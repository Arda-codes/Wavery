//! Rodio-backed implementation of PlayerEngine using a dedicated worker thread
//! to safely own non-Send `rodio::OutputStream` and manage audio stream lifecycles.

use async_trait::async_trait;
use parking_lot::Mutex;
use rodio::{Decoder, OutputStream, Sink, Source};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::mpsc::{channel, sync_channel, Sender, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;
use wavery_core::error::AudioError;
use wavery_core::models::{PlaybackState, Track};
use wavery_core::traits::PlayerEngine;

use crate::opus::OpusSource;

/// Buffer capacity for high-throughput audio stream decoding (64 KB).
const AUDIO_BUFFER_CAPACITY: usize = 64 * 1024;

/// Unified audio source covering both standard formats (via Rodio/Symphonia)
/// and Ogg Opus containers (via pure-Rust `OpusSource`).
pub enum AudioSource {
    Rodio(Decoder<BufReader<File>>),
    Opus(Box<OpusSource<BufReader<File>>>),
}

impl Iterator for AudioSource {
    type Item = i16;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::Rodio(d) => d.next(),
            Self::Opus(o) => o.next(),
        }
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        match self {
            Self::Rodio(d) => d.size_hint(),
            Self::Opus(o) => o.size_hint(),
        }
    }
}

impl Source for AudioSource {
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        match self {
            Self::Rodio(d) => d.current_frame_len(),
            Self::Opus(o) => o.current_frame_len(),
        }
    }

    #[inline]
    fn channels(&self) -> u16 {
        match self {
            Self::Rodio(d) => d.channels(),
            Self::Opus(o) => o.channels(),
        }
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        match self {
            Self::Rodio(d) => d.sample_rate(),
            Self::Opus(o) => o.sample_rate(),
        }
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        match self {
            Self::Rodio(d) => d.total_duration(),
            Self::Opus(o) => o.total_duration(),
        }
    }

    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        match self {
            Self::Rodio(d) => d.try_seek(pos),
            Self::Opus(o) => o.try_seek(pos),
        }
    }
}

/// Computes a linear amplitude multiplier from a ReplayGain dB adjustment and peak ratio,
/// enforcing anti-clipping (`multiplier * peak <= 1.0`) and hard safety bounds (`[0.0001, 2.0]`).
#[must_use]
pub fn compute_loudness_attenuation(
    gain_db: Option<f32>,
    peak: Option<f32>,
    mode: &str,
    pre_amp_db: f32,
) -> f32 {
    let normalized_mode = mode.trim().to_ascii_lowercase();
    if normalized_mode != "track" && normalized_mode != "album" {
        return 1.0;
    }

    let Some(gain) = gain_db.filter(|g| g.is_finite()) else {
        return 1.0;
    };

    let safe_pre_amp = if pre_amp_db.is_finite() {
        pre_amp_db
    } else {
        0.0
    };
    let clamped_gain = (gain + safe_pre_amp).clamp(-60.0, 30.0);
    let mut multiplier = 10.0_f32.powf(clamped_gain / 20.0);

    if let Some(p) = peak.filter(|&p| p.is_finite() && p > 0.0) {
        if multiplier * p > 1.0 {
            multiplier = 1.0 / p;
        }
    }

    multiplier.clamp(0.0001, 2.0)
}

/// Calculates the perceptual loudness linear gain multiplier for a given [`Track`] and ReplayGain mode.
///
/// Supports `"track"`, `"album"`, and `"off"` modes (case-insensitive), falling back between
/// track and album ReplayGain tags when the primary tag is absent, and applying peak-based
/// anti-clipping protection.
#[must_use]
pub fn calculate_replay_gain_multiplier(track: &Track, mode: &str, pre_amp_db: f32) -> f32 {
    let normalized_mode = mode.trim().to_ascii_lowercase();
    let (gain_db, peak) = match normalized_mode.as_str() {
        "album" => (
            track
                .metadata
                .replaygain_album_gain
                .filter(|g| g.is_finite())
                .or_else(|| {
                    track
                        .metadata
                        .replaygain_track_gain
                        .filter(|g| g.is_finite())
                }),
            track
                .metadata
                .replaygain_album_peak
                .filter(|&p| p.is_finite() && p > 0.0)
                .or_else(|| {
                    track
                        .metadata
                        .replaygain_track_peak
                        .filter(|&p| p.is_finite() && p > 0.0)
                }),
        ),
        "track" => (
            track
                .metadata
                .replaygain_track_gain
                .filter(|g| g.is_finite())
                .or_else(|| {
                    track
                        .metadata
                        .replaygain_album_gain
                        .filter(|g| g.is_finite())
                }),
            track
                .metadata
                .replaygain_track_peak
                .filter(|&p| p.is_finite() && p > 0.0)
                .or_else(|| {
                    track
                        .metadata
                        .replaygain_album_peak
                        .filter(|&p| p.is_finite() && p > 0.0)
                }),
        ),
        _ => return 1.0,
    };

    compute_loudness_attenuation(gain_db, peak, &normalized_mode, pre_amp_db)
}

/// Attempts to open and decode an audio stream from disk, first checking for Opus files,
/// then trying standard automatic format probing via Rodio/Symphonia, with fallbacks for
/// format-hinted decoders (e.g. for ISO MP4/M4A, AAC, FLAC, WAV, and Vorbis/Opus containers).
fn open_decoder_from_path(path: &Path) -> Result<AudioSource, AudioError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    if ext == "opus" {
        let file = File::open(path).map_err(|_| AudioError::FileNotFound(path.to_path_buf()))?;
        let reader = BufReader::with_capacity(AUDIO_BUFFER_CAPACITY, file);
        return OpusSource::new(reader)
            .map(Box::new)
            .map(AudioSource::Opus);
    }

    let file = File::open(path).map_err(|_| AudioError::FileNotFound(path.to_path_buf()))?;
    let reader = BufReader::with_capacity(AUDIO_BUFFER_CAPACITY, file);
    match Decoder::new(reader) {
        Ok(source) => Ok(AudioSource::Rodio(source)),
        Err(orig_err) => {
            let retry_file =
                File::open(path).map_err(|_| AudioError::FileNotFound(path.to_path_buf()))?;
            let retry_reader = BufReader::with_capacity(AUDIO_BUFFER_CAPACITY, retry_file);

            match ext.as_str() {
                "m4a" => rodio::Decoder::new_mp4(retry_reader, rodio::decoder::Mp4Type::M4a)
                    .map(AudioSource::Rodio)
                    .map_err(|e| AudioError::DecoderError(e.to_string())),
                "mp4" | "m4b" | "m4p" => {
                    rodio::Decoder::new_mp4(retry_reader, rodio::decoder::Mp4Type::Mp4)
                        .map(AudioSource::Rodio)
                        .map_err(|e| AudioError::DecoderError(e.to_string()))
                }
                "aac" => rodio::Decoder::new_aac(retry_reader)
                    .map(AudioSource::Rodio)
                    .map_err(|e| AudioError::DecoderError(e.to_string())),
                "flac" => rodio::Decoder::new_flac(retry_reader)
                    .map(AudioSource::Rodio)
                    .map_err(|e| AudioError::DecoderError(e.to_string())),
                "ogg" | "oga" => {
                    // Try Vorbis first, fallback to Opus container if Vorbis fails
                    match rodio::Decoder::new_vorbis(retry_reader) {
                        Ok(source) => Ok(AudioSource::Rodio(source)),
                        Err(_) => {
                            let opus_file = File::open(path)
                                .map_err(|_| AudioError::FileNotFound(path.to_path_buf()))?;
                            let opus_reader =
                                BufReader::with_capacity(AUDIO_BUFFER_CAPACITY, opus_file);
                            OpusSource::new(opus_reader)
                                .map(Box::new)
                                .map(AudioSource::Opus)
                        }
                    }
                }
                "wav" => rodio::Decoder::new_wav(retry_reader)
                    .map(AudioSource::Rodio)
                    .map_err(|e| AudioError::DecoderError(e.to_string())),
                "mp3" => rodio::Decoder::new_mp3(retry_reader)
                    .map(AudioSource::Rodio)
                    .map_err(|e| AudioError::DecoderError(e.to_string())),
                _ => {
                    // One final attempt with OpusSource before returning error
                    let opus_file = File::open(path)
                        .map_err(|_| AudioError::FileNotFound(path.to_path_buf()))?;
                    let opus_reader = BufReader::with_capacity(AUDIO_BUFFER_CAPACITY, opus_file);
                    OpusSource::new(opus_reader)
                        .map(Box::new)
                        .map(AudioSource::Opus)
                        .map_err(|_| AudioError::DecoderError(orig_err.to_string()))
                }
            }
        }
    }
}

struct FadingSink {
    sink: Sink,
    start_instant: Instant,
    duration: Duration,
    initial_volume: f32,
}

struct FadingInSink {
    start_instant: Instant,
    duration: Duration,
    target_volume: f32,
}

enum AudioCommand {
    Load {
        track: Box<Track>,
        start_position: Option<Duration>,
        reply: oneshot::Sender<Result<(), AudioError>>,
    },
    Play {
        reply: SyncSender<Result<(), AudioError>>,
    },
    Pause {
        reply: SyncSender<Result<(), AudioError>>,
    },
    Stop {
        reply: SyncSender<Result<(), AudioError>>,
    },
    Seek {
        position: Duration,
        reply: SyncSender<Result<(), AudioError>>,
    },
    SetVolume(f32),
    SetCrossfade(Duration),
    SetReplayGainMode(String),
    Shutdown,
}

struct SharedState {
    playback_state: PlaybackState,
    volume: f32,
    replay_gain_mode: String,
    play_start_instant: Option<Instant>,
    accumulated_pos: Duration,
    total_duration: Option<Duration>,
}

/// Thread-safe audio player implementing PlayerEngine.
pub struct RodioPlayer {
    tx: Sender<AudioCommand>,
    shared: Arc<Mutex<SharedState>>,
}

impl RodioPlayer {
    /// Initializes the audio worker thread and output stream.
    ///
    /// # Errors
    /// Returns `AudioError::SinkError` if the output audio device cannot be initialized.
    pub fn try_new() -> Result<Self, AudioError> {
        let (cmd_tx, cmd_rx) = channel::<AudioCommand>();
        let (init_tx, init_rx) = channel::<Result<(), AudioError>>();

        let shared = Arc::new(Mutex::new(SharedState {
            playback_state: PlaybackState::Stopped,
            volume: 0.8,
            replay_gain_mode: String::from("off"),
            play_start_instant: None,
            accumulated_pos: Duration::ZERO,
            total_duration: None,
        }));

        let shared_clone = Arc::clone(&shared);

        thread::spawn(move || {
            let stream_res = OutputStream::try_default();
            let (mut _stream, mut stream_handle) = match stream_res {
                Ok((s, h)) => {
                    let _ = init_tx.send(Ok(()));
                    (s, h)
                }
                Err(e) => {
                    let _ = init_tx.send(Err(AudioError::SinkError(e.to_string())));
                    return;
                }
            };

            let mut active_sink: Option<Sink> = None;
            let mut current_track: Option<Box<Track>> = None;
            let mut fading_out_sinks: Vec<FadingSink> = Vec::new();
            let mut fading_in: Option<FadingInSink> = None;
            let mut crossfade_duration: Duration = Duration::ZERO;
            let mut current_volume: f32 = 0.8;
            let mut replay_gain_mode = String::from("off");
            let mut current_rg_multiplier: f32 = 1.0;

            loop {
                let cmd_res = cmd_rx.recv_timeout(Duration::from_millis(20));

                // Process tick fade updates
                fading_out_sinks.retain_mut(|fade| {
                    let elapsed = fade.start_instant.elapsed();
                    if elapsed >= fade.duration {
                        fade.sink.stop();
                        false
                    } else {
                        let t =
                            (elapsed.as_secs_f32() / fade.duration.as_secs_f32()).clamp(0.0, 1.0);
                        let out_gain = (t * std::f32::consts::FRAC_PI_2).cos();
                        fade.sink
                            .set_volume((fade.initial_volume * out_gain).clamp(0.0, 1.0));
                        true
                    }
                });

                if let Some(fade) = &fading_in {
                    let elapsed = fade.start_instant.elapsed();
                    if elapsed >= fade.duration {
                        if let Some(sink) = &active_sink {
                            sink.set_volume(fade.target_volume);
                        }
                        fading_in = None;
                    } else {
                        let t =
                            (elapsed.as_secs_f32() / fade.duration.as_secs_f32()).clamp(0.0, 1.0);
                        let in_gain = (t * std::f32::consts::FRAC_PI_2).sin();
                        if let Some(sink) = &active_sink {
                            sink.set_volume((fade.target_volume * in_gain).clamp(0.0, 1.0));
                        }
                    }
                }

                match cmd_res {
                    Ok(AudioCommand::SetCrossfade(duration)) => {
                        crossfade_duration = duration;
                    }
                    Ok(AudioCommand::SetReplayGainMode(mode)) => {
                        replay_gain_mode = mode;
                        current_rg_multiplier = current_track.as_deref().map_or(1.0, |tr| {
                            calculate_replay_gain_multiplier(tr, &replay_gain_mode, 0.0)
                        });
                        let effective_volume =
                            (current_volume * current_rg_multiplier).clamp(0.0, 1.0);
                        if fading_in.is_none() {
                            if let Some(sink) = &active_sink {
                                sink.set_volume(effective_volume);
                            }
                        } else if let Some(fade) = &mut fading_in {
                            fade.target_volume = effective_volume;
                        }
                    }
                    Ok(AudioCommand::Load {
                        track,
                        start_position,
                        reply,
                    }) => {
                        let path = track.source.path();
                        if !path.exists() {
                            let _ = reply.send(Err(AudioError::FileNotFound(path.clone())));
                            continue;
                        }

                        let old_effective_volume =
                            (current_volume * current_rg_multiplier).clamp(0.0, 1.0);
                        current_rg_multiplier =
                            calculate_replay_gain_multiplier(&track, &replay_gain_mode, 0.0);
                        let effective_volume =
                            (current_volume * current_rg_multiplier).clamp(0.0, 1.0);
                        current_track = Some(track.clone());

                        let res = (|| -> Result<(), AudioError> {
                            let source = open_decoder_from_path(path)?;

                            let sink = match Sink::try_new(&stream_handle) {
                                Ok(s) => s,
                                Err(_) => {
                                    // Automatic CPAL device re-initialization if device was disconnected or changed
                                    match OutputStream::try_default() {
                                        Ok((new_stream, new_handle)) => {
                                            _stream = new_stream;
                                            stream_handle = new_handle;
                                            Sink::try_new(&stream_handle)
                                                .map_err(|e| AudioError::SinkError(e.to_string()))?
                                        }
                                        Err(e) => {
                                            return Err(AudioError::SinkError(format!(
                                                "Audio output device lost and auto-reinitialization failed: {e}"
                                            )));
                                        }
                                    }
                                }
                            };

                            let start = start_position.unwrap_or(Duration::ZERO);
                            let was_playing =
                                shared_clone.lock().playback_state == PlaybackState::Playing;

                            if crossfade_duration > Duration::ZERO
                                && was_playing
                                && active_sink.is_some()
                            {
                                // Calculate actual volume of outgoing sink to prevent volume pop
                                let old_initial_volume = if let Some(fade) = &fading_in {
                                    let elapsed = fade.start_instant.elapsed();
                                    if elapsed >= fade.duration {
                                        old_effective_volume
                                    } else {
                                        let t = (elapsed.as_secs_f32()
                                            / fade.duration.as_secs_f32())
                                        .clamp(0.0, 1.0);
                                        let in_gain = (t * std::f32::consts::FRAC_PI_2).sin();
                                        (fade.target_volume * in_gain).clamp(0.0, 1.0)
                                    }
                                } else {
                                    old_effective_volume
                                };

                                // --- Dual-sink Equal-Power Crossfade ---
                                if let Some(old) = active_sink.take() {
                                    while fading_out_sinks.len() >= 3 {
                                        let f = fading_out_sinks.remove(0);
                                        f.sink.stop();
                                    }
                                    fading_out_sinks.push(FadingSink {
                                        sink: old,
                                        start_instant: Instant::now(),
                                        duration: crossfade_duration,
                                        initial_volume: old_initial_volume,
                                    });
                                }
                                sink.set_volume(0.0);
                                if start > Duration::ZERO {
                                    sink.append(source.skip_duration(start));
                                } else {
                                    sink.append(source);
                                }
                                active_sink = Some(sink);
                                fading_in = Some(FadingInSink {
                                    start_instant: Instant::now(),
                                    duration: crossfade_duration,
                                    target_volume: effective_volume,
                                });
                            } else {
                                // --- Instant Switch (stopped, paused, or crossfade = 0) ---
                                for f in fading_out_sinks.drain(..) {
                                    f.sink.stop();
                                }
                                fading_in = None;
                                if let Some(old) = active_sink.take() {
                                    old.stop();
                                }
                                sink.set_volume(effective_volume);
                                if start > Duration::ZERO {
                                    sink.append(source.skip_duration(start));
                                } else {
                                    sink.append(source);
                                }
                                active_sink = Some(sink);
                            }

                            let mut st = shared_clone.lock();
                            st.playback_state = PlaybackState::Playing;
                            st.play_start_instant = Some(Instant::now());
                            st.accumulated_pos = start;
                            st.total_duration = Some(track.metadata.duration);

                            Ok(())
                        })();

                        let _ = reply.send(res);
                    }
                    Ok(AudioCommand::Play { reply }) => {
                        let res = if let Some(sink) = &active_sink {
                            let mut st = shared_clone.lock();
                            if st.playback_state == PlaybackState::Paused {
                                sink.play();
                                for f in &fading_out_sinks {
                                    f.sink.play();
                                }
                                st.playback_state = PlaybackState::Playing;
                                st.play_start_instant = Some(Instant::now());
                            }
                            Ok(())
                        } else {
                            Ok(())
                        };
                        let _ = reply.send(res);
                    }
                    Ok(AudioCommand::Pause { reply }) => {
                        let res = if let Some(sink) = &active_sink {
                            let mut st = shared_clone.lock();
                            if st.playback_state == PlaybackState::Playing {
                                sink.pause();
                                for f in &fading_out_sinks {
                                    f.sink.pause();
                                }
                                if let Some(start) = st.play_start_instant.take() {
                                    st.accumulated_pos += start.elapsed();
                                }
                                st.playback_state = PlaybackState::Paused;
                            }
                            Ok(())
                        } else {
                            Ok(())
                        };
                        let _ = reply.send(res);
                    }
                    Ok(AudioCommand::Stop { reply }) => {
                        for f in fading_out_sinks.drain(..) {
                            f.sink.stop();
                        }
                        fading_in = None;
                        current_track = None;
                        current_rg_multiplier = 1.0;
                        if let Some(sink) = active_sink.take() {
                            sink.stop();
                        }
                        let mut st = shared_clone.lock();
                        st.playback_state = PlaybackState::Stopped;
                        st.play_start_instant = None;
                        st.accumulated_pos = Duration::ZERO;
                        let _ = reply.send(Ok(()));
                    }
                    Ok(AudioCommand::Seek { position, reply }) => {
                        for f in fading_out_sinks.drain(..) {
                            f.sink.stop();
                        }
                        fading_in = None;
                        let target_pos = {
                            let st = shared_clone.lock();
                            if let Some(dur) = st.total_duration {
                                position.min(dur)
                            } else {
                                position
                            }
                        };
                        let effective_volume =
                            (current_volume * current_rg_multiplier).clamp(0.0, 1.0);
                        let res = if let Some(sink) = &active_sink {
                            sink.set_volume(effective_volume);
                            match sink.try_seek(target_pos) {
                                Ok(()) => {
                                    let mut st = shared_clone.lock();
                                    st.accumulated_pos = target_pos;
                                    if st.playback_state == PlaybackState::Playing {
                                        st.play_start_instant = Some(Instant::now());
                                    }
                                    Ok(())
                                }
                                Err(e) => {
                                    // Fallback: If try_seek failed on current decoder, re-open track at position
                                    if let Some(ref tr) = current_track {
                                        let path = tr.source.path();
                                        if let Ok(source) = open_decoder_from_path(path) {
                                            if let Ok(new_sink) = Sink::try_new(&stream_handle)
                                            {
                                                new_sink.set_volume(effective_volume);
                                                let skipped = source.skip_duration(target_pos);
                                                new_sink.append(skipped);
                                                let was_playing =
                                                    shared_clone.lock().playback_state
                                                        == PlaybackState::Playing;
                                                if !was_playing {
                                                    new_sink.pause();
                                                }
                                                sink.stop();
                                                active_sink = Some(new_sink);
                                                let mut st = shared_clone.lock();
                                                st.accumulated_pos = target_pos;
                                                if was_playing {
                                                    st.play_start_instant =
                                                        Some(Instant::now());
                                                }
                                                Ok(())
                                            } else {
                                                Err(AudioError::DecoderError(e.to_string()))
                                            }
                                        } else {
                                            Err(AudioError::DecoderError(e.to_string()))
                                        }
                                    } else {
                                        Err(AudioError::DecoderError(e.to_string()))
                                    }
                                }
                            }
                        } else {
                            let mut st = shared_clone.lock();
                            if let Some(dur) = st.total_duration {
                                st.accumulated_pos = target_pos.min(dur);
                            } else {
                                st.accumulated_pos = Duration::ZERO;
                            }
                            Ok(())
                        };
                        let _ = reply.send(res);
                    }
                    Ok(AudioCommand::SetVolume(vol)) => {
                        let clamped = if vol.is_nan() {
                            0.0
                        } else {
                            vol.clamp(0.0, 1.0)
                        };
                        current_volume = clamped;
                        let effective_volume =
                            (current_volume * current_rg_multiplier).clamp(0.0, 1.0);
                        if fading_in.is_none() {
                            if let Some(sink) = &active_sink {
                                sink.set_volume(effective_volume);
                            }
                        } else if let Some(fade) = &mut fading_in {
                            fade.target_volume = effective_volume;
                        }
                        for f in &fading_out_sinks {
                            f.sink.set_volume(effective_volume);
                        }
                    }
                    Ok(AudioCommand::Shutdown) => {
                        for f in fading_out_sinks.drain(..) {
                            f.sink.stop();
                        }
                        if let Some(sink) = active_sink.take() {
                            sink.stop();
                        }
                        break;
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        for f in fading_out_sinks.drain(..) {
                            f.sink.stop();
                        }
                        if let Some(sink) = active_sink.take() {
                            sink.stop();
                        }
                        break;
                    }
                }

                // Check if active track has finished playing naturally (prevent starvation under rapid commands)
                if let Some(ref sink) = active_sink {
                    if sink.empty() && fading_out_sinks.is_empty() {
                        let mut st = shared_clone.lock();
                        if st.playback_state == PlaybackState::Playing {
                            st.playback_state = PlaybackState::Stopped;
                            st.play_start_instant = None;
                            if let Some(dur) = st.total_duration {
                                st.accumulated_pos = dur;
                            }
                        }
                    }
                }
            }
        });

        match init_rx.recv() {
            Ok(Ok(())) => Ok(Self { tx: cmd_tx, shared }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(AudioError::SinkError(
                "Audio thread failed to initialize".into(),
            )),
        }
    }

    /// Sets the perceptual loudness normalization mode (`"off"`, `"track"`, or `"album"`),
    /// dynamically recalculating and applying ReplayGain attenuation to the active stream.
    pub fn set_replay_gain_mode(&mut self, mode: &str) {
        let normalized = match mode.trim().to_ascii_lowercase().as_str() {
            "track" => String::from("track"),
            "album" => String::from("album"),
            _ => String::from("off"),
        };
        self.shared.lock().replay_gain_mode = normalized.clone();
        let _ = self.tx.send(AudioCommand::SetReplayGainMode(normalized));
    }

    /// Returns the currently active perceptual loudness normalization mode (`"off"`, `"track"`, or `"album"`).
    #[must_use]
    pub fn replay_gain_mode(&self) -> String {
        self.shared.lock().replay_gain_mode.clone()
    }
}

impl Drop for RodioPlayer {
    fn drop(&mut self) {
        let _ = self.tx.send(AudioCommand::Shutdown);
    }
}

#[async_trait]
impl PlayerEngine for RodioPlayer {
    async fn load(
        &mut self,
        track: &Track,
        start_position: Option<Duration>,
    ) -> Result<(), AudioError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(AudioCommand::Load {
                track: Box::new(track.clone()),
                start_position,
                reply: reply_tx,
            })
            .map_err(|e| AudioError::SinkError(e.to_string()))?;

        reply_rx
            .await
            .map_err(|_| AudioError::SinkError("Worker dropped reply channel".into()))?
    }

    fn play(&mut self) -> Result<(), AudioError> {
        let (reply_tx, reply_rx) = sync_channel(1);
        self.tx
            .send(AudioCommand::Play { reply: reply_tx })
            .map_err(|e| AudioError::SinkError(e.to_string()))?;

        reply_rx
            .recv()
            .map_err(|_| AudioError::SinkError("Worker dropped reply channel".into()))?
    }

    fn pause(&mut self) -> Result<(), AudioError> {
        let (reply_tx, reply_rx) = sync_channel(1);
        self.tx
            .send(AudioCommand::Pause { reply: reply_tx })
            .map_err(|e| AudioError::SinkError(e.to_string()))?;

        reply_rx
            .recv()
            .map_err(|_| AudioError::SinkError("Worker dropped reply channel".into()))?
    }

    fn stop(&mut self) -> Result<(), AudioError> {
        let (reply_tx, reply_rx) = sync_channel(1);
        self.tx
            .send(AudioCommand::Stop { reply: reply_tx })
            .map_err(|e| AudioError::SinkError(e.to_string()))?;

        reply_rx
            .recv()
            .map_err(|_| AudioError::SinkError("Worker dropped reply channel".into()))?
    }

    fn seek(&mut self, position: Duration) -> Result<(), AudioError> {
        let (reply_tx, reply_rx) = sync_channel(1);
        self.tx
            .send(AudioCommand::Seek {
                position,
                reply: reply_tx,
            })
            .map_err(|e| AudioError::SinkError(e.to_string()))?;

        reply_rx
            .recv()
            .map_err(|_| AudioError::SinkError("Worker dropped reply channel".into()))?
    }

    fn set_volume(&mut self, volume: f32) {
        let clamped = if volume.is_nan() {
            0.0
        } else {
            volume.clamp(0.0, 1.0)
        };
        self.shared.lock().volume = clamped;
        let _ = self.tx.send(AudioCommand::SetVolume(clamped));
    }

    fn set_crossfade(&mut self, duration: Duration) {
        let _ = self.tx.send(AudioCommand::SetCrossfade(duration));
    }

    fn set_replay_gain_mode(&mut self, mode: &str) {
        RodioPlayer::set_replay_gain_mode(self, mode);
    }

    fn volume(&self) -> f32 {
        self.shared.lock().volume
    }

    fn state(&self) -> PlaybackState {
        self.shared.lock().playback_state
    }

    fn position(&self) -> Duration {
        let st = self.shared.lock();
        if st.playback_state == PlaybackState::Playing {
            if let Some(start) = st.play_start_instant {
                let pos = st.accumulated_pos + start.elapsed();
                if let Some(dur) = st.total_duration {
                    return pos.min(dur);
                }
                return pos;
            }
        }
        st.accumulated_pos
    }

    fn duration(&self) -> Option<Duration> {
        self.shared.lock().total_duration
    }
}

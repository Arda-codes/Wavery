//! Rodio-backed implementation of PlayerEngine using a dedicated worker thread
//! to safely own non-Send `rodio::OutputStream` and manage audio stream lifecycles.

use async_trait::async_trait;
use parking_lot::Mutex;
use rodio::{Decoder, OutputStream, Sink};
use std::fs::File;
use std::io::BufReader;
use std::sync::mpsc::{channel, sync_channel, Sender, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::oneshot;
use wavery_core::error::AudioError;
use wavery_core::models::{PlaybackState, Track};
use wavery_core::traits::PlayerEngine;

/// Buffer capacity for high-throughput audio stream decoding (64 KB).
const AUDIO_BUFFER_CAPACITY: usize = 64 * 1024;

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
    Shutdown,
}

struct SharedState {
    playback_state: PlaybackState,
    volume: f32,
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

            loop {
                let cmd_res = cmd_rx.recv_timeout(Duration::from_millis(20));

                // Process tick fade updates
                fading_out_sinks.retain_mut(|fade| {
                    let elapsed = fade.start_instant.elapsed();
                    if elapsed >= fade.duration {
                        fade.sink.stop();
                        false
                    } else {
                        let t = (elapsed.as_secs_f32() / fade.duration.as_secs_f32()).clamp(0.0, 1.0);
                        let out_gain = (t * std::f32::consts::FRAC_PI_2).cos();
                        fade.sink.set_volume((fade.initial_volume * out_gain).clamp(0.0, 1.0));
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
                        let t = (elapsed.as_secs_f32() / fade.duration.as_secs_f32()).clamp(0.0, 1.0);
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
                    Ok(AudioCommand::Load {
                        track,
                        start_position,
                        reply,
                    }) => {
                        current_track = Some(track.clone());
                        let path = track.source.path();
                        if !path.exists() {
                            let _ = reply.send(Err(AudioError::FileNotFound(path.clone())));
                            continue;
                        }

                        let res = (|| -> Result<(), AudioError> {
                            let file = File::open(path)
                                .map_err(|e| AudioError::DecoderError(e.to_string()))?;
                            let reader = BufReader::with_capacity(AUDIO_BUFFER_CAPACITY, file);
                            let source = Decoder::new(reader)
                                .map_err(|e| AudioError::DecoderError(e.to_string()))?;

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
                            if start > Duration::ZERO {
                                let _ = sink.try_seek(start);
                            }

                            let was_playing = shared_clone.lock().playback_state == PlaybackState::Playing;

                            if crossfade_duration > Duration::ZERO && was_playing && active_sink.is_some() {
                                // --- Dual-sink Equal-Power Crossfade ---
                                if let Some(old) = active_sink.take() {
                                    fading_out_sinks.push(FadingSink {
                                        sink: old,
                                        start_instant: Instant::now(),
                                        duration: crossfade_duration,
                                        initial_volume: current_volume,
                                    });
                                }
                                sink.set_volume(0.0);
                                sink.append(source);
                                active_sink = Some(sink);
                                fading_in = Some(FadingInSink {
                                    start_instant: Instant::now(),
                                    duration: crossfade_duration,
                                    target_volume: current_volume,
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
                                sink.set_volume(current_volume);
                                sink.append(source);
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
                        let res = if let Some(sink) = &active_sink {
                            sink.set_volume(current_volume);
                            match sink.try_seek(position) {
                                Ok(()) => {
                                    let mut st = shared_clone.lock();
                                    st.accumulated_pos = position;
                                    if st.playback_state == PlaybackState::Playing {
                                        st.play_start_instant = Some(Instant::now());
                                    }
                                    Ok(())
                                }
                                Err(e) => {
                                    // Fallback: If try_seek failed on current decoder, re-open track at position
                                    if let Some(ref tr) = current_track {
                                        let path = tr.source.path();
                                        if let Ok(file) = File::open(path) {
                                            let reader = BufReader::with_capacity(AUDIO_BUFFER_CAPACITY, file);
                                            if let Ok(source) = Decoder::new(reader) {
                                                if let Ok(new_sink) = Sink::try_new(&stream_handle) {
                                                    let _ = new_sink.try_seek(position);
                                                    new_sink.set_volume(current_volume);
                                                    new_sink.append(source);
                                                    let was_playing = shared_clone.lock().playback_state == PlaybackState::Playing;
                                                    if !was_playing {
                                                        new_sink.pause();
                                                    }
                                                    sink.stop();
                                                    active_sink = Some(new_sink);
                                                    let mut st = shared_clone.lock();
                                                    st.accumulated_pos = position;
                                                    if was_playing {
                                                        st.play_start_instant = Some(Instant::now());
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
                                    } else {
                                        Err(AudioError::DecoderError(e.to_string()))
                                    }
                                }
                            }
                        } else {
                            let mut st = shared_clone.lock();
                            if let Some(dur) = st.total_duration {
                                st.accumulated_pos = position.min(dur);
                            } else {
                                st.accumulated_pos = Duration::ZERO;
                            }
                            Ok(())
                        };
                        let _ = reply.send(res);
                    }
                    Ok(AudioCommand::SetVolume(vol)) => {
                        let clamped = vol.clamp(0.0, 1.0);
                        current_volume = clamped;
                        if fading_in.is_none() {
                            if let Some(sink) = &active_sink {
                                sink.set_volume(clamped);
                            }
                        } else if let Some(fade) = &mut fading_in {
                            fade.target_volume = clamped;
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
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
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
            }
        });

        match init_rx.recv() {
            Ok(Ok(())) => Ok(Self { tx: cmd_tx, shared }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(AudioError::SinkError("Audio thread failed to initialize".into())),
        }
    }
}

impl Drop for RodioPlayer {
    fn drop(&mut self) {
        let _ = self.tx.send(AudioCommand::Shutdown);
    }
}

#[async_trait]
impl PlayerEngine for RodioPlayer {
    async fn load(&mut self, track: &Track, start_position: Option<Duration>) -> Result<(), AudioError> {
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
        let clamped = volume.clamp(0.0, 1.0);
        self.shared.lock().volume = clamped;
        let _ = self.tx.send(AudioCommand::SetVolume(clamped));
    }

    fn set_crossfade(&mut self, duration: Duration) {
        let _ = self.tx.send(AudioCommand::SetCrossfade(duration));
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

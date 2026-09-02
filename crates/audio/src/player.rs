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

            loop {
                match cmd_rx.recv_timeout(Duration::from_millis(50)) {
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

                            let current_vol = shared_clone.lock().volume;
                            sink.set_volume(current_vol);
                            sink.append(source);

                            let start = start_position.unwrap_or(Duration::ZERO);
                            if start > Duration::ZERO {
                                let _ = sink.try_seek(start);
                            }

                            if let Some(old) = active_sink.take() {
                                old.stop();
                            }
                            active_sink = Some(sink);

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
                        let res = if let Some(sink) = &active_sink {
                            match sink.try_seek(position) {
                                Ok(()) => {
                                    let mut st = shared_clone.lock();
                                    st.accumulated_pos = position;
                                    if st.playback_state == PlaybackState::Playing {
                                        st.play_start_instant = Some(Instant::now());
                                    }
                                    Ok(())
                                }
                                Err(e) => Err(AudioError::DecoderError(e.to_string())),
                            }
                        } else {
                            Ok(())
                        };
                        let _ = reply.send(res);
                    }
                    Ok(AudioCommand::SetVolume(vol)) => {
                        let clamped = vol.clamp(0.0, 1.0);
                        shared_clone.lock().volume = clamped;
                        if let Some(sink) = &active_sink {
                            sink.set_volume(clamped);
                        }
                    }
                    Ok(AudioCommand::Shutdown) => {
                        if let Some(sink) = active_sink.take() {
                            sink.stop();
                        }
                        break;
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if let Some(ref sink) = active_sink {
                            if sink.empty() {
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

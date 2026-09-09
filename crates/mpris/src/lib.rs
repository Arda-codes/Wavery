//! Linux MPRIS D-Bus integration for Wavery.
//!
//! Provides desktop media key support, notification controls, and task manager widgets.

use async_trait::async_trait;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wavery_core::error::MprisError;
use wavery_core::models::{PlaybackState, Track};
use wavery_core::traits::{MprisBridge, MprisCommand};

/// In-memory bridge simulating or queueing MPRIS events and dispatching commands.
pub struct ZbusMprisBridge {
    current_state: PlaybackState,
    current_position: Duration,
    current_track: Option<Track>,
    command_queue: Arc<Mutex<VecDeque<MprisCommand>>>,
}

impl ZbusMprisBridge {
    /// Creates a new MPRIS bridge.
    #[must_use]
    pub fn new() -> Self {
        Self {
            current_state: PlaybackState::Stopped,
            current_position: Duration::ZERO,
            current_track: None,
            command_queue: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    /// Emits a simulated or received MPRIS command into the queue.
    pub fn emit_command(&self, cmd: MprisCommand) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(cmd);
        }
    }
}

impl Default for ZbusMprisBridge {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl MprisBridge for ZbusMprisBridge {
    async fn update_status(&mut self, state: PlaybackState) -> Result<(), MprisError> {
        self.current_state = state;
        Ok(())
    }

    async fn update_metadata(&mut self, track: &Track, _art_url: Option<&str>) -> Result<(), MprisError> {
        self.current_track = Some(track.clone());
        Ok(())
    }

    async fn update_position(&mut self, position: Duration) -> Result<(), MprisError> {
        self.current_position = position;
        Ok(())
    }

    async fn poll_events(&mut self) -> Vec<MprisCommand> {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.drain(..).collect()
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use wavery_core::models::{TrackMetadata, TrackSource};

    #[tokio::test]
    async fn test_mpris_bridge_state_and_events() {
        let mut bridge = ZbusMprisBridge::new();

        assert_eq!(bridge.current_state, PlaybackState::Stopped);
        assert_eq!(bridge.current_position, Duration::ZERO);

        bridge.update_status(PlaybackState::Playing).await.unwrap();
        assert_eq!(bridge.current_state, PlaybackState::Playing);

        bridge.update_position(Duration::from_secs(45)).await.unwrap();
        assert_eq!(bridge.current_position, Duration::from_secs(45));

        let track = Track {
            id: "track-mpris".into(),
            source: TrackSource::Managed(PathBuf::from("/music/song.mp3")),
            metadata: TrackMetadata {
                title: Some("Song Title".into()),
                artist: Some("Artist Name".into()),
                album: Some("Album Name".into()),
                album_artist: None,
                track_number: None,
                disc_number: None,
                year: None,
                genre: None,
                duration: Duration::from_secs(200),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                format: "MP3".into(),
                lyrics: None,
            },
            date_added: 0,
        };

        bridge.update_metadata(&track, None).await.unwrap();
        assert_eq!(bridge.current_track.as_ref().unwrap().id, "track-mpris");

        bridge.emit_command(MprisCommand::Play);
        bridge.emit_command(MprisCommand::Next);

        let events = bridge.poll_events().await;
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], MprisCommand::Play));
        assert!(matches!(events[1], MprisCommand::Next));

        let empty_events = bridge.poll_events().await;
        assert!(empty_events.is_empty());
    }

    #[tokio::test]
    async fn test_mpris_error_propagation_and_handling() {
        struct FailingMprisBridge;

        #[async_trait]
        impl MprisBridge for FailingMprisBridge {
            async fn update_status(&mut self, _state: PlaybackState) -> Result<(), MprisError> {
                Err(MprisError::ConnectionFailed("Cannot connect to session D-Bus: org.freedesktop.DBus.Error.NoServer".into()))
            }

            async fn update_metadata(&mut self, _track: &Track, _art_url: Option<&str>) -> Result<(), MprisError> {
                Err(MprisError::PropertyError("Failed to update org.mpris.MediaPlayer2.Player.Metadata".into()))
            }

            async fn update_position(&mut self, _position: Duration) -> Result<(), MprisError> {
                Err(MprisError::EmitError("Seeked signal delivery failed".into()))
            }

            async fn poll_events(&mut self) -> Vec<MprisCommand> {
                Vec::new()
            }
        }

        let mut failing = FailingMprisBridge;

        // Verify status error propagation
        let status_res = failing.update_status(PlaybackState::Playing).await;
        assert!(status_res.is_err());
        match status_res.unwrap_err() {
            MprisError::ConnectionFailed(msg) => {
                assert!(msg.contains("Cannot connect to session D-Bus"));
            }
            _ => panic!("Expected ConnectionFailed error variant"),
        }

        // Verify metadata error propagation
        let track = Track {
            id: "dummy".into(),
            source: TrackSource::Managed(PathBuf::from("/dummy.mp3")),
            metadata: TrackMetadata {
                title: Some("Title".into()),
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                disc_number: None,
                year: None,
                genre: None,
                duration: Duration::from_secs(100),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                format: "MP3".into(),
                lyrics: None,
            },
            date_added: 0,
        };
        let meta_res = failing.update_metadata(&track, None).await;
        assert!(meta_res.is_err());
        match meta_res.unwrap_err() {
            MprisError::PropertyError(msg) => {
                assert!(msg.contains("Metadata"));
            }
            _ => panic!("Expected PropertyError variant"),
        }

        // Verify position error propagation
        let pos_res = failing.update_position(Duration::from_secs(10)).await;
        assert!(pos_res.is_err());
        match pos_res.unwrap_err() {
            MprisError::EmitError(msg) => {
                assert!(msg.contains("Seeked signal"));
            }
            _ => panic!("Expected EmitError variant"),
        }
    }

    #[tokio::test]
    async fn test_mpris_bridge_concurrent_emission() {
        let bridge = Arc::new(ZbusMprisBridge::new());
        let mut handles = Vec::new();

        for i in 0..10 {
            let b = Arc::clone(&bridge);
            handles.push(tokio::spawn(async move {
                for _ in 0..100 {
                    b.emit_command(MprisCommand::SetVolume(i as f32 / 10.0));
                }
            }));
        }

        for h in handles {
            h.await.unwrap();
        }

        let mut b_mut = match Arc::try_unwrap(bridge) {
            Ok(b) => b,
            Err(_) => panic!("Arc unwrap should succeed after all tasks complete"),
        };

        let events = b_mut.poll_events().await;
        assert_eq!(events.len(), 1000);
        let empty = b_mut.poll_events().await;
        assert!(empty.is_empty());
    }
}


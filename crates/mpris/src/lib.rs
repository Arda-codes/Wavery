//! Linux MPRIS D-Bus integration for Wavery.
//!
//! Provides desktop media key support, notification controls, and task manager widgets
//! by exporting standard `org.mpris.MediaPlayer2` and `org.mpris.MediaPlayer2.Player`
//! interfaces over Session D-Bus.

use async_trait::async_trait;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wavery_core::error::MprisError;
use wavery_core::models::{PlaybackState, Track};
use wavery_core::traits::{MprisBridge, MprisCommand};

/// Shared state of the MPRIS player.
#[derive(Debug, Clone)]
pub struct MprisState {
    pub current_state: PlaybackState,
    pub current_position: Duration,
    pub current_track: Option<Track>,
    pub current_art_url: Option<String>,
}

impl Default for MprisState {
    fn default() -> Self {
        Self {
            current_state: PlaybackState::Stopped,
            current_position: Duration::ZERO,
            current_track: None,
            current_art_url: None,
        }
    }
}

#[cfg(target_os = "linux")]
struct MprisRoot {
    command_queue: Arc<Mutex<VecDeque<MprisCommand>>>,
}

#[cfg(target_os = "linux")]
#[zbus::interface(name = "org.mpris.MediaPlayer2")]
impl MprisRoot {
    #[zbus(property)]
    fn can_quit(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_raise(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn has_track_list(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn identity(&self) -> &str {
        "Wavery"
    }

    #[zbus(property)]
    fn supported_uri_schemes(&self) -> &[&str] {
        &["file"]
    }

    #[zbus(property)]
    fn supported_mime_types(&self) -> &[&str] {
        &[
            "audio/mpeg",
            "audio/flac",
            "audio/ogg",
            "audio/wav",
            "audio/mp4",
            "audio/aac",
            "audio/opus",
        ]
    }

    fn quit(&self) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(MprisCommand::Stop);
        }
    }

    fn raise(&self) {
        // Desktop environment requests bringing the window forward
    }
}

#[cfg(target_os = "linux")]
struct MprisPlayer {
    state: Arc<Mutex<MprisState>>,
    command_queue: Arc<Mutex<VecDeque<MprisCommand>>>,
}

#[cfg(target_os = "linux")]
#[zbus::interface(name = "org.mpris.MediaPlayer2.Player")]
impl MprisPlayer {
    #[zbus(property)]
    fn playback_status(&self) -> String {
        if let Ok(s) = self.state.lock() {
            match s.current_state {
                PlaybackState::Playing => "Playing".to_string(),
                PlaybackState::Paused => "Paused".to_string(),
                PlaybackState::Stopped => "Stopped".to_string(),
            }
        } else {
            "Stopped".to_string()
        }
    }

    #[zbus(property)]
    fn loop_status(&self) -> &str {
        "None"
    }

    #[zbus(property)]
    fn rate(&self) -> f64 {
        1.0
    }

    #[zbus(property)]
    fn position(&self) -> i64 {
        if let Ok(s) = self.state.lock() {
            s.current_position.as_micros() as i64
        } else {
            0
        }
    }

    #[zbus(property)]
    fn volume(&self) -> f64 {
        1.0
    }

    #[zbus(property)]
    fn can_control(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_play(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_pause(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_seek(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_go_next(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_go_previous(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn metadata(&self) -> HashMap<String, zbus::zvariant::OwnedValue> {
        let mut map = HashMap::new();
        if let Ok(s) = self.state.lock() {
            if let Some(track) = &s.current_track {
                let track_id_path = format!("/org/wavery/Track/{}", track.id.replace('-', "_"));
                if let Ok(obj_path) = zbus::zvariant::ObjectPath::try_from(track_id_path) {
                    if let Ok(val) = zbus::zvariant::Value::from(obj_path).try_to_owned() {
                        map.insert("mpris:trackid".to_string(), val);
                    }
                }
                if let Some(title) = &track.metadata.title {
                    if let Ok(val) = zbus::zvariant::Value::from(title.clone()).try_to_owned() {
                        map.insert("xesam:title".to_string(), val);
                    }
                }
                if let Some(artist) = &track.metadata.artist {
                    if let Ok(val) = zbus::zvariant::Value::from(vec![artist.clone()]).try_to_owned() {
                        map.insert("xesam:artist".to_string(), val);
                    }
                }
                if let Some(album) = &track.metadata.album {
                    if let Ok(val) = zbus::zvariant::Value::from(album.clone()).try_to_owned() {
                        map.insert("xesam:album".to_string(), val);
                    }
                }
                let us = track.metadata.duration.as_micros() as i64;
                if us > 0 {
                    if let Ok(val) = zbus::zvariant::Value::from(us).try_to_owned() {
                        map.insert("mpris:length".to_string(), val);
                    }
                }
                if let Some(art) = &s.current_art_url {
                    if let Ok(val) = zbus::zvariant::Value::from(art.clone()).try_to_owned() {
                        map.insert("mpris:artUrl".to_string(), val);
                    }
                }
            }
        }
        map
    }

    fn next(&self) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(MprisCommand::Next);
        }
    }

    fn previous(&self) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(MprisCommand::Previous);
        }
    }

    fn pause(&self) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(MprisCommand::Pause);
        }
    }

    fn play_pause(&self) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(MprisCommand::TogglePlayPause);
        }
    }

    fn stop(&self) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(MprisCommand::Stop);
        }
    }

    fn play(&self) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(MprisCommand::Play);
        }
    }

    fn seek(&self, offset_us: i64) {
        if let Ok(mut queue) = self.command_queue.lock() {
            let dur = Duration::from_micros(offset_us.unsigned_abs());
            queue.push_back(MprisCommand::Seek(dur));
        }
    }

    fn set_position(&self, _track_id: zbus::zvariant::ObjectPath<'_>, position_us: i64) {
        if let Ok(mut queue) = self.command_queue.lock() {
            let dur = Duration::from_micros(position_us.unsigned_abs());
            queue.push_back(MprisCommand::SetPosition(dur));
        }
    }
}

/// Linux MPRIS D-Bus bridge that communicates with desktop media keys and status widgets.
pub struct ZbusMprisBridge {
    state: Arc<Mutex<MprisState>>,
    command_queue: Arc<Mutex<VecDeque<MprisCommand>>>,
    #[cfg(target_os = "linux")]
    connection: Option<zbus::Connection>,
}

impl ZbusMprisBridge {
    /// Creates a new MPRIS bridge in disconnected mode.
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(MprisState::default())),
            command_queue: Arc::new(Mutex::new(VecDeque::new())),
            #[cfg(target_os = "linux")]
            connection: None,
        }
    }

    /// Attempts to connect to Session D-Bus under `org.mpris.MediaPlayer2.wavery`.
    pub async fn try_connect_dbus(&mut self) -> Result<(), MprisError> {
        #[cfg(target_os = "linux")]
        {
            let root = MprisRoot {
                command_queue: Arc::clone(&self.command_queue),
            };
            let player = MprisPlayer {
                state: Arc::clone(&self.state),
                command_queue: Arc::clone(&self.command_queue),
            };

            match zbus::connection::Builder::session() {
                Ok(builder) => {
                    match builder
                        .name("org.mpris.MediaPlayer2.wavery")
                        .map_err(|e| MprisError::ConnectionFailed(e.to_string()))?
                        .serve_at("/org/mpris/MediaPlayer2", root)
                        .map_err(|e| MprisError::ConnectionFailed(e.to_string()))?
                        .serve_at("/org/mpris/MediaPlayer2", player)
                        .map_err(|e| MprisError::ConnectionFailed(e.to_string()))?
                        .build()
                        .await
                    {
                        Ok(conn) => {
                            self.connection = Some(conn);
                            tracing::info!("Registered MPRIS interface on org.mpris.MediaPlayer2.wavery");
                            Ok(())
                        }
                        Err(e) => {
                            tracing::warn!("Failed to establish MPRIS session D-Bus connection: {e}");
                            Err(MprisError::ConnectionFailed(e.to_string()))
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Session D-Bus unavailable: {e}");
                    Err(MprisError::ConnectionFailed(e.to_string()))
                }
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            Ok(())
        }
    }

    /// Emits a simulated or received MPRIS command into the queue.
    pub fn emit_command(&self, cmd: MprisCommand) {
        if let Ok(mut queue) = self.command_queue.lock() {
            queue.push_back(cmd);
        }
    }

    /// Returns the currently tracked track if any.
    #[must_use]
    pub fn current_track(&self) -> Option<Track> {
        self.state.lock().ok().and_then(|s| s.current_track.clone())
    }

    /// Returns the currently tracked playback state.
    #[must_use]
    pub fn current_state(&self) -> PlaybackState {
        self.state.lock().ok().map(|s| s.current_state).unwrap_or(PlaybackState::Stopped)
    }

    /// Returns the currently tracked position.
    #[must_use]
    pub fn current_position(&self) -> Duration {
        self.state.lock().ok().map(|s| s.current_position).unwrap_or(Duration::ZERO)
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
        if let Ok(mut s) = self.state.lock() {
            s.current_state = state;
        }
        Ok(())
    }

    async fn update_metadata(
        &mut self,
        track: &Track,
        art_url: Option<&str>,
    ) -> Result<(), MprisError> {
        if let Ok(mut s) = self.state.lock() {
            s.current_track = Some(track.clone());
            s.current_art_url = art_url.map(ToString::to_string);
        }
        Ok(())
    }

    async fn update_position(&mut self, position: Duration) -> Result<(), MprisError> {
        if let Ok(mut s) = self.state.lock() {
            s.current_position = position;
        }
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

        assert_eq!(bridge.current_state(), PlaybackState::Stopped);
        assert_eq!(bridge.current_position(), Duration::ZERO);

        bridge.update_status(PlaybackState::Playing).await.unwrap();
        assert_eq!(bridge.current_state(), PlaybackState::Playing);

        bridge
            .update_position(Duration::from_secs(45))
            .await
            .unwrap();
        assert_eq!(bridge.current_position(), Duration::from_secs(45));

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
                ..Default::default()
            },
            date_added: 0,
        };

        bridge.update_metadata(&track, None).await.unwrap();
        assert_eq!(bridge.current_track().as_ref().unwrap().id, "track-mpris");

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
                Err(MprisError::ConnectionFailed(
                    "Cannot connect to session D-Bus: org.freedesktop.DBus.Error.NoServer".into(),
                ))
            }

            async fn update_metadata(
                &mut self,
                _track: &Track,
                _art_url: Option<&str>,
            ) -> Result<(), MprisError> {
                Err(MprisError::PropertyError(
                    "Failed to update org.mpris.MediaPlayer2.Player.Metadata".into(),
                ))
            }

            async fn update_position(&mut self, _position: Duration) -> Result<(), MprisError> {
                Err(MprisError::EmitError(
                    "Seeked signal delivery failed".into(),
                ))
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
                ..Default::default()
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

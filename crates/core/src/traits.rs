//! Canonical trait contracts for Wavery modules.
//!
//! Subsystems (audio, library, mpris) conform strictly to these trait definitions.

use crate::error::{AudioError, LibraryError, MprisError};
use crate::models::{
    ImportStrategy, LoopMode, PlaybackState, QueueStateSnapshot, Track, TrackMetadata,
    WaveformData,
};
use async_trait::async_trait;
use std::path::Path;
use std::time::Duration;

/// Playback Trait (PlayerEngine)
///
/// Defines the audio pipeline, decoding, output sink management, and state inspection.
#[async_trait]
pub trait PlayerEngine: Send + Sync {
    /// Load a track into the playback buffer and begin streaming.
    async fn load(
        &mut self,
        track: &Track,
        start_position: Option<Duration>,
    ) -> Result<(), AudioError>;

    /// Resume playback.
    fn play(&mut self) -> Result<(), AudioError>;

    /// Pause playback.
    fn pause(&mut self) -> Result<(), AudioError>;

    /// Stop playback and release the active audio stream.
    fn stop(&mut self) -> Result<(), AudioError>;

    /// Seek to absolute position within the current track.
    fn seek(&mut self, position: Duration) -> Result<(), AudioError>;

    /// Set volume between 0.0 (mute) and 1.0 (100%).
    fn set_volume(&mut self, volume: f32);

    /// Current output volume.
    fn volume(&self) -> f32;

    /// Current playback state.
    fn state(&self) -> PlaybackState;

    /// Current playback position.
    fn position(&self) -> Duration;

    /// Total duration of current loaded track.
    fn duration(&self) -> Option<Duration>;

    /// Set crossfade transition duration.
    fn set_crossfade(&mut self, _duration: Duration) {}

    /// Set perceptual loudness normalization mode ("off", "track", "album").
    fn set_replay_gain_mode(&mut self, _mode: &str) {}
}

/// Library & Storage Trait (LibraryManager)
///
/// Handles physical file management (copy vs move into managed store),
/// metadata extraction, and in-memory/persisted lookups.
#[async_trait]
pub trait LibraryManager: Send + Sync {
    /// Returns absolute path to the local managed directory.
    fn library_root(&self) -> &Path;

    /// Ingest an external file into the managed library using Copy or Move.
    async fn import_track(
        &mut self,
        source_path: &Path,
        strategy: ImportStrategy,
    ) -> Result<Track, LibraryError>;

    /// Recursively scan and import a folder of tracks.
    async fn import_directory(
        &mut self,
        dir_path: &Path,
        strategy: ImportStrategy,
    ) -> Result<Vec<Track>, LibraryError>;

    /// Recursively scan and import a folder of tracks with progress updates.
    async fn import_directory_with_progress(
        &mut self,
        dir_path: &Path,
        strategy: ImportStrategy,
        _progress_tx: Option<tokio::sync::mpsc::Sender<crate::models::ScanProgress>>,
    ) -> Result<Vec<Track>, LibraryError> {
        self.import_directory(dir_path, strategy).await
    }

    /// Remove a track from the library index and optionally wipe from disk.
    async fn delete_track(&mut self, track_id: &str, remove_file: bool)
        -> Result<(), LibraryError>;

    /// Query track by ID.
    fn get_track(&self, track_id: &str) -> Option<&Track>;

    /// Get all indexed tracks in the library.
    fn all_tracks(&self) -> &[Track];

    /// Search index across title, artist, and album.
    fn search(&self, query: &str) -> Vec<&Track>;

    /// Update track metadata in memory and SQLite index, optionally writing ID3/Vorbis tags to disk.
    async fn update_track_metadata(
        &mut self,
        track_id: &str,
        metadata: &TrackMetadata,
        write_tags: bool,
    ) -> Result<Track, LibraryError>;

    /// Returns pre-aggregated album list with compilation detection and track lists.
    fn list_albums(&self) -> Result<Vec<crate::models::Album>, LibraryError> {
        Ok(Vec::new())
    }

    /// Returns pre-aggregated artist profiles with albums, appearances, and track lists.
    fn list_artists(&self) -> Result<Vec<crate::models::Artist>, LibraryError> {
        Ok(Vec::new())
    }

    /// Returns pre-aggregated genres with track lists sorted descending by popularity.
    fn list_genres(&self) -> Result<Vec<crate::models::GenreInfo>, LibraryError> {
        Ok(Vec::new())
    }

    /// Query cached waveform peak envelope by track ID.
    async fn get_waveform(
        &self,
        _track_id: &str,
    ) -> Result<Option<WaveformData>, LibraryError> {
        Ok(None)
    }

    /// Save or update a track's waveform peak envelope.
    async fn save_waveform(
        &mut self,
        _waveform: &WaveformData,
    ) -> Result<(), LibraryError> {
        Ok(())
    }
}

/// Extracted artwork payload.
#[derive(Debug, Clone)]
pub struct ExtractedArtwork {
    pub mime_type: String,
    pub data: Vec<u8>,
}

/// Metadata & Artwork Extractor Trait (MetadataReader)
///
/// Decodes embedded ID3, Vorbis, FLAC, and MP4 tags and extracts embedded artwork.
pub trait MetadataReader: Send + Sync {
    /// Extract technical audio specs and tag fields from an audio file.
    fn read_metadata(&self, path: &Path) -> Result<TrackMetadata, LibraryError>;

    /// Extract embedded album artwork (APIC/METADATA_BLOCK_PICTURE), if present.
    fn read_artwork(&self, path: &Path) -> Result<Option<ExtractedArtwork>, LibraryError>;
}

/// Queue & Playback Order Trait (QueueManager)
///
/// Manages active linear queue, two-tier user priority queue, shuffle ordering, repeat policies,
/// and autoplay candidate recommendations.
pub trait QueueManager: Send + Sync {
    /// Replace queue items.
    fn set_queue(&mut self, tracks: Vec<Track>, start_index: usize);

    /// Append track to back of queue (or user priority queue).
    fn push_back(&mut self, track: Track);

    /// Insert track directly to play next (at the front of user priority queue).
    fn play_next(&mut self, track: Track);

    /// Set context queue while preserving any pending user-queued items.
    fn set_context_queue(&mut self, tracks: Vec<Track>, start_index: usize) {
        self.set_queue(tracks, start_index);
    }

    /// View active context tracks (album, playlist, or filtered tracks).
    fn context_queue(&self) -> &[Track] {
        self.queue()
    }

    /// Current 0-based index within the context tracks.
    fn context_index(&self) -> Option<usize> {
        self.current_index()
    }

    /// Advance to next track, returning next Track if available.
    fn next(&mut self) -> Option<&Track>;

    /// Revert to previous track or restart current track based on threshold.
    fn previous(&mut self, current_pos: Duration) -> Option<&Track>;

    /// Jump directly to index in flattened queue view.
    fn jump_to_index(&mut self, _index: usize) -> Option<&Track> {
        None
    }

    /// Jump directly to index in context queue.
    fn jump_to_context_track(&mut self, _context_index: usize) -> Option<&Track> {
        None
    }

    /// Jump directly to index in user priority queue.
    fn jump_to_user_track(&mut self, _user_index: usize) -> Option<&Track> {
        None
    }

    /// Toggle or set shuffle state.
    fn set_shuffle(&mut self, enabled: bool);

    /// Set loop behavior (Off, Track, Queue).
    fn set_loop_mode(&mut self, mode: LoopMode);

    /// Set continuous autoplay recommendations.
    fn set_autoplay(&mut self, _enabled: bool) {}

    /// Whether continuous autoplay recommendations are enabled.
    fn is_autoplay(&self) -> bool {
        false
    }

    /// Currently active track.
    fn current_track(&self) -> Option<&Track>;

    /// Current 0-based queue index.
    fn current_index(&self) -> Option<usize>;

    /// View entire linear queue.
    fn queue(&self) -> &[Track];

    /// View user-queued items.
    fn user_queue(&self) -> &[Track] {
        &[]
    }

    /// Clear user priority queue.
    fn clear_user_queue(&mut self) {}

    /// Remove a track from user priority queue at index.
    fn remove_user_track(&mut self, _index: usize) -> Option<Track> {
        None
    }

    /// Reorder a track inside user priority queue.
    fn reorder_user_queue(&mut self, _from: usize, _to: usize) {}

    /// Played track history for current session.
    fn history(&self) -> &[Track] {
        &[]
    }

    /// Whether shuffle is enabled.
    fn is_shuffle(&self) -> bool {
        false
    }

    /// Current loop mode.
    fn loop_mode(&self) -> LoopMode {
        LoopMode::Off
    }

    /// Clear both context and user queues, stopping active playback queue.
    fn clear(&mut self) {
        self.set_queue(Vec::new(), 0);
    }

    /// Return a comprehensive, serializable snapshot of the current queue state.
    fn get_state(&self) -> QueueStateSnapshot {
        QueueStateSnapshot {
            current_track: self.current_track().cloned(),
            current_index: self.current_index(),
            user_queue: self.user_queue().to_vec(),
            context_queue: self.context_queue().to_vec(),
            context_index: self.context_index(),
            queue: self.queue().to_vec(),
            is_shuffle: self.is_shuffle(),
            loop_mode: self.loop_mode(),
            is_autoplay: self.is_autoplay(),
            history: self.history().to_vec(),
            shuffle_indices: Vec::new(),
            shuffle_pos: 0,
        }
    }

    /// Select the highest-scoring unplayed candidate track from candidate pool based on artist, album, and genre heuristics.
    fn select_autoplay_candidate(&self, _candidate_pool: &[Track]) -> Option<Track> {
        None
    }

    /// Append an autoplay recommendation track to the queue.
    fn append_autoplay_track(&mut self, track: Track) {
        self.push_back(track);
    }
}

/// Linux Integration Trait (MprisBridge)
///
/// Connects player state to DBus (`org.mpris.MediaPlayer2.Player`) on Linux.
#[async_trait]
pub trait MprisBridge: Send + Sync {
    /// Broadcast current playback status (Playing, Paused, Stopped) to DBus.
    async fn update_status(&mut self, state: PlaybackState) -> Result<(), MprisError>;

    /// Broadcast track metadata and album art URI to MPRIS clients.
    async fn update_metadata(
        &mut self,
        track: &Track,
        art_url: Option<&str>,
    ) -> Result<(), MprisError>;

    /// Broadcast seek / position offset.
    async fn update_position(&mut self, position: Duration) -> Result<(), MprisError>;

    /// Listen for MPRIS commands (Play, Pause, Next, Previous, Seek, Volume).
    async fn poll_events(&mut self) -> Vec<MprisCommand>;
}

/// Control commands emitted by MPRIS client interactions.
#[derive(Debug, Clone, PartialEq)]
pub enum MprisCommand {
    Play,
    Pause,
    TogglePlayPause,
    Next,
    Previous,
    Stop,
    Seek(Duration),
    SetPosition(Duration),
    SetVolume(f32),
}

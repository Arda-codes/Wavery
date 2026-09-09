//! Core domain models and entities for Wavery.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

/// Method for importing a track into Wavery's managed store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImportStrategy {
    /// Copies source file to managed library root.
    Copy,
    /// Moves source file to managed library root (deleting original).
    Move,
}

/// Identifies where the actual audio file resides on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrackSource {
    /// Resides strictly inside Wavery's internal managed library directory.
    Managed(PathBuf),
}

impl TrackSource {
    /// Returns reference to path buffer inside managed store.
    #[must_use]
    pub fn path(&self) -> &PathBuf {
        match self {
            Self::Managed(path) => path,
        }
    }
}

/// Audio metadata representation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration: Duration,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u16>,
    pub channels: Option<u16>,
    pub format: String, // e.g., "FLAC", "ALAC", "MP3", "WAV"
    #[serde(default)]
    pub lyrics: Option<String>,
}

/// A playable item in the library or queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: String, // UUIDv4 or SHA-256 hash of relative path
    pub source: TrackSource,
    pub metadata: TrackMetadata,
    pub date_added: u64, // Unix timestamp in seconds
}

/// Aggregated album information.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Album {
    pub title: String,
    pub artist: String,
    pub year: Option<i32>,
    pub artwork_track_id: Option<String>,
    pub track_count: usize,
    pub total_duration: Duration,
}

/// Aggregated artist information.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Artist {
    pub name: String,
    pub album_count: usize,
    pub track_count: usize,
    pub artwork_track_id: Option<String>,
}

/// User-defined playlist.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub track_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Summary of a completed library scanning operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScanSummary {
    pub scanned_files: usize,
    pub imported_tracks: usize,
    pub failed_files: usize,
    pub duration_ms: u64,
}

/// Progress notification emitted during library scanning.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScanProgress {
    DiscoveredFiles(usize),
    Processing {
        current: usize,
        total: usize,
        current_file: PathBuf,
    },
    BatchIngested {
        count: usize,
        total: usize,
    },
    Completed(ScanSummary),
}

/// Current playback state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlaybackState {
    Playing,
    Paused,
    Stopped,
}

/// Playback loop / repeat mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum LoopMode {
    #[default]
    Off,
    Track,
    Queue,
}

/// Synchronized playback session state across Desktop and Web clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct PlaybackSession {
    pub current_track_id: Option<String>,
    #[serde(default)]
    pub queue: Vec<Track>,
    #[serde(default)]
    pub queue_index: usize,
    #[serde(default)]
    pub position_secs: f64,
    #[serde(default)]
    pub is_playing: bool,
    #[serde(default)]
    pub volume: Option<f32>,
    #[serde(default)]
    pub is_shuffle: bool,
    #[serde(default)]
    pub is_autoplay: bool,
    #[serde(default)]
    pub loop_mode: Option<String>,
    #[serde(default)]
    pub active_client: Option<String>,
}


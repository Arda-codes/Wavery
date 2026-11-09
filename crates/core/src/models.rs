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

    /// ReplayGain track gain in dB (e.g., -6.5 dB).
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "replayGainTrackGain", alias = "replaygainTrackGain")]
    pub replaygain_track_gain: Option<f32>,

    /// ReplayGain track peak amplitude ratio (e.g., 0.9885).
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "replayGainTrackPeak", alias = "replaygainTrackPeak")]
    pub replaygain_track_peak: Option<f32>,

    /// ReplayGain album gain in dB (e.g., -5.2 dB).
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "replayGainAlbumGain", alias = "replaygainAlbumGain")]
    pub replaygain_album_gain: Option<f32>,

    /// ReplayGain album peak amplitude ratio (e.g., 1.0).
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "replayGainAlbumPeak", alias = "replaygainAlbumPeak")]
    pub replaygain_album_peak: Option<f32>,
}

/// A playable item in the library or queue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: String, // UUIDv4 or SHA-256 hash of relative path
    pub source: TrackSource,
    pub metadata: TrackMetadata,
    pub date_added: u64, // Unix timestamp in seconds
}

/// Aggregated album information with track listings and compilation detection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub title: String,
    pub artist: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_artist: Option<String>,
    #[serde(default)]
    pub is_compilation: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    pub artwork_track_id: Option<String>,
    #[serde(default)]
    pub tracks: Vec<Track>,
    pub track_count: usize,
    #[serde(default)]
    pub total_duration: Duration,
    #[serde(default)]
    pub total_duration_secs: u64,
}

/// Aggregated artist profile with owned albums, appearances, and track roster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub name: String,
    #[serde(default)]
    pub albums: Vec<Album>,
    #[serde(default)]
    pub appears_on: Vec<Album>,
    #[serde(default)]
    pub tracks: Vec<Track>,
    pub album_count: usize,
    pub track_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_track_id: Option<String>,
}

/// Aggregated genre information with associated tracks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenreInfo {
    pub name: String,
    #[serde(default)]
    pub tracks: Vec<Track>,
    pub track_count: usize,
}

/// Token representing either an interactive artist name or connective delimiter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArtistToken {
    pub text: String,
    pub is_artist: bool,
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

/// Canonical snapshot of playback queue state emitted by `QueueManager` across IPC and session events.
///
/// Contains the complete two-tier queue representation (user priority queue and context queue),
/// playback pointers, loop/shuffle/autoplay policies, and session playback history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueStateSnapshot {
    /// Currently playing or loaded track, if any.
    #[serde(default, alias = "current_track")]
    pub current_track: Option<Track>,

    /// Zero-based index of the currently playing track in the unified/combined queue view.
    #[serde(default, alias = "current_index")]
    pub current_index: Option<usize>,

    /// Pending user-queued priority tracks ("Play Next" and "Add to Queue").
    #[serde(default, alias = "user_queue")]
    pub user_queue: Vec<Track>,

    /// Active context tracks (e.g. album, playlist, artist, or library query).
    #[serde(default, alias = "context_queue")]
    pub context_queue: Vec<Track>,

    /// Zero-based index within the context queue, preserved while user queue items are playing.
    #[serde(default, alias = "context_index")]
    pub context_index: Option<usize>,

    /// Synthesized flattened queue view for UI table rendering and backward compatibility.
    #[serde(default)]
    pub queue: Vec<Track>,

    /// Whether shuffle mode is active.
    #[serde(default, alias = "is_shuffle")]
    pub is_shuffle: bool,

    /// Playback loop / repeat mode (Off, Track, Queue).
    #[serde(default, alias = "loop_mode")]
    pub loop_mode: LoopMode,

    /// Whether continuous autoplay recommendations are enabled.
    #[serde(default, alias = "is_autoplay")]
    pub is_autoplay: bool,

    /// Chronological session playback history (most recent tracks played, capped at 100).
    #[serde(default)]
    pub history: Vec<Track>,

    /// Shuffled index permutation of the queue when shuffle mode is active.
    #[serde(
        default,
        alias = "shuffle_indices",
        alias = "shuffled_indices",
        alias = "shuffledIndices"
    )]
    pub shuffle_indices: Vec<usize>,

    /// Zero-based position pointer within `shuffle_indices`.
    #[serde(default, alias = "shuffle_pos")]
    pub shuffle_pos: usize,
}

/// Pre-computed waveform amplitude peak envelope for instant scrubber rendering.
///
/// Contains a normalized peak envelope (typically 100 points clamped in [0.0, 1.0])
/// computed during ingestion or background analysis, allowing instant O(1) waveform
/// rendering in UI players without re-decoding audio streams.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct WaveformData {
    /// Associated track identifier (UUID or relative path hash).
    #[serde(alias = "trackId")]
    pub track_id: String,

    /// Schema / algorithm version of the envelope computation (e.g. 1).
    pub version: u32,

    /// Normalized amplitude peak envelope points in range [0.0, 1.0].
    pub points: Vec<f32>,
}

impl WaveformData {
    /// Creates a new `WaveformData` instance.
    #[must_use]
    pub fn new(track_id: impl Into<String>, version: u32, points: Vec<f32>) -> Self {
        Self {
            track_id: track_id.into(),
            version,
            points,
        }
    }

    /// Returns whether the envelope contains the expected 100 normalized points.
    #[must_use]
    pub fn is_valid_100_point_envelope(&self) -> bool {
        self.points.len() == 100 && self.points.iter().all(|&p| (0.0..=1.0).contains(&p))
    }
}


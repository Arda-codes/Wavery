//! Ingestion, file management (Copy vs Move), metadata extraction, and SQLite database for Wavery.
//!
//! Enforces the rule that all library tracks are managed in the local library directory.

pub mod clustering;
pub mod db;
pub mod heuristics;
pub mod m3u;
pub mod manager;
pub mod playlist_import;
pub mod reader;
pub mod waveform;

pub use clustering::{extract_library_genres, group_tracks_by_album, group_tracks_by_artist};
pub use db::{DatabaseBackup, DatabaseHealth, DatabaseStats, LibraryDatabase};
pub use heuristics::extract_artist_from_path;
pub use m3u::{parse_m3u, M3uEntry, M3uPlaylist};
pub use manager::SqliteLibraryManager;
pub use playlist_import::PlaylistImportSummary;
pub use reader::LoftyMetadataReader;
pub use waveform::{compute_waveform_peaks, resample_peaks_to_100};

#[cfg(test)]
mod tests;

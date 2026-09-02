//! Pure domain logic, entities, trait interfaces, and typed errors for Wavery.
//!
//! This crate contains ZERO platform-specific I/O, database drivers, audio decoders, or UI frameworks.

pub mod error;
pub mod models;
pub mod traits;

pub use error::{AudioError, LibraryError, MprisError};
pub use models::{
    Album, Artist, ImportStrategy, LoopMode, PlaybackSession, PlaybackState, Playlist, ScanProgress,
    ScanSummary, Track, TrackMetadata, TrackSource,
};
pub use traits::{
    ExtractedArtwork, LibraryManager, MetadataReader, MprisBridge, MprisCommand, PlayerEngine,
    QueueManager,
};

#[cfg(test)]
mod tests;

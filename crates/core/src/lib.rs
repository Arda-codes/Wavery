//! Pure domain logic, entities, trait interfaces, and typed errors for Wavery.
//!
//! This crate contains ZERO platform-specific I/O, database drivers, audio decoders, or UI frameworks.

pub mod error;
pub mod heuristics;
pub mod lyrics;
pub mod models;
pub mod traits;

pub use error::{AudioError, LibraryError, MprisError};
pub use lyrics::{
    extract_clean_artist, get_active_lyric_index, has_lrc_timestamps, normalize_query, parse_lrc,
    score_lyric_candidates, score_single_candidate, strip_enclosing_parentheses, LyricCandidate,
    LyricLine, LyricTargetInfo, LrcMetadata, ParsedLyrics, ScoredLyricCandidate,
};
pub use heuristics::{
    extract_featured_artists_from_title, extract_primary_artist, is_roster_string,
    normalize_genre, parse_artist_tokens, split_artists, split_genres,
    DEFAULT_GENRE_MAPPINGS, DEFAULT_PROTECTED_ARTISTS,
};
pub use models::{
    Album, Artist, ArtistToken, GenreInfo, ImportStrategy, LoopMode, PlaybackSession,
    PlaybackState, Playlist, QueueStateSnapshot, ScanProgress, ScanSummary, Track, TrackMetadata,
    TrackSource, WaveformData,
};
pub use traits::{
    ExtractedArtwork, LibraryManager, MetadataReader, MprisBridge, MprisCommand, PlayerEngine,
    QueueManager,
};

#[cfg(test)]
mod tests;

//! Domain-level typed error definitions.

use std::path::PathBuf;
use thiserror::Error;

/// Errors arising during audio playback or audio stream management.
#[derive(Error, Debug)]
pub enum AudioError {
    #[error("Failed to decode audio file: {0}")]
    DecoderError(String),
    #[error("Audio output device error: {0}")]
    SinkError(String),
    #[error("Track file not found at path: {0}")]
    FileNotFound(PathBuf),
    #[error("Unsupported audio codec or container")]
    UnsupportedFormat,
}

/// Errors arising during library scanning, indexing, or database access.
#[derive(Error, Debug)]
pub enum LibraryError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Tag reading failed: {0}")]
    TagReadError(String),
    #[error("Target track not found in index: {0}")]
    TrackNotFound(String),
    #[error("Duplicate track skipped: {0}")]
    DuplicateSkipped(String),
    #[error("Database / indexing failure: {0}")]
    IndexError(String),
}

/// Errors arising during MPRIS D-Bus communication or event handling.
#[derive(Error, Debug)]
pub enum MprisError {
    #[error("Failed to connect or communicate via D-Bus: {0}")]
    ConnectionFailed(String),
    #[error("MPRIS property error: {0}")]
    PropertyError(String),
    #[error("Failed to emit MPRIS event or signal: {0}")]
    EmitError(String),
}


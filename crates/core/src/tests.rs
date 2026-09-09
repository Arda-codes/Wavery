use crate::models::{
    Album, Artist, ImportStrategy, LoopMode, PlaybackState, Playlist, ScanProgress, ScanSummary,
    Track, TrackMetadata, TrackSource,
};
use std::path::PathBuf;
use std::time::Duration;

#[test]
fn test_track_models() {
    let meta = TrackMetadata {
        title: Some("Test Track".into()),
        artist: Some("Test Artist".into()),
        album: Some("Test Album".into()),
        album_artist: None,
        track_number: Some(1),
        disc_number: Some(1),
        year: Some(2026),
        genre: Some("Synthwave".into()),
        duration: Duration::from_secs(180),
        sample_rate: Some(44100),
        bit_depth: Some(16),
        channels: Some(2),
        format: "FLAC".into(),
        lyrics: None,
    };

    let track = Track {
        id: "track-123".into(),
        source: TrackSource::Managed(PathBuf::from("/tmp/music/track.flac")),
        metadata: meta,
        date_added: 1700000000,
    };

    assert_eq!(track.source.path(), &PathBuf::from("/tmp/music/track.flac"));
    assert_eq!(track.metadata.format, "FLAC");
    assert_eq!(track.metadata.duration.as_secs(), 180);
}

#[test]
fn test_album_and_artist_models() {
    let album = Album {
        title: "Random Access Memories".into(),
        artist: "Daft Punk".into(),
        year: Some(2013),
        artwork_track_id: Some("art-1".into()),
        track_count: 13,
        total_duration: Duration::from_secs(4460),
    };
    assert_eq!(album.title, "Random Access Memories");
    assert_eq!(album.track_count, 13);

    let artist = Artist {
        name: "Daft Punk".into(),
        album_count: 4,
        track_count: 50,
        artwork_track_id: Some("art-1".into()),
    };
    assert_eq!(artist.name, "Daft Punk");
    assert_eq!(artist.album_count, 4);
}

#[test]
fn test_playlist_and_scan_models() {
    let playlist = Playlist {
        id: "pl-1".into(),
        name: "Favorites".into(),
        track_ids: vec!["t1".into(), "t2".into()],
        created_at: 1700000000,
        updated_at: 1700000000,
    };
    assert_eq!(playlist.track_ids.len(), 2);

    let summary = ScanSummary {
        scanned_files: 100,
        imported_tracks: 98,
        failed_files: 2,
        duration_ms: 450,
    };
    let progress = ScanProgress::Completed(summary.clone());
    if let ScanProgress::Completed(s) = progress {
        assert_eq!(s.imported_tracks, 98);
        assert_eq!(s.failed_files, 2);
    } else {
        panic!("Expected ScanProgress::Completed");
    }
}

#[test]
fn test_enums() {
    assert_eq!(ImportStrategy::Copy, ImportStrategy::Copy);
    assert_ne!(ImportStrategy::Copy, ImportStrategy::Move);
    assert_eq!(LoopMode::default(), LoopMode::Off);
    assert_eq!(PlaybackState::Stopped, PlaybackState::Stopped);
}

#[test]
fn test_mpris_error_display() {
    use crate::error::MprisError;
    let conn_err = MprisError::ConnectionFailed("dbus disconnect".into());
    assert_eq!(
        conn_err.to_string(),
        "Failed to connect or communicate via D-Bus: dbus disconnect"
    );

    let prop_err = MprisError::PropertyError("invalid metadata".into());
    assert_eq!(
        prop_err.to_string(),
        "MPRIS property error: invalid metadata"
    );

    let emit_err = MprisError::EmitError("signal drop".into());
    assert_eq!(
        emit_err.to_string(),
        "Failed to emit MPRIS event or signal: signal drop"
    );
}


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
        ..Default::default()
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
        album_artist: None,
        is_compilation: false,
        year: Some(2013),
        artwork_track_id: Some("art-1".into()),
        tracks: Vec::new(),
        track_count: 13,
        total_duration: Duration::from_secs(4460),
        total_duration_secs: 4460,
    };
    assert_eq!(album.title, "Random Access Memories");
    assert_eq!(album.track_count, 13);
    assert_eq!(album.total_duration_secs, 4460);

    let artist = Artist {
        name: "Daft Punk".into(),
        albums: vec![album.clone()],
        appears_on: Vec::new(),
        tracks: Vec::new(),
        album_count: 4,
        track_count: 50,
        artwork_track_id: Some("art-1".into()),
    };
    assert_eq!(artist.name, "Daft Punk");
    assert_eq!(artist.album_count, 4);
    assert_eq!(artist.albums.len(), 1);
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

#[test]
fn test_heuristics_split_artists_protected() {
    use crate::heuristics::split_artists;

    // Atomic protected artist with comma
    let res = split_artists("Tyler, The Creator", &[]);
    assert_eq!(res, vec!["Tyler, The Creator"]);

    // Atomic protected artist with slash
    let res = split_artists("AC/DC", &[]);
    assert_eq!(res, vec!["AC/DC"]);

    // Multiple artists including protected
    let res = split_artists("Tyler, The Creator; Kali Uchis", &[]);
    assert_eq!(res, vec!["Tyler, The Creator", "Kali Uchis"]);

    // Collaboration keywords
    let res = split_artists("Daft Punk feat. Pharrell Williams & Nile Rodgers", &[]);
    assert_eq!(res, vec!["Daft Punk", "Pharrell Williams", "Nile Rodgers"]);

    // Overlapping composite protected artists
    let res = split_artists("Crosby, Stills, Nash & Young", &[]);
    assert_eq!(res, vec!["Crosby, Stills, Nash & Young"]);

    // Case-insensitive deduplication
    let res = split_artists("Radiohead & radiohead", &[]);
    assert_eq!(res, vec!["Radiohead"]);
}

#[test]
fn test_heuristics_genre_normalization() {
    use crate::heuristics::{normalize_genre, split_genres};

    // Cyrillic mapping
    assert_eq!(normalize_genre("рок", None), "Rock");
    assert_eq!(normalize_genre("альтернатива", None), "Alternative");
    assert_eq!(normalize_genre("электроника", None), "Electronic");

    // Truncated Cyrillic tag with trailing dots
    assert_eq!(normalize_genre("Альтернатив...", None), "Alternative");
    assert_eq!(normalize_genre("Электронная...", None), "Electronic");

    // English aliases
    assert_eq!(normalize_genre("alt rock", None), "Alternative");
    assert_eq!(normalize_genre("dnb", None), "Drum & Bass");
    assert_eq!(normalize_genre("lofi", None), "Lo-Fi");

    // Split compound genres while protecting R&B and Drum & Bass
    let split = split_genres("Alternative / Rock & Pop / R&B", None);
    assert_eq!(split, vec!["Alternative", "Rock", "Pop", "R&B"]);

    let split2 = split_genres("Drum & Bass, Electronic", None);
    assert_eq!(split2, vec!["Drum & Bass", "Electronic"]);
}

#[test]
fn test_heuristics_artist_tokens_and_roster() {
    use crate::heuristics::{is_roster_string, parse_artist_tokens};

    let tokens = parse_artist_tokens("Tyler, The Creator; Kali Uchis", &[]);
    assert_eq!(tokens.len(), 3);
    assert_eq!(tokens[0].text, "Tyler, The Creator");
    assert!(tokens[0].is_artist);
    assert_eq!(tokens[1].text, "; ");
    assert!(!tokens[1].is_artist);
    assert_eq!(tokens[2].text, "Kali Uchis");
    assert!(tokens[2].is_artist);

    // Roster detection
    assert!(!is_roster_string("Tyler, The Creator", &[]));
    assert!(is_roster_string("John Lennon, Paul McCartney, George Harrison, Ringo Starr", &[]));
}

#[test]
fn test_heuristics_pathological_delimiter_strings() {
    use crate::heuristics::split_artists;

    assert_eq!(split_artists(";,/,&&,", &[]), vec!["Unknown Artist"]);
    assert_eq!(split_artists(" ; / & , ", &[]), vec!["Unknown Artist"]);
    assert_eq!(split_artists("//////", &[]), vec!["Unknown Artist"]);
    assert_eq!(split_artists(",,,,;;;;", &[]), vec!["Unknown Artist"]);
    assert_eq!(split_artists("   ", &[]), vec!["Unknown Artist"]);
    assert_eq!(split_artists("", &[]), vec!["Unknown Artist"]);
}

#[test]
fn test_heuristics_slashed_words_and_protected_artists() {
    use crate::heuristics::split_artists;

    // Slashed atomic names not in protected list should not split when unspaced
    assert_eq!(split_artists("NotAC/DC", &[]), vec!["NotAC/DC"]);

    // Protected artist alongside unspaced word
    assert_eq!(
        split_artists("Tribute to AC/DC, NotAC/DC", &[]),
        vec!["Tribute to AC/DC", "NotAC/DC"]
    );

    // Isolated protected artist with slash
    assert_eq!(split_artists("AC/DC", &[]), vec!["AC/DC"]);

    // Slashes with whitespace ARE delimiters
    assert_eq!(
        split_artists("Artist A / Artist B", &[]),
        vec!["Artist A", "Artist B"]
    );
    assert_eq!(
        split_artists("Daft Punk ////// Giorgio Moroder", &[]),
        vec!["Daft Punk", "Giorgio Moroder"]
    );
}

#[test]
fn test_heuristics_unicode_char_boundary_and_case_shift() {
    use crate::heuristics::split_artists;

    let custom = vec!["БИ-2".to_string()];
    // Word boundary before fails on Cyrillic 'е' - must not panic
    let res = split_artists("НеБИ-2 & БИ-2", &custom);
    assert_eq!(res, vec!["НеБИ-2", "БИ-2"]);

    // Turkish dotted I case shift must not panic or desynchronize
    let res_tr = split_artists("İ & AC/DC", &[]);
    assert_eq!(res_tr, vec!["İ", "AC/DC"]);

    // German sharp S case shift must not panic
    let res_de = split_artists("ẞ & Tyler, The Creator", &[]);
    assert_eq!(res_de, vec!["ẞ", "Tyler, The Creator"]);
}

#[test]
fn test_queue_state_snapshot_defaults_and_camel_case_serialization() {
    use crate::models::{LoopMode, QueueStateSnapshot};

    let snapshot = QueueStateSnapshot::default();
    assert_eq!(snapshot.current_track, None);
    assert_eq!(snapshot.current_index, None);
    assert!(snapshot.user_queue.is_empty());
    assert!(snapshot.context_queue.is_empty());
    assert_eq!(snapshot.context_index, None);
    assert!(snapshot.queue.is_empty());
    assert!(!snapshot.is_shuffle);
    assert_eq!(snapshot.loop_mode, LoopMode::Off);
    assert!(!snapshot.is_autoplay);
    assert!(snapshot.history.is_empty());

    let json = serde_json::to_string(&snapshot).unwrap();
    assert!(json.contains("\"currentTrack\":null"));
    assert!(json.contains("\"currentIndex\":null"));
    assert!(json.contains("\"userQueue\":[]"));
    assert!(json.contains("\"contextQueue\":[]"));
    assert!(json.contains("\"contextIndex\":null"));
    assert!(json.contains("\"isShuffle\":false"));
    assert!(json.contains("\"loopMode\":\"Off\""));
    assert!(json.contains("\"isAutoplay\":false"));
}

#[test]
fn test_queue_state_snapshot_snake_case_deserialization_compatibility() {
    use crate::models::{LoopMode, QueueStateSnapshot};

    let snake_json = r#"{
        "current_track": null,
        "current_index": 3,
        "user_queue": [],
        "context_queue": [],
        "context_index": 2,
        "queue": [],
        "is_shuffle": true,
        "loop_mode": "Queue",
        "is_autoplay": true,
        "history": []
    }"#;

    let parsed: QueueStateSnapshot = serde_json::from_str(snake_json).unwrap();
    assert_eq!(parsed.current_index, Some(3));
    assert_eq!(parsed.context_index, Some(2));
    assert!(parsed.is_shuffle);
    assert_eq!(parsed.loop_mode, LoopMode::Queue);
    assert!(parsed.is_autoplay);
}

#[test]
fn test_queue_manager_trait_default_implementations() {
    use crate::models::{LoopMode, Track};
    use crate::traits::QueueManager;
    use std::time::Duration;

    struct MinimalQueueManager {
        items: Vec<Track>,
        idx: Option<usize>,
    }

    impl QueueManager for MinimalQueueManager {
        fn set_queue(&mut self, tracks: Vec<Track>, start_index: usize) {
            self.items = tracks;
            self.idx = if self.items.is_empty() {
                None
            } else {
                Some(start_index.min(self.items.len() - 1))
            };
        }
        fn push_back(&mut self, track: Track) {
            self.items.push(track);
        }
        fn play_next(&mut self, track: Track) {
            self.items.insert(0, track);
        }
        fn next(&mut self) -> Option<&Track> {
            None
        }
        fn previous(&mut self, _current_pos: Duration) -> Option<&Track> {
            None
        }
        fn set_shuffle(&mut self, _enabled: bool) {}
        fn set_loop_mode(&mut self, _mode: LoopMode) {}
        fn current_track(&self) -> Option<&Track> {
            self.idx.and_then(|i| self.items.get(i))
        }
        fn current_index(&self) -> Option<usize> {
            self.idx
        }
        fn queue(&self) -> &[Track] {
            &self.items
        }
    }

    let q = MinimalQueueManager {
        items: Vec::new(),
        idx: None,
    };
    assert_eq!(q.context_queue().len(), 0);
    assert_eq!(q.context_index(), None);
    assert!(!q.is_autoplay());
    assert_eq!(q.select_autoplay_candidate(&[]), None);

    let state = q.get_state();
    assert_eq!(state.queue.len(), 0);
    assert!(!state.is_autoplay);
}

#[test]
fn test_waveform_data_creation_and_validation() {
    use crate::models::WaveformData;

    // Default instance
    let default_wf = WaveformData::default();
    assert_eq!(default_wf.track_id, "");
    assert_eq!(default_wf.version, 0);
    assert!(default_wf.points.is_empty());
    assert!(!default_wf.is_valid_100_point_envelope());

    // Valid 100-point normalized envelope
    let valid_points: Vec<f32> = (0..100).map(|i| (i as f32) / 100.0).collect();
    let wf = WaveformData::new("track-abc", 1, valid_points);
    assert_eq!(wf.track_id, "track-abc");
    assert_eq!(wf.version, 1);
    assert_eq!(wf.points.len(), 100);
    assert!(wf.is_valid_100_point_envelope());

    // Invalid length (99 points)
    let invalid_len_points: Vec<f32> = (0..99).map(|i| (i as f32) / 100.0).collect();
    let wf_invalid_len = WaveformData::new("track-abc", 1, invalid_len_points);
    assert!(!wf_invalid_len.is_valid_100_point_envelope());

    // Out-of-bounds peak (> 1.0)
    let mut out_of_bounds = vec![0.5f32; 100];
    out_of_bounds[50] = 1.05;
    let wf_oob = WaveformData::new("track-abc", 1, out_of_bounds);
    assert!(!wf_oob.is_valid_100_point_envelope());

    // Out-of-bounds peak (< 0.0)
    let mut negative_val = vec![0.5f32; 100];
    negative_val[20] = -0.01;
    let wf_neg = WaveformData::new("track-abc", 1, negative_val);
    assert!(!wf_neg.is_valid_100_point_envelope());
}

#[test]
fn test_waveform_data_serde_roundtrip_and_aliases() {
    use crate::models::WaveformData;

    let points = vec![0.0, 0.25, 0.5, 0.75, 1.0];
    let wf = WaveformData::new("track-123", 1, points.clone());

    // 1. Serialization emits snake_case "track_id"
    let json = serde_json::to_string(&wf).expect("Serialization failed");
    assert!(json.contains("\"track_id\":\"track-123\""));
    assert!(json.contains("\"version\":1"));
    assert!(json.contains("\"points\":[0.0,0.25,0.5,0.75,1.0]"));

    // 2. Deserialization from snake_case JSON
    let parsed: WaveformData = serde_json::from_str(&json).expect("Deserialization failed");
    assert_eq!(parsed, wf);

    // 3. Deserialization from camelCase "trackId" alias
    let camel_json = r#"{"trackId":"track-123","version":1,"points":[0.0,0.25,0.5,0.75,1.0]}"#;
    let camel_parsed: WaveformData =
        serde_json::from_str(camel_json).expect("CamelCase deserialization failed");
    assert_eq!(camel_parsed.track_id, "track-123");
    assert_eq!(camel_parsed.points, points);
}

#[test]
fn test_track_metadata_replaygain_serde_skip_none() {
    use crate::models::TrackMetadata;
    use std::time::Duration;

    let meta = TrackMetadata {
        title: Some("Song".into()),
        artist: Some("Band".into()),
        album: None,
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
    };

    let json = serde_json::to_string(&meta).expect("Serialization failed");
    assert!(!json.contains("replaygain_track_gain"));
    assert!(!json.contains("replaygain_track_peak"));
    assert!(!json.contains("replaygain_album_gain"));
    assert!(!json.contains("replaygain_album_peak"));
}

#[test]
fn test_track_metadata_replaygain_serde_roundtrip_and_aliases() {
    use crate::models::TrackMetadata;
    use std::time::Duration;

    let meta = TrackMetadata {
        title: Some("Loud Track".into()),
        artist: Some("Rock Band".into()),
        album: Some("Greatest Hits".into()),
        album_artist: None,
        track_number: Some(2),
        disc_number: Some(1),
        year: Some(2024),
        genre: Some("Rock".into()),
        duration: Duration::from_secs(210),
        sample_rate: Some(44100),
        bit_depth: Some(16),
        channels: Some(2),
        format: "FLAC".into(),
        lyrics: None,
        replaygain_track_gain: Some(-6.5),
        replaygain_track_peak: Some(0.988),
        replaygain_album_gain: Some(-5.2),
        replaygain_album_peak: Some(1.0),
    };

    let json = serde_json::to_string(&meta).expect("Serialization failed");
    assert!(json.contains("\"replaygain_track_gain\":-6.5"));
    assert!(json.contains("\"replaygain_track_peak\":0.988"));
    assert!(json.contains("\"replaygain_album_gain\":-5.2"));
    assert!(json.contains("\"replaygain_album_peak\":1.0"));

    let roundtripped: TrackMetadata =
        serde_json::from_str(&json).expect("Deserialization failed");
    assert_eq!(roundtripped.replaygain_track_gain, Some(-6.5));
    assert_eq!(roundtripped.replaygain_track_peak, Some(0.988));
    assert_eq!(roundtripped.replaygain_album_gain, Some(-5.2));
    assert_eq!(roundtripped.replaygain_album_peak, Some(1.0));

    // Backward compatibility test: JSON without ReplayGain fields
    let legacy_json = r#"{
        "title": "Legacy Song",
        "duration": {"secs": 180, "nanos": 0},
        "format": "MP3"
    }"#;
    let legacy_meta: TrackMetadata =
        serde_json::from_str(legacy_json).expect("Legacy deserialization failed");
    assert_eq!(legacy_meta.replaygain_track_gain, None);
    assert_eq!(legacy_meta.replaygain_track_peak, None);
    assert_eq!(legacy_meta.replaygain_album_gain, None);
    assert_eq!(legacy_meta.replaygain_album_peak, None);

    // CamelCase alias test
    let camel_json = r#"{
        "title": "Modern Song",
        "duration": {"secs": 180, "nanos": 0},
        "format": "FLAC",
        "replayGainTrackGain": -7.1,
        "replayGainTrackPeak": 0.95,
        "replayGainAlbumGain": -6.0,
        "replayGainAlbumPeak": 0.99
    }"#;
    let camel_meta: TrackMetadata =
        serde_json::from_str(camel_json).expect("CamelCase deserialization failed");
    assert_eq!(camel_meta.replaygain_track_gain, Some(-7.1));
    assert_eq!(camel_meta.replaygain_track_peak, Some(0.95));
    assert_eq!(camel_meta.replaygain_album_gain, Some(-6.0));
    assert_eq!(camel_meta.replaygain_album_peak, Some(0.99));
}

#[tokio::test]
async fn test_library_manager_waveform_default_trait_methods() {
    use crate::models::{ImportStrategy, Track, TrackMetadata, WaveformData};
    use crate::traits::LibraryManager;
    use crate::error::LibraryError;
    use async_trait::async_trait;
    use std::path::{Path, PathBuf};

    struct DummyLibraryManager {
        root: PathBuf,
    }

    #[async_trait]
    impl LibraryManager for DummyLibraryManager {
        fn library_root(&self) -> &Path {
            &self.root
        }
        async fn import_track(&mut self, _path: &Path, _strategy: ImportStrategy) -> Result<Track, LibraryError> {
            Err(LibraryError::IndexError("Unimplemented".into()))
        }
        async fn import_directory(&mut self, _dir: &Path, _strategy: ImportStrategy) -> Result<Vec<Track>, LibraryError> {
            Ok(Vec::new())
        }
        async fn delete_track(&mut self, _track_id: &str, _remove: bool) -> Result<(), LibraryError> {
            Ok(())
        }
        fn get_track(&self, _id: &str) -> Option<&Track> {
            None
        }
        fn all_tracks(&self) -> &[Track] {
            &[]
        }
        fn search(&self, _query: &str) -> Vec<&Track> {
            Vec::new()
        }
        async fn update_track_metadata(&mut self, _id: &str, _meta: &TrackMetadata, _write: bool) -> Result<Track, LibraryError> {
            Err(LibraryError::IndexError("Unimplemented".into()))
        }
    }

    let mut dummy = DummyLibraryManager { root: PathBuf::from("/tmp") };

    // Verify default get_waveform returns Ok(None)
    let wf_res = dummy.get_waveform("nonexistent").await;
    assert!(wf_res.is_ok());
    assert_eq!(wf_res.unwrap(), None);

    // Verify default save_waveform returns Ok(())
    let wf = WaveformData::new("t1", 1, vec![0.5; 100]);
    let save_res = dummy.save_waveform(&wf).await;
    assert!(save_res.is_ok());
}



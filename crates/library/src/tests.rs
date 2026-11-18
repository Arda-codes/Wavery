use crate::db::LibraryDatabase;
use crate::manager::SqliteLibraryManager;
use crate::reader::LoftyMetadataReader;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tokio::sync::mpsc;
use wavery_core::models::{
    ImportStrategy, ScanProgress, Track, TrackMetadata, TrackSource, WaveformData,
};
use wavery_core::traits::{LibraryManager, MetadataReader};

#[test]
fn test_sqlite_pragmas_and_schema() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_pragma_test_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&temp_dir).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    // Verify PRAGMAs directly against connection
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(journal_mode.to_lowercase(), "wal");

    let foreign_keys: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(foreign_keys, 1);

    // Verify index existence in sqlite_master
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .unwrap();
    let index_names: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert!(index_names.contains(&"idx_tracks_artist".to_string()));
    assert!(index_names.contains(&"idx_tracks_album".to_string()));
    assert!(index_names.contains(&"idx_tracks_album_artist".to_string()));
    assert!(index_names.contains(&"idx_tracks_date_added".to_string()));
    assert!(index_names.contains(&"idx_tracks_album_order".to_string()));
    assert!(index_names.contains(&"idx_tracks_artist_album".to_string()));
    assert!(index_names.contains(&"idx_playlist_tracks_playlist".to_string()));
    assert!(index_names.contains(&"idx_playlist_tracks_track".to_string()));

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_batched_ingestion_and_fts5_triggers() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_batch_test_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    let mut tracks = Vec::new();
    for i in 1..=10 {
        tracks.push(Track {
            id: format!("track-id-{i}"),
            source: TrackSource::Managed(
                managed_root.join(format!("artist/album/{i:02} - Song {i}.flac")),
            ),
            metadata: TrackMetadata {
                title: Some(format!("Synth Song {i}")),
                artist: Some(if i <= 5 {
                    "Kavinsky".into()
                } else {
                    "Gunship".into()
                }),
                album: Some(if i <= 5 {
                    "Nightcall".into()
                } else {
                    "Dark All Day".into()
                }),
                album_artist: Some(if i <= 5 {
                    "Kavinsky".into()
                } else {
                    "Gunship".into()
                }),
                track_number: Some(i),
                disc_number: Some(1),
                year: Some(2013 + (i as i32 % 5)),
                genre: Some("Synthwave".into()),
                duration: Duration::from_secs(180 + i as u64 * 10),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000000 + i as u64,
        });
    }

    // 1. Ingest batch
    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    let loaded = db.load_all(&managed_root).unwrap();
    assert_eq!(loaded.len(), 10);

    // 2. FTS5 Search for "Kavinsky"
    let fts_kavinsky = db.search_fts("Kavinsky", &managed_root).unwrap();
    assert_eq!(fts_kavinsky.len(), 5);

    // 3. FTS5 Search for "Dark All Day"
    let fts_gunship = db.search_fts("Dark Day", &managed_root).unwrap();
    assert_eq!(fts_gunship.len(), 5);

    // 4. Test FTS update trigger
    let mut updated_track = tracks[0].clone();
    updated_track.metadata.title = Some("Pacific Coast Highway".into());
    db.insert_or_update(&updated_track, &managed_root).unwrap();

    let fts_updated = db.search_fts("Pacific Highway", &managed_root).unwrap();
    assert_eq!(fts_updated.len(), 1);
    assert_eq!(fts_updated[0].id, tracks[0].id);

    // 5. Test FTS delete trigger
    let _ = db.delete(&tracks[0].id).unwrap();
    let fts_deleted = db.search_fts("Pacific Highway", &managed_root).unwrap();
    assert_eq!(fts_deleted.len(), 0);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_sqlite_fts5_diacritics_unicode_and_special_queries() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_fts_unicode_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    let tracks = vec![
        Track {
            id: "t_bjork".into(),
            source: TrackSource::Managed(managed_root.join("bjork.flac")),
            metadata: TrackMetadata {
                title: Some("Jóga".into()),
                artist: Some("Björk".into()),
                album: Some("Homogenic".into()),
                album_artist: Some("Björk".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(1997),
                genre: Some("Art Pop".into()),
                duration: Duration::from_secs(305),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000001,
        },
        Track {
            id: "t_rene".into(),
            source: TrackSource::Managed(managed_root.join("rene.flac")),
            metadata: TrackMetadata {
                title: Some("C'est la vie".into()),
                artist: Some("René Aubry".into()),
                album: Some("Plaisirs d'amour".into()),
                album_artist: None,
                track_number: Some(2),
                disc_number: Some(1),
                year: Some(1998),
                genre: Some("Chanson".into()),
                duration: Duration::from_secs(210),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000002,
        },
        Track {
            id: "t_motley".into(),
            source: TrackSource::Managed(managed_root.join("motley.mp3")),
            metadata: TrackMetadata {
                title: Some("Kickstart My Heart".into()),
                artist: Some("Mötley Crüe".into()),
                album: Some("Dr. Feelgood".into()),
                album_artist: Some("Mötley Crüe".into()),
                track_number: Some(5),
                disc_number: Some(1),
                year: Some(1989),
                genre: Some("Glam Metal".into()),
                duration: Duration::from_secs(284),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000003,
        },
        Track {
            id: "t_cyrillic".into(),
            source: TrackSource::Managed(managed_root.join("kino.mp3")),
            metadata: TrackMetadata {
                title: Some("Группа крови".into()),
                artist: Some("Кино".into()),
                album: Some("Группа крови".into()),
                album_artist: Some("Кино".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(1988),
                genre: Some("Post-Punk".into()),
                duration: Duration::from_secs(285),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000004,
        },
        Track {
            id: "t_japanese".into(),
            source: TrackSource::Managed(managed_root.join("hisaishi.flac")),
            metadata: TrackMetadata {
                title: Some("あの夏へ (One Summer's Day)".into()),
                artist: Some("久石譲".into()),
                album: Some("千と千尋の神隠し".into()),
                album_artist: Some("久石譲".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2001),
                genre: Some("Soundtrack".into()),
                duration: Duration::from_secs(189),
                sample_rate: Some(48000),
                bit_depth: Some(24),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000005,
        },
        Track {
            id: "t_special_chars".into(),
            source: TrackSource::Managed(managed_root.join("acdc.mp3")),
            metadata: TrackMetadata {
                title: Some("Thunderstruck (Live & Raw)".into()),
                artist: Some("AC/DC".into()),
                album: Some("The Razors Edge".into()),
                album_artist: Some("AC/DC".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(1990),
                genre: Some("Hard Rock & Roll".into()),
                duration: Duration::from_secs(292),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000006,
        },
    ];

    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    // 1. Test diacritic-insensitive searches: "Bjork" finds "Björk"
    let res_bjork = db.search_fts("Bjork", &managed_root).unwrap();
    assert_eq!(res_bjork.len(), 1);
    assert_eq!(res_bjork[0].id, "t_bjork");

    // 2. "Rene" finds "René"
    let res_rene = db.search_fts("Rene", &managed_root).unwrap();
    assert_eq!(res_rene.len(), 1);
    assert_eq!(res_rene[0].id, "t_rene");

    // 3. "Motley Crue" finds "Mötley Crüe"
    let res_motley = db.search_fts("Motley Crue", &managed_root).unwrap();
    assert_eq!(res_motley.len(), 1);
    assert_eq!(res_motley[0].id, "t_motley");

    // 4. Cyrillic Search
    let res_kino = db.search_fts("Кино", &managed_root).unwrap();
    assert_eq!(res_kino.len(), 1);
    assert_eq!(res_kino[0].id, "t_cyrillic");

    // 5. Japanese Kanji Search
    let res_hisaishi = db.search_fts("久石譲", &managed_root).unwrap();
    assert_eq!(res_hisaishi.len(), 1);
    assert_eq!(res_hisaishi[0].id, "t_japanese");

    // 6. Special Characters: "AC/DC" and "Rock & Roll"
    let res_acdc = db.search_fts("AC/DC", &managed_root).unwrap();
    assert_eq!(res_acdc.len(), 1);
    assert_eq!(res_acdc[0].id, "t_special_chars");

    let res_rock = db.search_fts("Hard Rock & Roll", &managed_root).unwrap();
    assert_eq!(res_rock.len(), 1);
    assert_eq!(res_rock[0].id, "t_special_chars");

    // 7. Punctuation-only queries return empty without error
    let res_punct = db.search_fts("??? !@#$% ^&*()", &managed_root).unwrap();
    assert!(res_punct.is_empty());

    let res_empty = db.search_fts("   ", &managed_root).unwrap();
    assert!(res_empty.is_empty());

    // 8. SQL Injection attacks are safely sanitized
    let res_injection = db
        .search_fts("'; DROP TABLE tracks; --", &managed_root)
        .unwrap();
    // Verify table still exists and query returned cleanly
    assert!(res_injection.is_empty());
    assert_eq!(db.load_all(&managed_root).unwrap().len(), 6);

    let res_sqli2 = db.search_fts("' OR '1'='1", &managed_root).unwrap();
    assert!(res_sqli2.is_empty());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_multi_connection_wal_concurrency() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_wal_multi_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    // Primary connection through LibraryDatabase
    let db = Arc::new(LibraryDatabase::open(&db_path).unwrap());

    // Populate initial tracks
    let mut initial_tracks = Vec::new();
    for i in 1..=50 {
        initial_tracks.push(Track {
            id: format!("init-{i}"),
            source: TrackSource::Managed(managed_root.join(format!("song_{i}.mp3"))),
            metadata: TrackMetadata {
                title: Some(format!("Initial Track {i}")),
                artist: Some("Initial Artist".into()),
                album: Some("Initial Album".into()),
                album_artist: None,
                track_number: Some(i),
                disc_number: Some(1),
                year: Some(2020),
                genre: None,
                duration: Duration::from_secs(100),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000000 + i as u64,
        });
    }
    db.insert_or_update_batch(&initial_tracks, &managed_root)
        .unwrap();

    let writer_done = Arc::new(AtomicBool::new(false));

    // Spawn concurrent reader threads using SEPARATE independent SQLite connections
    let mut reader_handles = Vec::new();
    for _ in 0..4 {
        let p = db_path.clone();
        let is_done = Arc::clone(&writer_done);
        reader_handles.push(thread::spawn(move || {
            let reader_conn = rusqlite::Connection::open(&p).unwrap();
            reader_conn
                .busy_timeout(Duration::from_millis(5000))
                .unwrap();
            let mut read_iterations = 0;

            while !is_done.load(Ordering::SeqCst) || read_iterations < 20 {
                let count: usize = reader_conn
                    .query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))
                    .expect("Concurrent read in WAL mode must not fail or block");
                assert!(count >= 50);

                let fts_count: usize = reader_conn
                    .query_row(
                        "SELECT COUNT(*) FROM tracks_fts WHERE tracks_fts MATCH 'Initial*'",
                        [],
                        |r| r.get(0),
                    )
                    .expect("FTS query during active WAL writing must succeed");
                assert!(fts_count >= 50);

                read_iterations += 1;
                thread::sleep(Duration::from_millis(1));
            }
            read_iterations
        }));
    }

    // Heavy writer running multiple batched inserts
    let db_writer = Arc::clone(&db);
    let root_writer = managed_root.clone();
    let writer_handle = thread::spawn(move || {
        for batch_num in 1..=5 {
            let mut batch = Vec::new();
            for i in 1..=50 {
                let id = format!("batch-{batch_num}-{i}");
                batch.push(Track {
                    id: id.clone(),
                    source: TrackSource::Managed(root_writer.join(format!("{id}.mp3"))),
                    metadata: TrackMetadata {
                        title: Some(format!("Batch {batch_num} Song {i}")),
                        artist: Some("Batch Artist".into()),
                        album: Some("Batch Album".into()),
                        album_artist: None,
                        track_number: Some(i),
                        disc_number: Some(1),
                        year: Some(2022),
                        genre: None,
                        duration: Duration::from_secs(120),
                        sample_rate: None,
                        bit_depth: None,
                        channels: None,
                        format: "MP3".into(),
                        lyrics: None,
                ..Default::default()
                    },
                    date_added: 1700000000 + i as u64,
                });
            }
            db_writer
                .insert_or_update_batch(&batch, &root_writer)
                .unwrap();
            thread::sleep(Duration::from_millis(5));
        }
    });

    writer_handle.join().unwrap();
    writer_done.store(true, Ordering::SeqCst);

    for handle in reader_handles {
        let iterations = handle.join().unwrap();
        assert!(iterations >= 20);
    }

    // Final total tracks = 50 initial + 250 batch = 300
    assert_eq!(db.load_all(&managed_root).unwrap().len(), 300);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_transaction_atomicity_and_rollback_integrity() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_tx_rollback_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    // 1. Initial valid track
    let track1 = Track {
        id: "valid-1".into(),
        source: TrackSource::Managed(managed_root.join("valid1.mp3")),
        metadata: TrackMetadata {
            title: Some("Valid Track 1".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            album_artist: None,
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2020),
            genre: None,
            duration: Duration::from_secs(180),
            sample_rate: None,
            bit_depth: None,
            channels: None,
            format: "MP3".into(),
            lyrics: None,
            ..Default::default()
        },
        date_added: 1700000000,
    };
    db.insert_or_update(&track1, &managed_root).unwrap();
    assert_eq!(db.load_all(&managed_root).unwrap().len(), 1);

    // 2. Create playlist with track1
    let playlist = db.create_playlist("My Playlist").unwrap();
    db.add_tracks_to_playlist(&playlist.id, &["valid-1".into()])
        .unwrap();
    let initial_pl = db.get_playlist(&playlist.id).unwrap().unwrap();
    assert_eq!(initial_pl.track_ids, vec!["valid-1".to_string()]);

    // 3. Attempt to save playlist with a non-existent track ID (violates foreign key constraint)
    let mut invalid_pl = initial_pl.clone();
    invalid_pl.name = "Corrupted Attempt".into();
    invalid_pl.track_ids = vec!["valid-1".into(), "non_existent_ghost_track_id".into()];

    let save_res = db.save_playlist(&invalid_pl);
    assert!(
        save_res.is_err(),
        "Foreign key violation must produce error"
    );

    // 4. Verify full rollback: playlist name and track list remain unmodified
    let after_rollback_pl = db.get_playlist(&playlist.id).unwrap().unwrap();
    assert_eq!(after_rollback_pl.name, "My Playlist");
    assert_eq!(after_rollback_pl.track_ids, vec!["valid-1".to_string()]);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_library_rebuild_resilience_on_disk_mutations() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_rebuild_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let incoming_dir = temp_dir.join("incoming");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&incoming_dir).unwrap();
    fs::create_dir_all(&library_root).unwrap();

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path).unwrap();

    // Create 4 initial audio files
    for i in 1..=4 {
        let fpath = incoming_dir.join(format!("song_{i}.mp3"));
        fs::write(&fpath, b"ID3\x03\x00\x00\x00\x00\x00\x00audioframesample").unwrap();
        manager
            .import_track(&fpath, ImportStrategy::Copy)
            .await
            .unwrap();
    }

    assert_eq!(manager.all_tracks().len(), 4);
    let original_tracks = manager.all_tracks().to_vec();

    // 1. Delete 1 physical file from the managed library directory
    let to_delete_path = original_tracks[0].source.path();
    let _ = fs::remove_file(to_delete_path);

    // 2. Add 2 new files directly into the managed directory
    let new_track_path1 = library_root.join("new_song_A.flac");
    fs::write(&new_track_path1, b"fLaC\x00\x00\x00\x00newcontentA").unwrap();

    let new_track_path2 = library_root.join("new_song_B.mp3");
    fs::write(
        &new_track_path2,
        b"ID3\x03\x00\x00\x00\x00\x00\x00newcontentB",
    )
    .unwrap();

    // 3. Trigger rebuild_library
    let rebuilt_tracks = manager.rebuild_library().await.unwrap();

    // 4. Expected count: 3 remaining original + 2 new = 5 tracks
    assert_eq!(rebuilt_tracks.len(), 5);
    assert_eq!(manager.all_tracks().len(), 5);

    // Verify deleted file is no longer in library
    assert!(!manager
        .all_tracks()
        .iter()
        .any(|t| t.id == original_tracks[0].id));

    // Verify new files are present and indexed
    assert!(manager
        .all_tracks()
        .iter()
        .any(|t| t.source.path().file_name().unwrap() == "new_song_A.flac"));
    assert!(manager
        .all_tracks()
        .iter()
        .any(|t| t.source.path().file_name().unwrap() == "new_song_B.mp3"));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_corrupt_and_untagged_audio_fallbacks() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_corrupt_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();

    let reader = LoftyMetadataReader::new();

    // 1. 0-byte file
    let empty_file = temp_dir.join("01_empty_song.mp3");
    fs::write(&empty_file, b"").unwrap();
    let meta_empty = reader.read_metadata(&empty_file).unwrap();
    assert_eq!(meta_empty.title.as_deref(), Some("01_empty_song"));
    assert_eq!(meta_empty.format, "MP3");
    assert_eq!(meta_empty.duration, Duration::ZERO);
    assert!(meta_empty.artist.is_none());
    assert!(meta_empty.album.is_none());
    assert!(reader.read_artwork(&empty_file).unwrap().is_none());

    // 2. Truncated FLAC header
    let truncated_flac = temp_dir.join("truncated.flac");
    fs::write(&truncated_flac, b"fLaC\x00\x00").unwrap();
    let meta_flac = reader.read_metadata(&truncated_flac).unwrap();
    assert_eq!(meta_flac.title.as_deref(), Some("truncated"));
    assert_eq!(meta_flac.format, "FLAC");
    assert!(reader.read_artwork(&truncated_flac).unwrap().is_none());

    // 3. Corrupt ID3 frame / random binary garbage
    let garbage_mp3 = temp_dir.join("garbage.mp3");
    fs::write(
        &garbage_mp3,
        [0xFF, 0xFE, 0x00, 0x12, 0x99, 0x88, 0x77, 0x66],
    )
    .unwrap();
    let meta_garbage = reader.read_metadata(&garbage_mp3).unwrap();
    assert_eq!(meta_garbage.title.as_deref(), Some("garbage"));
    assert_eq!(meta_garbage.format, "MP3");
    assert!(reader.read_artwork(&garbage_mp3).unwrap().is_none());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_scanner_filters_non_audio_files() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_filter_test_{}", uuid::Uuid::new_v4()));
    let incoming_dir = temp_dir.join("mixed_files");
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&incoming_dir).unwrap();
    fs::create_dir_all(&library_root).unwrap();

    // Create mixed files: 3 audio files, 5 non-audio files
    fs::write(
        incoming_dir.join("track1.mp3"),
        b"ID3\x03\x00\x00\x00\x00\x00\x00data",
    )
    .unwrap();
    fs::write(
        incoming_dir.join("track2.flac"),
        b"fLaC\x00\x00\x00\x00data",
    )
    .unwrap();
    fs::write(incoming_dir.join("track3.ogg"), b"OggS\x00\x00\x00\x00data").unwrap();

    fs::write(incoming_dir.join("cover.jpg"), b"\xFF\xD8\xFF\xE0image").unwrap();
    fs::write(incoming_dir.join("info.nfo"), b"Release Info NFO").unwrap();
    fs::write(incoming_dir.join("notes.txt"), b"Album Notes").unwrap();
    fs::write(incoming_dir.join("playlist.m3u"), b"track1.mp3\n").unwrap();
    fs::write(incoming_dir.join(".DS_Store"), b"apple metadata").unwrap();

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path).unwrap();

    let imported = manager
        .import_directory(&incoming_dir, ImportStrategy::Copy)
        .await
        .unwrap();

    // Only the 3 audio files should have been imported
    assert_eq!(imported.len(), 3);
    assert_eq!(manager.all_tracks().len(), 3);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_multi_artist_and_missing_tag_edge_cases() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_multi_artist_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    let tracks = vec![
        Track {
            id: "t_slash".into(),
            source: TrackSource::Managed(managed_root.join("kavinsky_lovefoxxx.mp3")),
            metadata: TrackMetadata {
                title: Some("Nightcall".into()),
                artist: Some("Kavinsky / Lovefoxxx".into()),
                album: Some("Nightcall EP".into()),
                album_artist: Some("Kavinsky".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2010),
                genre: Some("Synthwave".into()),
                duration: Duration::from_secs(259),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000001,
        },
        Track {
            id: "t_semicolon".into(),
            source: TrackSource::Managed(managed_root.join("daft_casablancas.flac")),
            metadata: TrackMetadata {
                title: Some("Instant Crush".into()),
                artist: Some("Daft Punk; Julian Casablancas".into()),
                album: Some("Random Access Memories".into()),
                album_artist: Some("Daft Punk".into()),
                track_number: Some(5),
                disc_number: Some(1),
                year: Some(2013),
                genre: Some("Disco".into()),
                duration: Duration::from_secs(337),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000002,
        },
        Track {
            id: "t_feat".into(),
            source: TrackSource::Managed(managed_root.join("gunship_cappello.flac")),
            metadata: TrackMetadata {
                title: Some("Dark All Day".into()),
                artist: Some("Gunship feat. Tim Cappello & Indiana".into()),
                album: Some("Dark All Day".into()),
                album_artist: Some("Gunship".into()),
                track_number: Some(2),
                disc_number: Some(1),
                year: Some(2018),
                genre: Some("Synthwave".into()),
                duration: Duration::from_secs(328),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000003,
        },
        Track {
            id: "t_ft".into(),
            source: TrackSource::Managed(managed_root.join("midnight_tyler.mp3")),
            metadata: TrackMetadata {
                title: Some("Sunset".into()),
                artist: Some("The Midnight ft. Tyler Lyle".into()),
                album: Some("Endless Summer".into()),
                album_artist: Some("The Midnight".into()),
                track_number: Some(3),
                disc_number: Some(1),
                year: Some(2016),
                genre: Some("Synthwave".into()),
                duration: Duration::from_secs(326),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000004,
        },
        Track {
            id: "t_missing_tags".into(),
            source: TrackSource::Managed(managed_root.join("mystery_song.wav")),
            metadata: TrackMetadata {
                title: Some("mystery_song".into()),
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                disc_number: None,
                year: None,
                genre: None,
                duration: Duration::from_secs(60),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "WAV".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000005,
        },
    ];

    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    // 1. FTS5 Search resolves individual collaborators
    // Search "Lovefoxxx" finds "Kavinsky / Lovefoxxx"
    let res1 = db.search_fts("Lovefoxxx", &managed_root).unwrap();
    assert_eq!(res1.len(), 1);
    assert_eq!(res1[0].id, "t_slash");

    // Search "Julian" or "Casablancas" finds "Daft Punk; Julian Casablancas"
    let res2 = db.search_fts("Casablancas", &managed_root).unwrap();
    assert_eq!(res2.len(), 1);
    assert_eq!(res2[0].id, "t_semicolon");

    // Search "Cappello" finds "Gunship feat. Tim Cappello & Indiana"
    let res3 = db.search_fts("Cappello", &managed_root).unwrap();
    assert_eq!(res3.len(), 1);
    assert_eq!(res3[0].id, "t_feat");

    // Search "Tyler Lyle" finds "The Midnight ft. Tyler Lyle"
    let res4 = db.search_fts("Tyler Lyle", &managed_root).unwrap();
    assert_eq!(res4.len(), 1);
    assert_eq!(res4[0].id, "t_ft");

    // 2. Missing tags coalesce cleanly in aggregations
    let albums = db.list_albums().unwrap();
    let unknown_album = albums.iter().find(|a| a.title == "Unknown Album");
    assert!(unknown_album.is_some());
    assert_eq!(unknown_album.unwrap().artist, "Unknown Artist");
    assert_eq!(unknown_album.unwrap().track_count, 1);

    let artists = db.list_artists().unwrap();
    let unknown_artist = artists.iter().find(|a| a.name == "Unknown Artist");
    assert!(unknown_artist.is_some());
    assert_eq!(unknown_artist.unwrap().track_count, 1);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_sqlite_aggregations() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_agg_test_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    let tracks = vec![
        Track {
            id: "t1".into(),
            source: TrackSource::Managed(managed_root.join("artist1/album1/01.flac")),
            metadata: TrackMetadata {
                title: Some("Song A".into()),
                artist: Some("Daft Punk".into()),
                album: Some("Discovery".into()),
                album_artist: Some("Daft Punk".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2001),
                genre: Some("Electronic".into()),
                duration: Duration::from_secs(200),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000000,
        },
        Track {
            id: "t2".into(),
            source: TrackSource::Managed(managed_root.join("artist1/album1/02.flac")),
            metadata: TrackMetadata {
                title: Some("Song B".into()),
                artist: Some("Daft Punk".into()),
                album: Some("Discovery".into()),
                album_artist: Some("Daft Punk".into()),
                track_number: Some(2),
                disc_number: Some(1),
                year: Some(2001),
                genre: Some("Electronic".into()),
                duration: Duration::from_secs(300),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000001,
        },
        Track {
            id: "t3".into(),
            source: TrackSource::Managed(managed_root.join("artist2/album2/01.flac")),
            metadata: TrackMetadata {
                title: Some("Song C".into()),
                artist: Some("Justice".into()),
                album: Some("Cross".into()),
                album_artist: Some("Justice".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2007),
                genre: Some("Electro House".into()),
                duration: Duration::from_secs(240),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000002,
        },
    ];

    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    // Check list_albums
    let albums = db.list_albums().unwrap();
    assert_eq!(albums.len(), 2);
    let discovery = albums.iter().find(|a| a.title == "Discovery").unwrap();
    assert_eq!(discovery.artist, "Daft Punk");
    assert_eq!(discovery.track_count, 2);
    assert_eq!(discovery.total_duration.as_secs(), 500);
    assert_eq!(discovery.year, Some(2001));

    // Check list_artists
    let artists = db.list_artists().unwrap();
    assert_eq!(artists.len(), 2);
    let daft = artists.iter().find(|a| a.name == "Daft Punk").unwrap();
    assert_eq!(daft.album_count, 1);
    assert_eq!(daft.track_count, 2);

    // Check get_album_tracks
    let disc_tracks = db
        .get_album_tracks("Discovery", Some("Daft Punk"), &managed_root)
        .unwrap();
    assert_eq!(disc_tracks.len(), 2);
    assert_eq!(disc_tracks[0].id, "t1");
    assert_eq!(disc_tracks[1].id, "t2");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_parallel_directory_scanner_with_progress() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_scan_test_{}", uuid::Uuid::new_v4()));
    let source_dir = temp_dir.join("incoming_music");
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");

    fs::create_dir_all(&source_dir).unwrap();
    fs::create_dir_all(&library_root).unwrap();

    // Create 15 dummy audio files
    for i in 1..=15 {
        let file_path = source_dir.join(format!("song_{i:02}.mp3"));
        let mut f = File::create(&file_path).unwrap();
        f.write_all(b"ID3dummydataaudioframe").unwrap();
    }

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path).unwrap();

    let (tx, mut rx) = mpsc::channel::<ScanProgress>(100);

    let progress_handle = tokio::spawn(async move {
        let mut events = Vec::new();
        while let Some(event) = rx.recv().await {
            events.push(event);
        }
        events
    });

    let imported = manager
        .import_directory_with_progress(&source_dir, ImportStrategy::Copy, Some(tx))
        .await
        .unwrap();

    assert_eq!(imported.len(), 15);
    assert_eq!(manager.all_tracks().len(), 15);

    let events = progress_handle.await.unwrap();
    assert!(!events.is_empty());

    let has_discovered = events
        .iter()
        .any(|e| matches!(e, ScanProgress::DiscoveredFiles(15)));
    let has_completed = events
        .iter()
        .any(|e| matches!(e, ScanProgress::Completed(_)));
    assert!(has_discovered);
    assert!(has_completed);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_playlist_operations() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_playlist_test_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    // Ingest sample tracks
    let tracks = vec![
        Track {
            id: "track-1".into(),
            source: TrackSource::Managed(managed_root.join("track1.mp3")),
            metadata: TrackMetadata {
                title: Some("Track One".into()),
                artist: Some("Artist One".into()),
                album: Some("Album One".into()),
                album_artist: None,
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2020),
                genre: None,
                duration: Duration::from_secs(120),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000000,
        },
        Track {
            id: "track-2".into(),
            source: TrackSource::Managed(managed_root.join("track2.mp3")),
            metadata: TrackMetadata {
                title: Some("Track Two".into()),
                artist: Some("Artist Two".into()),
                album: Some("Album Two".into()),
                album_artist: None,
                track_number: Some(2),
                disc_number: Some(1),
                year: Some(2021),
                genre: None,
                duration: Duration::from_secs(150),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000001,
        },
    ];
    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    // Create playlist
    let playlist = db.create_playlist("Chill Synth").unwrap();
    assert_eq!(playlist.name, "Chill Synth");

    // Add tracks
    db.add_tracks_to_playlist(&playlist.id, &["track-1".into(), "track-2".into()])
        .unwrap();

    let fetched = db.get_playlist(&playlist.id).unwrap().unwrap();
    assert_eq!(fetched.track_ids.len(), 2);
    assert_eq!(fetched.track_ids[0], "track-1");
    assert_eq!(fetched.track_ids[1], "track-2");

    // Get playlist tracks
    let pl_tracks = db.get_playlist_tracks(&playlist.id, &managed_root).unwrap();
    assert_eq!(pl_tracks.len(), 2);
    assert_eq!(pl_tracks[0].metadata.title.as_deref(), Some("Track One"));

    // Rename playlist
    db.rename_playlist(&playlist.id, "Renamed Synth").unwrap();
    let renamed = db.get_playlist(&playlist.id).unwrap().unwrap();
    assert_eq!(renamed.name, "Renamed Synth");

    // Remove track from playlist
    db.remove_track_from_playlist(&playlist.id, "track-1")
        .unwrap();
    let after_removal = db.get_playlist(&playlist.id).unwrap().unwrap();
    assert_eq!(after_removal.track_ids, vec!["track-2".to_string()]);

    // Save updated playlist
    let mut modified = after_removal.clone();
    modified.name = "Ultimate Synth".into();
    modified.track_ids = vec!["track-2".into()];
    db.save_playlist(&modified).unwrap();

    let after_save = db.get_playlist(&playlist.id).unwrap().unwrap();
    assert_eq!(after_save.name, "Ultimate Synth");
    assert_eq!(after_save.track_ids, vec!["track-2".to_string()]);

    // List playlists
    let all_pls = db.list_playlists().unwrap();
    assert_eq!(all_pls.len(), 1);

    // Delete playlist
    db.delete_playlist(&playlist.id).unwrap();
    assert!(db.get_playlist(&playlist.id).unwrap().is_none());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_liked_tracks_operations() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_liked_test_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    let tracks = vec![
        Track {
            id: "track-1".into(),
            source: TrackSource::Managed(managed_root.join("track1.mp3")),
            metadata: TrackMetadata {
                title: Some("Song A".into()),
                artist: Some("Artist A".into()),
                album: Some("Album A".into()),
                album_artist: None,
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2022),
                genre: None,
                duration: Duration::from_secs(180),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                format: "MP3".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000000,
        },
        Track {
            id: "track-2".into(),
            source: TrackSource::Managed(managed_root.join("track2.mp3")),
            metadata: TrackMetadata {
                title: Some("Song B".into()),
                artist: Some("Artist B".into()),
                album: Some("Album B".into()),
                album_artist: None,
                track_number: Some(2),
                disc_number: Some(1),
                year: Some(2023),
                genre: None,
                duration: Duration::from_secs(200),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000001,
        },
    ];
    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    // 1. Initial state: not liked
    assert!(!db.is_track_liked("track-1").unwrap());
    assert_eq!(db.get_liked_track_ids().unwrap().len(), 0);
    assert_eq!(db.get_liked_tracks(&managed_root).unwrap().len(), 0);

    // 2. Like track-1
    db.like_track("track-1").unwrap();
    assert!(db.is_track_liked("track-1").unwrap());
    assert_eq!(
        db.get_liked_track_ids().unwrap(),
        vec!["track-1".to_string()]
    );
    let liked_tracks = db.get_liked_tracks(&managed_root).unwrap();
    assert_eq!(liked_tracks.len(), 1);
    assert_eq!(liked_tracks[0].metadata.title.as_deref(), Some("Song A"));

    // 3. Toggle like on track-2 (false -> true)
    let state = db.toggle_like("track-2").unwrap();
    assert!(state);
    assert!(db.is_track_liked("track-2").unwrap());
    assert_eq!(db.get_liked_track_ids().unwrap().len(), 2);

    // 4. Toggle like on track-1 (true -> false)
    let state = db.toggle_like("track-1").unwrap();
    assert!(!state);
    assert!(!db.is_track_liked("track-1").unwrap());
    assert_eq!(
        db.get_liked_track_ids().unwrap(),
        vec!["track-2".to_string()]
    );

    // 5. Unlike track-2
    db.unlike_track("track-2").unwrap();
    assert!(!db.is_track_liked("track-2").unwrap());
    assert_eq!(db.get_liked_track_ids().unwrap().len(), 0);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_import_track_copy_and_move_strategies() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_strategy_test_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&library_root).unwrap();

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path).unwrap();

    // 1. Test Copy Strategy
    let copy_source = temp_dir.join("copy_source.mp3");
    {
        let mut f = File::create(&copy_source).unwrap();
        f.write_all(b"ID3dummydata").unwrap();
    }

    let copied = manager
        .import_track(&copy_source, ImportStrategy::Copy)
        .await
        .unwrap();

    assert!(copy_source.exists()); // Source file still exists after copy
    assert!(copied.source.path().exists());

    // 2. Test Move Strategy
    let move_source = temp_dir.join("move_source.mp3");
    {
        let mut f = File::create(&move_source).unwrap();
        f.write_all(b"ID3dummydata").unwrap();
    }

    let moved = manager
        .import_track(&move_source, ImportStrategy::Move)
        .await
        .unwrap();

    assert!(!move_source.exists()); // Source file is deleted/moved
    assert!(moved.source.path().exists());

    // 3. Test get_track, all_tracks, search
    assert_eq!(manager.all_tracks().len(), 2);
    assert!(manager.get_track(&copied.id).is_some());
    assert!(manager.get_track(&moved.id).is_some());

    // 4. Test delete_track
    manager.delete_track(&copied.id, true).await.unwrap();
    assert_eq!(manager.all_tracks().len(), 1);
    assert!(!copied.source.path().exists());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_reimport_and_rescan_deduplication() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_dedup_test_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let external_dir = temp_dir.join("external");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&library_root).unwrap();
    fs::create_dir_all(&external_dir).unwrap();

    let song_path = external_dir.join("song_dedup.mp3");
    fs::write(&song_path, b"ID3\x03\x00\x00\x00\x00\x00\x00dedupcontent").unwrap();

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path).unwrap();

    // 1. Initial import of single track
    let track1 = manager
        .import_track(&song_path, ImportStrategy::Copy)
        .await
        .unwrap();
    assert_eq!(manager.all_tracks().len(), 1);

    // 2. Re-import the exact same track multiple times
    let track2 = manager
        .import_track(&song_path, ImportStrategy::Copy)
        .await
        .unwrap();
    assert_eq!(track1.id, track2.id);
    assert_eq!(manager.all_tracks().len(), 1);

    // 3. Scan the external directory multiple times
    let _ = manager
        .import_directory(&external_dir, ImportStrategy::Copy)
        .await
        .unwrap();
    assert_eq!(manager.all_tracks().len(), 1);

    let _ = manager
        .import_directory(&external_dir, ImportStrategy::Copy)
        .await
        .unwrap();
    assert_eq!(manager.all_tracks().len(), 1);

    // 4. Scan the managed library root directory itself (simulating startup scan)
    let _ = manager
        .import_directory(&library_root, ImportStrategy::Copy)
        .await
        .unwrap();
    assert_eq!(manager.all_tracks().len(), 1);

    let _ = manager
        .import_directory(&library_root, ImportStrategy::Copy)
        .await
        .unwrap();
    assert_eq!(manager.all_tracks().len(), 1);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_legacy_uuid_duplicate_cleanup() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_legacy_uuid_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&library_root).unwrap();

    // Create a target artist/album dir inside library
    let album_dir = library_root.join("Muse").join("Will Of The People");
    fs::create_dir_all(&album_dir).unwrap();

    // Canonical file
    let canonical = album_dir.join("song.mp3");
    fs::write(
        &canonical,
        b"ID3\x03\x00\x00\x00\x00\x00\x00canonicalcontent",
    )
    .unwrap();

    // Legacy duplicate files with 8 hex chars suffixes
    let dup1 = album_dir.join("song_a1b2c3d4.mp3");
    let dup2 = album_dir.join("song_e5f60718.mp3");
    fs::write(&dup1, b"ID3\x03\x00\x00\x00\x00\x00\x00dup1content").unwrap();
    fs::write(&dup2, b"ID3\x03\x00\x00\x00\x00\x00\x00dup2content").unwrap();

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path).unwrap();

    // Scanning the library root should clean up dup1 and dup2 from disk and keep only canonical
    let scanned = manager
        .import_directory(&library_root, ImportStrategy::Copy)
        .await
        .unwrap();

    assert_eq!(scanned.len(), 1);
    assert_eq!(manager.all_tracks().len(), 1);
    assert!(canonical.exists());
    assert!(
        !dup1.exists(),
        "Legacy duplicate 1 must be deleted from disk"
    );
    assert!(
        !dup2.exists(),
        "Legacy duplicate 2 must be deleted from disk"
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_fts5_bm25_weighted_ranking_relevance() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_bm25_rank_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    // Setup tracks with the target query term "Hyperdrive" in different fields:
    // 1. Title match (weight 10.0) -> Expected Rank 1
    // 2. Artist match (weight 5.0) -> Expected Rank 2
    // 3. Album match (weight 3.0) -> Expected Rank 3
    // 4. Album Artist match (weight 2.0) -> Expected Rank 4
    // 5. Genre match (weight 1.0) -> Expected Rank 5
    let tracks = vec![
        Track {
            id: "t_genre".into(),
            source: TrackSource::Managed(managed_root.join("genre_match.flac")),
            metadata: TrackMetadata {
                title: Some("Cosmic Voyage".into()),
                artist: Some("Alpha Band".into()),
                album: Some("Starlight".into()),
                album_artist: Some("Alpha Band".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2024),
                genre: Some("Hyperdrive".into()),
                duration: Duration::from_secs(180),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000001,
        },
        Track {
            id: "t_album_artist".into(),
            source: TrackSource::Managed(managed_root.join("album_artist_match.flac")),
            metadata: TrackMetadata {
                title: Some("Nebula Horizon".into()),
                artist: Some("Beta Performer".into()),
                album: Some("Deep Space".into()),
                album_artist: Some("Hyperdrive Collective".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2024),
                genre: Some("Electronic".into()),
                duration: Duration::from_secs(200),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000002,
        },
        Track {
            id: "t_album".into(),
            source: TrackSource::Managed(managed_root.join("album_match.flac")),
            metadata: TrackMetadata {
                title: Some("Stellar Pulse".into()),
                artist: Some("Gamma Duo".into()),
                album: Some("Hyperdrive Odyssey".into()),
                album_artist: Some("Gamma Duo".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2024),
                genre: Some("Synthwave".into()),
                duration: Duration::from_secs(210),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000003,
        },
        Track {
            id: "t_artist".into(),
            source: TrackSource::Managed(managed_root.join("artist_match.flac")),
            metadata: TrackMetadata {
                title: Some("Orbit Decay".into()),
                artist: Some("Hyperdrive Project".into()),
                album: Some("Gravity Well".into()),
                album_artist: Some("Hyperdrive Project".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2024),
                genre: Some("Electro".into()),
                duration: Duration::from_secs(220),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000004,
        },
        Track {
            id: "t_title".into(),
            source: TrackSource::Managed(managed_root.join("title_match.flac")),
            metadata: TrackMetadata {
                title: Some("Hyperdrive Overload".into()),
                artist: Some("Delta Force".into()),
                album: Some("Supernova".into()),
                album_artist: Some("Delta Force".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2024),
                genre: Some("Chiptune".into()),
                duration: Duration::from_secs(230),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000005,
        },
    ];

    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    let search_results = db.search_fts("Hyperdrive", &managed_root).unwrap();
    assert_eq!(search_results.len(), 5);

    let result_ids: Vec<String> = search_results.iter().map(|t| t.id.clone()).collect();
    println!(
        "BM25 Weighted Search Result Order for 'Hyperdrive': {:?}",
        result_ids
    );

    // Exact expected BM25 order:
    // 1. Title (weight 10.0) -> t_title
    // 2. Artist (weight 5.0) -> t_artist
    // 3. Album (weight 3.0) -> t_album
    // 4. Album Artist (weight 2.0) -> t_album_artist
    // 5. Genre (weight 1.0) -> t_genre
    assert_eq!(
        result_ids[0], "t_title",
        "Title match must rank highest (weight 10.0)"
    );
    assert_eq!(
        result_ids[1], "t_artist",
        "Artist match must rank second (weight 5.0)"
    );
    assert_eq!(
        result_ids[2], "t_album",
        "Album match must rank third (weight 3.0)"
    );
    assert_eq!(
        result_ids[3], "t_album_artist",
        "Album Artist match must rank fourth (weight 2.0)"
    );
    assert_eq!(
        result_ids[4], "t_genre",
        "Genre match must rank fifth (weight 1.0)"
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_year_boundary_validation_and_defensive_guard() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_year_val_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();

    let reader = LoftyMetadataReader::new();

    fn create_dummy_wav(path: &Path) {
        let mut data = Vec::new();
        data.extend_from_slice(b"RIFF");
        data.extend_from_slice(&(52u32).to_le_bytes()); // ChunkSize: 4 + 24 + 8 + 16 = 52
        data.extend_from_slice(b"WAVE");
        data.extend_from_slice(b"fmt ");
        data.extend_from_slice(&(16u32).to_le_bytes());
        data.extend_from_slice(&(1u16).to_le_bytes());
        data.extend_from_slice(&(2u16).to_le_bytes());
        data.extend_from_slice(&(44100u32).to_le_bytes());
        data.extend_from_slice(&(176400u32).to_le_bytes());
        data.extend_from_slice(&(4u16).to_le_bytes());
        data.extend_from_slice(&(16u16).to_le_bytes());
        data.extend_from_slice(b"data");
        data.extend_from_slice(&(16u32).to_le_bytes());
        data.extend_from_slice(&[0u8; 16]);
        fs::write(path, data).unwrap();
    }

    let audio_file = temp_dir.join("year_test_song.wav");
    create_dummy_wav(&audio_file);

    // 1. Test write_metadata with negative year: should not panic or set negative/underflowed year
    let neg_year_meta = TrackMetadata {
        title: Some("Negative Year Song".into()),
        artist: Some("Test Artist".into()),
        album: Some("Test Album".into()),
        album_artist: None,
        track_number: Some(1),
        disc_number: Some(1),
        year: Some(-1999),
        genre: Some("Rock".into()),
        duration: Duration::from_secs(120),
        sample_rate: Some(44100),
        bit_depth: Some(16),
        channels: Some(2),
        format: "WAV".into(),
        lyrics: None,
        ..Default::default()
    };
    let write_res = reader.write_metadata(&audio_file, &neg_year_meta);
    assert!(
        write_res.is_ok(),
        "Writing metadata with negative year must succeed without panic: {:?}",
        write_res.err()
    );
    let read_back_neg = reader.read_metadata(&audio_file).unwrap();
    assert!(
        read_back_neg.year.is_none(),
        "Negative year must not be stored in tag"
    );

    // 2. Test write_metadata with zero year: should not set zero year
    let zero_year_meta = TrackMetadata {
        title: Some("Zero Year Song".into()),
        artist: Some("Test Artist".into()),
        album: Some("Test Album".into()),
        album_artist: None,
        track_number: Some(1),
        disc_number: Some(1),
        year: Some(0),
        genre: Some("Rock".into()),
        duration: Duration::from_secs(120),
        sample_rate: Some(44100),
        bit_depth: Some(16),
        channels: Some(2),
        format: "WAV".into(),
        lyrics: None,
        ..Default::default()
    };
    let write_zero_res = reader.write_metadata(&audio_file, &zero_year_meta);
    assert!(
        write_zero_res.is_ok(),
        "Writing metadata with zero year must succeed without panic"
    );
    let read_back_zero = reader.read_metadata(&audio_file).unwrap();
    assert!(
        read_back_zero.year.is_none(),
        "Zero year must not be stored in tag"
    );

    // 3. Test write_metadata with valid positive year
    let valid_year_meta = TrackMetadata {
        title: Some("Valid Year Song".into()),
        artist: Some("Test Artist".into()),
        album: Some("Test Album".into()),
        album_artist: None,
        track_number: Some(1),
        disc_number: Some(1),
        year: Some(2024),
        genre: Some("Rock".into()),
        duration: Duration::from_secs(120),
        sample_rate: Some(44100),
        bit_depth: Some(16),
        channels: Some(2),
        format: "WAV".into(),
        lyrics: None,
        ..Default::default()
    };
    let write_valid_res = reader.write_metadata(&audio_file, &valid_year_meta);
    assert!(
        write_valid_res.is_ok(),
        "Writing metadata with valid year must succeed"
    );
    let read_back_valid = reader.read_metadata(&audio_file).unwrap();
    assert_eq!(
        read_back_valid.year,
        Some(2024),
        "Valid positive year must be stored and read back"
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_parallel_ingestion_corrupted_zero_byte_concurrent_wal_reads() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_corrupt_wal_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let incoming_dir = temp_dir.join("incoming");
    let db_path = temp_dir.join("library.db");

    fs::create_dir_all(&library_root).unwrap();
    fs::create_dir_all(&incoming_dir).unwrap();

    // Create 30 files with varying corruption patterns:
    // - 10 zero-byte files (.mp3, .flac, .ogg, .wav)
    // - 10 truncated header files
    // - 10 random binary garbage files
    for i in 1..=10 {
        let empty_path = incoming_dir.join(format!("empty_song_{i:02}.mp3"));
        fs::write(&empty_path, b"").unwrap();
    }
    for i in 1..=10 {
        let trunc_path = incoming_dir.join(format!("truncated_song_{i:02}.flac"));
        fs::write(&trunc_path, b"fLaC\x00\x00\x01").unwrap();
    }
    for i in 1..=10 {
        let garbage_path = incoming_dir.join(format!("garbage_song_{i:02}.ogg"));
        fs::write(
            &garbage_path,
            [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11],
        )
        .unwrap();
    }

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone()).unwrap();

    let running = Arc::new(AtomicBool::new(true));
    let read_count = Arc::new(AtomicUsize::new(0));
    let read_err = Arc::new(AtomicUsize::new(0));

    // Spawn 4 concurrent WAL reader OS threads querying during ingestion
    let mut reader_handles = Vec::new();
    for _ in 0..4 {
        let p = db_path.clone();
        let running_c = Arc::clone(&running);
        let r_cnt = Arc::clone(&read_count);
        let r_err = Arc::clone(&read_err);

        reader_handles.push(std::thread::spawn(move || {
            let conn = match rusqlite::Connection::open(&p) {
                Ok(c) => c,
                Err(_) => {
                    r_err.fetch_add(1, Ordering::Relaxed);
                    return;
                }
            };
            let _ = conn.busy_timeout(Duration::from_millis(5000));

            while running_c.load(Ordering::Relaxed) {
                let res1: Result<i64, _> =
                    conn.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0));
                let res2: Result<i64, _> = conn.query_row(
                    "SELECT COUNT(*) FROM tracks_fts WHERE tracks_fts MATCH '\"empty\"*'",
                    [],
                    |r| r.get(0),
                );

                if res1.is_err() || res2.is_err() {
                    r_err.fetch_add(1, Ordering::Relaxed);
                } else {
                    r_cnt.fetch_add(2, Ordering::Relaxed);
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }));
    }

    // Ingest all 30 corrupted/malformed files
    let imported = manager
        .import_directory(&incoming_dir, ImportStrategy::Copy)
        .await
        .unwrap();

    running.store(false, Ordering::Relaxed);
    for h in reader_handles {
        h.join().unwrap();
    }

    // All 30 files should have successfully imported with graceful file stem fallbacks
    assert_eq!(imported.len(), 30);
    assert_eq!(manager.all_tracks().len(), 30);
    assert_eq!(
        read_err.load(Ordering::SeqCst),
        0,
        "Zero read errors permitted during parallel ingestion"
    );
    assert!(
        read_count.load(Ordering::SeqCst) > 0,
        "Concurrent reads must execute during scan"
    );

    // Verify all 30 tracks have proper format and duration = 0
    for track in manager.all_tracks() {
        assert_eq!(track.metadata.duration, Duration::ZERO);
        assert!(track.metadata.title.is_some());
    }

    // Search for "truncated" in FTS
    let fts_trunc = manager.search_fts("truncated").unwrap();
    assert_eq!(fts_trunc.len(), 10);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_lyrics_reading_embedded_and_sidecar() {
    let reader = LoftyMetadataReader::new();

    // 1. Verify reading embedded lyrics from the user's sample FLAC if available
    let flac_path = Path::new("/home/arda/Downloads/04 - Tyler, The Creator - See You Again (feat. Kali Uchis)_with_lyrics.flac");
    if flac_path.exists() {
        let meta = reader.read_metadata(flac_path).unwrap();
        assert!(
            meta.lyrics.is_some(),
            "Embedded lyrics must be parsed from FLAC tag"
        );
        let lyrics = meta.lyrics.unwrap();
        assert!(
            lyrics.contains("See You Again"),
            "Lyrics must contain song title"
        );
        assert!(
            lyrics.contains("[00:00.19]"),
            "Lyrics must contain LRC timestamps"
        );
    }

    // 2. Verify reading from sidecar .lrc file
    let temp_dir = std::env::temp_dir().join(format!("wavery_lrc_test_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let song_file = temp_dir.join("test_song.mp3");
    let lrc_file = temp_dir.join("test_song.lrc");

    // Write a dummy file (unreadable by probe fallback) and a sidecar .lrc
    fs::write(&song_file, b"DUMMY_AUDIO_DATA").unwrap();
    fs::write(
        &lrc_file,
        "[00:01.00]Sidecar lyric line 1\n[00:05.00]Sidecar lyric line 2",
    )
    .unwrap();

    let meta = reader.read_metadata(&song_file).unwrap();
    assert!(
        meta.lyrics.is_some(),
        "Sidecar .lrc must be read when present"
    );
    let sidecar_lyrics = meta.lyrics.unwrap();
    assert!(sidecar_lyrics.contains("Sidecar lyric line 1"));
    assert!(sidecar_lyrics.contains("[00:05.00]"));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_lyrics_database_persistence_and_queries() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_db_lyrics_test_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();

    let sample_lrc = "[00:10.00]First line\n[00:20.00]Second line";
    let track = Track {
        id: "track-with-lyrics-1".into(),
        source: TrackSource::Managed(managed_root.join("artist/album/song.flac")),
        metadata: TrackMetadata {
            title: Some("Song With Lyrics".into()),
            artist: Some("Lyric Artist".into()),
            album: Some("Lyric Album".into()),
            album_artist: Some("Lyric Artist".into()),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2026),
            genre: Some("Pop".into()),
            duration: Duration::from_secs(210),
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "FLAC".into(),
            lyrics: Some(sample_lrc.into()),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    // 1. Insert track
    db.insert_or_update(&track, &managed_root).unwrap();

    // 2. Fetch by ID
    let fetched = db
        .get_track("track-with-lyrics-1", &managed_root)
        .unwrap()
        .unwrap();
    assert_eq!(fetched.metadata.lyrics.as_deref(), Some(sample_lrc));

    // 3. Load all
    let all = db.load_all(&managed_root).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].metadata.lyrics.as_deref(), Some(sample_lrc));

    // 4. Get album tracks
    let album_tracks = db
        .get_album_tracks("Lyric Album", Some("Lyric Artist"), &managed_root)
        .unwrap();
    assert_eq!(album_tracks.len(), 1);
    assert_eq!(album_tracks[0].metadata.lyrics.as_deref(), Some(sample_lrc));

    // 5. Update track metadata with new lyrics
    let mut updated_meta = fetched.metadata.clone();
    let updated_lrc = "[00:15.00]Updated lyric line";
    updated_meta.lyrics = Some(updated_lrc.into());
    db.update_track_metadata("track-with-lyrics-1", &updated_meta)
        .unwrap();

    let refetched = db
        .get_track("track-with-lyrics-1", &managed_root)
        .unwrap()
        .unwrap();
    assert_eq!(refetched.metadata.lyrics.as_deref(), Some(updated_lrc));

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_database_schema_migration_for_lyrics() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_db_migration_test_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("legacy_library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    // 1. Manually create a legacy database schema without the lyrics column
    {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE tracks (
                id TEXT PRIMARY KEY,
                relative_path TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                album_artist TEXT,
                track_number INTEGER,
                disc_number INTEGER,
                year INTEGER,
                genre TEXT,
                duration_secs REAL NOT NULL,
                sample_rate INTEGER,
                bit_depth INTEGER,
                channels INTEGER,
                format TEXT NOT NULL,
                date_added INTEGER NOT NULL
            );
            CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE playlist_tracks (playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (playlist_id, position));
            CREATE TABLE liked_tracks (track_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
            CREATE VIRTUAL TABLE tracks_fts USING fts5(title, artist, album, album_artist, genre, content='tracks', content_rowid='rowid');
            INSERT INTO tracks (id, relative_path, title, artist, album, duration_secs, format, date_added)
            VALUES ('legacy-track-1', 'song.mp3', 'Legacy Song', 'Legacy Artist', 'Legacy Album', 120.0, 'MP3', 1700000000);
            "
        ).unwrap();
    }

    // 2. Open via LibraryDatabase::open which must apply the migration
    let db = LibraryDatabase::open(&db_path).unwrap();

    // Verify existing track is loaded with lyrics: None
    let track = db
        .get_track("legacy-track-1", &managed_root)
        .unwrap()
        .unwrap();
    assert_eq!(track.metadata.title.as_deref(), Some("Legacy Song"));
    assert_eq!(track.metadata.lyrics, None);

    // Verify updating metadata to add lyrics works on migrated database
    let mut meta = track.metadata.clone();
    meta.lyrics = Some("[00:01.00]Migrated lyrics".into());
    db.update_track_metadata("legacy-track-1", &meta).unwrap();

    let updated = db
        .get_track("legacy-track-1", &managed_root)
        .unwrap()
        .unwrap();
    assert_eq!(
        updated.metadata.lyrics.as_deref(),
        Some("[00:01.00]Migrated lyrics")
    );

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_heuristics_extract_artist_from_path() {
    use crate::heuristics::extract_artist_from_path;

    // Parent folder heuristic
    let p1 = Path::new("/Music/Radiohead/In Rainbows/01.flac");
    assert_eq!(
        extract_artist_from_path(p1, Some("In Rainbows")),
        Some("Radiohead".to_string())
    );

    // "Artist - Album" folder heuristic
    let p2 = Path::new("/Music/Led Zeppelin - Physical Graffiti/01.mp3");
    assert_eq!(
        extract_artist_from_path(p2, None),
        Some("Led Zeppelin".to_string())
    );

    // Filename pattern "01 - Artist - Title"
    let p3 = Path::new("/Downloads/01 - Radiohead - Creep.flac");
    assert_eq!(
        extract_artist_from_path(p3, None),
        Some("Radiohead".to_string())
    );

    // Filename pattern "01. Artist - Title"
    let p4 = Path::new("/Downloads/01. Led Zeppelin - Kashmir.mp3");
    assert_eq!(
        extract_artist_from_path(p4, None),
        Some("Led Zeppelin".to_string())
    );

    // Generic folders ignored
    let p5 = Path::new("/Music/Downloads/audio/01.flac");
    assert_eq!(extract_artist_from_path(p5, None), None);

    // Multi-byte Unicode prefix safety (where byte index 5 is not a char boundary)
    let p_cyrillic = Path::new("/Music/Downloads/ЖЖЖ - Song.flac");
    assert_eq!(
        extract_artist_from_path(p_cyrillic, None),
        Some("ЖЖЖ".to_string())
    );

    // Track prefix with German uppercase sharp S and Cyrillic
    let p_german_cyrillic = Path::new("/Music/Downloads/Track 01 ЖWEIẞ - Song.flac");
    assert_eq!(
        extract_artist_from_path(p_german_cyrillic, None),
        Some("ЖWEIẞ".to_string())
    );

    // Case-insensitive variants
    let p_caps = Path::new("/Music/Downloads/TRACK 99 Some Artist - Song.flac");
    assert_eq!(
        extract_artist_from_path(p_caps, None),
        Some("Some Artist".to_string())
    );

    // System temp & OS boundary folders must never be treated as artist names
    let p_macos_tmp = Path::new("/var/folders/12/abcdef123456/T/wavery_corrupt_123/01_empty_song.mp3");
    assert_eq!(extract_artist_from_path(p_macos_tmp, None), None);

    let p_win_tmp = Path::new("/Users/runneradmin/AppData/Local/Temp/wavery_corrupt_123/01_empty_song.mp3");
    assert_eq!(extract_artist_from_path(p_win_tmp, None), None);
}


#[test]
fn test_clustering_group_tracks_by_album_and_artist() {
    use crate::clustering::{extract_library_genres, group_tracks_by_album, group_tracks_by_artist};
    use std::path::PathBuf;
    use wavery_core::models::{Track, TrackMetadata, TrackSource};

    let track1 = Track {
        id: "t1".into(),
        source: TrackSource::Managed(PathBuf::from("/Music/Daft Punk/Discovery/01 One More Time.flac")),
        metadata: TrackMetadata {
            title: Some("One More Time".into()),
            artist: Some("Daft Punk".into()),
            album: Some("Discovery".into()),
            album_artist: None,
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2001),
            genre: Some("Electronic / Dance".into()),
            duration: Duration::from_secs(320),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    let track2 = Track {
        id: "t2".into(),
        source: TrackSource::Managed(PathBuf::from("/Music/Daft Punk/Discovery/02 Aerodynamic.flac")),
        metadata: TrackMetadata {
            title: Some("Aerodynamic".into()),
            artist: Some("Daft Punk".into()),
            album: Some("Discovery".into()),
            album_artist: None,
            track_number: Some(2),
            disc_number: Some(1),
            year: Some(2001),
            genre: Some("Electronic".into()),
            duration: Duration::from_secs(210),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    let tracks = vec![track2.clone(), track1.clone()]; // out of order
    let albums = group_tracks_by_album(&tracks, &[]);
    assert_eq!(albums.len(), 1);
    let alb = &albums[0];
    assert_eq!(alb.title, "Discovery");
    assert_eq!(alb.artist, "Daft Punk");
    assert_eq!(alb.track_count, 2);
    assert_eq!(alb.total_duration_secs, 530);
    assert_eq!(alb.tracks[0].id, "t1"); // sorted by track_number
    assert_eq!(alb.tracks[1].id, "t2");

    let artists = group_tracks_by_artist(&tracks, &[]);
    assert_eq!(artists.len(), 1);
    let art = &artists[0];
    assert_eq!(art.name, "Daft Punk");
    assert_eq!(art.album_count, 1);
    assert_eq!(art.track_count, 2);

    let genres = extract_library_genres(&tracks, None);
    assert!(!genres.is_empty());
    assert_eq!(genres[0].name, "Electronic");
    assert_eq!(genres[0].track_count, 2);
}

#[test]
fn test_clustering_compilation_detection() {
    use crate::clustering::group_tracks_by_album;
    use std::path::PathBuf;
    use wavery_core::models::{Track, TrackMetadata, TrackSource};

    let tracks: Vec<Track> = (0..5)
        .map(|i| Track {
            id: format!("comp-{i}"),
            source: TrackSource::Managed(PathBuf::from(format!(
                "/Music/Soundtracks/Pulp Fiction/0{i} Song.flac"
            ))),
            metadata: TrackMetadata {
                title: Some(format!("Song {i}")),
                artist: Some(format!("Artist {i}")),
                album: Some("Pulp Fiction OST".into()),
                album_artist: None,
                track_number: Some(i as u32 + 1),
                disc_number: Some(1),
                year: Some(1994),
                genre: Some("Soundtrack".into()),
                duration: Duration::from_secs(180),
                ..Default::default()
            },
            date_added: 1700000000,
        })
        .collect();

    let albums = group_tracks_by_album(&tracks, &[]);
    assert_eq!(albums.len(), 1);
    let alb = &albums[0];
    assert_eq!(alb.title, "Pulp Fiction OST");
    assert!(alb.is_compilation);
    assert_eq!(alb.artist, "Various Artists");
    assert_eq!(alb.track_count, 5);
}

#[test]
fn test_manager_cached_collections() {
    use crate::manager::SqliteLibraryManager;
    use wavery_core::models::{ImportStrategy, TrackMetadata};
    use wavery_core::traits::LibraryManager;

    let temp_dir = std::env::temp_dir().join(format!("wavery_mgr_test_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&library_root).unwrap();

    let mut mgr = SqliteLibraryManager::new(library_root.clone(), db_path).unwrap();

    // Verify initial empty cache
    assert!(mgr.list_albums().unwrap().is_empty());
    assert!(mgr.list_artists().unwrap().is_empty());
    assert!(mgr.list_genres().unwrap().is_empty());

    // Import audio file
    let audio_path = library_root.join("01_test_track.flac");
    fs::write(&audio_path, b"dummy audio content").unwrap();

    let meta = TrackMetadata {
        title: Some("Instant Crush".into()),
        artist: Some("Daft Punk feat. Julian Casablancas".into()),
        album: Some("Random Access Memories".into()),
        year: Some(2013),
        genre: Some("Synth-Pop".into()),
        duration: Duration::from_secs(337),
        ..Default::default()
    };

    // Ingest track into manager
    let rt = tokio::runtime::Runtime::new().unwrap();
    let track = rt.block_on(mgr.import_track(&audio_path, ImportStrategy::Copy));
    // Even if Lofty fails on dummy audio, let's update track metadata to test caching
    if let Ok(mut t) = track {
        t.metadata = meta.clone();
        let _ = rt.block_on(mgr.update_track_metadata(&t.id, &meta, false));

        let albums = mgr.list_albums().unwrap();
        assert!(!albums.is_empty());

        let artists = mgr.list_artists().unwrap();
        assert!(!artists.is_empty());

        let genres = mgr.list_genres().unwrap();
        assert!(!genres.is_empty());
    }

    drop(mgr);
    let _ = fs::remove_dir_all(&temp_dir);
}

fn write_test_pcm16_wav(path: &Path, samples: &[i16], sample_rate: u32) {
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate: u32 = sample_rate * u32::from(num_channels) * u32::from(bits_per_sample / 8);
    let block_align: u16 = num_channels * (bits_per_sample / 8);
    let data_size: u32 = (samples.len() * 2) as u32;
    let riff_size: u32 = 36 + data_size;

    let mut bytes = Vec::with_capacity(44 + data_size as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&riff_size.to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes()); // PCM
    bytes.extend_from_slice(&num_channels.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&block_align.to_le_bytes());
    bytes.extend_from_slice(&bits_per_sample.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    for &sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    fs::write(path, bytes).unwrap();
}

#[test]
fn test_waveform_resampling_and_symphonia_decoding() {
    use crate::waveform::{compute_waveform_peaks, resample_peaks_to_100, WAVEFORM_POINT_COUNT};

    // 1. Empty & silent inputs produce 100 finite zeros without NaN
    let empty_res = resample_peaks_to_100(&[]);
    assert_eq!(empty_res.len(), WAVEFORM_POINT_COUNT);
    assert!(empty_res.iter().all(|&v| v == 0.0 && !v.is_nan()));

    let silent_res = resample_peaks_to_100(&vec![0.0; 500]);
    assert_eq!(silent_res.len(), WAVEFORM_POINT_COUNT);
    assert!(silent_res.iter().all(|&v| v == 0.0 && !v.is_nan()));

    // 2. Short input (< 100 samples) interpolates cleanly to 100 points in [0.0, 1.0]
    let short_res = resample_peaks_to_100(&[0.25, 0.5, 1.0]);
    assert_eq!(short_res.len(), WAVEFORM_POINT_COUNT);
    assert!((short_res[0] - 0.25).abs() < 1e-4);
    assert!((short_res[99] - 1.0).abs() < 1e-4);
    assert!(short_res.iter().all(|&v| (0.0..=1.0).contains(&v)));

    // 3. Real Symphonia decoding of a ramp WAV file, a silent WAV file, and a short WAV file
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_waveform_test_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();

    let ramp_wav = temp_dir.join("ramp.wav");
    let ramp_samples: Vec<i16> = (0..4000).map(|i| ((i * 8) as i16).min(32000)).collect();
    write_test_pcm16_wav(&ramp_wav, &ramp_samples, 44100);

    let wf = compute_waveform_peaks("track-ramp", &ramp_wav).unwrap();
    assert_eq!(wf.track_id, "track-ramp");
    assert_eq!(wf.version, 1);
    assert!(wf.is_valid_100_point_envelope());
    assert!(wf.points[99] > wf.points[0]);
    assert!((wf.points.iter().copied().fold(0.0_f32, f32::max) - 1.0).abs() < 1e-4);

    let silent_wav = temp_dir.join("silent.wav");
    write_test_pcm16_wav(&silent_wav, &vec![0_i16; 1024], 44100);
    let wf_silent = compute_waveform_peaks("track-silent", &silent_wav).unwrap();
    assert!(wf_silent.is_valid_100_point_envelope());
    assert!(wf_silent.points.iter().all(|&p| p == 0.0));

    let tiny_wav = temp_dir.join("tiny.wav");
    write_test_pcm16_wav(&tiny_wav, &[1000, 4000, 8000, 16000, 32000], 44100);
    let wf_tiny = compute_waveform_peaks("track-tiny", &tiny_wav).unwrap();
    assert!(wf_tiny.is_valid_100_point_envelope());

    let corrupt_wav = temp_dir.join("corrupt.wav");
    fs::write(&corrupt_wav, b"not an audio file").unwrap();
    assert!(compute_waveform_peaks("track-corrupt", &corrupt_wav).is_err());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_replaygain_r128_and_itunnorm_parsers() {
    use crate::reader::{parse_itunnorm, parse_r128_gain_db, parse_replaygain_db};

    assert!((parse_replaygain_db("-6.50 dB").unwrap() - (-6.50)).abs() < 1e-4);
    assert!((parse_replaygain_db("+2.25 db").unwrap() - 2.25).abs() < 1e-4);
    assert!((parse_replaygain_db("-4.0 LU").unwrap() - (-4.0)).abs() < 1e-4);
    assert!(parse_replaygain_db("").is_none());
    assert!(parse_replaygain_db("not_a_number dB").is_none());

    // EBU R128 Q7.8 fixed-point (-1536 / 256.0 = -6.0 dB, +5.0 dB offset = -1.0 dB)
    assert!((parse_r128_gain_db("-1536").unwrap() - (-1.0)).abs() < 1e-4);
    assert!((parse_r128_gain_db("0").unwrap() - 5.0).abs() < 1e-4);
    assert!((parse_r128_gain_db("-6.5 dB").unwrap() - (-1.5)).abs() < 1e-4);

    // Apple Sound Check (iTunNORM): 0x03E8 = 1000 (0 dB), 0x07D0 = 2000 (-3.0103 dB), 0x8000 = 32768 (1.0 peak)
    let itun = " 000003E8 000003E8 000007D0 000007D0 00008000 00008000 00004000 00004000 00000000 00000000";
    let (tg, tp, ag, ap) = parse_itunnorm(itun).unwrap();
    assert!(tg.abs() < 1e-4);
    assert!((tp - 1.0).abs() < 1e-4);
    assert!((ag - (-3.0103)).abs() < 1e-3);
    assert!((ap - 0.5).abs() < 1e-4);
}

#[tokio::test]
async fn test_waveform_persistence_cascade_and_replaygain_roundtrip() {
    use wavery_core::models::WaveformData;

    let temp_dir =
        std::env::temp_dir().join(format!("wavery_m2_db_test_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&library_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();
    let wav_path = library_root.join("test_song.wav");
    let samples: Vec<i16> = (0..2048).map(|i| ((i * 15) % 30000) as i16).collect();
    write_test_pcm16_wav(&wav_path, &samples, 44100);

    let track = Track {
        id: "m2-track-1".into(),
        source: TrackSource::Managed(wav_path.clone()),
        metadata: TrackMetadata {
            title: Some("Normalized Song".into()),
            artist: Some("Test Artist".into()),
            album: Some("Test Album".into()),
            duration: Duration::from_secs(10),
            format: "WAV".into(),
            replaygain_track_gain: Some(-6.5),
            replaygain_track_peak: Some(0.9885),
            replaygain_album_gain: Some(-5.2),
            replaygain_album_peak: Some(0.995),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    db.insert_or_update(&track, &library_root).unwrap();

    let fetched = db.get_track("m2-track-1", &library_root).unwrap().unwrap();
    assert_eq!(fetched.metadata.replaygain_track_gain, Some(-6.5));
    assert_eq!(fetched.metadata.replaygain_track_peak, Some(0.9885));
    assert_eq!(fetched.metadata.replaygain_album_gain, Some(-5.2));
    assert_eq!(fetched.metadata.replaygain_album_peak, Some(0.995));

    let points: Vec<f32> = (0..100).map(|i| (i as f32) / 99.0).collect();
    let wf = WaveformData::new("m2-track-1", 1, points.clone());
    db.save_waveform(&wf).unwrap();

    let loaded_wf = db.get_waveform("m2-track-1").unwrap().unwrap();
    assert_eq!(loaded_wf.track_id, "m2-track-1");
    assert_eq!(loaded_wf.version, 1);
    assert_eq!(loaded_wf.points.len(), 100);
    for (a, b) in loaded_wf.points.iter().zip(points.iter()) {
        assert!((a - b).abs() < 1e-6);
    }

    // Deleting track cascades to track_waveforms
    db.delete("m2-track-1").unwrap();
    assert!(db.get_waveform("m2-track-1").unwrap().is_none());

    // Re-insert track without waveform and verify SqliteLibraryManager computes and caches it on demand
    db.insert_or_update(&track, &library_root).unwrap();
    drop(db);

    let mgr = SqliteLibraryManager::new(library_root, db_path).unwrap();
    let auto_wf = LibraryManager::get_waveform(&mgr, "m2-track-1")
        .await
        .unwrap()
        .unwrap();
    assert!(auto_wf.is_valid_100_point_envelope());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_import_playlist_json_creates_ordered_playlist_and_reuses_it() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_playlist_json_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();
    let tracks = vec![
        Track {
            id: "playlist-track-1".into(),
            source: TrackSource::Managed(managed_root.join("First Song [aaaaaaaaaaa].opus")),
            metadata: TrackMetadata {
                title: Some("First Song".into()),
                artist: Some("Some Artist".into()),
                duration: Duration::from_secs(201),
                format: "OPUS".into(),
                ..Default::default()
            },
            date_added: 1_700_000_000,
        },
        Track {
            id: "playlist-track-2".into(),
            source: TrackSource::Managed(managed_root.join("Second Song [bbbbbbbbbbb].opus")),
            metadata: TrackMetadata {
                title: Some("Second Song".into()),
                artist: Some("Some Artist".into()),
                duration: Duration::from_secs(180),
                format: "OPUS".into(),
                ..Default::default()
            },
            date_added: 1_700_000_001,
        },
    ];
    db.insert_or_update_batch(&tracks, &managed_root).unwrap();
    drop(db);

    // The manager prunes database rows whose files are gone, so the synthetic
    // tracks need real (content-free) files on disk.
    fs::write(managed_root.join("First Song [aaaaaaaaaaa].opus"), b"stub").unwrap();
    fs::write(managed_root.join("Second Song [bbbbbbbbbbb].opus"), b"stub").unwrap();

    let manager = SqliteLibraryManager::new(managed_root, db_path).unwrap();
    let json_path = temp_dir.join("Road Trip.json");
    fs::write(
        &json_path,
        r#"{
            "_type": "playlist",
            "title": "Road Trip",
            "entries": [
                {"id": "bbbbbbbbbbb", "title": "Second Song", "duration": 180},
                {"id": "aaaaaaaaaaa", "title": "First Song", "duration": 201},
                {"id": "zzzzzzzzzzz", "title": "Not Downloaded", "duration": 90}
            ]
        }"#,
    )
    .unwrap();

    let summary = manager.import_playlist_json(&json_path).unwrap();
    assert_eq!(summary.playlist_name, "Road Trip");
    assert_eq!(summary.total_entries, 3);
    assert_eq!(summary.matched_tracks, 2);
    assert_eq!(summary.unmatched_entries, 1);
    assert_eq!(summary.already_in_playlist, 0);
    assert_eq!(summary.unmatched_titles, vec!["Not Downloaded".to_string()]);

    // Order follows the JSON, not the database or track id order.
    let playlist = manager.get_playlist(&summary.playlist_id).unwrap().unwrap();
    assert_eq!(
        playlist.track_ids,
        vec![
            "playlist-track-2".to_string(),
            "playlist-track-1".to_string()
        ]
    );

    // Re-importing the same file reuses the playlist and appends nothing.
    let second = manager.import_playlist_json(&json_path).unwrap();
    assert_eq!(second.playlist_id, summary.playlist_id);
    assert_eq!(second.matched_tracks, 2);
    assert_eq!(second.already_in_playlist, 2);
    assert_eq!(manager.list_playlists().unwrap().len(), 1);

    let playlist = manager.get_playlist(&second.playlist_id).unwrap().unwrap();
    assert_eq!(playlist.track_ids.len(), 2);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_import_playlist_m3u_creates_ordered_playlist_and_reuses_it() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_playlist_m3u_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();
    let tracks = vec![
        Track {
            id: "m3u-track-1".into(),
            source: TrackSource::Managed(managed_root.join("Alpha Track.opus")),
            metadata: TrackMetadata {
                title: Some("Alpha Track".into()),
                artist: Some("Artist Alpha".into()),
                duration: Duration::from_secs(210),
                format: "OPUS".into(),
                ..Default::default()
            },
            date_added: 1_700_000_000,
        },
        Track {
            id: "m3u-track-2".into(),
            source: TrackSource::Managed(managed_root.join("Beta Track.webm")),
            metadata: TrackMetadata {
                title: Some("Beta Track".into()),
                artist: Some("Artist Beta".into()),
                duration: Duration::from_secs(180),
                format: "WEBM".into(),
                ..Default::default()
            },
            date_added: 1_700_000_001,
        },
    ];
    db.insert_or_update_batch(&tracks, &managed_root).unwrap();
    drop(db);

    fs::write(managed_root.join("Alpha Track.opus"), b"stub").unwrap();
    fs::write(managed_root.join("Beta Track.webm"), b"stub").unwrap();

    let manager = SqliteLibraryManager::new(managed_root.clone(), db_path).unwrap();

    // M3U file located in managed_root so relative paths resolve cleanly
    let m3u_path = managed_root.join("Summer Jams.m3u");
    fs::write(
        &m3u_path,
        "#EXTM3U\n\
         #PLAYLIST:Summer Jams\n\
         #EXTINF:180,Artist Beta - Beta Track\n\
         Beta Track.webm\n\
         #EXTINF:210,Artist Alpha - Alpha Track\n\
         Alpha Track.opus\n\
         #EXTINF:99,Ghost Artist - Missing Track\n\
         Nonexistent.mp3\n",
    )
    .unwrap();

    // Test import_playlist_file auto-routing
    let summary = manager.import_playlist_file(&m3u_path).unwrap();
    assert_eq!(summary.playlist_name, "Summer Jams");
    assert_eq!(summary.total_entries, 3);
    assert_eq!(summary.matched_tracks, 2);
    assert_eq!(summary.unmatched_entries, 1);
    assert_eq!(summary.already_in_playlist, 0);
    assert_eq!(
        summary.unmatched_titles,
        vec!["Ghost Artist - Missing Track".to_string()]
    );

    // Verify ordering
    let playlist = manager.get_playlist(&summary.playlist_id).unwrap().unwrap();
    assert_eq!(
        playlist.track_ids,
        vec!["m3u-track-2".to_string(), "m3u-track-1".to_string()]
    );

    // Re-import reuses playlist without duplicates
    let second = manager.import_playlist_file(&m3u_path).unwrap();
    assert_eq!(second.playlist_id, summary.playlist_id);
    assert_eq!(second.matched_tracks, 2);
    assert_eq!(second.already_in_playlist, 2);
    assert_eq!(manager.list_playlists().unwrap().len(), 1);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_database_stats_health_backup_and_prune() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_db_center_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    let cache_dir = temp_dir.join("artwork");
    fs::create_dir_all(&managed_root).unwrap();
    fs::create_dir_all(&cache_dir).unwrap();

    let db = LibraryDatabase::open(&db_path).unwrap();
    let tracks = vec![
        Track {
            id: "stats-track-1".into(),
            source: TrackSource::Managed(managed_root.join("Artist A/Album X/01 One.flac")),
            metadata: TrackMetadata {
                title: Some("One".into()),
                artist: Some("Artist A".into()),
                album: Some("Album X".into()),
                duration: Duration::from_secs(120),
                format: "FLAC".into(),
                ..Default::default()
            },
            date_added: 1_700_000_000,
        },
        Track {
            id: "stats-track-2".into(),
            source: TrackSource::Managed(managed_root.join("Artist A/Album X/02 Two.flac")),
            metadata: TrackMetadata {
                title: Some("Two".into()),
                artist: Some("Artist A".into()),
                album: Some("Album X".into()),
                duration: Duration::from_secs(130),
                format: "FLAC".into(),
                ..Default::default()
            },
            date_added: 1_700_000_001,
        },
        Track {
            id: "stats-track-3".into(),
            source: TrackSource::Managed(managed_root.join("Artist B/Album Y/01 Gone.flac")),
            metadata: TrackMetadata {
                title: Some("Gone".into()),
                artist: Some("Artist B".into()),
                album: Some("Album Y".into()),
                duration: Duration::from_secs(140),
                format: "FLAC".into(),
                ..Default::default()
            },
            date_added: 1_700_000_002,
        },
    ];
    db.insert_or_update_batch(&tracks, &managed_root).unwrap();
    fs::create_dir_all(managed_root.join("Artist A/Album X")).unwrap();
    fs::write(managed_root.join("Artist A/Album X/01 One.flac"), b"stub").unwrap();
    fs::write(managed_root.join("Artist A/Album X/02 Two.flac"), b"stub").unwrap();
    fs::write(cache_dir.join("cover.jpg"), b"cover").unwrap();

    db.create_playlist("Road Trip").unwrap();
    db.like_track("stats-track-1").unwrap();
    let waveform = WaveformData::new(
        "stats-track-1",
        1,
        (0..100).map(|i| i as f32 / 99.0).collect(),
    );
    db.save_waveform(&waveform).unwrap();

    let stats = db.stats(&managed_root, &cache_dir).unwrap();
    assert_eq!(stats.track_count, 3);
    assert_eq!(stats.album_count, 2);
    assert_eq!(stats.artist_count, 2);
    assert_eq!(stats.playlist_count, 1);
    assert_eq!(stats.liked_count, 1);
    assert_eq!(stats.waveform_count, 1);
    assert_eq!(stats.missing_file_count, 1);
    assert!(stats.database_bytes > 0);
    assert!(stats.library_bytes > 0);
    assert!(stats.artwork_cache_bytes > 0);
    assert_eq!(stats.journal_mode.to_lowercase(), "wal");

    let health = db.health(&managed_root).unwrap();
    assert!(!health.is_healthy);
    assert_eq!(health.quick_check, "ok");
    assert_eq!(health.foreign_key_violations, 0);
    assert_eq!(health.fts_indexed_tracks, 3);
    assert_eq!(health.fts_missing_tracks, 0);
    assert_eq!(health.missing_file_count, 1);
    assert!(health.issues.iter().any(|issue| issue.contains("no longer exist")));

    let backup_path = temp_dir.join("backups").join("library-copy.db");
    let backup = db.backup_to(&backup_path).unwrap();
    assert_eq!(backup.path, backup_path.display().to_string());
    assert!(backup.bytes > 0);
    assert!(backup_path.is_file());
    let backup_conn = rusqlite::Connection::open(&backup_path).unwrap();
    let backed_up_tracks: i64 = backup_conn
        .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
        .unwrap();
    let backed_up_playlists: i64 = backup_conn
        .query_row("SELECT COUNT(*) FROM playlists", [], |row| row.get(0))
        .unwrap();
    assert_eq!(backed_up_tracks, 3);
    assert_eq!(backed_up_playlists, 1);

    // Backing up over the live database must be rejected.
    assert!(db.backup_to(&db_path).is_err());

    let removed = db.prune_missing_files(&managed_root).unwrap();
    assert_eq!(removed, 1);
    let pruned_stats = db.stats(&managed_root, &cache_dir).unwrap();
    assert_eq!(pruned_stats.track_count, 2);
    assert_eq!(pruned_stats.missing_file_count, 0);
    let healthy = db.health(&managed_root).unwrap();
    assert!(healthy.is_healthy);
    assert_eq!(healthy.fts_indexed_tracks, 2);
    assert!(healthy.issues.is_empty());

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_import_folders_as_playlists_per_folder_reuse_and_combine() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_folder_pl_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    let rock_dir = temp_dir.join("Rock");
    let jazz_dir = temp_dir.join("Jazz");
    let empty_dir = temp_dir.join("Empty");

    fs::create_dir_all(&library_root).unwrap();
    fs::create_dir_all(&rock_dir).unwrap();
    fs::create_dir_all(&jazz_dir).unwrap();
    fs::create_dir_all(&empty_dir).unwrap();

    fs::write(rock_dir.join("01_anthem.mp3"), b"ID3\x03\x00\x00\x00\x00\x00\x00rock1").unwrap();
    fs::write(rock_dir.join("02_encore.mp3"), b"ID3\x03\x00\x00\x00\x00\x00\x00rock2").unwrap();
    fs::write(jazz_dir.join("blue_note.flac"), b"fLaC\x00\x00\x00\x00jazz1").unwrap();

    let mut manager = SqliteLibraryManager::new(library_root, db_path).unwrap();

    // 1. Per-folder mode with an empty folder included
    let result = manager
        .import_folders_as_playlists(
            &[rock_dir.clone(), jazz_dir.clone(), empty_dir.clone()],
            ImportStrategy::Copy,
            None,
        )
        .await
        .unwrap();

    assert_eq!(result.playlists.len(), 2);
    assert_eq!(result.total_tracks_imported, 3);
    assert_eq!(result.skipped_folders.len(), 1);
    assert_eq!(result.playlists[0].playlist_name, "Rock");
    assert_eq!(result.playlists[0].matched_tracks, 2);
    assert_eq!(result.playlists[1].playlist_name, "Jazz");
    assert_eq!(result.playlists[1].matched_tracks, 1);

    let playlists = manager.list_playlists().unwrap();
    assert_eq!(playlists.len(), 2);

    // 2. Re-import Rock after adding a 3rd track -> reuses "Rock" without duplicating first 2
    fs::write(rock_dir.join("03_bonus.mp3"), b"ID3\x03\x00\x00\x00\x00\x00\x00rock3").unwrap();
    let reimport = manager
        .import_folders_as_playlists(std::slice::from_ref(&rock_dir), ImportStrategy::Copy, None)
        .await
        .unwrap();

    assert_eq!(reimport.playlists.len(), 1);
    assert_eq!(reimport.playlists[0].playlist_name, "Rock");
    assert_eq!(reimport.playlists[0].already_in_playlist, 2);

    let rock_pl = manager
        .get_playlist(&reimport.playlists[0].playlist_id)
        .unwrap()
        .unwrap();
    assert_eq!(rock_pl.track_ids.len(), 3);

    // 3. Combine multiple folders into one custom-named playlist
    let combined = manager
        .import_folders_as_playlists(
            &[rock_dir, jazz_dir],
            ImportStrategy::Copy,
            Some("Road Trip"),
        )
        .await
        .unwrap();

    assert_eq!(combined.playlists.len(), 1);
    assert_eq!(combined.playlists[0].playlist_name, "Road Trip");
    assert_eq!(combined.playlists[0].matched_tracks, 4);

    let road_trip = manager
        .get_playlist(&combined.playlists[0].playlist_id)
        .unwrap()
        .unwrap();
    assert_eq!(road_trip.track_ids.len(), 4);

    let _ = fs::remove_dir_all(&temp_dir);
}

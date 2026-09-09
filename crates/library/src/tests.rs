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
use wavery_core::models::{ImportStrategy, ScanProgress, Track, TrackMetadata, TrackSource};
use wavery_core::traits::{LibraryManager, MetadataReader};

#[test]
fn test_sqlite_pragmas_and_schema() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_pragma_test_{}", uuid::Uuid::new_v4()));
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
            source: TrackSource::Managed(managed_root.join(format!("artist/album/{i:02} - Song {i}.flac"))),
            metadata: TrackMetadata {
                title: Some(format!("Synth Song {i}")),
                artist: Some(if i <= 5 { "Kavinsky".into() } else { "Gunship".into() }),
                album: Some(if i <= 5 { "Nightcall".into() } else { "Dark All Day".into() }),
                album_artist: Some(if i <= 5 { "Kavinsky".into() } else { "Gunship".into() }),
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
    let temp_dir = std::env::temp_dir().join(format!("wavery_fts_unicode_{}", uuid::Uuid::new_v4()));
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
    let res_injection = db.search_fts("'; DROP TABLE tracks; --", &managed_root).unwrap();
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
            },
            date_added: 1700000000 + i as u64,
        });
    }
    db.insert_or_update_batch(&initial_tracks, &managed_root).unwrap();

    let writer_done = Arc::new(AtomicBool::new(false));

    // Spawn concurrent reader threads using SEPARATE independent SQLite connections
    let mut reader_handles = Vec::new();
    for _ in 0..4 {
        let p = db_path.clone();
        let is_done = Arc::clone(&writer_done);
        reader_handles.push(thread::spawn(move || {
            let reader_conn = rusqlite::Connection::open(&p).unwrap();
            reader_conn.busy_timeout(Duration::from_millis(5000)).unwrap();
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
                    },
                    date_added: 1700000000 + i as u64,
                });
            }
            db_writer.insert_or_update_batch(&batch, &root_writer).unwrap();
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
    let temp_dir = std::env::temp_dir().join(format!("wavery_tx_rollback_{}", uuid::Uuid::new_v4()));
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
        },
        date_added: 1700000000,
    };
    db.insert_or_update(&track1, &managed_root).unwrap();
    assert_eq!(db.load_all(&managed_root).unwrap().len(), 1);

    // 2. Create playlist with track1
    let playlist = db.create_playlist("My Playlist").unwrap();
    db.add_tracks_to_playlist(&playlist.id, &["valid-1".into()]).unwrap();
    let initial_pl = db.get_playlist(&playlist.id).unwrap().unwrap();
    assert_eq!(initial_pl.track_ids, vec!["valid-1".to_string()]);

    // 3. Attempt to save playlist with a non-existent track ID (violates foreign key constraint)
    let mut invalid_pl = initial_pl.clone();
    invalid_pl.name = "Corrupted Attempt".into();
    invalid_pl.track_ids = vec!["valid-1".into(), "non_existent_ghost_track_id".into()];

    let save_res = db.save_playlist(&invalid_pl);
    assert!(save_res.is_err(), "Foreign key violation must produce error");

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
        manager.import_track(&fpath, ImportStrategy::Copy).await.unwrap();
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
    fs::write(&new_track_path2, b"ID3\x03\x00\x00\x00\x00\x00\x00newcontentB").unwrap();

    // 3. Trigger rebuild_library
    let rebuilt_tracks = manager.rebuild_library().await.unwrap();

    // 4. Expected count: 3 remaining original + 2 new = 5 tracks
    assert_eq!(rebuilt_tracks.len(), 5);
    assert_eq!(manager.all_tracks().len(), 5);

    // Verify deleted file is no longer in library
    assert!(!manager.all_tracks().iter().any(|t| t.id == original_tracks[0].id));

    // Verify new files are present and indexed
    assert!(manager.all_tracks().iter().any(|t| t.source.path().file_name().unwrap() == "new_song_A.flac"));
    assert!(manager.all_tracks().iter().any(|t| t.source.path().file_name().unwrap() == "new_song_B.mp3"));

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
    fs::write(&garbage_mp3, [0xFF, 0xFE, 0x00, 0x12, 0x99, 0x88, 0x77, 0x66]).unwrap();
    let meta_garbage = reader.read_metadata(&garbage_mp3).unwrap();
    assert_eq!(meta_garbage.title.as_deref(), Some("garbage"));
    assert_eq!(meta_garbage.format, "MP3");
    assert!(reader.read_artwork(&garbage_mp3).unwrap().is_none());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_scanner_filters_non_audio_files() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_filter_test_{}", uuid::Uuid::new_v4()));
    let incoming_dir = temp_dir.join("mixed_files");
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&incoming_dir).unwrap();
    fs::create_dir_all(&library_root).unwrap();

    // Create mixed files: 3 audio files, 5 non-audio files
    fs::write(incoming_dir.join("track1.mp3"), b"ID3\x03\x00\x00\x00\x00\x00\x00data").unwrap();
    fs::write(incoming_dir.join("track2.flac"), b"fLaC\x00\x00\x00\x00data").unwrap();
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
    let temp_dir = std::env::temp_dir().join(format!("wavery_multi_artist_{}", uuid::Uuid::new_v4()));
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
    let disc_tracks = db.get_album_tracks("Discovery", Some("Daft Punk"), &managed_root).unwrap();
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

    let has_discovered = events.iter().any(|e| matches!(e, ScanProgress::DiscoveredFiles(15)));
    let has_completed = events.iter().any(|e| matches!(e, ScanProgress::Completed(_)));
    assert!(has_discovered);
    assert!(has_completed);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_playlist_operations() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_playlist_test_{}", uuid::Uuid::new_v4()));
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
            },
            date_added: 1700000001,
        },
    ];
    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    // Create playlist
    let playlist = db.create_playlist("Chill Synth").unwrap();
    assert_eq!(playlist.name, "Chill Synth");

    // Add tracks
    db.add_tracks_to_playlist(&playlist.id, &["track-1".into(), "track-2".into()]).unwrap();

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
    db.remove_track_from_playlist(&playlist.id, "track-1").unwrap();
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
    assert_eq!(db.get_liked_track_ids().unwrap(), vec!["track-1".to_string()]);
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
    assert_eq!(db.get_liked_track_ids().unwrap(), vec!["track-2".to_string()]);

    // 5. Unlike track-2
    db.unlike_track("track-2").unwrap();
    assert!(!db.is_track_liked("track-2").unwrap());
    assert_eq!(db.get_liked_track_ids().unwrap().len(), 0);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_import_track_copy_and_move_strategies() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_strategy_test_{}", uuid::Uuid::new_v4()));
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
    let temp_dir = std::env::temp_dir().join(format!("wavery_legacy_uuid_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&library_root).unwrap();

    // Create a target artist/album dir inside library
    let album_dir = library_root.join("Muse").join("Will Of The People");
    fs::create_dir_all(&album_dir).unwrap();

    // Canonical file
    let canonical = album_dir.join("song.mp3");
    fs::write(&canonical, b"ID3\x03\x00\x00\x00\x00\x00\x00canonicalcontent").unwrap();

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
    assert!(!dup1.exists(), "Legacy duplicate 1 must be deleted from disk");
    assert!(!dup2.exists(), "Legacy duplicate 2 must be deleted from disk");

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
            },
            date_added: 1700000005,
        },
    ];

    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    let search_results = db.search_fts("Hyperdrive", &managed_root).unwrap();
    assert_eq!(search_results.len(), 5);

    let result_ids: Vec<String> = search_results.iter().map(|t| t.id.clone()).collect();
    println!("BM25 Weighted Search Result Order for 'Hyperdrive': {:?}", result_ids);

    // Exact expected BM25 order:
    // 1. Title (weight 10.0) -> t_title
    // 2. Artist (weight 5.0) -> t_artist
    // 3. Album (weight 3.0) -> t_album
    // 4. Album Artist (weight 2.0) -> t_album_artist
    // 5. Genre (weight 1.0) -> t_genre
    assert_eq!(result_ids[0], "t_title", "Title match must rank highest (weight 10.0)");
    assert_eq!(result_ids[1], "t_artist", "Artist match must rank second (weight 5.0)");
    assert_eq!(result_ids[2], "t_album", "Album match must rank third (weight 3.0)");
    assert_eq!(result_ids[3], "t_album_artist", "Album Artist match must rank fourth (weight 2.0)");
    assert_eq!(result_ids[4], "t_genre", "Genre match must rank fifth (weight 1.0)");

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
    };
    let write_res = reader.write_metadata(&audio_file, &neg_year_meta);
    assert!(write_res.is_ok(), "Writing metadata with negative year must succeed without panic: {:?}", write_res.err());
    let read_back_neg = reader.read_metadata(&audio_file).unwrap();
    assert!(read_back_neg.year.is_none(), "Negative year must not be stored in tag");

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
    };
    let write_zero_res = reader.write_metadata(&audio_file, &zero_year_meta);
    assert!(write_zero_res.is_ok(), "Writing metadata with zero year must succeed without panic");
    let read_back_zero = reader.read_metadata(&audio_file).unwrap();
    assert!(read_back_zero.year.is_none(), "Zero year must not be stored in tag");

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
    };
    let write_valid_res = reader.write_metadata(&audio_file, &valid_year_meta);
    assert!(write_valid_res.is_ok(), "Writing metadata with valid year must succeed");
    let read_back_valid = reader.read_metadata(&audio_file).unwrap();
    assert_eq!(read_back_valid.year, Some(2024), "Valid positive year must be stored and read back");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_parallel_ingestion_corrupted_zero_byte_concurrent_wal_reads() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_corrupt_wal_{}", uuid::Uuid::new_v4()));
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
        fs::write(&garbage_path, [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11]).unwrap();
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
                let res1: Result<i64, _> = conn.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0));
                let res2: Result<i64, _> = conn.query_row("SELECT COUNT(*) FROM tracks_fts WHERE tracks_fts MATCH '\"empty\"*'", [], |r| r.get(0));

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
    assert_eq!(read_err.load(Ordering::SeqCst), 0, "Zero read errors permitted during parallel ingestion");
    assert!(read_count.load(Ordering::SeqCst) > 0, "Concurrent reads must execute during scan");

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
        assert!(meta.lyrics.is_some(), "Embedded lyrics must be parsed from FLAC tag");
        let lyrics = meta.lyrics.unwrap();
        assert!(lyrics.contains("See You Again"), "Lyrics must contain song title");
        assert!(lyrics.contains("[00:00.19]"), "Lyrics must contain LRC timestamps");
    }

    // 2. Verify reading from sidecar .lrc file
    let temp_dir = std::env::temp_dir().join(format!("wavery_lrc_test_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let song_file = temp_dir.join("test_song.mp3");
    let lrc_file = temp_dir.join("test_song.lrc");

    // Write a dummy file (unreadable by probe fallback) and a sidecar .lrc
    fs::write(&song_file, b"DUMMY_AUDIO_DATA").unwrap();
    fs::write(&lrc_file, "[00:01.00]Sidecar lyric line 1\n[00:05.00]Sidecar lyric line 2").unwrap();

    let meta = reader.read_metadata(&song_file).unwrap();
    assert!(meta.lyrics.is_some(), "Sidecar .lrc must be read when present");
    let sidecar_lyrics = meta.lyrics.unwrap();
    assert!(sidecar_lyrics.contains("Sidecar lyric line 1"));
    assert!(sidecar_lyrics.contains("[00:05.00]"));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_lyrics_database_persistence_and_queries() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_db_lyrics_test_{}", uuid::Uuid::new_v4()));
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
        },
        date_added: 1700000000,
    };

    // 1. Insert track
    db.insert_or_update(&track, &managed_root).unwrap();

    // 2. Fetch by ID
    let fetched = db.get_track("track-with-lyrics-1", &managed_root).unwrap().unwrap();
    assert_eq!(fetched.metadata.lyrics.as_deref(), Some(sample_lrc));

    // 3. Load all
    let all = db.load_all(&managed_root).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].metadata.lyrics.as_deref(), Some(sample_lrc));

    // 4. Get album tracks
    let album_tracks = db.get_album_tracks("Lyric Album", Some("Lyric Artist"), &managed_root).unwrap();
    assert_eq!(album_tracks.len(), 1);
    assert_eq!(album_tracks[0].metadata.lyrics.as_deref(), Some(sample_lrc));

    // 5. Update track metadata with new lyrics
    let mut updated_meta = fetched.metadata.clone();
    let updated_lrc = "[00:15.00]Updated lyric line";
    updated_meta.lyrics = Some(updated_lrc.into());
    db.update_track_metadata("track-with-lyrics-1", &updated_meta).unwrap();

    let refetched = db.get_track("track-with-lyrics-1", &managed_root).unwrap().unwrap();
    assert_eq!(refetched.metadata.lyrics.as_deref(), Some(updated_lrc));

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_database_schema_migration_for_lyrics() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_db_migration_test_{}", uuid::Uuid::new_v4()));
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
    let track = db.get_track("legacy-track-1", &managed_root).unwrap().unwrap();
    assert_eq!(track.metadata.title.as_deref(), Some("Legacy Song"));
    assert_eq!(track.metadata.lyrics, None);

    // Verify updating metadata to add lyrics works on migrated database
    let mut meta = track.metadata.clone();
    meta.lyrics = Some("[00:01.00]Migrated lyrics".into());
    db.update_track_metadata("legacy-track-1", &meta).unwrap();

    let updated = db.get_track("legacy-track-1", &managed_root).unwrap().unwrap();
    assert_eq!(updated.metadata.lyrics.as_deref(), Some("[00:01.00]Migrated lyrics"));

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

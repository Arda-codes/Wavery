//! Integration tests for Milestone 2: FTS5 BM25 Ranking, Year Defensive Validation, and Scanner Hardening.

use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use wavery_core::models::{ImportStrategy, Track, TrackMetadata, TrackSource};
use wavery_core::traits::{LibraryManager, MetadataReader};
use wavery_library::db::LibraryDatabase;
use wavery_library::manager::SqliteLibraryManager;
use wavery_library::reader::LoftyMetadataReader;

fn setup_test_env(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let temp_dir = std::env::temp_dir().join(format!("wavery_m2_test_{name}_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();
    (temp_dir, db_path, managed_root)
}

fn create_valid_wav(path: &std::path::Path) {
    let mut data = Vec::new();
    data.extend_from_slice(b"RIFF");
    data.extend_from_slice(&(52u32).to_le_bytes());
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

#[test]
fn test_bm25_exact_column_weight_hierarchy() {
    let (temp_dir, db_path, managed_root) = setup_test_env("bm25_hierarchy");
    let db = LibraryDatabase::open(&db_path).expect("Failed to open DB");

    // Term: "Overdrive"
    // Field 1: Title (Weight 10.0) -> Track A
    // Field 2: Artist (Weight 5.0) -> Track B
    // Field 3: Album (Weight 3.0) -> Track C
    // Field 4: Album Artist (Weight 2.0) -> Track D
    // Field 5: Genre (Weight 1.0) -> Track E
    let tracks = vec![
        Track {
            id: "track_e_genre".into(),
            source: TrackSource::Managed(managed_root.join("e.flac")),
            metadata: TrackMetadata {
                title: Some("Song One".into()),
                artist: Some("Band Alpha".into()),
                album: Some("Record One".into()),
                album_artist: Some("Band Alpha".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2023),
                genre: Some("Overdrive".into()),
                duration: Duration::from_secs(180),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
            },
            date_added: 1700000001,
        },
        Track {
            id: "track_d_album_artist".into(),
            source: TrackSource::Managed(managed_root.join("d.flac")),
            metadata: TrackMetadata {
                title: Some("Song Two".into()),
                artist: Some("Band Beta".into()),
                album: Some("Record Two".into()),
                album_artist: Some("Overdrive Orchestra".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2023),
                genre: Some("Rock".into()),
                duration: Duration::from_secs(190),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
            },
            date_added: 1700000002,
        },
        Track {
            id: "track_c_album".into(),
            source: TrackSource::Managed(managed_root.join("c.flac")),
            metadata: TrackMetadata {
                title: Some("Song Three".into()),
                artist: Some("Band Gamma".into()),
                album: Some("Overdrive Unleashed".into()),
                album_artist: Some("Band Gamma".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2023),
                genre: Some("Metal".into()),
                duration: Duration::from_secs(200),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
            },
            date_added: 1700000003,
        },
        Track {
            id: "track_b_artist".into(),
            source: TrackSource::Managed(managed_root.join("b.flac")),
            metadata: TrackMetadata {
                title: Some("Song Four".into()),
                artist: Some("Overdrive Project".into()),
                album: Some("Record Four".into()),
                album_artist: Some("Overdrive Project".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2023),
                genre: Some("Electronic".into()),
                duration: Duration::from_secs(210),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
            },
            date_added: 1700000004,
        },
        Track {
            id: "track_a_title".into(),
            source: TrackSource::Managed(managed_root.join("a.flac")),
            metadata: TrackMetadata {
                title: Some("Overdrive Anthem".into()),
                artist: Some("Band Epsilon".into()),
                album: Some("Record Five".into()),
                album_artist: Some("Band Epsilon".into()),
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2023),
                genre: Some("Chiptune".into()),
                duration: Duration::from_secs(220),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
            },
            date_added: 1700000005,
        },
    ];

    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    let results = db.search_fts("Overdrive", &managed_root).unwrap();
    assert_eq!(results.len(), 5);

    let ranked_ids: Vec<&str> = results.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(
        ranked_ids,
        vec![
            "track_a_title",
            "track_b_artist",
            "track_c_album",
            "track_d_album_artist",
            "track_e_genre"
        ]
    );

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_year_defensive_bounds_and_tag_manipulation() {
    let (temp_dir, _db_path, _managed_root) = setup_test_env("year_bounds");
    let reader = LoftyMetadataReader::new();

    let sample_wav = temp_dir.join("sample.wav");
    create_valid_wav(&sample_wav);

    // Test negative, zero, positive, and boundary years
    let test_years = [
        Some(-2024),
        Some(-1),
        Some(0),
        Some(1984),
        Some(2024),
        Some(2026),
        None,
    ];

    for &year in &test_years {
        let meta = TrackMetadata {
            title: Some("Test Year Song".into()),
            artist: Some("Year Artist".into()),
            album: Some("Year Album".into()),
            album_artist: None,
            track_number: Some(1),
            disc_number: Some(1),
            year,
            genre: Some("Synth".into()),
            duration: Duration::from_secs(120),
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "WAV".into(),
        };

        let res = reader.write_metadata(&sample_wav, &meta);
        assert!(res.is_ok(), "Writing metadata with year {year:?} must succeed");

        let read_back = reader.read_metadata(&sample_wav).unwrap();
        if let Some(y) = year {
            if y > 0 {
                assert_eq!(read_back.year, Some(y), "Positive year must be read back");
            } else {
                assert!(read_back.year.is_none(), "Zero/Negative year must not be stored");
            }
        }
    }

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_heavy_corrupted_media_parallel_ingestion_under_wal_concurrency() {
    let (temp_dir, db_path, library_root) = setup_test_env("heavy_corrupted_wal");
    let incoming_dir = temp_dir.join("incoming");
    fs::create_dir_all(&incoming_dir).unwrap();

    // Create 60 files:
    // - 20 valid dummy MP3 files with ID3 headers
    // - 20 zero-byte files with various audio extensions
    // - 10 truncated header files
    // - 10 random binary garbage files
    for i in 1..=20 {
        let p = incoming_dir.join(format!("valid_song_{i:02}.mp3"));
        let mut f = File::create(&p).unwrap();
        f.write_all(b"ID3\x04\x00\x00\x00\x00\x00\x20TIT2\x00\x00\x00\x09\x00\x00\x03Song ValidTPE1\x00\x00\x00\x0b\x00\x00\x03Artist Valid").unwrap();
    }
    for i in 1..=20 {
        let ext = match i % 4 {
            0 => "mp3",
            1 => "flac",
            2 => "ogg",
            _ => "wav",
        };
        let p = incoming_dir.join(format!("zero_byte_song_{i:02}.{ext}"));
        fs::write(&p, b"").unwrap();
    }
    for i in 1..=10 {
        let p = incoming_dir.join(format!("truncated_song_{i:02}.flac"));
        fs::write(&p, b"fLaC\x00").unwrap();
    }
    for i in 1..=10 {
        let p = incoming_dir.join(format!("garbage_song_{i:02}.m4a"));
        fs::write(&p, [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]).unwrap();
    }

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone()).unwrap();

    let running = Arc::new(AtomicBool::new(true));
    let read_queries = Arc::new(AtomicUsize::new(0));
    let read_errors = Arc::new(AtomicUsize::new(0));

    // Spawn 6 OS threads querying continuously via independent connections under WAL mode
    let mut reader_handles = Vec::new();
    for _ in 0..6 {
        let p = db_path.clone();
        let running_c = Arc::clone(&running);
        let q_cnt = Arc::clone(&read_queries);
        let err_cnt = Arc::clone(&read_errors);

        reader_handles.push(std::thread::spawn(move || {
            let conn = match rusqlite::Connection::open(&p) {
                Ok(c) => c,
                Err(_) => {
                    err_cnt.fetch_add(1, Ordering::Relaxed);
                    return;
                }
            };
            let _ = conn.busy_timeout(Duration::from_millis(5000));

            while running_c.load(Ordering::Relaxed) {
                let r1: Result<i64, _> = conn.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0));
                let r2: Result<i64, _> = conn.query_row("SELECT COUNT(*) FROM tracks_fts WHERE tracks_fts MATCH '\"Song\"*'", [], |r| r.get(0));

                if r1.is_err() || r2.is_err() {
                    err_cnt.fetch_add(1, Ordering::Relaxed);
                } else {
                    q_cnt.fetch_add(2, Ordering::Relaxed);
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }));
    }

    let imported = manager
        .import_directory(&incoming_dir, ImportStrategy::Copy)
        .await
        .unwrap();

    running.store(false, Ordering::Relaxed);
    for h in reader_handles {
        h.join().unwrap();
    }

    assert_eq!(imported.len(), 60, "All 60 files must be imported without failure");
    assert_eq!(manager.all_tracks().len(), 60);
    assert_eq!(read_errors.load(Ordering::SeqCst), 0, "Zero read errors permitted during WAL concurrency");
    assert!(read_queries.load(Ordering::SeqCst) > 0);

    let _ = fs::remove_dir_all(&temp_dir);
}

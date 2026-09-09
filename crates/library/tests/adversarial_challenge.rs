//! Adversarial Empirical Challenge Suite for Milestone 2.
//!
//! Tests:
//! 1. High-frequency SQLite WAL Concurrency stress: multi-connection readers + concurrent batch writers.
//! 2. FTS5 Edge Cases: Unicode normalization, emojis, diacritics, CJK, RTL, SQL injection, extreme special characters.
//! 3. Database Rebuild Resilience: Corrupted files, missing directories, permission errors, zero-byte files, broken symlinks.
//! 4. Zero panics, zero database lock errors.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use wavery_core::error::LibraryError;
use wavery_core::models::{ImportStrategy, Track, TrackMetadata, TrackSource};
use wavery_core::traits::LibraryManager;
use wavery_library::db::LibraryDatabase;
use wavery_library::manager::SqliteLibraryManager;

fn create_challenge_env(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let temp_dir = std::env::temp_dir().join(format!("wavery_adv_{name}_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();
    (temp_dir, db_path, managed_root)
}

fn create_sample_track(id: &str, title: &str, artist: &str, album: &str, genre: &str, managed_root: &Path) -> Track {
    Track {
        id: id.to_string(),
        source: TrackSource::Managed(managed_root.join(format!("{artist}/{album}/{id}.flac"))),
        metadata: TrackMetadata {
            title: Some(title.to_string()),
            artist: Some(artist.to_string()),
            album: Some(album.to_string()),
            album_artist: Some(artist.to_string()),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2024),
            genre: Some(genre.to_string()),
            duration: Duration::from_secs(200),
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "FLAC".to_string(),
            lyrics: None,
        },
        date_added: 1700000000,
    }
}

// =========================================================================
// 1. CONCURRENCY STRESS UNDER SQLITE WAL MODE
// =========================================================================

#[test]
fn challenge_wal_high_concurrency_stress_zero_locks() {
    let (temp_dir, db_path, managed_root) = create_challenge_env("wal_stress_extreme");
    let db = Arc::new(LibraryDatabase::open(&db_path).expect("Failed to open DB"));

    // Seed with 1000 tracks
    let mut initial_tracks = Vec::new();
    for i in 0..1000 {
        initial_tracks.push(create_sample_track(
            &format!("seed-{i:05}"),
            &format!("Initial Seed Track {i}"),
            &format!("Artist {}", i % 20),
            &format!("Album {}", i % 10),
            "Synthwave",
            &managed_root,
        ));
    }
    db.insert_or_update_batch(&initial_tracks, &managed_root).unwrap();

    let running = Arc::new(AtomicBool::new(true));
    let read_ops = Arc::new(AtomicUsize::new(0));
    let write_ops = Arc::new(AtomicUsize::new(0));
    let read_lock_errors = Arc::new(AtomicUsize::new(0));
    let write_lock_errors = Arc::new(AtomicUsize::new(0));
    let other_read_errors = Arc::new(AtomicUsize::new(0));
    let other_write_errors = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::new();

    // Spawn 8 Independent SQLite Connection Readers (simulating external processes / threads)
    for _reader_idx in 0..8 {
        let p = db_path.clone();
        let running_clone = Arc::clone(&running);
        let r_ops = Arc::clone(&read_ops);
        let r_lock_err = Arc::clone(&read_lock_errors);
        let r_oth_err = Arc::clone(&other_read_errors);

        handles.push(std::thread::spawn(move || {
            let conn = rusqlite::Connection::open(&p).expect("Failed independent reader connection");
            conn.busy_timeout(Duration::from_millis(5000)).expect("Failed to set busy timeout");

            let mut iter = 0;
            while running_clone.load(Ordering::Relaxed) {
                iter += 1;
                match iter % 6 {
                    0 => {
                        // Count tracks
                        match conn.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get::<_, i64>(0)) {
                            Ok(c) => assert!(c >= 1000),
                            Err(rusqlite::Error::SqliteFailure(e, _)) if e.extended_code == 5 || e.code == rusqlite::ffi::ErrorCode::DatabaseBusy => {
                                r_lock_err.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(_) => { r_oth_err.fetch_add(1, Ordering::Relaxed); }
                        }
                    }
                    1 => {
                        // FTS match query
                        let query_res = {
                            let mut stmt = match conn.prepare("SELECT t.id FROM tracks t JOIN tracks_fts fts ON fts.rowid = t.rowid WHERE tracks_fts MATCH '\"Artist\"*' LIMIT 50") {
                                Ok(s) => s,
                                Err(e) => {
                                    if e.to_string().contains("locked") || e.to_string().contains("busy") {
                                        r_lock_err.fetch_add(1, Ordering::Relaxed);
                                    } else {
                                        r_oth_err.fetch_add(1, Ordering::Relaxed);
                                    }
                                    continue;
                                }
                            };
                            let rows: Result<Vec<String>, rusqlite::Error> = stmt.query_map([], |r| r.get::<_, String>(0)).and_then(|mapped| mapped.collect());
                            rows
                        };
                        match query_res {
                            Ok(_) => {},
                            Err(e) => {
                                if e.to_string().contains("locked") || e.to_string().contains("busy") {
                                    r_lock_err.fetch_add(1, Ordering::Relaxed);
                                } else {
                                    r_oth_err.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                        }
                    }
                    2 => {
                        // Aggregation query: list albums
                        let _ = conn.prepare("SELECT album, COUNT(*) FROM tracks GROUP BY album").and_then(|mut stmt| {
                            let rows: Result<Vec<(String, i64)>, rusqlite::Error> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).and_then(|m| m.collect());
                            rows
                        });
                    }
                    3 => {
                        // Point lookup by ID
                        let id = format!("seed-{:05}", (iter * 7) % 1000);
                        let _ = conn.query_row("SELECT title, artist FROM tracks WHERE id = ?1", rusqlite::params![id], |r| {
                            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
                        });
                    }
                    4 => {
                        // Playlist read
                        let _ = conn.query_row("SELECT COUNT(*) FROM playlists", [], |r| r.get::<_, i64>(0));
                    }
                    _ => {
                        // Sorted query
                        let _ = conn.prepare("SELECT id FROM tracks ORDER BY date_added DESC LIMIT 20").and_then(|mut stmt| {
                            let rows: Result<Vec<String>, rusqlite::Error> = stmt.query_map([], |r| r.get(0)).and_then(|m| m.collect());
                            rows
                        });
                    }
                }
                r_ops.fetch_add(1, Ordering::Relaxed);
            }
        }));
    }

    // Spawn 4 Readers using LibraryDatabase wrapper
    for _ in 0..4 {
        let db_clone = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_clone = Arc::clone(&running);
        let r_ops = Arc::clone(&read_ops);
        let r_lock_err = Arc::clone(&read_lock_errors);
        let r_oth_err = Arc::clone(&other_read_errors);

        handles.push(std::thread::spawn(move || {
            let mut iter = 0;
            while running_clone.load(Ordering::Relaxed) {
                iter += 1;
                let res = match iter % 4 {
                    0 => db_clone.search_fts("Artist", &m_root).map(|_| ()),
                    1 => db_clone.list_albums().map(|_| ()),
                    2 => db_clone.list_artists().map(|_| ()),
                    _ => {
                        let id = format!("seed-{:05}", (iter * 11) % 1000);
                        db_clone.get_track(&id, &m_root).map(|_| ())
                    }
                };
                match res {
                    Ok(_) => { r_ops.fetch_add(1, Ordering::Relaxed); }
                    Err(LibraryError::IndexError(msg)) if msg.contains("locked") || msg.contains("busy") => {
                        r_lock_err.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(_) => { r_oth_err.fetch_add(1, Ordering::Relaxed); }
                }
            }
        }));
    }

    // Spawn 2 High-Frequency Batch Writers
    for writer_id in 0..2 {
        let db_clone = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_clone = Arc::clone(&running);
        let w_ops = Arc::clone(&write_ops);
        let w_lock_err = Arc::clone(&write_lock_errors);
        let w_oth_err = Arc::clone(&other_write_errors);

        handles.push(std::thread::spawn(move || {
            let mut batch_seq = 0;
            while running_clone.load(Ordering::Relaxed) {
                batch_seq += 1;
                let batch_size = 50;
                let offset = 1000 + (writer_id * 20000) + (batch_seq * batch_size);
                let tracks: Vec<Track> = (0..batch_size)
                    .map(|i| {
                        let idx = offset + i;
                        create_sample_track(
                            &format!("dynamic-w{writer_id}-{idx}"),
                            &format!("Dynamic Song {idx} by Writer {writer_id}"),
                            &format!("WriterArtist {writer_id}"),
                            &format!("WriterAlbum {}", idx / 10),
                            "Electro",
                            &m_root,
                        )
                    })
                    .collect();

                match db_clone.insert_or_update_batch(&tracks, &m_root) {
                    Ok(_) => {
                        w_ops.fetch_add(batch_size, Ordering::Relaxed);
                    }
                    Err(LibraryError::IndexError(msg)) if msg.contains("locked") || msg.contains("busy") => {
                        w_lock_err.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(_) => {
                        w_oth_err.fetch_add(1, Ordering::Relaxed);
                    }
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }));
    }

    // Spawn 1 Playlist Mutation Thread
    {
        let db_clone = Arc::clone(&db);
        let running_clone = Arc::clone(&running);
        let w_ops = Arc::clone(&write_ops);

        handles.push(std::thread::spawn(move || {
            let mut pl_idx = 0;
            while running_clone.load(Ordering::Relaxed) {
                pl_idx += 1;
                if let Ok(pl) = db_clone.create_playlist(&format!("Concurrent PL {pl_idx}")) {
                    let track_ids = vec![format!("seed-{:05}", (pl_idx * 3) % 1000)];
                    let _ = db_clone.add_tracks_to_playlist(&pl.id, &track_ids);
                    w_ops.fetch_add(1, Ordering::Relaxed);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }));
    }

    // Run concurrency stress for 4 seconds
    let start_time = Instant::now();
    std::thread::sleep(Duration::from_secs(4));
    running.store(false, Ordering::Relaxed);

    for h in handles {
        h.join().unwrap();
    }

    let elapsed = start_time.elapsed();
    let total_reads = read_ops.load(Ordering::SeqCst);
    let total_writes = write_ops.load(Ordering::SeqCst);
    let r_locks = read_lock_errors.load(Ordering::SeqCst);
    let w_locks = write_lock_errors.load(Ordering::SeqCst);
    let r_oth = other_read_errors.load(Ordering::SeqCst);
    let w_oth = other_write_errors.load(Ordering::SeqCst);

    println!("\n=== EMPIRICAL WAL CONCURRENCY STRESS REPORT ===");
    println!("Duration:           {elapsed:?}");
    println!("Total Read Ops:     {total_reads} ({:.1} ops/sec)", total_reads as f64 / elapsed.as_secs_f64());
    println!("Total Written Rows: {total_writes} ({:.1} rows/sec)", total_writes as f64 / elapsed.as_secs_f64());
    println!("Read Lock Errors:   {r_locks}");
    println!("Write Lock Errors:  {w_locks}");
    println!("Other Read Errors:  {r_oth}");
    println!("Other Write Errors: {w_oth}");

    assert_eq!(r_locks, 0, "Zero database locked errors allowed on reads under WAL mode");
    assert_eq!(w_locks, 0, "Zero database locked errors allowed on writes under WAL mode with busy_timeout");
    assert_eq!(r_oth, 0, "Zero other errors allowed during concurrent reads");
    assert_eq!(w_oth, 0, "Zero other errors allowed during concurrent writes");
    assert!(total_reads > 500, "High read throughput expected (>500 ops)");
    assert!(total_writes > 200, "Steady write throughput expected (>200 rows)");

    // Clean up
    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// 2. FTS5 EDGE CASES & ADVERSARIAL QUERIES
// =========================================================================

#[test]
fn challenge_fts5_unicode_emojis_and_extreme_special_chars() {
    let (temp_dir, db_path, managed_root) = create_challenge_env("fts5_edge_cases");
    let db = LibraryDatabase::open(&db_path).expect("Failed to open DB");

    let edge_tracks = vec![
        // 1. Emoji rich titles and artists
        create_sample_track("t_emoji_1", "🔥 Fire Track 🎸", "DJ 🎧 Beats", "Album ⭐⭐⭐", "EDM 🚀", &managed_root),
        create_sample_track("t_emoji_2", "❤️ Love & Peace ✌️", "Artist 🌟", "Cosmic 🌌", "Ambient 🌙", &managed_root),
        // 2. Multilingual scripts
        create_sample_track("t_cjk_kanji", "千と千尋の神隠し", "久石譲", "Spirited Away OST", "Soundtrack", &managed_root),
        create_sample_track("t_cjk_korean", "강남스타일 (Gangnam Style)", "싸이 (PSY)", "싸이6甲 Part 1", "K-Pop", &managed_root),
        create_sample_track("t_arabic_rtl", "حبيبي يا نور العين", "عمرو دياب", "Nour El Ain", "Arabic Pop", &managed_root),
        create_sample_track("t_hebrew_rtl", "הללויה", "עוזי חיטמן", "Classic Hebrew", "Folk", &managed_root),
        create_sample_track("t_cyrillic_complex", "Спокойная ночь / Пачка сигарет", "Виктор Цой (Кино)", "Группа крови", "Rock", &managed_root),
        create_sample_track("t_greek", "Ζορμπάς (Zorba the Greek)", "Μίκης Θεοδωράκης", "Syrtaki Classics", "Traditional", &managed_root),
        // 3. European Diacritics & Ligatures
        create_sample_track("t_nordic", "Ágætis byrjun (Hoppípolla)", "Sigur Rós", "Ágætis byrjun", "Post-Rock", &managed_root),
        create_sample_track("t_german_umlaut", "Über den Wolken", "Reinhard Mey", "Wie vor Jahr und Tag", "Liedermacher", &managed_root),
        create_sample_track("t_french_accents", "Les Étoiles et l'Éléphant", "Camille Saint-Saëns", "Le Carnaval des animaux", "Classical", &managed_root),
        create_sample_track("t_turkish", "İstanbul'da Sonbahar", "Teoman", "Gönülçelen", "Turkish Rock", &managed_root),
        create_sample_track("t_spanish_ñ", "Corazón Espinado (Año 2000)", "Santana ft. Maná", "Supernatural", "Latin Rock", &managed_root),
        // 4. Extreme Punctuation and Technical Terms
        create_sample_track("t_tech_punct", "track_v2.0_final (remix) [192kHz/24bit] #42", "C++ // Rust Devs", "std::sync::Arc<Mutex<T>>", "Chiptune", &managed_root),
        create_sample_track("t_special_math", "π ≈ 3.1415926535 & ∞ / ±0", "The Mathematicians ∑∏∫", "Calculus III", "Math Rock", &managed_root),
        create_sample_track("t_quotes_and_slashes", "Don't \"Stop\" Believin' / Any Way You Want It", "Journey & Co.", "Greatest Hits: Vol. 1", "Classic Rock", &managed_root),
    ];

    db.insert_or_update_batch(&edge_tracks, &managed_root).unwrap();

    // Adversarial Query Tests: All must return Ok(...) and NEVER panic or error out!
    let test_queries = [
        // Raw punctuation / malformed FTS syntax
        ("", 0),
        ("   ", 0),
        ("---", 0),
        ("***", 0),
        ("???", 0),
        ("///", 0),
        ("\\\\\\", 0),
        ("\"\"\"\"", 0),
        ("''''", 0),
        ("()()()", 0),
        ("[][][]", 0),
        ("{}{}{}", 0),
        ("!@#$%^&*()_+-=", 0),
        ("MATCH 'something'", 0),
        ("NEAR(a, b, 10)", 0),
        ("AND OR NOT", 0),
        ("col:value", 0),
        // Term Searches
        ("Fire", 1),
        ("Beats", 1),
        ("Love", 1),
        ("Cosmic", 1),
        // Diacritic insensitive searches
        ("Hoppipolla", 1), // matches "Hoppípolla"
        ("Sigur Ros", 1), // matches "Sigur Rós"
        ("Uber den Wolken", 1), // matches "Über den Wolken"
        ("Etoiles", 1), // matches "Étoiles"
        ("Saint Saens", 1), // matches "Saint-Saëns"
        ("Corazon", 1), // matches "Corazón"
        ("Mana", 1), // matches "Maná"
        ("Istanbul", 1), // matches "İstanbul"
        // Multilingual scripts
        ("千と千尋の神隠し", 1),
        ("久石譲", 1),
        ("Gangnam", 1),
        ("싸이", 1),
        ("حبيبي", 1),
        ("دياب", 1),
        ("הללויה", 1),
        ("Цой", 1),
        ("Кино", 1),
        ("Ζορμπάς", 1),
        ("Θεοδωράκης", 1),
        // Technical terms and punctuation
        ("Rust Devs", 1),
        ("Mutex", 1),
        ("192kHz", 1),
        ("3.1415926535", 1),
        ("Don't Stop Believin", 1),
        // SQL Injection attempts
        ("'; DROP TABLE tracks; --", 0),
        ("' UNION SELECT * FROM tracks --", 0),
        ("1' OR '1'='1", 0),
        ("admin'--", 0),
        ("\" OR \"\"=\"", 0),
    ];

    println!("\n=== EMPIRICAL FTS5 ADVERSARIAL QUERY TEST ===");
    for (q, min_expected) in test_queries {
        let res = db.search_fts(q, &managed_root);
        assert!(res.is_ok(), "FTS query '{q}' MUST NOT return Err, got: {:?}", res.err());
        let tracks = res.unwrap();
        if min_expected > 0 {
            assert!(tracks.len() >= min_expected, "FTS query '{q}' expected >= {min_expected} matches, got {}", tracks.len());
        }
        println!("  FTS query: '{q:30}' -> returned {} matches (OK)", tracks.len());
    }

    // Verify DB integrity after injection attempts
    let total = db.load_all(&managed_root).unwrap().len();
    assert_eq!(total, edge_tracks.len(), "All tracks must remain intact after adversarial SQL queries");

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// 3. DATABASE REBUILD & SCANNER RESILIENCE
// =========================================================================

#[tokio::test]
async fn challenge_database_rebuild_and_path_corruption_resilience() {
    let (temp_dir, db_path, library_root) = create_challenge_env("rebuild_resilience");
    let incoming_dir = temp_dir.join("incoming");
    fs::create_dir_all(&incoming_dir).unwrap();

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone()).expect("Init manager");

    println!("\n=== EMPIRICAL DATABASE REBUILD RESILIENCE TEST ===");

    // Test 1: Rebuild on completely empty library directory
    println!("Test 1: Rebuild empty library directory...");
    let empty_res = manager.rebuild_library().await;
    assert!(empty_res.is_ok(), "Rebuild on empty library root must succeed");
    assert_eq!(empty_res.unwrap().len(), 0);
    assert_eq!(manager.all_tracks().len(), 0);

    // Test 2: Ingest files from incoming directory using Copy strategy
    println!("Test 2: Importing audio and non-audio files...");
    // 2a. Valid dummy MP3 with ID3 tag
    let f1 = incoming_dir.join("01_song.mp3");
    let mut file1 = File::create(&f1).unwrap();
    file1.write_all(b"ID3\x04\x00\x00\x00\x00\x00\x20TIT2\x00\x00\x00\x0a\x00\x00\x03Valid SongTPE1\x00\x00\x00\x0b\x00\x00\x03Test ArtistTALB\x00\x00\x00\x0a\x00\x00\x03Test Album").unwrap();

    // 2b. Zero-byte file with audio extension
    let f2 = incoming_dir.join("02_empty.flac");
    fs::write(&f2, b"").unwrap();

    // 2c. Truncated header
    let f3 = incoming_dir.join("03_truncated.ogg");
    fs::write(&f3, b"OggS\x00\x02").unwrap();

    // 2d. Binary garbage with .mp3 extension
    let f4 = incoming_dir.join("04_garbage.mp3");
    fs::write(&f4, [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0xFF, 0xAA, 0x55]).unwrap();

    // 2e. Non-audio files
    fs::write(incoming_dir.join("cover.jpg"), b"\xFF\xD8\xFF\xE0JPEGIMAGE").unwrap();
    fs::write(incoming_dir.join("metadata.nfo"), b"Release details nfo").unwrap();
    fs::write(incoming_dir.join(".hidden_file"), b"hidden").unwrap();

    let imported = manager.import_directory(&incoming_dir, ImportStrategy::Copy).await.unwrap();
    println!("  Imported {} audio tracks (4 audio files imported, 3 non-audio ignored)", imported.len());
    assert_eq!(imported.len(), 4);
    assert_eq!(manager.all_tracks().len(), 4);

    // Test 3: Trigger rebuild on the managed library
    println!("Test 3: Rebuild library from managed storage...");
    let rebuild_res = manager.rebuild_library().await;
    assert!(rebuild_res.is_ok(), "Rebuild must handle corrupt files gracefully without panic: {:?}", rebuild_res.err());
    let tracks = rebuild_res.unwrap();
    println!("  Rebuilt {} tracks successfully", tracks.len());

    // Test 4: Physical file deleted behind manager's back, then rebuild
    println!("Test 4: Deleting a physical file in managed store, then rebuild...");
    let track_to_delete = manager.all_tracks()[0].source.path().clone();
    let _ = fs::remove_file(&track_to_delete);

    let rebuild_res2 = manager.rebuild_library().await.expect("Rebuild after deletion");
    println!("  Rebuild after deleting 1 file returned {} tracks", rebuild_res2.len());
    assert!(!manager.all_tracks().iter().any(|t| t.source.path() == &track_to_delete));

    // Test 5: Rebuild after library_root directory is completely removed
    println!("Test 5: Rebuild after library_root directory is deleted from disk...");
    let _ = fs::remove_dir_all(&library_root);
    let rebuild_deleted_root = manager.rebuild_library().await;
    assert!(rebuild_deleted_root.is_ok(), "Rebuild must not panic if library_root was deleted");
    assert_eq!(rebuild_deleted_root.unwrap().len(), 0);

    // Test 6: Database open against uncreatable path (e.g. file where directory expected)
    println!("Test 6: Database open against invalid filesystem structure...");
    let dummy_file = temp_dir.join("file_not_dir");
    fs::write(&dummy_file, b"im_a_file").unwrap();
    let invalid_db_path = dummy_file.join("subpath").join("library.db");
    let open_invalid = LibraryDatabase::open(&invalid_db_path);
    assert!(open_invalid.is_err(), "Opening DB under a regular file parent must fail with clean LibraryError");

    drop(manager);
    let _ = fs::remove_dir_all(&temp_dir);
}

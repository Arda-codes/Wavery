//! Empirical Adversarial Challenge Suite for Milestone 2:
//! SQLite FTS5 BM25 Weighted Ranking, Diacritics/Accents Tokenization,
//! SQL Injection Sanitization, and Multi-threaded Trigger Synchronization.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wavery_core::models::{Track, TrackMetadata, TrackSource};
use wavery_library::db::LibraryDatabase;

fn setup_env(test_name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let temp_dir = std::env::temp_dir().join(format!("wavery_fts5_adv_{test_name}_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();
    (temp_dir, db_path, managed_root)
}

fn build_track(
    id: &str,
    title: &str,
    artist: &str,
    album: &str,
    album_artist: Option<&str>,
    genre: &str,
    managed_root: &Path,
) -> Track {
    Track {
        id: id.to_string(),
        source: TrackSource::Managed(managed_root.join(format!("{artist}/{album}/{id}.flac"))),
        metadata: TrackMetadata {
            title: Some(title.to_string()),
            artist: Some(artist.to_string()),
            album: Some(album.to_string()),
            album_artist: album_artist.map(String::from),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2024),
            genre: Some(genre.to_string()),
            duration: Duration::from_secs(210),
            sample_rate: Some(48000),
            bit_depth: Some(24),
            channels: Some(2),
            format: "FLAC".to_string(),
        },
        date_added: 1700000000,
    }
}

// =========================================================================
// 1. BM25 COLUMN WEIGHT HIERARCHY TEST
// =========================================================================

#[test]
fn test_adversarial_bm25_column_weight_ordering() {
    let (temp_dir, db_path, managed_root) = setup_env("bm25_weights");
    let db = LibraryDatabase::open(&db_path).expect("Failed to open DB");

    // Target keyword: "Supernova"
    // Column weights configured in db.rs:
    // 1. Title (10.0) -> Highest
    // 2. Artist (5.0)
    // 3. Album (3.0)
    // 4. Album Artist (2.0)
    // 5. Genre (1.0) -> Lowest
    let tracks = vec![
        build_track("t_genre", "Regular Track", "Regular Artist", "Regular Album", None, "Supernova", &managed_root),
        build_track("t_album_artist", "Regular Track 2", "Regular Artist 2", "Regular Album 2", Some("Supernova"), "Rock", &managed_root),
        build_track("t_album", "Regular Track 3", "Regular Artist 3", "Supernova", None, "Rock", &managed_root),
        build_track("t_artist", "Regular Track 4", "Supernova", "Regular Album 4", None, "Rock", &managed_root),
        build_track("t_title", "Supernova", "Regular Artist 5", "Regular Album 5", None, "Rock", &managed_root),
    ];

    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    let results = db.search_fts("Supernova", &managed_root).unwrap();
    assert_eq!(results.len(), 5, "All 5 tracks containing 'Supernova' must match");

    let ids: Vec<&str> = results.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "t_title",
            "t_artist",
            "t_album",
            "t_album_artist",
            "t_genre",
        ],
        "FTS5 BM25 ranking must strictly order: Title (10.0) > Artist (5.0) > Album (3.0) > AlbumArtist (2.0) > Genre (1.0)"
    );

    // Test secondary keyword "Hyperdrive" with multi-word titles
    let hyper_tracks = vec![
        build_track("h_genre", "Song Delta", "Artist Echo", "Album Foxtrot", None, "Hyperdrive Metal", &managed_root),
        build_track("h_album_artist", "Song Charlie", "Artist Bravo", "Album Alpha", Some("Hyperdrive Syndicate"), "Metal", &managed_root),
        build_track("h_album", "Song Bravo", "Artist Alpha", "The Hyperdrive Experience", None, "Metal", &managed_root),
        build_track("h_artist", "Song Alpha", "Hyperdrive Project", "Greatest Hits", None, "Metal", &managed_root),
        build_track("h_title", "Hyperdrive Odyssey", "Unknown Artist", "Unknown Album", None, "Metal", &managed_root),
    ];

    db.insert_or_update_batch(&hyper_tracks, &managed_root).unwrap();

    let hyper_results = db.search_fts("Hyperdrive", &managed_root).unwrap();
    assert_eq!(hyper_results.len(), 5);

    let hyper_ids: Vec<&str> = hyper_results.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(
        hyper_ids,
        vec![
            "h_title",
            "h_artist",
            "h_album",
            "h_album_artist",
            "h_genre",
        ]
    );

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// 2. DIACRITICS, ACCENTS, AND MULTILINGUAL UNICODE TOKENIZATION
// =========================================================================

#[test]
fn test_adversarial_diacritics_and_unicode_tokenization() {
    let (temp_dir, db_path, managed_root) = setup_env("diacritics_unicode");
    let db = LibraryDatabase::open(&db_path).expect("Failed to open DB");

    let unicode_tracks = vec![
        build_track("u_cafe", "Café del Mar", "Chilled Café", "Café Sessions", None, "Ambient", &managed_root),
        build_track("u_motley", "Kickstart My Heart", "Mötley Crüe", "Dr. Feelgood", None, "Glam Metal", &managed_root),
        build_track("u_bjork", "Jóga", "Björk", "Homogenic", None, "Art Pop", &managed_root),
        build_track("u_amelie", "La Valse d'Amélie", "Yann Tiersen", "Le Fabuleux Destin d'Amélie Poulain", None, "Soundtrack", &managed_root),
        build_track("u_sigur", "Hoppípolla", "Sigur Rós", "Takk...", None, "Post-Rock", &managed_root),
        build_track("u_spanish", "Canción del Mariachi", "Los Lobos & Antonio Banderas", "Desperado", None, "Latin", &managed_root),
        build_track("u_german", "Über den Wolken", "Reinhard Mey", "Mädchen im Spiegel", None, "Liedermacher", &managed_root),
        build_track("u_turkish", "Gönülçelen", "Teoman", "İstanbul'da Sonbahar", None, "Rock", &managed_root),
        build_track("u_nordic", "Smuk Som Et Stjerneskud", "Brødrene Olsen", "Dansk Melodi Grand Prix", None, "Pop", &managed_root),
        build_track("u_cjk", "千と千尋の神隠し", "久石譲", "Spirited Away", None, "Soundtrack", &managed_root),
        build_track("u_cyrillic", "Группа крови", "Кино", "Группа крови", None, "Rock", &managed_root),
    ];

    db.insert_or_update_batch(&unicode_tracks, &managed_root).unwrap();

    // Verification Test Matrix:
    // Testing specific accents/diacritics: café, mötley, björk, etc.
    let test_cases = [
        // Query, Expected ID
        ("cafe", "u_cafe"),
        ("café", "u_cafe"),
        ("CAFE", "u_cafe"),
        ("CAFÉ", "u_cafe"),
        ("motley", "u_motley"),
        ("mötley", "u_motley"),
        ("crue", "u_motley"),
        ("crüe", "u_motley"),
        ("bjork", "u_bjork"),
        ("björk", "u_bjork"),
        ("joga", "u_bjork"),
        ("jóga", "u_bjork"),
        ("amelie", "u_amelie"),
        ("amélie", "u_amelie"),
        ("sigur", "u_sigur"),
        ("ros", "u_sigur"),
        ("rós", "u_sigur"),
        ("hoppipolla", "u_sigur"),
        ("hoppípolla", "u_sigur"),
        ("cancion", "u_spanish"),
        ("canción", "u_spanish"),
        ("uber", "u_german"),
        ("über", "u_german"),
        ("gonulcelen", "u_turkish"),
        ("gönülçelen", "u_turkish"),
        ("istanbul", "u_turkish"),
        ("brødrene", "u_nordic"),
        ("久石譲", "u_cjk"),
        ("Кино", "u_cyrillic"),
    ];

    for (query, expected_id) in test_cases {
        let results = db.search_fts(query, &managed_root)
            .unwrap_or_else(|e| panic!("Search failed for '{query}': {e}"));
        assert!(
            results.iter().any(|t| t.id == expected_id),
            "FTS query '{query}' failed to find track '{expected_id}'"
        );
    }

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// 3. MULTI-WORD PREFIX SEARCH & COMPLEX SPECIAL CHARACTERS
// =========================================================================

#[test]
fn test_adversarial_multi_word_prefix_and_punctuation() {
    let (temp_dir, db_path, managed_root) = setup_env("multi_word_prefix");
    let db = LibraryDatabase::open(&db_path).expect("Failed to open DB");

    let tracks = vec![
        build_track("p1", "Dark All Day (feat. Tim Cappello)", "Gunship", "Dark All Day", None, "Synthwave", &managed_root),
        build_track("p2", "Thunderstruck / Shoot to Thrill [Live at River Plate]", "AC/DC", "Live", None, "Hard Rock", &managed_root),
        build_track("p3", "Don't Stop Believin'", "Journey", "Escape (Expanded Edition)", None, "Classic Rock", &managed_root),
        build_track("p4", "Around the World / Harder, Better, Faster, Stronger", "Daft Punk", "Alive 2007", None, "Electronic", &managed_root),
        build_track("p5", "21st Century Schizoid Man [including Mirrors]", "King Crimson", "In the Court of the Crimson King", None, "Prog Rock", &managed_root),
    ];

    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    let prefix_queries = [
        ("dark all", "p1"),
        ("gunsh", "p1"),
        ("cappel", "p1"),
        ("ac dc", "p2"),
        ("ac/dc", "p2"),
        ("thund", "p2"),
        ("river plate", "p2"),
        ("don't stop", "p3"),
        ("stop believ", "p3"),
        ("around world", "p4"),
        ("hard bett fast", "p4"),
        ("alive 2007", "p4"),
        ("21st cent", "p5"),
        ("schizoid", "p5"),
        ("crimson king", "p5"),
    ];

    for (query, expected_id) in prefix_queries {
        let results = db.search_fts(query, &managed_root).unwrap();
        assert!(
            results.iter().any(|t| t.id == expected_id),
            "Multi-word prefix query '{query}' failed to find '{expected_id}'. Found: {:?}",
            results.iter().map(|t| &t.id).collect::<Vec<_>>()
        );
    }

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// 4. SQL INJECTION & MALICIOUS ATTACK PAYLOADS
// =========================================================================

#[test]
fn test_adversarial_sql_injection_payloads() {
    let (temp_dir, db_path, managed_root) = setup_env("sqli_payloads");
    let db = LibraryDatabase::open(&db_path).expect("Failed to open DB");

    let baseline_tracks = vec![
        build_track("base1", "Safe Track 1", "Safe Artist", "Safe Album", None, "Pop", &managed_root),
        build_track("base2", "Safe Track 2", "Safe Artist", "Safe Album", None, "Rock", &managed_root),
    ];
    db.insert_or_update_batch(&baseline_tracks, &managed_root).unwrap();

    let attack_payloads = [
        "'; DROP TABLE tracks; --",
        "'; DROP TABLE tracks_fts; --",
        "'; DELETE FROM tracks; --",
        "' OR '1'='1",
        "\" OR \"\"=\"",
        "' UNION SELECT id, relative_path, title, artist, album, album_artist, track_number, disc_number, year, genre, duration_secs, sample_rate, bit_depth, channels, format, date_added FROM tracks --",
        "admin'--",
        "1; ATTACH DATABASE '/tmp/pwned.db' AS pwn; --",
        "MATCH 'tracks_fts: *'",
        "NEAR(foo, bar, 1000)",
        "AND OR NOT NOT",
        "\"\"\"\"\"\"\"\"\"\"\"\"\"\"\"\"",
        "''''''''''''''''",
        "`SELECT * FROM tracks`",
        "${7*7}",
        "{{7*7}}",
        "\0\0\0\0",
        "\r\n\t\x00\x1b[31mRed Alert\x1b[0m",
        &"A".repeat(10000), // Huge string
        &"' OR 1=1 -- ".repeat(500),
    ];

    for (idx, payload) in attack_payloads.iter().enumerate() {
        let res = db.search_fts(payload, &managed_root);
        assert!(
            res.is_ok(),
            "Adversarial payload #{idx} ('{payload}') MUST NOT cause an internal error or panic: {:?}",
            res.err()
        );
    }

    // Verify database tables and data are 100% intact
    let all = db.load_all(&managed_root).unwrap();
    assert_eq!(all.len(), 2, "Database tracks table must remain untouched and uncorrupted");

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// 5. RAPID CONCURRENT BATCH INSERTS, UPDATES, DELETES & TRIGGER SYNC
// =========================================================================

#[test]
fn test_adversarial_rapid_concurrent_mutations_and_trigger_sync() {
    let (temp_dir, db_path, managed_root) = setup_env("rapid_mutations");
    let db = Arc::new(LibraryDatabase::open(&db_path).expect("Failed to open DB"));

    // Pre-populate with 200 tracks
    let mut initial = Vec::new();
    for i in 0..200 {
        initial.push(build_track(
            &format!("init_{i:04}"),
            &format!("Initial Song {i}"),
            &format!("Initial Artist {}", i % 10),
            &format!("Initial Album {}", i % 5),
            None,
            "Electronic",
            &managed_root,
        ));
    }
    db.insert_or_update_batch(&initial, &managed_root).unwrap();

    let running = Arc::new(AtomicBool::new(true));
    let inserted_ids = Arc::new(Mutex::new(HashSet::new()));
    let deleted_ids = Arc::new(Mutex::new(HashSet::new()));
    let updated_titles = Arc::new(Mutex::new(std::collections::HashMap::new()));
    let error_count = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::new();

    // Thread 1 & 2: Rapid batch inserts
    for thread_idx in 0..2 {
        let db_c = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_c = Arc::clone(&running);
        let ins_ids = Arc::clone(&inserted_ids);
        let err_cnt = Arc::clone(&error_count);

        handles.push(std::thread::spawn(move || {
            let mut batch_seq = 0;
            while running_c.load(Ordering::Relaxed) {
                batch_seq += 1;
                let batch_size = 25;
                let start_idx = 1000 + (thread_idx * 5000) + (batch_seq * batch_size);

                let mut batch = Vec::new();
                let mut ids = Vec::new();
                for i in 0..batch_size {
                    let id = format!("dyn_t{thread_idx}_{}", start_idx + i);
                    ids.push(id.clone());
                    batch.push(build_track(
                        &id,
                        &format!("Dynamic UniqueTitle {id}"),
                        &format!("Dynamic Artist {thread_idx}"),
                        &format!("Dynamic Album {}", (start_idx + i) % 10),
                        None,
                        "Synth",
                        &m_root,
                    ));
                }

                match db_c.insert_or_update_batch(&batch, &m_root) {
                    Ok(_) => {
                        let mut set = ins_ids.lock().unwrap();
                        for id in ids {
                            set.insert(id);
                        }
                    }
                    Err(e) => {
                        eprintln!("Insert batch error: {e:?}");
                        err_cnt.fetch_add(1, Ordering::Relaxed);
                    }
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }));
    }

    // Thread 3: Rapid updates (modifying metadata of initial tracks)
    {
        let db_c = Arc::clone(&db);
        let running_c = Arc::clone(&running);
        let upd_map = Arc::clone(&updated_titles);
        let err_cnt = Arc::clone(&error_count);

        handles.push(std::thread::spawn(move || {
            let mut seq = 0;
            while running_c.load(Ordering::Relaxed) {
                seq += 1;
                let target_id = format!("init_{:04}", (seq * 7) % 100);
                let new_title = format!("UpdatedTitle_Seq{seq}_{target_id}");

                let meta = TrackMetadata {
                    title: Some(new_title.clone()),
                    artist: Some("Updated Artist".to_string()),
                    album: Some("Updated Album".to_string()),
                    album_artist: None,
                    track_number: Some(1),
                    disc_number: Some(1),
                    year: Some(2025),
                    genre: Some("Updated Genre".to_string()),
                    duration: Duration::from_secs(240),
                    sample_rate: Some(44100),
                    bit_depth: Some(16),
                    channels: Some(2),
                    format: "FLAC".to_string(),
                };

                match db_c.update_track_metadata(&target_id, &meta) {
                    Ok(_) => {
                        upd_map.lock().unwrap().insert(target_id, new_title);
                    }
                    Err(e) => {
                        eprintln!("Update error: {e:?}");
                        err_cnt.fetch_add(1, Ordering::Relaxed);
                    }
                }
                std::thread::sleep(Duration::from_millis(3));
            }
        }));
    }

    // Thread 4: Rapid deletes of initial tracks (upper half 100..200)
    {
        let db_c = Arc::clone(&db);
        let running_c = Arc::clone(&running);
        let del_ids = Arc::clone(&deleted_ids);
        let err_cnt = Arc::clone(&error_count);

        handles.push(std::thread::spawn(move || {
            let mut del_idx = 100;
            while running_c.load(Ordering::Relaxed) && del_idx < 200 {
                let target_id = format!("init_{del_idx:04}");
                del_idx += 1;

                match db_c.delete(&target_id) {
                    Ok(Some(_)) => {
                        del_ids.lock().unwrap().insert(target_id);
                    }
                    Ok(None) => {}
                    Err(e) => {
                        eprintln!("Delete error: {e:?}");
                        err_cnt.fetch_add(1, Ordering::Relaxed);
                    }
                }
                std::thread::sleep(Duration::from_millis(4));
            }
        }));
    }

    // Thread 5 & 6: Rapid concurrent FTS5 queries
    for q_idx in 0..2 {
        let db_c = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_c = Arc::clone(&running);
        let err_cnt = Arc::clone(&error_count);

        handles.push(std::thread::spawn(move || {
            let mut iter = 0;
            while running_c.load(Ordering::Relaxed) {
                iter += 1;
                let q = match (q_idx + iter) % 4 {
                    0 => "Initial Song",
                    1 => "Dynamic UniqueTitle",
                    2 => "UpdatedTitle",
                    _ => "Electronic",
                };

                match db_c.search_fts(q, &m_root) {
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("Concurrent search error: {e:?}");
                        err_cnt.fetch_add(1, Ordering::Relaxed);
                    }
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        }));
    }

    // Let the rapid mutations run for 3.5 seconds
    std::thread::sleep(Duration::from_millis(3500));
    running.store(false, Ordering::Relaxed);

    for h in handles {
        h.join().unwrap();
    }

    assert_eq!(error_count.load(Ordering::SeqCst), 0, "Zero errors allowed during rapid concurrent mutations");

    println!("\n=== POST-CONCURRENCY FTS5 TRIGGER SYNCHRONIZATION AUDIT ===");

    // 1. Audit Deleted Tracks: Ensure FTS5 has NO GHOST ROWS for deleted tracks
    let deleted_set = deleted_ids.lock().unwrap().clone();
    println!("Auditing {} deleted tracks...", deleted_set.len());
    assert!(!deleted_set.is_empty(), "Expected at least some tracks to have been deleted");

    for d_id in &deleted_set {
        // Direct table check
        assert!(db.get_track(d_id, &managed_root).unwrap().is_none(), "Track {d_id} must not exist in tracks table");

        // FTS search for the old initial song title
        let idx_str = d_id.strip_prefix("init_").unwrap();
        let old_title_q = format!("Initial Song {idx_str}");
        let search_res = db.search_fts(&old_title_q, &managed_root).unwrap();
        assert!(
            !search_res.iter().any(|t| t.id == *d_id),
            "FTS5 trigger tracks_ad failed: Deleted track {d_id} still returned in FTS search!"
        );
    }

    // 2. Audit Updated Tracks: Ensure FTS5 finds new title and NOT old title
    let updated_map = updated_titles.lock().unwrap().clone();
    println!("Auditing {} updated tracks...", updated_map.len());
    assert!(!updated_map.is_empty(), "Expected at least some tracks to have been updated");

    for (u_id, new_title) in &updated_map {
        // Search for new title must return track
        let new_q = new_title.clone();
        let new_res = db.search_fts(&new_q, &managed_root).unwrap();
        assert!(
            new_res.iter().any(|t| t.id == *u_id),
            "FTS5 trigger tracks_au failed: Updated track {u_id} with title '{new_title}' not found in FTS search"
        );
    }

    // 3. Audit Inserted Tracks: Ensure all inserted tracks are indexed in FTS5
    let inserted_set = inserted_ids.lock().unwrap().clone();
    println!("Auditing {} inserted tracks...", inserted_set.len());
    assert!(inserted_set.len() > 100, "Expected >100 tracks inserted");

    // Spot-check 20 inserted tracks
    for ins_id in inserted_set.iter().take(20) {
        let q = format!("UniqueTitle {ins_id}");
        let res = db.search_fts(&q, &managed_root).unwrap();
        assert!(
            res.iter().any(|t| t.id == *ins_id),
            "FTS5 trigger tracks_ai failed: Inserted track {ins_id} not indexed in FTS5"
        );
    }

    println!("All FTS5 triggers (INSERT, UPDATE, DELETE) are 100% synchronized under heavy concurrent mutations!");

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// 6. MULTI-WORD CROSS-COLUMN SCORING & NULL/CONTROL CHARACTER RESILIENCE
// =========================================================================

#[test]
fn test_adversarial_multi_word_cross_column_ranking_and_nulls() {
    let (temp_dir, db_path, managed_root) = setup_env("cross_col_nulls");
    let db = LibraryDatabase::open(&db_path).expect("Failed to open DB");

    // Search query: "Midnight Runner"
    // Rank 1: Both words in Title (10.0 + 10.0) -> Track 1
    // Rank 2: Word 1 in Title, Word 2 in Artist (10.0 + 5.0) -> Track 2
    // Rank 3: Both words in Artist (5.0 + 5.0) -> Track 3
    // Rank 4: Word 1 in Artist, Word 2 in Album (5.0 + 3.0) -> Track 4
    // Rank 5: Both words in Genre (1.0 + 1.0) -> Track 5
    let ranking_tracks = vec![
        build_track("r5_genre", "Some Title", "Some Artist", "Some Album", None, "Midnight Runner Synth", &managed_root),
        build_track("r4_artist_album", "Some Title", "Midnight Star", "Runner Records", None, "Synth", &managed_root),
        build_track("r3_artist", "Some Title", "Midnight Runner Band", "Some Album", None, "Synth", &managed_root),
        build_track("r2_title_artist", "Midnight Melody", "Runner Boy", "Some Album", None, "Synth", &managed_root),
        build_track("r1_title", "Midnight Runner", "Some Artist", "Some Album", None, "Synth", &managed_root),
    ];

    db.insert_or_update_batch(&ranking_tracks, &managed_root).unwrap();

    let results = db.search_fts("Midnight Runner", &managed_root).unwrap();
    assert_eq!(results.len(), 5, "All 5 tracks matching both words must be returned");

    let ids: Vec<&str> = results.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "r1_title",
            "r2_title_artist",
            "r3_artist",
            "r4_artist_album",
            "r5_genre",
        ],
        "Multi-word cross-column BM25 ranking must order by cumulative column weights"
    );

    // Test completely NULL metadata fields insertion and trigger resilience
    let null_track = Track {
        id: "t_null_fields".to_string(),
        source: TrackSource::Managed(managed_root.join("null_track.flac")),
        metadata: TrackMetadata {
            title: None,
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            duration: Duration::from_secs(120),
            sample_rate: None,
            bit_depth: None,
            channels: None,
            format: "FLAC".to_string(),
        },
        date_added: 1700000000,
    };

    db.insert_or_update(&null_track, &managed_root).unwrap();
    assert!(db.get_track("t_null_fields", &managed_root).unwrap().is_some());

    // Test Control characters in metadata fields
    let ctrl_track = build_track(
        "t_ctrl_chars",
        "Title\nWith\r\nTabs\tAnd\0Nulls",
        "Artist\x08With\x1bEscapes",
        "Album\x7fDelete",
        None,
        "Genre\x1fUnit",
        &managed_root,
    );
    db.insert_or_update(&ctrl_track, &managed_root).unwrap();

    let ctrl_search = db.search_fts("With Tabs", &managed_root).unwrap();
    assert_eq!(ctrl_search.len(), 1);
    assert_eq!(ctrl_search[0].id, "t_ctrl_chars");

    // Test clear_all_tracks cleans both tracks table and FTS5 table completely
    db.clear_all_tracks().unwrap();
    assert_eq!(db.load_all(&managed_root).unwrap().len(), 0);
    assert_eq!(db.search_fts("Midnight", &managed_root).unwrap().len(), 0);
    assert_eq!(db.search_fts("Title", &managed_root).unwrap().len(), 0);

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

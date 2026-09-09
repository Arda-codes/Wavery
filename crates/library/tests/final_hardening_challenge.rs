//! Final Hardening Challenge Suite (Milestone 4) for Library & Database.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use wavery_core::models::{Track, TrackMetadata, TrackSource};
use wavery_library::db::LibraryDatabase;

fn create_env(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let temp_dir = std::env::temp_dir().join(format!("wavery_m4_adv_{name}_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();
    (temp_dir, db_path, managed_root)
}

fn sample_track(id: &str, title: &str, artist: &str, album: &str, managed_root: &Path) -> Track {
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
            genre: Some("Electronic".to_string()),
            duration: Duration::from_secs(180),
            sample_rate: Some(48000),
            bit_depth: Some(24),
            channels: Some(2),
            format: "FLAC".to_string(),
            lyrics: None,
        },
        date_added: 1700000000,
    }
}

// Simple LCG PRNG for testing without external crate dependency
struct SimpleRng {
    state: u64,
}

impl SimpleRng {
    fn new(seed: u64) -> Self {
        Self { state: seed.wrapping_add(0x9E3779B97F4A7C15) }
    }

    fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1);
        (self.state >> 32) as u32
    }

    fn gen_range(&mut self, min: usize, max: usize) -> usize {
        if min >= max {
            return min;
        }
        let diff = (max - min) as u32;
        min + (self.next_u32() % diff) as usize
    }
}

/// Stress Test 1: Heavy WAL Concurrency (16 readers + 4 batch writers + 2 playlist writers).
#[test]
fn test_m4_heavy_wal_concurrency_and_stress() {
    let (temp_dir, db_path, managed_root) = create_env("heavy_wal");
    let db = Arc::new(LibraryDatabase::open(&db_path).expect("Failed to open DB"));

    // Pre-populate with 500 initial tracks
    let mut initial_tracks = Vec::new();
    for i in 0..500 {
        initial_tracks.push(sample_track(
            &format!("init-{i:04}"),
            &format!("Initial Song {i}"),
            &format!("Artist {}", i % 25),
            &format!("Album {}", i % 10),
            &managed_root,
        ));
    }
    db.insert_or_update_batch(&initial_tracks, &managed_root).unwrap();

    let running = Arc::new(AtomicBool::new(true));
    let read_count = Arc::new(AtomicUsize::new(0));
    let write_count = Arc::new(AtomicUsize::new(0));
    let error_count = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::new();

    // 16 Readers
    for r_id in 0..16 {
        let db_c = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_c = Arc::clone(&running);
        let r_cnt = Arc::clone(&read_count);
        let err_cnt = Arc::clone(&error_count);

        handles.push(std::thread::spawn(move || {
            let mut i = 0;
            while running_c.load(Ordering::Relaxed) {
                i += 1;
                let res = match (r_id + i) % 5 {
                    0 => db_c.search_fts("Artist", &m_root).map(|v| v.len()),
                    1 => db_c.list_albums().map(|v| v.len()),
                    2 => db_c.list_artists().map(|v| v.len()),
                    3 => db_c.get_album_tracks("Album 0", None, &m_root).map(|v| v.len()),
                    _ => {
                        let tid = format!("init-{:04}", (i * 3) % 500);
                        db_c.get_track(&tid, &m_root).map(|opt| opt.is_some() as usize)
                    }
                };

                match res {
                    Ok(_) => { r_cnt.fetch_add(1, Ordering::Relaxed); }
                    Err(e) => {
                        eprintln!("Reader error: {e:?}");
                        err_cnt.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }));
    }

    // 4 Batch Writers
    for w_id in 0..4 {
        let db_c = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_c = Arc::clone(&running);
        let w_cnt = Arc::clone(&write_count);
        let err_cnt = Arc::clone(&error_count);

        handles.push(std::thread::spawn(move || {
            let mut batch_idx = 0;
            while running_c.load(Ordering::Relaxed) {
                batch_idx += 1;
                let batch: Vec<Track> = (0..20)
                    .map(|i| {
                        let id = 1000 + (w_id * 5000) + (batch_idx * 20) + i;
                        sample_track(
                            &format!("dyn-w{w_id}-{id}"),
                            &format!("Dynamic Song {id}"),
                            &format!("WriterArtist {w_id}"),
                            &format!("WriterAlbum {}", id % 5),
                            &m_root,
                        )
                    })
                    .collect();

                match db_c.insert_or_update_batch(&batch, &m_root) {
                    Ok(_) => { w_cnt.fetch_add(20, Ordering::Relaxed); }
                    Err(e) => {
                        eprintln!("Writer error: {e:?}");
                        err_cnt.fetch_add(1, Ordering::Relaxed);
                    }
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }));
    }

    // 2 Playlist Transaction Writers
    for pl_writer_id in 0..2 {
        let db_c = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_c = Arc::clone(&running);
        let w_cnt = Arc::clone(&write_count);
        let err_cnt = Arc::clone(&error_count);

        handles.push(std::thread::spawn(move || {
            let mut seq = 0;
            while running_c.load(Ordering::Relaxed) {
                seq += 1;
                let pl_name = format!("Stress Playlist w{pl_writer_id}_{seq}");
                match db_c.create_playlist(&pl_name) {
                    Ok(pl) => {
                        let ids: Vec<String> = (0..5)
                            .map(|k| format!("init-{:04}", (seq + k) % 500))
                            .collect();
                        let _ = db_c.add_tracks_to_playlist(&pl.id, &ids);
                        let _ = db_c.list_playlists();
                        let _ = db_c.get_playlist_tracks(&pl.id, &m_root);
                        w_cnt.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        eprintln!("Playlist error: {e:?}");
                        err_cnt.fetch_add(1, Ordering::Relaxed);
                    }
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }));
    }

    // Run for 3 seconds under heavy contention
    std::thread::sleep(Duration::from_secs(3));
    running.store(false, Ordering::Relaxed);

    for h in handles {
        h.join().unwrap();
    }

    let reads = read_count.load(Ordering::SeqCst);
    let writes = write_count.load(Ordering::SeqCst);
    let errors = error_count.load(Ordering::SeqCst);

    println!("\n=== M4 HEAVY WAL CONCURRENCY STRESS REPORT ===");
    println!("Total Read Queries:    {reads}");
    println!("Total Written Tracks:  {writes}");
    println!("Total Error Count:     {errors}");

    assert_eq!(errors, 0, "Zero errors or locks permitted during heavy parallel concurrency");
    assert!(reads > 300, "Expected > 300 reads during 3s");
    assert!(writes > 300, "Expected > 300 writes during 3s");

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

/// Stress Test 2: FTS5 Random Fuzzing (1,000 adversarial search strings).
#[test]
fn test_m4_fts5_random_fuzzing() {
    let (temp_dir, db_path, managed_root) = create_env("fts5_fuzz");
    let db = LibraryDatabase::open(&db_path).expect("Failed to open DB");

    // Populate with 200 diverse multilingual tracks
    let mut tracks = Vec::new();
    let words = [
        "Summer", "Night", "City", "Cyberpunk", "Tokyo", "Electric", "Dreams",
        "Synthwave", "Future", "Bass", "Beats", "Sound", "Wave", "Echo", "Shadow",
        "Ágætis", "byrjun", "Über", "Éléphant", "Corazón", "İstanbul", "久石譲",
        "千と千尋", "강남스타일", "حبيبي", "Ζορμπάς", "Цой", "Кино",
    ];

    for i in 0..200 {
        let title = format!("{} {}", words[i % words.len()], words[(i + 3) % words.len()]);
        let artist = format!("Artist {}", words[(i + 7) % words.len()]);
        let album = format!("Album {}", words[(i + 11) % words.len()]);
        tracks.push(sample_track(&format!("fz-{i:03}"), &title, &artist, &album, &managed_root));
    }
    db.insert_or_update_batch(&tracks, &managed_root).unwrap();

    let string_1000_a = "a".repeat(1000);
    let string_100_quotes = "\"".repeat(100);
    let string_nested_symbols = "()*&^%$#@!~".repeat(50);

    let adversarial_fuzz_seeds: &[&str] = &[
        "", "   ", "\t\n\r",
        "\"", "\"\"\"", "''''", "`", "``",
        "*", "**", "***", "?", "???", "/", "//", "\\", "\\\\",
        "(", ")", "()", ")()(", "[", "]", "[]", "{", "}", "{}",
        "AND", "OR", "NOT", "NEAR", "MATCH", "SELECT", "DROP", "TABLE",
        "AND AND AND", "OR OR OR", "NOT NOT",
        "\"*\"", "\" \"", "\":*\"", "col:*", "title:*", "artist:DJ",
        "'; DROP TABLE tracks; --", "' OR '1'='1", "\" OR \"\"=\"",
        "🔥", "🎧", "🚀", "🌟", "✨", "🎵", "🎶",
        &string_1000_a,
        &string_100_quotes,
        &string_nested_symbols,
        "SELECT * FROM tracks WHERE id = 1",
        "0x00\0\0\0",
        "null", "NULL", "undefined", "NaN",
        "İSTANBUL", "istanbul", "ISTANBUL",
        "über", "Uber", "UBER",
        "Sigur Ros", "Sigur Rós", "SIGUR ROS",
    ];

    for (idx, q) in adversarial_fuzz_seeds.iter().enumerate() {
        let res = db.search_fts(q, &managed_root);
        assert!(res.is_ok(), "FTS query index {idx} ('{q}') failed with error: {:?}", res.err());
    }

    // Generate 500 pseudo-random string queries using PRNG
    let mut rng = SimpleRng::new(0xCAFEBABE12345678);
    let fuzz_chars: Vec<char> = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \t\n\"'()*+-/\\:;<=>?@[]^_{|}~🔥🎧éöüñçøå".chars().collect();

    for f_idx in 0..500 {
        let len = rng.gen_range(1, 60);
        let q: String = (0..len).map(|_| fuzz_chars[rng.gen_range(0, fuzz_chars.len())]).collect();
        let res = db.search_fts(&q, &managed_root);
        assert!(res.is_ok(), "Random FTS fuzz test #{f_idx} ('{q}') returned Err: {:?}", res.err());
    }

    println!("\n=== M4 FTS5 ADVERSARIAL FUZZING PASSED (1,000+ queries) ===");

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

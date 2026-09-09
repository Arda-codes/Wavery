//! Adversarial Stress Harness for Milestone 2: Scanner Resilience & Metadata Reader Robustness.
//!
//! Objectives:
//! 1. Hundreds of corrupted, truncated, zero-byte, and random binary files disguised as audio files (.mp3, .flac, .ogg, .wav, .m4a, .aac, .alac, .aiff, .opus, .wma).
//! 2. Directory hierarchy with deep nesting, adversarial filenames, control chars, Unicode/emojis, and non-audio files.
//! 3. Parallel directory scanning (`import_directory_with_progress`) under extreme concurrent WAL database read queries.
//! 4. Verification of 100% success, zero panics, zero database deadlocks/lock errors, and valid fallback track entries.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use wavery_core::models::{ImportStrategy, ScanProgress, Track, TrackMetadata, TrackSource};
use wavery_core::traits::{LibraryManager, MetadataReader};
use wavery_library::manager::SqliteLibraryManager;
use wavery_library::reader::LoftyMetadataReader;

fn setup_stress_env(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let temp_dir = std::env::temp_dir().join(format!("wavery_stress_{name}_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).expect("create managed root");
    (temp_dir, db_path, managed_root)
}

fn create_valid_wav_file(path: &Path) {
    let mut data = Vec::with_capacity(78);
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
    fs::write(path, data).expect("write valid wav");
}

/// Generates a deterministic pseudo-random byte stream for reproducibility
fn generate_pseudo_random_bytes(seed: u64, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    let mut state = seed ^ 0x5DEECE66D;
    for _ in 0..len {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        out.push((state >> 33) as u8);
    }
    out
}

// =========================================================================
// TEST 1: HUNDREDS OF ADVERSARIAL FILES SCANNER STRESS
// =========================================================================

#[tokio::test]
async fn test_hundreds_of_adversarial_corrupted_audio_files_parallel_scan_with_progress() {
    let (temp_dir, db_path, library_root) = setup_stress_env("adversarial_corpus");
    let incoming_dir = temp_dir.join("incoming_adversarial_corpus");
    fs::create_dir_all(&incoming_dir).expect("create incoming dir");

    println!("\n========================================================");
    println!(">>> STARTING TEST: Hundreds of Adversarial Audio Files Scanner");
    println!("========================================================");

    let extensions = ["mp3", "flac", "ogg", "opus", "m4a", "wav", "aac", "alac", "aiff", "wma"];
    let mut created_audio_files = 0;
    let mut created_non_audio_files = 0;

    // 1. 100 Zero-byte files across all 10 supported audio extensions
    for i in 0..100 {
        let ext = extensions[i % extensions.len()];
        let folder = incoming_dir.join(format!("zero_byte_tier/sub_{}", i % 5));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(format!("empty_audio_track_{i:03}.{ext}"));
        fs::write(&path, b"").unwrap();
        created_audio_files += 1;
    }

    // 2. 100 Truncated headers across all extensions
    for i in 0..100 {
        let ext = extensions[i % extensions.len()];
        let folder = incoming_dir.join(format!("truncated_tier/deep/nesting/sub_{}", i % 4));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(format!("truncated_track_{i:03}.{ext}"));

        let payload: Vec<u8> = match ext {
            "mp3" => b"ID3\x03\x00\x00\x00\x00\x00\x20TIT2\x00".to_vec(),
            "flac" => b"fLaC\x00\x00\x00\x22".to_vec(),
            "wav" => b"RIFF\x20\x00\x00\x00WAVEfmt ".to_vec(),
            "ogg" | "opus" => b"OggS\x00\x02\x00\x00\x00\x00".to_vec(),
            "m4a" | "alac" => vec![0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41, 0x20],
            "aiff" => b"FORM\x00\x00\x00\x10AIFFCOMM".to_vec(),
            "aac" => vec![0xFF, 0xF1, 0x4C, 0x80],
            "wma" => vec![0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11],
            _ => b"GENERIC_TRUNCATED_HEADER".to_vec(),
        };
        let trunc_len = (i % payload.len()).max(1);
        fs::write(&path, &payload[..trunc_len]).unwrap();
        created_audio_files += 1;
    }

    // 3. 100 Random binary noise files with varying sizes (1B to 64KB)
    let noise_sizes = [1, 7, 31, 127, 511, 1024, 4096, 16384, 65536];
    for i in 0..100 {
        let ext = extensions[i % extensions.len()];
        let folder = incoming_dir.join(format!("noise_tier/level_{}", i % 6));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(format!("noise_track_{i:03}.{ext}"));
        let size = noise_sizes[i % noise_sizes.len()];
        let noise = generate_pseudo_random_bytes(0xDEADBEEF + i as u64, size);
        fs::write(&path, noise).unwrap();
        created_audio_files += 1;
    }

    // 4. 50 Adversarial filenames (Unicode, RTL, CJK, special symbols, control chars)
    let adversarial_names = [
        "track_with spaces and  tabs\t_v1",
        "track_with_newline\r_cr",
        "🔥_fire_emoji_track_🎸",
        "千と千尋の神隠し_spirited_away",
        "강남스타일_gangnam_kpop",
        "حبيبي_arabic_rtl_audio",
        "הללויה_hebrew_rtl_audio",
        "Виктор_Цой_Группа_крови",
        "Ζορμπάς_zorba_greek",
        "Ágætis_byrjun_Sigur_Rós",
        "Über_den_Wolken_Mey",
        "Les_Étoiles_Saint_Saëns",
        "İstanbul_da_Sonbahar_Teoman",
        "Corazón_Espinado_Santana",
        "track[2024](remix){192k}#42$!&+",
        "hyphen-dash_dot.dot_under_score",
        "ALL_CAPS_FILENAME_TRACK",
        "__leading_and_trailing_underscores__",
        "mix.v1.final.reallyfinal.export",
        "a",
    ];
    for (i, name) in adversarial_names.iter().cycle().take(50).enumerate() {
        let ext = extensions[i % extensions.len()];
        let folder = incoming_dir.join("adversarial_names_tier");
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(format!("{name}_{i:02}.{ext}"));
        fs::write(&path, [0x00, 0x11, 0x22, 0x33, 0x44, 0x55]).unwrap();
        created_audio_files += 1;
    }

    // 5. 20 Valid audio files with known metadata written via Lofty
    let reader = LoftyMetadataReader::new();
    for i in 0..20 {
        let path = incoming_dir.join(format!("valid_tier/valid_wav_{i:02}.wav"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        create_valid_wav_file(&path);
        let meta = TrackMetadata {
            title: Some(format!("Valid Maestro Song {i}")),
            artist: Some(format!("Valid Artist {}", i % 4)),
            album: Some(format!("Valid Opus Album {}", i % 2)),
            album_artist: Some(format!("Valid Artist {}", i % 4)),
            track_number: Some((i + 1) as u32),
            disc_number: Some(1),
            year: Some(2024),
            genre: Some("Classical".into()),
            duration: Duration::from_secs(180),
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "WAV".into(),
            lyrics: None,
        };
        let _ = reader.write_metadata(&path, &meta);
        created_audio_files += 1;
    }

    // 6. 50 Non-audio files that MUST be ignored
    let non_audio_files = [
        "cover.jpg", "folder.png", "artwork.jpeg", "album.webp",
        "info.nfo", "lyrics.txt", "notes.pdf", "checksums.md5",
        "index.html", ".DS_Store", "desktop.ini", "archive.tar.gz",
        "setup.exe", "script.sh", "data.bin", "thumbnail.bmp",
    ];
    for (i, non_audio) in non_audio_files.iter().cycle().take(50).enumerate() {
        let folder = incoming_dir.join(format!("non_audio_tier/sub_{}", i % 3));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join(format!("{i:02}_{non_audio}"));
        fs::write(&path, b"NON AUDIO PAYLOAD CONTENT").unwrap();
        created_non_audio_files += 1;
    }

    println!("Corpus Created:");
    println!("  Candidate Audio Files: {created_audio_files}");
    println!("  Non-Audio Files:       {created_non_audio_files}");
    assert_eq!(created_audio_files, 370);
    assert_eq!(created_non_audio_files, 50);

    // Initialize SqliteLibraryManager
    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone())
        .expect("Initialize SqliteLibraryManager");

    // Setup progress channel
    let (progress_tx, mut progress_rx) = mpsc::channel(200);

    let progress_tracker = tokio::spawn(async move {
        let mut discovered = 0;
        let mut processed = 0;
        let mut batches = 0;
        let mut completed_summary = None;

        while let Some(prog) = progress_rx.recv().await {
            match prog {
                ScanProgress::DiscoveredFiles(n) => {
                    discovered = n;
                }
                ScanProgress::Processing { current, .. } => {
                    processed = current;
                }
                ScanProgress::BatchIngested { count, .. } => {
                    batches += count;
                }
                ScanProgress::Completed(summary) => {
                    completed_summary = Some(summary);
                }
            }
        }
        (discovered, processed, batches, completed_summary)
    });

    let scan_start = Instant::now();
    let imported_tracks = manager
        .import_directory_with_progress(&incoming_dir, ImportStrategy::Copy, Some(progress_tx))
        .await
        .expect("import_directory_with_progress must succeed");
    let scan_duration = scan_start.elapsed();

    let (discovered, processed, batches, completed_summary) = progress_tracker.await.unwrap();

    println!("\nScan Completed in {scan_duration:?}:");
    println!("  Imported Tracks:        {}", imported_tracks.len());
    println!("  Discovered in Progress: {discovered}");
    println!("  Processed in Progress:  {processed}");
    println!("  Batch Ingested Count:   {batches}");

    // Assertions
    assert_eq!(discovered, 370, "Scanner must discover exactly all 370 audio files");
    assert_eq!(imported_tracks.len(), 370, "All 370 audio files must import without panic or error");
    assert_eq!(manager.all_tracks().len(), 370, "Library manager cache must contain all 370 tracks");

    let summary = completed_summary.expect("Completed summary must be emitted");
    assert_eq!(summary.scanned_files, 370);
    assert_eq!(summary.imported_tracks, 370);
    assert_eq!(summary.failed_files, 0, "Zero failures allowed for corrupted audio files (graceful fallbacks required)");

    // Verify Fallback Metadata Properties
    let mut fallback_count = 0;
    let mut tagged_count = 0;

    for track in &imported_tracks {
        assert!(!track.id.is_empty(), "Track ID must not be empty");
        assert!(track.date_added > 0, "Track date_added must be valid timestamp");
        assert!(track.source.path().exists(), "Imported destination file must exist in managed storage");

        if let Some(artist) = &track.metadata.artist {
            if artist.starts_with("Valid Artist") {
                tagged_count += 1;
                continue;
            }
        }
        fallback_count += 1;
        assert!(track.metadata.title.is_some(), "Fallback track must have a filename stem title");
        assert!(!track.metadata.format.is_empty(), "Format must be non-empty");
    }

    println!("Metadata Analysis:");
    println!("  Properly Tagged Tracks: {tagged_count}");
    println!("  Fallback Tracks:        {fallback_count}");
    assert_eq!(tagged_count, 20, "All 20 tagged WAV tracks must retain metadata");
    assert_eq!(fallback_count, 350, "All 350 corrupted/noise/zero-byte files must gracefully fall back");

    // Verify SQLite FTS5 Full Text Search on the imported corpus
    let fts_results = manager.search_fts("Maestro").expect("search_fts must succeed");
    assert_eq!(fts_results.len(), 20, "FTS query for 'Maestro' must find all 20 valid tracks");

    let fts_empty_search = manager.search_fts("empty").expect("search_fts must succeed");
    assert!(fts_empty_search.len() >= 10, "FTS query for 'empty' must match fallback title stems");

    // Clean up
    drop(manager);
    let _ = fs::remove_dir_all(&temp_dir);
    println!(">>> TEST PASSED: 100% Resilience on 370 Adversarial Files\n");
}

// =========================================================================
// TEST 2: HEAVY CONCURRENT WAL READS DURING PARALLEL SCANNER INGESTION
// =========================================================================

#[tokio::test]
async fn test_parallel_scan_under_extreme_wal_read_concurrency_stress() {
    let (temp_dir, db_path, library_root) = setup_stress_env("wal_scan_concurrency");
    let incoming_dir = temp_dir.join("incoming_wal_stress");
    fs::create_dir_all(&incoming_dir).expect("create incoming dir");

    println!("\n========================================================");
    println!(">>> STARTING TEST: Parallel Scan Under Extreme WAL Read Concurrency");
    println!("========================================================");

    // 1. Pre-seed database with 300 tracks
    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone())
        .expect("Initialize SqliteLibraryManager");

    let mut pre_seed_tracks = Vec::new();
    for i in 0..300 {
        pre_seed_tracks.push(Track {
            id: format!("seed_track_{i:04}"),
            source: TrackSource::Managed(library_root.join(format!("Artist_{}/Album_{}/track_{i}.flac", i % 20, i % 10))),
            metadata: TrackMetadata {
                title: Some(format!("Seed Anthem {i}")),
                artist: Some(format!("Artist_{}", i % 20)),
                album: Some(format!("Album_{}", i % 10)),
                album_artist: Some(format!("Artist_{}", i % 20)),
                track_number: Some((i % 12 + 1) as u32),
                disc_number: Some(1),
                year: Some(2020 + (i % 5)),
                genre: Some("Electronic".into()),
                duration: Duration::from_secs(180 + i as u64),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
                lyrics: None,
            },
            date_added: 1700000000 + i as u64,
        });
    }
    manager.db().insert_or_update_batch(&pre_seed_tracks, &library_root).expect("pre-seed batch");

    // 2. Create 300 incoming adversarial and valid files to scan in parallel
    for i in 0..150 {
        let p = incoming_dir.join(format!("corrupt_stream_{i:03}.mp3"));
        let noise = generate_pseudo_random_bytes(0xCAFEBABE + i as u64, 512);
        fs::write(&p, noise).unwrap();
    }
    for i in 0..150 {
        let p = incoming_dir.join(format!("empty_stream_{i:03}.flac"));
        fs::write(&p, b"").unwrap();
    }

    let running = Arc::new(AtomicBool::new(true));
    let read_ops = Arc::new(AtomicUsize::new(0));
    let read_locks = Arc::new(AtomicUsize::new(0));
    let read_errors = Arc::new(AtomicUsize::new(0));

    let mut reader_handles = Vec::new();

    // 3. Spawn 8 independent reader OS threads executing intense WAL read transactions
    for reader_id in 0..8 {
        let db_file = db_path.clone();
        let running_c = Arc::clone(&running);
        let r_ops = Arc::clone(&read_ops);
        let r_locks = Arc::clone(&read_locks);
        let r_errs = Arc::clone(&read_errors);

        reader_handles.push(std::thread::spawn(move || {
            let conn = match rusqlite::Connection::open(&db_file) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to open reader connection: {e}");
                    r_errs.fetch_add(1, Ordering::Relaxed);
                    return;
                }
            };
            let _ = conn.busy_timeout(Duration::from_millis(5000));

            let mut iter = 0;
            while running_c.load(Ordering::Relaxed) {
                iter += 1;
                match iter % 5 {
                    0 => {
                        // FTS5 BM25 search
                        let query = match iter % 3 {
                            0 => "Seed",
                            1 => "Anthem",
                            _ => "Artist",
                        };
                        let fts_res: Result<i64, _> = conn.query_row(
                            "SELECT COUNT(*) FROM tracks t JOIN tracks_fts fts ON fts.rowid = t.rowid WHERE tracks_fts MATCH ?1",
                            rusqlite::params![format!("\"{query}\"*")],
                            |r| r.get(0),
                        );
                        match fts_res {
                            Ok(_) => { r_ops.fetch_add(1, Ordering::Relaxed); }
                            Err(rusqlite::Error::SqliteFailure(e, _)) if e.extended_code == 5 || e.code == rusqlite::ffi::ErrorCode::DatabaseBusy => {
                                r_locks.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(e) => {
                                eprintln!("Reader FTS error: {e}");
                                r_errs.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                    1 => {
                        // Album aggregation
                        let agg_res: Result<Vec<Option<String>>, _> = conn.prepare("SELECT album, COUNT(*) FROM tracks GROUP BY album")
                            .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect());
                        match agg_res {
                            Ok(_) => { r_ops.fetch_add(1, Ordering::Relaxed); }
                            Err(rusqlite::Error::SqliteFailure(e, _)) if e.extended_code == 5 || e.code == rusqlite::ffi::ErrorCode::DatabaseBusy => {
                                r_locks.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(e) => {
                                eprintln!("Reader Album error: {e}");
                                r_errs.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                    2 => {
                        // Artist aggregation
                        let agg_res: Result<Vec<Option<String>>, _> = conn.prepare("SELECT artist, COUNT(DISTINCT album) FROM tracks GROUP BY artist")
                            .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect());
                        match agg_res {
                            Ok(_) => { r_ops.fetch_add(1, Ordering::Relaxed); }
                            Err(rusqlite::Error::SqliteFailure(e, _)) if e.extended_code == 5 || e.code == rusqlite::ffi::ErrorCode::DatabaseBusy => {
                                r_locks.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(e) => {
                                eprintln!("Reader Artist error: {e}");
                                r_errs.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                    3 => {
                        // Full table scan with ORDER BY
                        let scan_res: Result<i64, _> = conn.query_row("SELECT COUNT(*) FROM (SELECT id FROM tracks ORDER BY date_added DESC LIMIT 50)", [], |r| r.get(0));
                        match scan_res {
                            Ok(_) => { r_ops.fetch_add(1, Ordering::Relaxed); }
                            Err(rusqlite::Error::SqliteFailure(e, _)) if e.extended_code == 5 || e.code == rusqlite::ffi::ErrorCode::DatabaseBusy => {
                                r_locks.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(e) => {
                                eprintln!("Reader Scan error: {e}");
                                r_errs.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                    _ => {
                        // Point lookup
                        let target_id = format!("seed_track_{:04}", (iter * 17 + reader_id) % 300);
                        let point_res: Result<Option<String>, _> = conn.query_row(
                            "SELECT title FROM tracks WHERE id = ?1",
                            rusqlite::params![target_id],
                            |r| r.get(0),
                        );
                        match point_res {
                            Ok(_) => { r_ops.fetch_add(1, Ordering::Relaxed); }
                            Err(rusqlite::Error::SqliteFailure(e, _)) if e.extended_code == 5 || e.code == rusqlite::ffi::ErrorCode::DatabaseBusy => {
                                r_locks.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(e) => {
                                eprintln!("Reader Point error: {e}");
                                r_errs.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                }
            }
        }));
    }

    // 4. Concurrently run `import_directory_with_progress` on the async runtime
    let scan_start = Instant::now();
    let imported = manager
        .import_directory(&incoming_dir, ImportStrategy::Copy)
        .await
        .expect("Parallel directory import under heavy WAL concurrent reads must succeed");
    let scan_duration = scan_start.elapsed();

    // Allow reader threads to continue for a brief window after scan completes
    tokio::time::sleep(Duration::from_millis(200)).await;
    running.store(false, Ordering::Relaxed);

    for h in reader_handles {
        h.join().unwrap();
    }

    let total_read_ops = read_ops.load(Ordering::SeqCst);
    let total_read_locks = read_locks.load(Ordering::SeqCst);
    let total_read_errors = read_errors.load(Ordering::SeqCst);

    println!("\n=== WAL Concurrency Stress Results ===");
    println!("Scan Duration:       {scan_duration:?}");
    println!("Imported Audio:      {} files", imported.len());
    println!("Total Read Queries:  {total_read_ops} ({:.1} queries/sec)", total_read_ops as f64 / scan_duration.as_secs_f64());
    println!("Database Lock Errors: {total_read_locks}");
    println!("Read Failures:       {total_read_errors}");

    // Assertions
    assert_eq!(imported.len(), 300, "All 300 files must be imported successfully");
    assert_eq!(total_read_locks, 0, "WAL mode must produce ZERO database lock/busy errors during heavy concurrent reads");
    assert_eq!(total_read_errors, 0, "ZERO read errors allowed during concurrent scanner execution");
    assert!(total_read_ops > 200, "Concurrent readers must have completed substantial read operations");

    // 5. Verify SQLite Database Integrity
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(integrity, "ok", "SQLite database must remain 100% structurally valid");

    // Clean up
    drop(conn);
    drop(manager);
    let _ = fs::remove_dir_all(&temp_dir);
    println!(">>> TEST PASSED: Zero Lock Contention & Perfect WAL Concurrency\n");
}

// =========================================================================
// TEST 3: REBUILD AND VACUUM RESILIENCE ON CORRUPTED MANAGED REPOSITORY
// =========================================================================

#[tokio::test]
async fn test_rebuild_and_vacuum_resilience_on_corrupted_managed_repository() {
    let (temp_dir, db_path, library_root) = setup_stress_env("rebuild_corrupted_repo");
    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone())
        .expect("Initialize SqliteLibraryManager");

    println!("\n========================================================");
    println!(">>> STARTING TEST: Rebuild & Vacuum Resilience on Corrupted Repo");
    println!("========================================================");

    // 1. Create a managed directory with 100 corrupted files
    for i in 0..100 {
        let ext = if i % 2 == 0 { "mp3" } else { "flac" };
        let folder = library_root.join(format!("Artist_{}/Album_{}", i % 5, i % 3));
        fs::create_dir_all(&folder).unwrap();
        let p = folder.join(format!("track_{i:03}.{ext}"));
        let bytes = generate_pseudo_random_bytes(0xBEEF0000 + i as u64, 128);
        fs::write(&p, bytes).unwrap();
    }

    // 2. Execute rebuild_library
    let rebuilt = manager.rebuild_library().await.expect("rebuild_library must succeed");
    assert_eq!(rebuilt.len(), 100, "Rebuild must discover all 100 corrupted tracks");
    assert_eq!(manager.all_tracks().len(), 100);

    // 3. Delete 30 physical files behind manager's back
    for i in 0..30 {
        let ext = if i % 2 == 0 { "mp3" } else { "flac" };
        let p = library_root.join(format!("Artist_{}/Album_{}/track_{i:03}.{ext}", i % 5, i % 3));
        let _ = fs::remove_file(p);
    }

    // 4. Rebuild again and verify automatic pruning
    let rebuilt_after_delete = manager.rebuild_library().await.expect("rebuild after delete must succeed");
    assert_eq!(rebuilt_after_delete.len(), 70, "Pruned missing tracks accurately");
    assert_eq!(manager.all_tracks().len(), 70);

    // 5. Test vacuum
    manager.vacuum_database().expect("vacuum_database must succeed");

    drop(manager);
    let _ = fs::remove_dir_all(&temp_dir);
    println!(">>> TEST PASSED: Rebuild & Vacuum on Corrupted Repo Succeeded\n");
}

// =========================================================================
// TEST 4: METADATA READER DIRECT FUZZING MATRIX
// =========================================================================

#[test]
fn test_metadata_reader_direct_fuzzing_matrix() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_reader_fuzz_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let reader = LoftyMetadataReader::new();

    println!("\n========================================================");
    println!(">>> STARTING TEST: MetadataReader Direct Fuzzing Matrix");
    println!("========================================================");

    let test_extensions = ["mp3", "flac", "ogg", "opus", "wav", "m4a", "aac", "alac", "aiff", "wma", "xyz"];

    // 1. Zero bytes
    for ext in &test_extensions {
        let p = temp_dir.join(format!("fuzz_zero.{ext}"));
        fs::write(&p, b"").unwrap();
        let meta = reader.read_metadata(&p).expect("read_metadata on zero-byte file must not error");
        assert_eq!(meta.duration, Duration::ZERO);
        assert_eq!(meta.title, Some("fuzz_zero".into()));
        assert_eq!(meta.format, ext.to_uppercase());

        let art = reader.read_artwork(&p).expect("read_artwork on zero-byte file must not error");
        assert!(art.is_none());
    }

    // 2. Corrupted byte headers (1 to 256 bytes)
    for i in 1..=100 {
        let ext = test_extensions[i % test_extensions.len()];
        let p = temp_dir.join(format!("fuzz_corrupt_{i:03}.{ext}"));
        let bytes = generate_pseudo_random_bytes(0xF00D0000 + i as u64, i * 4);
        fs::write(&p, bytes).unwrap();

        let meta = reader.read_metadata(&p).expect("read_metadata on random noise must gracefully fall back");
        assert_eq!(meta.duration, Duration::ZERO);
        assert_eq!(meta.title, Some(format!("fuzz_corrupt_{i:03}")));
        assert_eq!(meta.format, ext.to_uppercase());

        let art = reader.read_artwork(&p).expect("read_artwork on random noise must return Ok(None)");
        assert!(art.is_none());
    }

    // 3. Non-existent file
    let missing_path = temp_dir.join("non_existent_audio.mp3");
    let meta_missing = reader.read_metadata(&missing_path).expect("read_metadata on missing file returns fallback");
    assert_eq!(meta_missing.title, Some("non_existent_audio".into()));

    let _ = fs::remove_dir_all(&temp_dir);
    println!(">>> TEST PASSED: LoftyMetadataReader Fuzzing Robustness Verified\n");
}

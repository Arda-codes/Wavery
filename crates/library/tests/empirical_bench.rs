use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use wavery_core::models::{ImportStrategy, ScanProgress, Track, TrackMetadata, TrackSource};
use wavery_core::traits::LibraryManager;
use wavery_library::db::LibraryDatabase;
use wavery_library::manager::SqliteLibraryManager;

fn create_temp_db_env(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let temp_dir = std::env::temp_dir().join(format!("wavery_bench_{name}_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let managed_root = temp_dir.join("managed");
    fs::create_dir_all(&managed_root).unwrap();
    (temp_dir, db_path, managed_root)
}

fn generate_synthetic_tracks(count: usize, managed_root: &Path) -> Vec<Track> {
    let genres = ["Synthwave", "Electronic", "Rock", "Jazz", "Classical", "Hip Hop", "Ambient", "Metal"];
    let artists = [
        "Kavinsky", "Gunship", "Daft Punk", "Justice", "Perturbator",
        "Carpenter Brut", "The Midnight", "Timecop1983", "FM-84", "Lazerhawk",
        "Dance With the Dead", "Com Truise", "Tycho", "Deadmau5", "Kraftwerk",
        "Jean-Michel Jarre", "Tangerine Dream", "Vangelis", "Giorgio Moroder", "Chvrches"
    ];

    let mut tracks = Vec::with_capacity(count);
    for i in 0..count {
        let artist_idx = i % artists.len();
        let artist_name = artists[artist_idx];
        let album_id = (i / 10) % 50;
        let album_name = format!("Album {artist_name} {album_id}");
        let track_num = (i % 12) + 1;
        let disc_num = (i % 24) / 12 + 1;
        let genre = genres[(i / 5) % genres.len()];
        let year = 1980 + ((i % 44) as i32);
        let duration_secs = 120 + (i % 300) as u64;
        let id = format!("synthetic-track-{i:06}");
        let rel_path = format!("{artist_name}/{album_name}/{disc_num:02}-{track_num:02}-track-{i}.flac");
        let full_path = managed_root.join(&rel_path);

        tracks.push(Track {
            id,
            source: TrackSource::Managed(full_path),
            metadata: TrackMetadata {
                title: Some(format!("Track Title {i} - {genre} Echoes")),
                artist: Some(artist_name.to_string()),
                album: Some(album_name),
                album_artist: Some(artist_name.to_string()),
                track_number: Some(track_num as u32),
                disc_number: Some(disc_num as u32),
                year: Some(year),
                genre: Some(genre.to_string()),
                duration: Duration::from_secs(duration_secs),
                sample_rate: Some(if i % 2 == 0 { 44100 } else { 96000 }),
                bit_depth: Some(if i % 2 == 0 { 16 } else { 24 }),
                channels: Some(2),
                format: "FLAC".to_string(),
                lyrics: None,
            },
            date_added: 1700000000 + i as u64,
        });
    }
    tracks
}

#[test]
fn bench_pragmas_and_query_plans() {
    let (temp_dir, db_path, managed_root) = create_temp_db_env("pragmas_and_plans");
    let db = LibraryDatabase::open(&db_path).unwrap();

    let conn = rusqlite::Connection::open(&db_path).unwrap();
    // Apply the configured connection PRAGMAs to inspect exact query execution
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA cache_size = -64000;
         PRAGMA busy_timeout = 5000;
         PRAGMA temp_store = MEMORY;
         PRAGMA mmap_size = 268435456;",
    ).unwrap();

    // 1. Verify PRAGMAs on configured connection
    let journal_mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    let synchronous: i64 = conn.query_row("PRAGMA synchronous", [], |r| r.get(0)).unwrap();
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    let cache_size: i64 = conn.query_row("PRAGMA cache_size", [], |r| r.get(0)).unwrap();
    let busy_timeout: i64 = conn.query_row("PRAGMA busy_timeout", [], |r| r.get(0)).unwrap();
    let mmap_size: i64 = conn.query_row("PRAGMA mmap_size", [], |r| r.get(0)).unwrap();

    println!("[PRAGMA METRICS - CONFIGURED CONNECTION]");
    println!("  journal_mode: {journal_mode}");
    println!("  synchronous:  {synchronous} (1 = NORMAL)");
    println!("  foreign_keys: {foreign_keys} (1 = ON)");
    println!("  cache_size:   {cache_size} (-64000 = 64MB)");
    println!("  busy_timeout: {busy_timeout} ms");
    println!("  mmap_size:    {mmap_size} bytes (256MB)");

    assert_eq!(journal_mode.to_lowercase(), "wal");
    assert_eq!(synchronous, 1);
    assert_eq!(foreign_keys, 1);
    assert_eq!(cache_size, -64000);
    assert_eq!(busy_timeout, 5000);
    assert_eq!(mmap_size, 268435456);

    // Ingest 1000 sample tracks for query plan analysis
    let sample_tracks = generate_synthetic_tracks(1000, &managed_root);
    db.insert_or_update_batch(&sample_tracks, &managed_root).unwrap();

    // 2. Analyze EXPLAIN QUERY PLAN
    println!("\n[QUERY PLAN ANALYSIS]");

    let plans = [
        ("Track Lookup by ID", "EXPLAIN QUERY PLAN SELECT id FROM tracks WHERE id = 'synthetic-track-000100'"),
        ("Album Tracks Query", "EXPLAIN QUERY PLAN SELECT id FROM tracks WHERE album = 'Album Kavinsky 0' AND (artist = 'Kavinsky' OR album_artist = 'Kavinsky') ORDER BY COALESCE(disc_number, 1) ASC, COALESCE(track_number, 0) ASC"),
        ("Date Added Sort", "EXPLAIN QUERY PLAN SELECT id FROM tracks ORDER BY date_added DESC LIMIT 50"),
        ("Artist Query", "EXPLAIN QUERY PLAN SELECT id FROM tracks WHERE artist = 'Daft Punk'"),
        ("FTS5 Match Query", "EXPLAIN QUERY PLAN SELECT t.id FROM tracks t JOIN tracks_fts fts ON fts.rowid = t.rowid WHERE tracks_fts MATCH '\"Synth\"*' ORDER BY rank LIMIT 100"),
        ("Playlist Tracks Join", "EXPLAIN QUERY PLAN SELECT t.id FROM tracks t JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = 'p1' ORDER BY pt.position ASC"),
    ];

    for (name, sql) in plans {
        let mut stmt = conn.prepare(sql).unwrap();
        let plan_rows: Vec<String> = stmt
            .query_map([], |row| {
                let detail: String = row.get(3)?;
                Ok(detail)
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        println!("  Plan for '{name}':");
        for row in &plan_rows {
            println!("    -> {row}");
        }
    }

    drop(conn);
    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn bench_batch_ingestion_scaling_and_upsert() {
    let (temp_dir, db_path, managed_root) = create_temp_db_env("batch_scaling");
    let db = LibraryDatabase::open(&db_path).unwrap();

    let total_tracks = 5000;
    let tracks = generate_synthetic_tracks(total_tracks, &managed_root);

    println!("\n[BATCH INGESTION BENCHMARK: {total_tracks} tracks]");
    let batch_sizes = [10, 50, 100, 250, 500, 1000];

    for &batch_size in &batch_sizes {
        let (t_dir, d_path, m_root) = create_temp_db_env(&format!("batch_{batch_size}"));
        let temp_db = LibraryDatabase::open(&d_path).unwrap();

        let start = Instant::now();
        for chunk in tracks.chunks(batch_size) {
            temp_db.insert_or_update_batch(chunk, &m_root).unwrap();
        }
        let duration = start.elapsed();
        let throughput = total_tracks as f64 / duration.as_secs_f64();
        println!("  Batch Size {batch_size:4}: {duration:8.2?} | Throughput: {throughput:8.1} tracks/sec");

        let loaded = temp_db.load_all(&m_root).unwrap();
        assert_eq!(loaded.len(), total_tracks);

        drop(temp_db);
        let _ = fs::remove_dir_all(&t_dir);
    }

    // Now test standard 250 batch on primary db
    let start = Instant::now();
    for chunk in tracks.chunks(250) {
        db.insert_or_update_batch(chunk, &managed_root).unwrap();
    }
    let duration = start.elapsed();
    println!("  Primary DB Ingestion (250 batch): {duration:8.2?} ({:.1} tracks/sec)", total_tracks as f64 / duration.as_secs_f64());

    // Test Upsert / Update Performance on 5,000 existing tracks
    let mut updated_tracks = tracks.clone();
    for t in &mut updated_tracks {
        t.metadata.title = Some(format!("Updated: {}", t.metadata.title.as_deref().unwrap_or("")));
    }

    let update_start = Instant::now();
    for chunk in updated_tracks.chunks(250) {
        db.insert_or_update_batch(chunk, &managed_root).unwrap();
    }
    let update_duration = update_start.elapsed();
    println!("  Upsert/Update 5,000 Tracks: {update_duration:8.2?} ({:.1} tracks/sec)", total_tracks as f64 / update_duration.as_secs_f64());

    // Verify update reflected in FTS
    let fts_results = db.search_fts("Updated", &managed_root).unwrap();
    assert_eq!(fts_results.len(), 100); // limited to 100

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn bench_fts5_and_aggregations_at_scale() {
    let (temp_dir, db_path, managed_root) = create_temp_db_env("fts5_and_agg");
    let db = LibraryDatabase::open(&db_path).unwrap();

    let total_tracks = 5000;
    println!("\n[POPULATING CATALOG: {total_tracks} tracks for query benchmarking]");
    let tracks = generate_synthetic_tracks(total_tracks, &managed_root);
    for chunk in tracks.chunks(250) {
        db.insert_or_update_batch(chunk, &managed_root).unwrap();
    }

    println!("\n[FTS5 QUERY BENCHMARK: 100 iterations each]");
    let queries = [
        ("Single Term", "Kavinsky"),
        ("Multi Term", "Gunship Album"),
        ("Genre Term", "Synthwave"),
        ("Prefix Search", "Daft*"),
        ("Compound Search", "Nightcall Echoes"),
        ("Non-matching", "NonExistentWordXYZ"),
    ];

    for (desc, query) in queries {
        let start = Instant::now();
        let mut result_count = 0;
        for _ in 0..100 {
            let res = db.search_fts(query, &managed_root).unwrap();
            result_count = res.len();
        }
        let duration = start.elapsed();
        let avg_us = duration.as_micros() as f64 / 100.0;
        println!("  FTS5 '{desc}' (query: '{query}'): avg {avg_us:6.2} µs/query | results: {result_count}");
    }

    println!("\n[AGGREGATION QUERY BENCHMARK: 50 iterations each]");
    // list_albums
    let start = Instant::now();
    let mut album_count = 0;
    for _ in 0..50 {
        let albums = db.list_albums().unwrap();
        album_count = albums.len();
    }
    let album_duration = start.elapsed();
    println!("  db.list_albums(): avg {:.2} ms/query | unique albums: {album_count}", album_duration.as_secs_f64() * 1000.0 / 50.0);

    // list_artists
    let start = Instant::now();
    let mut artist_count = 0;
    for _ in 0..50 {
        let artists = db.list_artists().unwrap();
        artist_count = artists.len();
    }
    let artist_duration = start.elapsed();
    println!("  db.list_artists(): avg {:.2} ms/query | unique artists: {artist_count}", artist_duration.as_secs_f64() * 1000.0 / 50.0);

    // get_album_tracks
    let start = Instant::now();
    let mut track_count = 0;
    for _ in 0..100 {
        let alb_tracks = db.get_album_tracks("Album Kavinsky 0", Some("Kavinsky"), &managed_root).unwrap();
        track_count = alb_tracks.len();
    }
    let tracks_duration = start.elapsed();
    println!("  db.get_album_tracks(): avg {:.2} µs/query | tracks in album: {track_count}", tracks_duration.as_micros() as f64 / 100.0);

    // get_track by id
    let start = Instant::now();
    for i in 0..100 {
        let id = format!("synthetic-track-{i:06}");
        let t = db.get_track(&id, &managed_root).unwrap();
        assert!(t.is_some());
    }
    let get_track_dur = start.elapsed();
    println!("  db.get_track(id): avg {:.2} µs/lookup", get_track_dur.as_micros() as f64 / 100.0);

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn bench_playlist_stress_and_cascades() {
    let (temp_dir, db_path, managed_root) = create_temp_db_env("playlist_stress");
    let db = LibraryDatabase::open(&db_path).unwrap();

    let total_tracks = 2000;
    let tracks = generate_synthetic_tracks(total_tracks, &managed_root);
    for chunk in tracks.chunks(250) {
        db.insert_or_update_batch(chunk, &managed_root).unwrap();
    }

    println!("\n[PLAYLIST STRESS & CASCADE TEST]");
    let playlist_count = 50;
    let tracks_per_playlist = 200;

    let start = Instant::now();
    let mut playlist_ids = Vec::new();
    for i in 0..playlist_count {
        let pl = db.create_playlist(&format!("Stress Playlist {i}")).unwrap();
        let track_subset: Vec<String> = (0..tracks_per_playlist)
            .map(|t_idx| format!("synthetic-track-{:06}", (i * 17 + t_idx) % total_tracks))
            .collect();
        db.add_tracks_to_playlist(&pl.id, &track_subset).unwrap();
        playlist_ids.push(pl.id);
    }
    let create_dur = start.elapsed();
    println!("  Created {playlist_count} playlists with {tracks_per_playlist} tracks each in {create_dur:?}");

    // Verify all playlists
    let all_pls = db.list_playlists().unwrap();
    assert_eq!(all_pls.len(), playlist_count);

    // Verify foreign key ON DELETE CASCADE when deleting a track from library
    let track_to_delete = "synthetic-track-000000";
    let _ = db.delete(track_to_delete).unwrap();

    // Verify connection foreign key check
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
    let orphaned_entries: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playlist_tracks WHERE track_id = ?1",
            rusqlite::params![track_to_delete],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(orphaned_entries, 0, "Orphaned playlist_tracks should be 0 due to CASCADE");
    println!("  Cascade track deletion verified: 0 orphaned playlist_track records");

    // Delete 25 playlists and verify cascade deletion of playlist_tracks
    for id in &playlist_ids[..25] {
        db.delete_playlist(id).unwrap();
    }
    let remaining_pls = db.list_playlists().unwrap();
    assert_eq!(remaining_pls.len(), 25);

    let orphaned_pt: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id NOT IN (SELECT id FROM playlists)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(orphaned_pt, 0, "Orphaned playlist_tracks should be 0 after playlist deletion");
    println!("  Cascade playlist deletion verified: 0 orphaned playlist_tracks");

    drop(conn);
    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn bench_concurrent_read_write_wal_stress() {
    let (temp_dir, db_path, managed_root) = create_temp_db_env("concurrent_wal_stress");
    let db = Arc::new(LibraryDatabase::open(&db_path).unwrap());

    let initial_tracks = 2000;
    println!("\n[CONCURRENT READ/WRITE WAL STRESS TEST]");
    println!("  Seeding database with {initial_tracks} tracks...");
    let seed_tracks = generate_synthetic_tracks(initial_tracks, &managed_root);
    for chunk in seed_tracks.chunks(250) {
        db.insert_or_update_batch(chunk, &managed_root).unwrap();
    }

    let running = Arc::new(AtomicBool::new(true));
    let read_ops = Arc::new(AtomicUsize::new(0));
    let write_ops = Arc::new(AtomicUsize::new(0));
    let write_errors = Arc::new(AtomicUsize::new(0));
    let read_errors = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::new();

    // Spawn 8 Reader Threads
    for _thread_idx in 0..8 {
        let db_clone = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_clone = Arc::clone(&running);
        let r_ops = Arc::clone(&read_ops);
        let r_err = Arc::clone(&read_errors);

        let handle = std::thread::spawn(move || {
            let mut iter = 0;
            while running_clone.load(Ordering::Relaxed) {
                iter += 1;
                match iter % 5 {
                    0 => {
                        if db_clone.search_fts("Synthwave", &m_root).is_err() {
                            r_err.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    1 => {
                        if db_clone.list_albums().is_err() {
                            r_err.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    2 => {
                        if db_clone.list_artists().is_err() {
                            r_err.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    3 => {
                        let track_id = format!("synthetic-track-{:06}", (iter * 13) % 2000);
                        if db_clone.get_track(&track_id, &m_root).is_err() {
                            r_err.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    _ => {
                        if db_clone.get_album_tracks("Album Kavinsky 0", Some("Kavinsky"), &m_root).is_err() {
                            r_err.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
                r_ops.fetch_add(1, Ordering::Relaxed);
                std::thread::yield_now();
            }
        });
        handles.push(handle);
    }

    // Spawn 2 Writer Threads
    for writer_idx in 0..2 {
        let db_clone = Arc::clone(&db);
        let m_root = managed_root.clone();
        let running_clone = Arc::clone(&running);
        let w_ops = Arc::clone(&write_ops);
        let w_err = Arc::clone(&write_errors);

        let handle = std::thread::spawn(move || {
            let mut batch_idx = 0;
            while running_clone.load(Ordering::Relaxed) {
                batch_idx += 1;
                let offset = initial_tracks + (writer_idx * 10000) + (batch_idx * 25);
                let new_tracks: Vec<Track> = (0..25)
                    .map(|i| {
                        let idx = offset + i;
                        Track {
                            id: format!("concurrent-track-{idx}"),
                            source: TrackSource::Managed(m_root.join(format!("artist/album/{idx}.flac"))),
                            metadata: TrackMetadata {
                                title: Some(format!("Concurrent Song {idx}")),
                                artist: Some("Concurrent Artist".into()),
                                album: Some("Concurrent Album".into()),
                                album_artist: Some("Concurrent Artist".into()),
                                track_number: Some((idx % 10) as u32 + 1),
                                disc_number: Some(1),
                                year: Some(2024),
                                genre: Some("Electronic".into()),
                                duration: Duration::from_secs(180),
                                sample_rate: Some(44100),
                                bit_depth: Some(16),
                                channels: Some(2),
                                format: "FLAC".into(),
                                lyrics: None,
                            },
                            date_added: 1700000000 + idx as u64,
                        }
                    })
                    .collect();

                if db_clone.insert_or_update_batch(&new_tracks, &m_root).is_err() {
                    w_err.fetch_add(1, Ordering::Relaxed);
                } else {
                    w_ops.fetch_add(new_tracks.len(), Ordering::Relaxed);
                }

                std::thread::sleep(Duration::from_millis(5));
            }
        });
        handles.push(handle);
    }

    // Run stress test for 3 seconds
    let test_start = Instant::now();
    std::thread::sleep(Duration::from_secs(3));
    running.store(false, Ordering::Relaxed);

    for h in handles {
        h.join().unwrap();
    }
    let elapsed = test_start.elapsed();

    let total_reads = read_ops.load(Ordering::SeqCst);
    let total_writes = write_ops.load(Ordering::SeqCst);
    let total_r_err = read_errors.load(Ordering::SeqCst);
    let total_w_err = write_errors.load(Ordering::SeqCst);

    println!("  Duration: {elapsed:.2?}");
    println!("  Total Read Operations:  {total_reads:6} ({:.1} ops/sec)", total_reads as f64 / elapsed.as_secs_f64());
    println!("  Total Tracks Ingested:  {total_writes:6} ({:.1} tracks/sec)", total_writes as f64 / elapsed.as_secs_f64());
    println!("  Read Errors / Busy:     {total_r_err}");
    println!("  Write Errors / Busy:    {total_w_err}");

    assert_eq!(total_r_err, 0, "Zero read errors allowed under WAL concurrency");
    assert_eq!(total_w_err, 0, "Zero write errors allowed under WAL concurrency");
    assert!(total_reads > 200, "Should achieve high read throughput under concurrent writes");
    assert!(total_writes > 100, "Should achieve steady writes during concurrent reads");

    drop(db);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn bench_parallel_directory_scanner_scale() {
    let (temp_dir, db_path, library_root) = create_temp_db_env("scanner_scale");
    let source_dir = temp_dir.join("massive_incoming");
    fs::create_dir_all(&source_dir).unwrap();

    let file_count = 250;
    println!("\n[PARALLEL DIRECTORY SCANNER BENCHMARK: {file_count} files]");
    println!("  Generating {file_count} dummy audio files in nested directory hierarchy...");

    for artist_i in 1..=5 {
        for album_j in 1..=5 {
            let album_dir = source_dir.join(format!("Artist_{artist_i}")).join(format!("Album_{album_j}"));
            fs::create_dir_all(&album_dir).unwrap();
            for track_k in 1..=10 {
                let file_path = album_dir.join(format!("{track_k:02} - Song_{artist_i}_{album_j}_{track_k}.mp3"));
                let mut f = File::create(&file_path).unwrap();
                f.write_all(b"ID3\x04\x00\x00\x00\x00\x00\x20TIT2\x00\x00\x00\x09\x00\x00\x03TestSongTPE1\x00\x00\x00\x0b\x00\x00\x03TestArtistTALB\x00\x00\x00\x0a\x00\x00\x03TestAlbum").unwrap();
            }
        }
    }

    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path).unwrap();
    let (tx, mut rx) = mpsc::channel::<ScanProgress>(500);

    let progress_tracker = tokio::spawn(async move {
        let mut discovered = 0;
        let mut processed = 0;
        let mut batches = 0;
        let mut summary_opt = None;

        while let Some(evt) = rx.recv().await {
            match evt {
                ScanProgress::DiscoveredFiles(n) => discovered = n,
                ScanProgress::Processing { current, .. } => processed = current,
                ScanProgress::BatchIngested { count, .. } => batches += count,
                ScanProgress::Completed(summary) => summary_opt = Some(summary),
            }
        }
        (discovered, processed, batches, summary_opt)
    });

    let start = Instant::now();
    let imported = manager
        .import_directory_with_progress(&source_dir, ImportStrategy::Copy, Some(tx))
        .await
        .unwrap();
    let duration = start.elapsed();

    let (disc, proc, batches, summary) = progress_tracker.await.unwrap();

    println!("  Scan & Ingest Duration: {duration:?}");
    println!("  Discovered: {disc}, Processed: {proc}, Batched Ingested: {batches}");
    println!("  Imported Tracks: {}", imported.len());
    if let Some(s) = summary {
        println!("  Summary: scanned={}, imported={}, failed={}, duration_ms={}ms", s.scanned_files, s.imported_tracks, s.failed_files, s.duration_ms);
        assert_eq!(s.imported_tracks, file_count);
        assert_eq!(s.failed_files, 0);
    }

    assert_eq!(imported.len(), file_count);
    assert_eq!(manager.all_tracks().len(), file_count);

    // Verify managed file structure exists on disk
    let sample_managed = manager.all_tracks()[0].source.path();
    assert!(sample_managed.exists(), "Managed file must exist on disk after Copy");
    assert!(sample_managed.starts_with(&library_root));

    let _ = fs::remove_dir_all(&temp_dir);
}

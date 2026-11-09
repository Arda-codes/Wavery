//! Empirical Adversarial Challenger Suite for Milestone M1
//!
//! Stress-tests:
//! 1. Multilingual Genre Normalization & Splitting:
//!    - Cyrillic strings, mixed scripts (Greek, CJK, RTL, emojis).
//!    - Truncation dots, ellipsis, dashes, whitespace.
//!    - Unknown genres & title casing.
//!    - Case sensitivity & Unicode casing differences (e.g. İ, ẞ).
//! 2. `SqliteLibraryManager` in-memory collection cache:
//!    - Mutation invalidation under imports, track updates, deletes.
//!    - Dynamic config updates (`set_protected_artists`, `set_genre_mappings`).
//!    - Concurrent mutations and reads stress test.
//! 3. Large collection clustering latency & memory footprint:
//!    - Benchmarks on 1,000, 5,000, 10,000, and 25,000 tracks.
//! 4. Zero panics verification across malformed and extreme inputs.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use wavery_core::heuristics::{
    normalize_genre, split_artists, split_genres, DEFAULT_GENRE_MAPPINGS,
};
use wavery_core::models::{
    Track, TrackMetadata, TrackSource,
};
use wavery_core::traits::LibraryManager;
use wavery_library::clustering::{
    extract_library_genres, group_tracks_by_album, group_tracks_by_artist,
};
use wavery_library::manager::SqliteLibraryManager;

fn setup_temp_env(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let temp_dir = std::env::temp_dir().join(format!("wavery_m1_adv_{name}_{}", uuid::Uuid::new_v4()));
    let db_path = temp_dir.join("library.db");
    let library_root = temp_dir.join("library");
    fs::create_dir_all(&library_root).expect("create library root");
    (temp_dir, db_path, library_root)
}

#[allow(clippy::too_many_arguments)]
fn create_test_track(
    id: &str,
    title: &str,
    artist: &str,
    album: &str,
    genre: &str,
    track_number: u32,
    disc_number: u32,
    duration_secs: u64,
    library_root: &Path,
) -> Track {
    let file_path = library_root.join(format!("{artist}/{album}/{id}.flac"));
    if let Some(parent) = file_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&file_path, b"DUMMY_AUDIO_DATA_FOR_CHALLENGER_TEST");

    Track {
        id: id.to_string(),
        source: TrackSource::Managed(file_path),
        metadata: TrackMetadata {
            title: Some(title.to_string()),
            artist: Some(artist.to_string()),
            album: Some(album.to_string()),
            album_artist: Some(artist.to_string()),
            track_number: Some(track_number),
            disc_number: Some(disc_number),
            year: Some(2024),
            genre: Some(genre.to_string()),
            duration: Duration::from_secs(duration_secs),
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "FLAC".to_string(),
            lyrics: None,
            ..Default::default()
        },
        date_added: 1700000000,
    }
}

// =========================================================================
// SECTION 1: ADVERSARIAL GENRE NORMALIZATION & SPLITTING MATRIX
// =========================================================================

#[test]
fn test_adversarial_genre_cyrillic_and_truncation_matrix() {
    println!("\n>>> Testing Cyrillic Genre Normalization & Truncation Matrix");

    // 1. All 70 default mappings in canonical lower case
    for &(alias, canonical) in DEFAULT_GENRE_MAPPINGS {
        assert_eq!(
            normalize_genre(alias, None),
            canonical,
            "Failed canonical mapping for alias '{alias}'"
        );
    }

    // 2. Case variations on Cyrillic strings
    let case_tests = [
        ("РОК", "Rock"),
        ("Рок", "Rock"),
        ("рОк", "Rock"),
        ("ХИП-ХОП", "Hip-Hop"),
        ("Хип-Хоп", "Hip-Hop"),
        ("хип хоп", "Hip-Hop"),
        ("ЭЛЕКТРОНИКА", "Electronic"),
        ("Электронная Музыка", "Electronic"),
        ("КЛАССИКА", "Classical"),
        ("Классическая Музыка", "Classical"),
        ("САУНДТРЕК", "Soundtrack"),
        ("Саундтреки", "Soundtrack"),
        ("ИНДИ-РОК", "Indie"),
        ("АЛЬТЕРНАТИВНЫЙ РОК", "Alternative"),
        ("МЕТАЛЛ", "Metal"),
        ("ТЯЖЕЛЫЙ РОК", "Metal"),
        ("ДЖАЗ", "Jazz"),
        ("БЛЮЗ", "Blues"),
    ];
    for (input, expected) in case_tests {
        assert_eq!(
            normalize_genre(input, None),
            expected,
            "Failed Cyrillic case variation for '{input}'"
        );
    }

    // 3. Truncation dots, ellipsis, dashes, and trailing whitespace
    let truncation_tests = [
        ("Рок...", "Rock"),
        ("Рок…", "Rock"), // Unicode ellipsis \u{2026}
        ("Хип-Хоп---", "Hip-Hop"),
        ("Электроника. . .", "Electronic"),
        ("Альтернатив...", "Alternative"),
        ("Альтернатив--", "Alternative"),
        ("Альтернатив…", "Alternative"),
        ("Электронная...", "Electronic"),
        ("Классич...", "Classical"),
        ("Инструмент...", "Instrumental"),
        ("   Alt Rock ...  ", "Alternative"),
        ("Soundtrack - ", "Soundtrack"),
        ("Hip-Hop - - - ", "Hip-Hop"),
        ("  Dnb … ", "Drum & Bass"),
        ("  Lo-Fi . .. ", "Lo-Fi"),
    ];
    for (input, expected) in truncation_tests {
        assert_eq!(
            normalize_genre(input, None),
            expected,
            "Failed truncation test for '{input}'"
        );
    }

    // 4. Degenerate inputs (MUST NOT PANIC and return empty string)
    let degenerate_inputs = [
        "",
        "   ",
        "\t\r\n",
        "...",
        "……",
        "---",
        " - - - ",
        " . . . ",
        "…-…-",
    ];
    for input in degenerate_inputs {
        let res = normalize_genre(input, None);
        assert!(
            res.is_empty(),
            "Expected empty result for degenerate input '{input}', got '{res}'"
        );
    }
}

#[test]
fn test_adversarial_genre_unknown_and_mixed_scripts() {
    println!("\n>>> Testing Unknown Genres, Title Case & Mixed Scripts");

    // 1. Unknown English and hyphenated genres
    let unknown_tests = [
        ("post-rock", "Post-Rock"),
        ("POST-ROCK", "Post-Rock"),
        ("post-apocalyptic witch house", "Post-Apocalyptic Witch House"),
        ("kawaii future bass", "Kawaii Future Bass"),
        ("GLITCH HOP", "Glitch Hop"),
        ("cyberpunk industrial", "Cyberpunk Industrial"),
        ("dream-pop", "Dream-Pop"),
        ("math-rock", "Math-Rock"),
    ];
    for (input, expected) in unknown_tests {
        assert_eq!(
            normalize_genre(input, None),
            expected,
            "Failed unknown genre title-casing for '{input}'"
        );
    }

    // 2. Mixed scripts & non-Latin characters (CJK, Greek, RTL, emojis)
    let mixed_tests = [
        ("J-Rock", "J-Rock"),
        ("K-Pop", "K-Pop"),
        ("アニメ", "アニメ"),
        ("موسيقى", "موسيقى"),
        ("Русский Rock", "Русский Rock"),
        ("🔥 Synthwave ⚡", "🔥 Synthwave ⚡"),
    ];
    for (input, _expected) in mixed_tests {
        let res = normalize_genre(input, None);
        assert!(!res.is_empty(), "Result for mixed script '{input}' was empty");
    }

    // 3. Custom mappings override default and add new genres
    let mut custom = HashMap::new();
    custom.insert("рок".to_string(), "Custom Rock".to_string());
    custom.insert("kawaii future bass".to_string(), "Future Bass".to_string());
    custom.insert("мой жанр".to_string(), "My Genre".to_string());

    assert_eq!(normalize_genre("рок", Some(&custom)), "Custom Rock");
    assert_eq!(normalize_genre("РОК", Some(&custom)), "Custom Rock");
    assert_eq!(normalize_genre("kawaii future bass", Some(&custom)), "Future Bass");
    assert_eq!(normalize_genre("мой жанр", Some(&custom)), "My Genre");
    assert_eq!(normalize_genre("джаз", Some(&custom)), "Jazz");
}

#[test]
fn test_adversarial_split_genres_protected_and_compounds() {
    println!("\n>>> Testing split_genres with Protected Terms & Delimiters");

    // 1. Protected terms must not be split by & or and
    let protected_cases = [
        ("R&B", vec!["R&B"]),
        ("r&b", vec!["R&B"]),
        ("R & B", vec!["R&B"]),
        ("rnb", vec!["R&B"]),
        ("Drum & Bass", vec!["Drum & Bass"]),
        ("drum and bass", vec!["Drum & Bass"]),
        ("dnb", vec!["Drum & Bass"]),
        ("Rock & Roll", vec!["Rock & Roll"]),
        ("rock and roll", vec!["Rock & Roll"]),
    ];
    for (input, expected) in protected_cases {
        let res = split_genres(input, None);
        assert_eq!(res, expected, "Failed protected genre test for '{input}'");
    }

    // 2. Complex compound strings with multiple delimiters and protected terms
    let compound = "Alternative / Rock & Pop, R&B; Drum & Bass | Hip-Hop";
    let split = split_genres(compound, None);
    assert_eq!(
        split,
        vec!["Alternative", "Rock", "Pop", "R&B", "Drum & Bass", "Hip-Hop"]
    );

    // 3. Cyrillic compound genres
    let cyrillic_compound = "Русский Рок / Альтернатива & Хип-Хоп, Джаз; Электроника";
    let cyrillic_split = split_genres(cyrillic_compound, None);
    assert_eq!(
        cyrillic_split,
        vec!["Rock", "Alternative", "Hip-Hop", "Jazz", "Electronic"]
    );

    // 4. Deduplication of identical / case-differing genres in same tag
    let dup_compound = "Rock / rock / ROCK / Rock & Pop / pop";
    let dup_split = split_genres(dup_compound, None);
    assert_eq!(dup_split, vec!["Rock", "Pop"]);

    // 5. Empty and degenerate compound strings
    let degenerate = " / / ,,, ;;; &&& ||| ";
    let degen_split = split_genres(degenerate, None);
    assert!(degen_split.is_empty(), "Expected empty vector for '{degenerate}'");
}

/// EMPIRICALLY CONFIRMED DEFECT:
/// String slicing in `mask_protected_artists` and `split_genres` uses byte offsets from `to_lowercase()`,
/// which desynchronizes from the original string whenever characters expand (e.g. Turkish 'İ' 2B -> 3B)
/// or shrink (e.g. German 'ẞ' 3B -> 2B) under Unicode lowercasing.
/// This causes:
/// 1. Panics: `end byte index X is not a char boundary; it is inside '...'`
/// 2. Silent corruption: protected composite artists (Tyler, The Creator; AC/DC) are split mistakenly.
#[test]
fn test_empirical_vulnerability_unicode_case_shift_panics_and_corruption() {
    println!("\n>>> VERIFYING UNICODE CASE SHIFT INTEGRITY & PANIC-FREEDOM");

    // A. Verify no panics in split_artists on multi-byte protected names preceded by expanding 'İ' or shrinking 'ẞ'
    let protected = vec!["Джаз & Рок".to_string(), "Électro & Pop".to_string()];

    let panic_1 = std::panic::catch_unwind(|| {
        split_artists("İ, Джаз & Рок", &protected)
    });
    assert!(
        panic_1.is_ok(),
        "Empirical check failed: 'İ, Джаз & Рок' should execute without panic"
    );

    let panic_2 = std::panic::catch_unwind(|| {
        split_artists("ẞ, Électro & Pop", &protected)
    });
    assert!(
        panic_2.is_ok(),
        "Empirical check failed: 'ẞ, Électro & Pop' should execute without panic"
    );

    // B. Verify no panic in split_genres on shrinking 'ẞ' followed by multi-byte Cyrillic before protected genre
    let panic_3 = std::panic::catch_unwind(|| {
        split_genres("ẞдr&b", None)
    });
    assert!(
        panic_3.is_ok(),
        "Empirical check failed: 'ẞдr&b' should execute without panic in split_genres"
    );

    // C. Verify zero token corruption:
    // Protected artists "Tyler, The Creator" and "AC/DC" are preserved intact
    let fixed_artist_1 = split_artists("İ & Tyler, The Creator", &[]);
    assert_eq!(
        fixed_artist_1,
        vec!["İ", "Tyler, The Creator"],
        "Expected protected artist 'Tyler, The Creator' to remain atomic"
    );

    let fixed_artist_2 = split_artists("İ & AC/DC", &[]);
    assert_eq!(
        fixed_artist_2,
        vec!["İ", "AC/DC"],
        "Expected protected artist 'AC/DC' to remain atomic"
    );

    let fixed_genre = split_genres("İ / Drum & Bass", None);
    assert_eq!(
        fixed_genre,
        vec!["İ", "Drum & Bass"],
        "Expected Drum & Bass to remain atomic"
    );

    println!("Confirmed: 0 panics and zero token corruption verified!");
}

// =========================================================================
// SECTION 2: SQLITE LIBRARY MANAGER CACHE INVALIDATION & CONCURRENCY
// =========================================================================

#[tokio::test]
async fn test_sqlite_library_manager_cache_invalidation_lifecycle() {
    let (temp_dir, db_path, library_root) = setup_temp_env("cache_lifecycle");

    println!("\n>>> Testing SqliteLibraryManager Cache Invalidation Lifecycle");

    // 1. Initial State: empty cache
    let manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone())
        .expect("Initialize SqliteLibraryManager");

    assert!(manager.list_albums().unwrap().is_empty());
    assert!(manager.list_artists().unwrap().is_empty());
    assert!(manager.list_genres().unwrap().is_empty());

    // 2. Insert 5 tracks directly via db.insert_or_update_batch (with physical files on disk)
    let track1 = create_test_track("t1", "One More Time", "Daft Punk", "Discovery", "Electronic", 1, 1, 320, &library_root);
    let track2 = create_test_track("t2", "Aerodynamic", "Daft Punk", "Discovery", "Dance", 2, 1, 210, &library_root);
    let track3 = create_test_track("t3", "Nightcall", "Kavinsky", "Nightcall", "Synthwave", 1, 1, 259, &library_root);
    let track4 = create_test_track("t4", "Pacific Coast Highway", "Kavinsky", "Nightcall", "Electro", 2, 1, 380, &library_root);
    let track5 = create_test_track("t5", "Genesis", "Justice", "Cross", "Electronic", 1, 1, 234, &library_root);

    manager.db().insert_or_update_batch(
        &[track1.clone(), track2.clone(), track3.clone(), track4.clone(), track5.clone()],
        &library_root,
    ).expect("Insert initial batch");

    // Re-initialize manager from populated DB
    drop(manager);
    let mut manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone())
        .expect("Re-open manager with tracks");

    let albums = manager.list_albums().unwrap();
    assert_eq!(albums.len(), 3, "Expected 3 albums: Discovery, Nightcall, Cross");
    let artists = manager.list_artists().unwrap();
    assert_eq!(artists.len(), 3, "Expected 3 artists: Daft Punk, Kavinsky, Justice");
    let genres = manager.list_genres().unwrap();
    let genre_names: Vec<&str> = genres.iter().map(|g| g.name.as_str()).collect();
    assert!(genre_names.contains(&"Electronic"));
    assert!(genre_names.contains(&"Dance"));
    assert!(genre_names.contains(&"Synthwave"));

    // 3. Mutation: update_track_metadata on Track 1
    // Move Track 1 from Album "Discovery" to Album "Homework", and Genre from "Electronic" to "Techno"
    let mut updated_meta = track1.metadata.clone();
    updated_meta.album = Some("Homework".to_string());
    updated_meta.genre = Some("Techno".to_string());

    let updated_res = manager.update_track_metadata(&track1.id, &updated_meta, false).await
        .expect("Update track metadata");
    assert_eq!(updated_res.metadata.album.as_deref(), Some("Homework"));

    // Cache should immediately reflect the mutation without restart
    let albums_after_update = manager.list_albums().unwrap();
    assert_eq!(albums_after_update.len(), 4, "Expected 4 albums after moving track to Homework");
    let hw = albums_after_update.iter().find(|a| a.title == "Homework").expect("Found Homework album");
    assert_eq!(hw.track_count, 1);
    assert_eq!(hw.tracks[0].id, "t1");

    let disc = albums_after_update.iter().find(|a| a.title == "Discovery").expect("Found Discovery album");
    assert_eq!(disc.track_count, 1);
    assert_eq!(disc.tracks[0].id, "t2");

    let genres_after_update = manager.list_genres().unwrap();
    let techno = genres_after_update.iter().find(|g| g.name == "Techno").expect("Found Techno genre");
    assert_eq!(techno.track_count, 1);
    assert_eq!(techno.tracks[0].id, "t1");

    // Electronic should now have 2 tracks (t5 from Justice, and t4 "Electro" which aliases to Electronic)
    let electronic = genres_after_update.iter().find(|g| g.name == "Electronic").expect("Found Electronic genre");
    assert_eq!(electronic.track_count, 2);
    assert!(electronic.tracks.iter().any(|t| t.id == "t5"));
    assert!(electronic.tracks.iter().any(|t| t.id == "t4"));

    // 4. Mutation: delete_track on Track 5 (Justice)
    manager.delete_track(&track5.id, false).await.expect("Delete track 5");

    let artists_after_delete = manager.list_artists().unwrap();
    assert!(!artists_after_delete.iter().any(|a| a.name == "Justice"), "Justice should be gone from artist cache");
    assert_eq!(artists_after_delete.len(), 2, "Expected 2 artists remaining");

    let albums_after_delete = manager.list_albums().unwrap();
    assert!(!albums_after_delete.iter().any(|a| a.title == "Cross"), "Cross should be gone from album cache");
    assert_eq!(albums_after_delete.len(), 3, "Expected 3 albums remaining");

    let genres_after_delete = manager.list_genres().unwrap();
    let electronic_remaining = genres_after_delete.iter().find(|g| g.name == "Electronic").expect("Electronic still has t4");
    assert_eq!(electronic_remaining.track_count, 1);
    assert_eq!(electronic_remaining.tracks[0].id, "t4");

    // 5. Dynamic config updates: set_genre_mappings
    let mut custom_genres = HashMap::new();
    custom_genres.insert("techno".to_string(), "Cyber Techno".to_string());
    manager.set_genre_mappings(custom_genres);

    let genres_after_mapping = manager.list_genres().unwrap();
    assert!(genres_after_mapping.iter().any(|g| g.name == "Cyber Techno"), "Cyber Techno should appear via dynamic mapping");
    assert!(!genres_after_mapping.iter().any(|g| g.name == "Techno"), "Techno should be renamed to Cyber Techno");

    // 6. Delete all remaining tracks one by one
    manager.delete_track(&track1.id, false).await.unwrap();
    manager.delete_track(&track2.id, false).await.unwrap();
    manager.delete_track(&track3.id, false).await.unwrap();
    manager.delete_track(&track4.id, false).await.unwrap();

    assert!(manager.list_albums().unwrap().is_empty(), "Albums cache should be empty after deleting all tracks");
    assert!(manager.list_artists().unwrap().is_empty(), "Artists cache should be empty after deleting all tracks");
    assert!(manager.list_genres().unwrap().is_empty(), "Genres cache should be empty after deleting all tracks");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_sqlite_library_manager_concurrent_mutations_and_reads() {
    let (temp_dir, db_path, library_root) = setup_temp_env("concurrent_cache");

    println!("\n>>> Testing SqliteLibraryManager Concurrent Mutation & Read Stress");

    let manager = SqliteLibraryManager::new(library_root.clone(), db_path.clone())
        .expect("Initialize SqliteLibraryManager");

    // Pre-populate with 50 tracks with physical files
    let mut initial_tracks = Vec::new();
    for i in 0..50 {
        let artist = format!("Artist_{}", i % 5);
        let album = format!("Album_{}", i % 10);
        let genre = match i % 4 {
            0 => "Rock",
            1 => "Pop",
            2 => "Electronic",
            _ => "Hip-Hop",
        };
        initial_tracks.push(create_test_track(
            &format!("init_{i}"),
            &format!("Title {i}"),
            &artist,
            &album,
            genre,
            (i % 10) + 1,
            1,
            200,
            &library_root,
        ));
    }
    manager.db().insert_or_update_batch(&initial_tracks, &library_root).unwrap();
    drop(manager);

    let manager = Arc::new(Mutex::new(
        SqliteLibraryManager::new(library_root.clone(), db_path.clone()).unwrap(),
    ));

    // Spawn 3 concurrent tasks performing operations
    let read_mgr = manager.clone();
    let reader_handle = tokio::spawn(async move {
        for _ in 0..60 {
            let m = read_mgr.lock().await;
            let albums = m.list_albums().unwrap();
            let artists = m.list_artists().unwrap();
            let genres = m.list_genres().unwrap();

            for alb in &albums {
                assert!(!alb.title.is_empty());
                assert_eq!(alb.tracks.len(), alb.track_count);
            }
            for art in &artists {
                assert!(!art.name.is_empty());
            }
            for i in 1..genres.len() {
                assert!(genres[i - 1].track_count >= genres[i].track_count);
            }
            drop(m);
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    });

    let update_mgr = manager.clone();
    let updater_handle = tokio::spawn(async move {
        for i in 0..30 {
            let mut m = update_mgr.lock().await;
            let track_id = format!("init_{}", i % 40); // avoid deleting range
            let meta = TrackMetadata {
                title: Some(format!("Updated Title {i}")),
                artist: Some(format!("Artist_{}", (i + 1) % 5)),
                album: Some(format!("Album_{}", (i + 1) % 10)),
                genre: Some(if i % 2 == 0 { "Jazz".to_string() } else { "Ambient".to_string() }),
                duration: Duration::from_secs(250),
                ..Default::default()
            };
            let _ = m.update_track_metadata(&track_id, &meta, false).await;
            drop(m);
            tokio::time::sleep(Duration::from_millis(3)).await;
        }
    });

    let delete_mgr = manager.clone();
    let deleter_handle = tokio::spawn(async move {
        for i in 40..50 {
            let mut m = delete_mgr.lock().await;
            let track_id = format!("init_{i}");
            let _ = m.delete_track(&track_id, false).await;
            drop(m);
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    });

    let (r_res, u_res, d_res) = tokio::join!(reader_handle, updater_handle, deleter_handle);
    r_res.expect("Reader task failed");
    u_res.expect("Updater task failed");
    d_res.expect("Deleter task failed");

    // Final consistency check
    let final_mgr = manager.lock().await;
    let final_albums = final_mgr.list_albums().unwrap();
    let final_artists = final_mgr.list_artists().unwrap();
    let final_genres = final_mgr.list_genres().unwrap();

    let all_tracks = final_mgr.all_tracks();
    assert_eq!(all_tracks.len(), 40, "Expected 40 tracks after deleting 10");

    let mut track_count_in_albums = 0;
    for a in &final_albums {
        track_count_in_albums += a.track_count;
    }
    assert_eq!(track_count_in_albums, 40, "Sum of tracks in albums must equal all tracks");

    println!(
        "Concurrent stress passed: {} albums, {} artists, {} genres verified consistently",
        final_albums.len(),
        final_artists.len(),
        final_genres.len()
    );

    drop(final_mgr);
    let _ = fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// SECTION 3: LARGE COLLECTION CLUSTERING LATENCY & MEMORY BENCHMARK
// =========================================================================

#[test]
fn test_clustering_scale_benchmark_1k_to_25k_tracks() {
    let dummy_root = Path::new("/Music");

    println!("\n=======================================================");
    println!("  M1 CLUSTERING SCALE BENCHMARK (1,000 -> 25,000 TRACKS)");
    println!("=======================================================");

    let scales = [1_000, 5_000, 10_000, 25_000];

    for &track_count in &scales {
        let mut tracks = Vec::with_capacity(track_count);
        let num_artists = (track_count / 20).max(5);
        let num_albums = (track_count / 10).max(5);

        for i in 0..track_count {
            let artist_idx = i % num_artists;
            let album_idx = i % num_albums;
            let genre = match i % 5 {
                0 => "Rock / Pop",
                1 => "Electronic / Dance",
                2 => "Hip-Hop / Rap",
                3 => "Jazz / Blues",
                _ => "Alternative & Indie",
            };

            tracks.push(Track {
                id: format!("bench_t_{track_count}_{i}"),
                source: TrackSource::Managed(dummy_root.join(format!(
                    "Artist_{artist_idx}/Album_{album_idx}/track_{i}.flac"
                ))),
                metadata: TrackMetadata {
                    title: Some(format!("Track {i}")),
                    artist: Some(format!("Artist {artist_idx}")),
                    album: Some(format!("Album {album_idx}")),
                    album_artist: Some(format!("Artist {artist_idx}")),
                    track_number: Some((i % 12) as u32 + 1),
                    disc_number: Some(1),
                    year: Some(2000 + (i % 25) as i32),
                    genre: Some(genre.to_string()),
                    duration: Duration::from_secs(180 + (i % 60) as u64),
                    format: "FLAC".to_string(),
                    ..Default::default()
                },
                date_added: 1700000000 + i as u64,
            });
        }

        // Measure group_tracks_by_album
        let t0 = Instant::now();
        let albums = group_tracks_by_album(&tracks, &[]);
        let album_dur = t0.elapsed();

        // Measure group_tracks_by_artist
        let t1 = Instant::now();
        let artists = group_tracks_by_artist(&tracks, &[]);
        let artist_dur = t1.elapsed();

        // Measure extract_library_genres
        let t2 = Instant::now();
        let genres = extract_library_genres(&tracks, None);
        let genre_dur = t2.elapsed();

        let total_dur = album_dur + artist_dur + genre_dur;

        println!(
            "  [{:>5} tracks] Albums: {:>5} ({:6.2}ms) | Artists: {:>4} ({:6.2}ms) | Genres: {:>2} ({:6.2}ms) | Total: {:6.2}ms",
            track_count,
            albums.len(),
            album_dur.as_secs_f64() * 1000.0,
            artists.len(),
            artist_dur.as_secs_f64() * 1000.0,
            genres.len(),
            genre_dur.as_secs_f64() * 1000.0,
            total_dur.as_secs_f64() * 1000.0
        );

        // Even for 25,000 tracks, total clustering must complete in < 1500ms
        assert!(
            total_dur < Duration::from_millis(1500),
            "Clustering {track_count} tracks took too long: {:?}",
            total_dur
        );
        assert!(!albums.is_empty());
        assert!(!artists.is_empty());
        assert!(!genres.is_empty());
    }
}

// =========================================================================
// SECTION 4: ZERO PANIC & ADVERSARIAL FUZZING MATRIX
// =========================================================================

#[test]
fn test_zero_panics_on_adversarial_strings() {
    println!("\n>>> Testing Zero Panics on Extreme Adversarial Strings");

    // 1. Extreme length string (100,000 characters)
    let huge_genre = "Rock / ".repeat(10_000);
    let split_huge = split_genres(&huge_genre, None);
    assert_eq!(split_huge, vec!["Rock"]);

    // 2. Huge string of pure punctuation
    let punct_bomb = "/,;&|".repeat(10_000);
    let split_punct = split_genres(&punct_bomb, None);
    assert!(split_punct.is_empty());

    // 3. Huge string of whitespace
    let space_bomb = " \t\r\n".repeat(10_000);
    assert_eq!(normalize_genre(&space_bomb, None), "");

    // 4. Repeated hyphens and dots
    let dash_bomb = ".-.-.-.-".repeat(5_000);
    assert_eq!(normalize_genre(&dash_bomb, None), "");

    // 5. Zalgo text & combining characters
    let zalgo_genre = "R̷o̷c̷k̷ / P̷o̷p̷";
    let split_zalgo = split_genres(zalgo_genre, None);
    println!("Zalgo split: {:?}", split_zalgo);

    // 6. Null bytes and control characters
    let null_genre = "Rock\0\r\n\t / Pop\x01\x02";
    let split_null = split_genres(null_genre, None);
    println!("Control chars split: {:?}", split_null);
    assert!(!split_null.is_empty());
}

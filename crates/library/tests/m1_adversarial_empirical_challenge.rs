//! Adversarial stress-test suite for Milestone M1 (Library Aggregation & Tag Heuristics).
//!
//! Provides empirical verification for the Challenger M1 evaluation of Wavery:
//! 1. Artist splitting and protected tokenizer (punctuation, overlaps, case, empty strings, ReDoS)
//! 2. Path fallback heuristics (nested hierarchies, path separators, symlinks, generic folders, malformed filenames)
//! 3. Compilation detection and album clustering (boundary ratios, 50%/70% dominance, multi-disc albums)
//! 4. Concurrency, memory allocation, and performance under high load
//! 5. Empirical reproduction of 5 critical bugs and discrepancies

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use wavery_core::heuristics::{
    normalize_genre, parse_artist_tokens, split_artists, split_genres, DEFAULT_PROTECTED_ARTISTS,
};
use wavery_core::models::{Track, TrackMetadata, TrackSource};
use wavery_library::clustering::{
    extract_library_genres, group_tracks_by_album, group_tracks_by_artist,
};
use wavery_library::heuristics::extract_artist_from_path;
use wavery_library::manager::SqliteLibraryManager;

// =========================================================================
// SECTION 1: ARTIST SPLITTING & PROTECTED TOKENIZER VALIDATIONS
// =========================================================================

#[test]
fn test_challenge_protected_artists_punctuation_and_casing() {
    // 1. Every single protected artist in DEFAULT_PROTECTED_ARTISTS must be preserved when isolated
    for &artist in DEFAULT_PROTECTED_ARTISTS {
        let res = split_artists(artist, &[]);
        assert_eq!(
            res,
            vec![artist.to_string()],
            "Protected artist '{artist}' must not be split when isolated"
        );

        // Lowercase variant
        let lower = artist.to_lowercase();
        let res_lower = split_artists(&lower, &[]);
        assert_eq!(
            res_lower.len(),
            1,
            "Lowercase protected artist '{lower}' should remain atomic (got {res_lower:?})"
        );

        // Uppercase variant
        let upper = artist.to_uppercase();
        let res_upper = split_artists(&upper, &[]);
        assert_eq!(
            res_upper.len(),
            1,
            "Uppercase protected artist '{upper}' should remain atomic (got {res_upper:?})"
        );
    }

    // 2. Complex collaborations involving multiple protected artists with various delimiters
    let input = "Tyler, The Creator; Earth, Wind & Fire, Crosby, Stills, Nash & Young & AC/DC";
    let split = split_artists(input, &[]);
    assert_eq!(
        split,
        vec![
            "Tyler, The Creator",
            "Earth, Wind & Fire",
            "Crosby, Stills, Nash & Young",
            "AC/DC"
        ],
        "Should correctly isolate all 4 protected artists despite mixed commas, semicolons, and ampersands"
    );

    // 3. Overlapping substrings in protected artists
    // "Crosby, Stills, Nash & Young" vs "Crosby, Stills & Nash"
    let combo = "Crosby, Stills, Nash & Young feat. Crosby, Stills & Nash";
    let split_combo = split_artists(combo, &[]);
    assert_eq!(
        split_combo,
        vec!["Crosby, Stills, Nash & Young", "Crosby, Stills & Nash"],
        "Longer protected artist should not cannibalize shorter protected artist in collaboration"
    );

    // 4. Reverse order of overlapping substrings
    let combo_rev = "Crosby, Stills & Nash with Crosby, Stills, Nash & Young";
    let split_rev = split_artists(combo_rev, &[]);
    assert_eq!(
        split_rev,
        vec!["Crosby, Stills & Nash", "Crosby, Stills, Nash & Young"],
        "Reverse order of overlapping protected artists must also preserve both intact"
    );

    // 5. Punctuation heavy: "Tony! Toni! Toné!", "Panic! At The Disco", "!!! (Chk Chk Chk)", "$uicideboy$"
    let punct = "Tony! Toni! Toné! / Panic! At The Disco & !!! (Chk Chk Chk) feat. $uicideboy$";
    let split_punct = split_artists(punct, &[]);
    assert_eq!(
        split_punct,
        vec![
            "Tony! Toni! Toné!",
            "Panic! At The Disco",
            "!!! (Chk Chk Chk)",
            "$uicideboy$"
        ]
    );
}

#[test]
fn test_challenge_artist_tokenizer_clean_inputs() {
    // 1. Empty and whitespace-only
    assert_eq!(split_artists("", &[]), vec!["Unknown Artist"]);
    assert_eq!(split_artists("   ", &[]), vec!["Unknown Artist"]);
    assert_eq!(split_artists("\t\n\r  ", &[]), vec!["Unknown Artist"]);

    // 2. Repeated delimiters
    let rep = "Daft Punk ;;;;; Pharrell Williams ,,,,,, Nile Rodgers ////// Giorgio Moroder";
    let split_rep = split_artists(rep, &[]);
    assert_eq!(
        split_rep,
        vec![
            "Daft Punk",
            "Pharrell Williams",
            "Nile Rodgers",
            "Giorgio Moroder"
        ]
    );

    // 3. Delimiters at start and end
    let edge_delims = "& Daft Punk & Pharrell Williams &";
    let split_edge = split_artists(edge_delims, &[]);
    assert_eq!(split_edge, vec!["Daft Punk", "Pharrell Williams"]);

    // 4. Deduplication of identical artists in same string
    let dupes = "Daft Punk feat. Daft Punk & daft punk";
    let split_dupes = split_artists(dupes, &[]);
    assert_eq!(split_dupes, vec!["Daft Punk"]);

    // 5. Delimiter tokenizer tokens check
    let tokens = parse_artist_tokens("Daft Punk & Pharrell Williams", &[]);
    assert_eq!(tokens.len(), 3);
    assert_eq!(tokens[0].text, "Daft Punk");
    assert!(tokens[0].is_artist);
    assert_eq!(tokens[1].text, "& ");
    assert!(!tokens[1].is_artist);
    assert_eq!(tokens[2].text, "Pharrell Williams");
    assert!(tokens[2].is_artist);
}

#[test]
fn test_challenge_redos_and_performance_stress() {
    // Construct pathological input: repeated delimiter chains and nested feature structures
    let mut pathological = String::new();
    for i in 0..500 {
        pathological.push_str(&format!("Artist {i} feat. "));
    }
    pathological.push_str("Final Artist");

    let start = Instant::now();
    let result = split_artists(&pathological, &[]);
    let elapsed = start.elapsed();

    assert_eq!(result.len(), 501);
    assert!(
        elapsed < Duration::from_millis(300),
        "500-artist delimiter chain must parse in < 300ms (debug build), took {:?}",
        elapsed
    );

    // Pathological repeating commas and slashes
    let repeated = "Tyler, The Creator, ".repeat(200);
    let start2 = Instant::now();
    let res2 = split_artists(&repeated, &[]);
    let elapsed2 = start2.elapsed();

    assert_eq!(res2, vec!["Tyler, The Creator"]); // Deduplicated
    assert!(
        elapsed2 < Duration::from_millis(100),
        "Repeated protected artist string must parse in < 100ms, took {:?}",
        elapsed2
    );
}

#[test]
fn test_challenge_genre_normalization_and_splitting() {
    // 1. Multilingual Cyrillic normalization
    assert_eq!(normalize_genre("русский рок", None), "Rock");
    assert_eq!(normalize_genre("ХАРД-РОК", None), "Rock");
    assert_eq!(normalize_genre("хип-хоп", None), "Hip-Hop");
    assert_eq!(normalize_genre("электроника", None), "Electronic");
    assert_eq!(normalize_genre("саундтрек", None), "Soundtrack");
    assert_eq!(normalize_genre("классическая музыка", None), "Classical");

    // 2. Truncated genres with trailing dots or dashes
    assert_eq!(normalize_genre("Альтернативный рок...", None), "Alternative");
    assert_eq!(normalize_genre("Электронная -", None), "Electronic");
    assert_eq!(normalize_genre("Инструментал...", None), "Instrumental");

    // 3. Fallback to clean title casing for unknown genres
    assert_eq!(
        normalize_genre("neo-psychedelic indie rock", None),
        "Neo-Psychedelic Indie Rock"
    );

    // 4. Splitting compound genres while protecting R&B, Drum & Bass, Rock & Roll
    let compound = "R&B / Soul, Drum & Bass & Rock & Roll | Hip-Hop; Electronic";
    let split = split_genres(compound, None);
    assert_eq!(
        split,
        vec![
            "R&B",
            "Soul",
            "Drum & Bass",
            "Rock & Roll",
            "Hip-Hop",
            "Electronic"
        ]
    );

    // 5. Custom genre mapping overriding defaults
    let mut custom = HashMap::new();
    custom.insert("synthwave".to_string(), "Electronic / Synthwave".to_string());
    assert_eq!(
        normalize_genre("synthwave", Some(&custom)),
        "Electronic / Synthwave"
    );
}

// =========================================================================
// SECTION 2: PATH FALLBACK HEURISTICS VALIDATIONS
// =========================================================================

#[test]
fn test_challenge_path_heuristics_nested_and_generic_folders() {
    // 1. Deeply nested directory hierarchy
    let p1 = Path::new("/var/media/storage/audio/flac/Radiohead/OK Computer/01 Airbag.flac");
    assert_eq!(
        extract_artist_from_path(p1, Some("OK Computer")),
        Some("Radiohead".to_string())
    );

    // 2. Folder with "Artist - Album" structure
    let p2 = Path::new("/downloads/Pink Floyd - The Dark Side of the Moon/01 Speak to Me.flac");
    assert_eq!(
        extract_artist_from_path(p2, None),
        Some("Pink Floyd".to_string())
    );

    // 3. All folders generic except filename
    let p3 = Path::new("/music/downloads/audio/flac/01 - Daft Punk - One More Time.flac");
    assert_eq!(
        extract_artist_from_path(p3, None),
        Some("Daft Punk".to_string())
    );

    // 4. Filename pattern "01. Artist - Title"
    let p4 = Path::new("/library/media/01. Led Zeppelin - Stairway to Heaven.mp3");
    assert_eq!(
        extract_artist_from_path(p4, None),
        Some("Led Zeppelin".to_string())
    );

    // 5. Filename with "Track 01 - Artist - Title"
    let p5 = Path::new("/tmp/songs/Track 01 - The Beatles - Come Together.opus");
    assert_eq!(
        extract_artist_from_path(p5, None),
        Some("The Beatles".to_string())
    );

    // 6. Filename with "track01 - Artist - Title"
    let p6 = Path::new("/songs/track05 - Queen - Bohemian Rhapsody.m4a");
    assert_eq!(
        extract_artist_from_path(p6, None),
        Some("Queen".to_string())
    );

    // 7. Path with only generic folders and non-conforming filename
    let p7 = Path::new("/music/audio/flac/01 Song Title.flac");
    assert_eq!(
        extract_artist_from_path(p7, None),
        None,
        "Should return None if no artist can be legitimately inferred"
    );

    // 8. Root directory files
    let p8 = Path::new("/01.mp3");
    assert_eq!(extract_artist_from_path(p8, None), None);
}

#[test]
fn test_challenge_path_heuristics_edge_cases_and_separators() {
    // 1. Multiple hyphens in filename: "01 - Artist - Song Title - Live.flac"
    let p1 = Path::new("/Music/01 - Iron Maiden - The Trooper - Live 1985.flac");
    assert_eq!(
        extract_artist_from_path(p1, None),
        Some("Iron Maiden".to_string()),
        "Should extract second segment in 3+ segment hyphenated filename"
    );

    // 2. Folder containing "disc 1" / "cd2" subdirectories
    let p2 = Path::new("/Music/Pink Floyd/The Wall/Disc 1/01 In the Flesh.flac");
    assert_eq!(
        extract_artist_from_path(p2, Some("The Wall")),
        Some("Pink Floyd".to_string()),
        "Should skip generic 'Disc 1' folder and match 'Pink Floyd'"
    );

    // 3. Filename with artist containing hyphens
    let p3 = Path::new("/Music/Downloads/01 - AC-DC - Back in Black.mp3");
    assert_eq!(
        extract_artist_from_path(p3, None),
        Some("AC-DC".to_string())
    );

    // 4. Filename without leading number: "Artist - Title.mp3"
    let p4 = Path::new("/Music/Nirvana - Smells Like Teen Spirit.mp3");
    assert_eq!(
        extract_artist_from_path(p4, None),
        Some("Nirvana".to_string())
    );
}

// =========================================================================
// SECTION 3: CLUSTERING & ARTIST PROFILE VALIDATIONS
// =========================================================================

#[test]
fn test_challenge_artist_profile_clustering_own_vs_appears_on() {
    let t1 = Track {
        id: "t1".into(),
        source: TrackSource::Managed(PathBuf::from("/Music/Daft Punk/Discovery/01.flac")),
        metadata: TrackMetadata {
            title: Some("One More Time".into()),
            artist: Some("Daft Punk".into()),
            album: Some("Discovery".into()),
            album_artist: Some("Daft Punk".into()),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2001),
            duration: Duration::from_secs(320),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    let t2 = Track {
        id: "t2".into(),
        source: TrackSource::Managed(PathBuf::from("/Music/The Weeknd/Starboy/01.flac")),
        metadata: TrackMetadata {
            title: Some("Starboy".into()),
            artist: Some("The Weeknd feat. Daft Punk".into()),
            album: Some("Starboy".into()),
            album_artist: Some("The Weeknd".into()),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2016),
            duration: Duration::from_secs(230),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    let artists = group_tracks_by_artist(&[t1, t2], &[]);
    assert_eq!(artists.len(), 2);

    let daft_punk = artists.iter().find(|a| a.name == "Daft Punk").unwrap();
    assert_eq!(daft_punk.albums.len(), 1, "Daft Punk owns Discovery");
    assert_eq!(daft_punk.albums[0].title, "Discovery");
    assert_eq!(
        daft_punk.appears_on.len(),
        1,
        "Daft Punk appears on Starboy"
    );
    assert_eq!(daft_punk.appears_on[0].title, "Starboy");
    assert_eq!(daft_punk.tracks.len(), 2, "Daft Punk has 2 tracks total");

    let the_weeknd = artists.iter().find(|a| a.name == "The Weeknd").unwrap();
    assert_eq!(the_weeknd.albums.len(), 1, "The Weeknd owns Starboy");
    assert_eq!(the_weeknd.appears_on.len(), 0);
    assert_eq!(the_weeknd.tracks.len(), 1);
}

#[test]
fn test_challenge_scale_5000_tracks_clustering_performance() {
    let mut tracks = Vec::with_capacity(5000);
    for i in 0..5000 {
        let artist_id = i % 100;
        let album_id = i % 500;
        let disc = if i % 10 == 0 { 2 } else { 1 };
        tracks.push(Track {
            id: format!("scale-track-{i}"),
            source: TrackSource::Managed(PathBuf::from(format!(
                "/Music/Artist {artist_id}/Album {album_id}/disc{disc}_{i}.flac"
            ))),
            metadata: TrackMetadata {
                title: Some(format!("Track {i}")),
                artist: Some(format!("Artist {artist_id}")),
                album: Some(format!("Album {album_id}")),
                album_artist: Some(format!("Artist {artist_id}")),
                track_number: Some((i % 20) as u32 + 1),
                disc_number: Some(disc),
                year: Some(2000 + (album_id % 25)),
                genre: Some(if i % 3 == 0 {
                    "Rock".into()
                } else if i % 3 == 1 {
                    "Electronic".into()
                } else {
                    "Jazz".into()
                }),
                duration: Duration::from_secs(180 + (i as u64 % 120)),
                ..Default::default()
            },
            date_added: 1700000000 + i as u64,
        });
    }

    let start = Instant::now();
    let albums = group_tracks_by_album(&tracks, &[]);
    let album_elapsed = start.elapsed();

    assert_eq!(albums.len(), 500);
    assert!(
        album_elapsed < Duration::from_millis(500),
        "5,000 tracks album clustering must complete in < 500ms, took {:?}",
        album_elapsed
    );

    let start_artist = Instant::now();
    let artists = group_tracks_by_artist(&tracks, &[]);
    let artist_elapsed = start_artist.elapsed();

    assert_eq!(artists.len(), 100);
    assert!(
        artist_elapsed < Duration::from_millis(800),
        "5,000 tracks artist clustering must complete in < 800ms, took {:?}",
        artist_elapsed
    );

    let genres = extract_library_genres(&tracks, None);
    assert_eq!(genres.len(), 3);
}

#[test]
fn test_challenge_manager_concurrency_stress() {
    let temp_dir =
        std::env::temp_dir().join(format!("wavery_concurrency_stress_{}", uuid::Uuid::new_v4()));
    let library_root = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    std::fs::create_dir_all(&library_root).unwrap();

    let mgr = Arc::new(RwLock::new(
        SqliteLibraryManager::new(library_root.clone(), db_path).unwrap(),
    ));

    let running = Arc::new(AtomicBool::new(true));
    let read_counter = Arc::new(AtomicUsize::new(0));
    let mut reader_handles = Vec::new();

    for _ in 0..8 {
        let mgr_clone = Arc::clone(&mgr);
        let running_clone = Arc::clone(&running);
        let counter_clone = Arc::clone(&read_counter);

        reader_handles.push(thread::spawn(move || {
            while running_clone.load(Ordering::Relaxed) {
                if let Ok(guard) = mgr_clone.read() {
                    let _ = guard.list_albums();
                    let _ = guard.list_artists();
                    let _ = guard.list_genres();
                    counter_clone.fetch_add(3, Ordering::Relaxed);
                }
            }
        }));
    }

    let mgr_writer = Arc::clone(&mgr);
    let writer_handle = thread::spawn(move || {
        for cycle in 0..20 {
            {
                if let Ok(mut guard) = mgr_writer.write() {
                    guard.set_protected_artists(vec![
                        format!("Custom Artist {cycle}"),
                        "Tyler, The Creator".into(),
                    ]);
                }
            }
            thread::sleep(Duration::from_millis(5));
        }
    });

    writer_handle.join().unwrap();
    running.store(false, Ordering::Relaxed);

    for handle in reader_handles {
        handle.join().unwrap();
    }

    let total_reads = read_counter.load(Ordering::Relaxed);
    assert!(
        total_reads > 500,
        "High concurrency reader-writer stress completed {total_reads} reads"
    );

    let _ = std::fs::remove_dir_all(&temp_dir);
}

// =========================================================================
// SECTION 4: EMPIRICAL VERIFICATION OF REMEDIATED CRITICAL DEFECTS
// =========================================================================

/// Bug 1 Verification: Executes without panic and safely parses when protected artist has non-ASCII characters
/// and word boundary check fails.
#[test]
fn test_empirical_bug1_utf8_char_boundary_slicing_panic() {
    let custom_prot = vec!["БИ-2".to_string()];
    // "НеБИ-2" contains "БИ-2", but preceded by 'е' (alphanumeric), so word boundary fails.
    // Advancing search position by character UTF-8 length must execute cleanly without panic.
    let panic_result = std::panic::catch_unwind(|| {
        split_artists("НеБИ-2 & БИ-2", &custom_prot)
    });

    assert!(
        panic_result.is_ok(),
        "Unicode character traversal in mask_protected_artists MUST NOT panic on non-ASCII multi-byte UTF-8 char boundary"
    );

    let artists = panic_result.unwrap();
    assert_eq!(artists, vec!["НеБИ-2", "БИ-2"]);
}

/// Bug 2 Verification: 3-Track Compilation detection with mathematical dominance threshold.
#[test]
fn test_empirical_bug2_3_track_compilation_integer_division_truncation() {
    let make_track = |id: &str, artist: &str, num: u32| Track {
        id: id.to_string(),
        source: TrackSource::Managed(PathBuf::from(format!("/Music/Sampler 3/{num:02}.flac"))),
        metadata: TrackMetadata {
            title: Some(format!("Track {num}")),
            artist: Some(artist.to_string()),
            album: Some("Sampler 3".to_string()),
            album_artist: None,
            track_number: Some(num),
            disc_number: Some(1),
            year: Some(2024),
            duration: Duration::from_secs(200),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    let comp_3_tracks = vec![
        make_track("t1", "Artist 1", 1),
        make_track("t2", "Artist 2", 2),
        make_track("t3", "Artist 3", 3),
    ];

    let albums = group_tracks_by_album(&comp_3_tracks, &[]);
    assert_eq!(albums.len(), 1);
    assert!(
        albums[0].is_compilation,
        "3 tracks with 3 distinct artists (100% diversity) MUST be detected as compilation"
    );
    assert_eq!(
        albums[0].artist,
        "Various Artists",
        "Album artist must be 'Various Artists'"
    );
}

/// Bug 3 Verification: Explicit "Various Artists" album_artist Tag Respected.
#[test]
fn test_empirical_bug3_explicit_various_artists_ignored() {
    let make_track = |id: &str, artist: &str, num: u32| Track {
        id: id.to_string(),
        source: TrackSource::Managed(PathBuf::from(format!("/Music/Split/{num:02}.flac"))),
        metadata: TrackMetadata {
            title: Some(format!("Track {num}")),
            artist: Some(artist.to_string()),
            album: Some("Split EP".to_string()),
            album_artist: Some("Various Artists".to_string()),
            track_number: Some(num),
            disc_number: Some(1),
            year: Some(2024),
            duration: Duration::from_secs(200),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    let split_tracks = vec![
        make_track("v1", "Artist A", 1),
        make_track("v2", "Artist B", 2),
    ];

    let albums = group_tracks_by_album(&split_tracks, &[]);
    assert_eq!(albums.len(), 1);
    assert!(
        albums[0].is_compilation,
        "Album with explicit 'Various Artists' album_artist tag MUST be flagged as compilation"
    );
    assert_eq!(
        albums[0].artist,
        "Various Artists",
        "Album artist must be 'Various Artists'"
    );
}

/// Bug 4 Verification: Multi-disc Album Subfolder Normalization.
#[test]
fn test_empirical_bug4_multi_disc_subfolder_fragmentation() {
    let t_disc1 = Track {
        id: "d1".to_string(),
        source: TrackSource::Managed(PathBuf::from("/Music/Pink Floyd/The Wall/Disc 1/01.flac")),
        metadata: TrackMetadata {
            title: Some("In the Flesh?".into()),
            artist: Some("Pink Floyd".into()),
            album: Some("The Wall".into()),
            album_artist: Some("Pink Floyd".into()),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(1979),
            duration: Duration::from_secs(200),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    let t_disc2 = Track {
        id: "d2".to_string(),
        source: TrackSource::Managed(PathBuf::from("/Music/Pink Floyd/The Wall/Disc 2/01.flac")),
        metadata: TrackMetadata {
            title: Some("Hey You".into()),
            artist: Some("Pink Floyd".into()),
            album: Some("The Wall".into()),
            album_artist: Some("Pink Floyd".into()),
            track_number: Some(1),
            disc_number: Some(2),
            year: Some(1979),
            duration: Duration::from_secs(280),
            ..Default::default()
        },
        date_added: 1700000000,
    };

    let albums = group_tracks_by_album(&[t_disc1, t_disc2], &[]);

    assert_eq!(
        albums.len(),
        1,
        "Multi-disc album with Disc 1 and Disc 2 subfolders should be clustered into ONE album, but was split into {} albums",
        albums.len()
    );
    assert_eq!(albums[0].track_count, 2);
    assert_eq!(albums[0].total_duration_secs, 480);
    assert_eq!(albums[0].tracks[0].metadata.disc_number, Some(1));
    assert_eq!(albums[0].tracks[1].metadata.disc_number, Some(2));
}

/// Bug 5 Verification: Delimiter-Only String Returns "Unknown Artist".
#[test]
fn test_empirical_bug5_delimiter_only_fallback() {
    let res = split_artists(";,/,&&,", &[]);
    assert_eq!(
        res,
        vec!["Unknown Artist"],
        "Pathological delimiter string must normalize to 'Unknown Artist'"
    );
}


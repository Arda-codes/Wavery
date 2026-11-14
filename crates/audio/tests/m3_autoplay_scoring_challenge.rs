//! Adversarial stress test suite for Milestone M3:
//! Queue Authority & Autoplay Recommendation Engine.
//!
//! Evaluates:
//! 1. Autoplay scoring heuristics (Artist +50, Album +30, Genre +20, Perfect +100).
//! 2. History penalty dynamics (-100 net penalty vs unplayed candidates).
//! 3. Candidate pool exhaustion fallback (non-current fallback, single-track library, empty pool).
//! 4. Empty queue, null/empty/unknown metadata edge cases.
//! 5. Equal-score top-tier pseudo-random distribution.
//! 6. Large candidate pool performance and resilience (10,000 tracks).
//! 7. `QueueStateSnapshot` serde roundtrips:
//!    - Outgoing camelCase serialization key verification (`currentTrack`, `userQueue`, `isShuffle`, `loopMode`, `isAutoplay`, etc.)
//!    - Incoming snake_case deserialization backwards-compatibility.
//!    - Data fidelity roundtrips and default fallback tolerance.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;
use wavery_audio::queue::StandardQueueManager;
use wavery_core::models::{LoopMode, QueueStateSnapshot, Track, TrackMetadata, TrackSource};
use wavery_core::traits::QueueManager;

fn make_track(id: &str, artist: &str, album: &str, genre: &str) -> Track {
    Track {
        id: id.to_string(),
        source: TrackSource::Managed(PathBuf::from(format!("/music/{id}.flac"))),
        metadata: TrackMetadata {
            title: Some(format!("Title {id}")),
            artist: if artist.is_empty() {
                None
            } else {
                Some(artist.to_string())
            },
            album: if album.is_empty() {
                None
            } else {
                Some(album.to_string())
            },
            album_artist: None,
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2026),
            genre: if genre.is_empty() {
                None
            } else {
                Some(genre.to_string())
            },
            duration: Duration::from_secs(210),
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
// 1. Autoplay Candidate Scoring: Hierarchy (+50 Artist, +30 Album, +20 Genre)
// =========================================================================

#[test]
fn test_autoplay_scoring_hierarchy_artist_vs_album_vs_genre() {
    let mut q = StandardQueueManager::new();
    let current = make_track("curr", "Radiohead", "OK Computer", "Alternative Rock");
    q.set_context_queue(vec![current], 0);

    let t_artist = make_track("t_artist", "Radiohead", "Kid A", "Electronic"); // +50
    let t_album = make_track("t_album", "Various Artists", "OK Computer", "Post-Rock"); // +30
    let t_genre = make_track("t_genre", "Coldplay", "Parachutes", "Alternative Rock"); // +20
    let t_none = make_track("t_none", "Miles Davis", "Kind of Blue", "Jazz"); // 0

    // Test 1: Full pool -> Artist (+50) MUST win every time over Album (+30), Genre (+20), None (0)
    let full_pool = vec![
        t_none.clone(),
        t_genre.clone(),
        t_album.clone(),
        t_artist.clone(),
    ];
    for _ in 0..50 {
        let chosen = q
            .select_autoplay_candidate(&full_pool)
            .expect("must select candidate");
        assert_eq!(
            chosen.id, "t_artist",
            "Artist match (+50) must beat Album (+30), Genre (+20), and None (0)"
        );
    }

    // Test 2: Pool without Artist -> Album (+30) MUST win over Genre (+20) and None (0)
    let pool_no_artist = vec![t_none.clone(), t_genre.clone(), t_album.clone()];
    for _ in 0..50 {
        let chosen = q
            .select_autoplay_candidate(&pool_no_artist)
            .expect("must select candidate");
        assert_eq!(
            chosen.id, "t_album",
            "Album match (+30) must beat Genre (+20) and None (0)"
        );
    }

    // Test 3: Pool without Artist or Album -> Genre (+20) MUST win over None (0)
    let pool_genre_vs_none = vec![t_none.clone(), t_genre.clone()];
    for _ in 0..50 {
        let chosen = q
            .select_autoplay_candidate(&pool_genre_vs_none)
            .expect("must select candidate");
        assert_eq!(
            chosen.id, "t_genre",
            "Genre match (+20) must beat None (0)"
        );
    }

    // Test 4: Pairwise head-to-head battles
    // Artist vs Album
    for _ in 0..20 {
        let chosen = q
            .select_autoplay_candidate(&[t_album.clone(), t_artist.clone()])
            .unwrap();
        assert_eq!(chosen.id, "t_artist");
    }
    // Album vs Genre
    for _ in 0..20 {
        let chosen = q
            .select_autoplay_candidate(&[t_genre.clone(), t_album.clone()])
            .unwrap();
        assert_eq!(chosen.id, "t_album");
    }
    // Artist vs Genre
    for _ in 0..20 {
        let chosen = q
            .select_autoplay_candidate(&[t_genre.clone(), t_artist.clone()])
            .unwrap();
        assert_eq!(chosen.id, "t_artist");
    }
}

// =========================================================================
// 2. Autoplay Candidate Scoring: Perfect Match (+100) vs Subsets
// =========================================================================

#[test]
fn test_autoplay_scoring_perfect_match_vs_subsets() {
    let mut q = StandardQueueManager::new();
    let current = make_track("curr", "Daft Punk", "Discovery", "French House");
    q.set_context_queue(vec![current], 0);

    let t_perfect = make_track("t_perfect", "Daft Punk", "Discovery", "French House"); // 50+30+20 = 100
    let t_art_alb = make_track("t_art_alb", "Daft Punk", "Discovery", "Electro"); // 50+30 = 80
    let t_art_gen = make_track("t_art_gen", "Daft Punk", "Human After All", "French House"); // 50+20 = 70
    let t_alb_gen = make_track(
        "t_alb_gen",
        "Thomas Bangalter",
        "Discovery",
        "French House",
    ); // 30+20 = 50
    let t_art_only = make_track("t_art_only", "Daft Punk", "Random Access Memories", "Disco"); // 50
    let t_alb_only = make_track("t_alb_only", "Guy-Manuel", "Discovery", "Synthwave"); // 30
    let t_gen_only = make_track("t_gen_only", "Justice", "Cross", "French House"); // 20
    let t_unrelated = make_track("t_unrelated", "Bach", "Goldberg Variations", "Classical"); // 0

    let all_candidates = vec![
        t_unrelated.clone(),
        t_gen_only.clone(),
        t_alb_only.clone(),
        t_art_only.clone(),
        t_alb_gen.clone(),
        t_art_gen.clone(),
        t_art_alb.clone(),
        t_perfect.clone(),
    ];

    // Perfect (+100) must decisively defeat all subsets
    for _ in 0..50 {
        let chosen = q
            .select_autoplay_candidate(&all_candidates)
            .expect("must select");
        assert_eq!(
            chosen.id, "t_perfect",
            "Perfect match (+100) must win over all sub-combinations"
        );
    }

    // Without Perfect (+100), Artist+Album (+80) must win
    let without_perfect: Vec<_> = all_candidates
        .iter()
        .filter(|t| t.id != "t_perfect")
        .cloned()
        .collect();
    for _ in 0..50 {
        let chosen = q
            .select_autoplay_candidate(&without_perfect)
            .expect("must select");
        assert_eq!(
            chosen.id, "t_art_alb",
            "Artist+Album (+80) must beat Artist+Genre (+70)"
        );
    }

    // Without Artist+Album (+80), Artist+Genre (+70) must win
    let without_art_alb: Vec<_> = without_perfect
        .iter()
        .filter(|t| t.id != "t_art_alb")
        .cloned()
        .collect();
    for _ in 0..50 {
        let chosen = q
            .select_autoplay_candidate(&without_art_alb)
            .expect("must select");
        assert_eq!(
            chosen.id, "t_art_gen",
            "Artist+Genre (+70) must beat Album+Genre (+50) and Artist-only (+50)"
        );
    }

    // Without Artist+Genre (+70), Album+Genre (+50) and Artist-only (+50) form a tie
    let without_art_gen: Vec<_> = without_art_alb
        .iter()
        .filter(|t| t.id != "t_art_gen")
        .cloned()
        .collect();
    let mut seen_ids = HashSet::new();
    for _ in 0..100 {
        let chosen = q
            .select_autoplay_candidate(&without_art_gen)
            .expect("must select");
        assert!(
            chosen.id == "t_alb_gen" || chosen.id == "t_art_only",
            "Top tier (+50) must only be t_alb_gen or t_art_only, got {}",
            chosen.id
        );
        seen_ids.insert(chosen.id);
    }
    assert_eq!(
        seen_ids.len(),
        2,
        "Equal top tier (+50) must pseudo-randomize between both tied candidates"
    );
}

// =========================================================================
// 3. Autoplay History Penalty Dynamics (-100 Penalty vs Unplayed Candidates)
// =========================================================================

#[test]
fn test_autoplay_history_penalty_dynamics() {
    let mut q = StandardQueueManager::new();
    let c0 = make_track("c0", "Pink Floyd", "The Wall", "Progressive Rock");
    let c1 = make_track(
        "c1",
        "Pink Floyd",
        "The Dark Side of the Moon",
        "Progressive Rock",
    );

    // Play c0 then c1, so c0 enters session history
    q.set_context_queue(vec![c0.clone(), c1.clone()], 0);
    q.next(); // transitions to c1, c0 recorded in history
    assert_eq!(q.current_track().unwrap().id, "c1");
    assert_eq!(q.history().len(), 1);
    assert_eq!(q.history()[0].id, "c0");

    // c0 has matching Artist (+50), Album ("The Wall" != "Dark Side", 0), Genre (+20) -> +70
    // But c0 is in history -> -100 penalty -> Net score: -30
    // t_unplayed has 0 matching attributes, but is unplayed -> Net score: 0
    let t_unplayed_zero = make_track("t_unplayed_zero", "The Beatles", "Abbey Road", "Pop"); // 0 net

    // Clear current queue so c0 is unqueued (not in queue, but remains in history)
    let mut q_history_test = StandardQueueManager::new();
    q_history_test.set_context_queue(vec![c1.clone()], 0);
    // Populate history by stepping through a dummy track
    let mut q_temp = StandardQueueManager::new();
    let h_artist = make_track("h_artist", "Pink Floyd", "Animals", "Rock"); // +50 artist, but in history
    q_temp.set_context_queue(vec![h_artist.clone(), c1.clone()], 0);
    q_temp.next(); // h_artist moved to history

    // Now test autoplay on q_temp:
    // candidate pool has h_artist (in history, +50 - 100 = -50) vs t_unplayed_zero (not in history, 0)
    let candidates = vec![h_artist.clone(), t_unplayed_zero.clone()];
    for _ in 0..50 {
        let chosen = q_temp
            .select_autoplay_candidate(&candidates)
            .expect("must select candidate");
        assert_eq!(
            chosen.id, "t_unplayed_zero",
            "Unplayed candidate with 0 matches (net 0) MUST beat track in history with matching artist (net -50)"
        );
    }

    // Test: Candidate in history with ALL THREE matches (+100 - 100 = 0 net)
    // vs Unplayed candidate with Genre match (+20 net)
    let h_perfect = make_track(
        "h_perfect",
        "Pink Floyd",
        "The Dark Side of the Moon",
        "Progressive Rock",
    ); // in history: +100 - 100 = 0 net
    let mut q_temp2 = StandardQueueManager::new();
    q_temp2.set_context_queue(vec![h_perfect.clone(), c1.clone()], 0);
    q_temp2.next(); // h_perfect moves into history

    let unplayed_genre = make_track("unplayed_genre", "King Crimson", "Red", "Progressive Rock"); // +20 net
    let pool2 = vec![h_perfect.clone(), unplayed_genre.clone()];
    for _ in 0..50 {
        let chosen = q_temp2
            .select_autoplay_candidate(&pool2)
            .expect("must select");
        assert_eq!(
            chosen.id, "unplayed_genre",
            "Unplayed candidate with genre match (+20 net) MUST beat history track even with all 3 matches (0 net)"
        );
    }

    // Test: When ALL unqueued candidates are in history, highest net score still wins
    // h_artist (-50 net) vs h_none (-100 net)
    let h_none = make_track("h_none", "Miles Davis", "Kind of Blue", "Jazz"); // in history: 0 - 100 = -100 net
    let mut q_all_hist = StandardQueueManager::new();
    q_all_hist.set_context_queue(vec![h_artist.clone(), h_none.clone(), c1.clone()], 0);
    q_all_hist.next();
    q_all_hist.next(); // h_artist and h_none in history

    let hist_pool = vec![h_none.clone(), h_artist.clone()];
    for _ in 0..50 {
        let chosen = q_all_hist
            .select_autoplay_candidate(&hist_pool)
            .expect("must select");
        assert_eq!(
            chosen.id, "h_artist",
            "When all candidates are in history, higher net score (-50 vs -100) must win"
        );
    }
}

// =========================================================================
// 4. Autoplay Candidate Pool Exhaustion & Fallback
// =========================================================================

#[test]
fn test_autoplay_candidate_pool_exhaustion_fallback() {
    let mut q = StandardQueueManager::new();
    let t1 = make_track("t1", "Artist 1", "Album 1", "Rock");
    let t2 = make_track("t2", "Artist 1", "Album 1", "Rock");
    let t3 = make_track("t3", "Artist 2", "Album 2", "Pop");
    let t4 = make_track("t4", "Artist 3", "Album 3", "Jazz");

    // All 4 tracks in library are currently queued!
    // Context queue: [t1, t2], User priority queue: [t3, t4]
    q.set_context_queue(vec![t1.clone(), t2.clone()], 0);
    q.push_back(t3.clone());
    q.push_back(t4.clone());

    assert_eq!(q.queue().len(), 4);
    assert_eq!(q.current_track().unwrap().id, "t1");

    let library = vec![t1.clone(), t2.clone(), t3.clone(), t4.clone()];

    // When all tracks are queued, autoplay must fallback to any track other than current
    for _ in 0..100 {
        let chosen = q
            .select_autoplay_candidate(&library)
            .expect("must return fallback candidate on pool exhaustion");
        assert_ne!(
            chosen.id, "t1",
            "Autoplay fallback must NEVER select currently playing track when alternatives exist!"
        );
        assert!(
            chosen.id == "t2" || chosen.id == "t3" || chosen.id == "t4",
            "Must choose among other queued tracks"
        );
    }

    // Now advance to t2
    q.next();
    let curr_id = q.current_track().unwrap().id.clone();
    for _ in 0..50 {
        let chosen = q
            .select_autoplay_candidate(&library)
            .expect("must return candidate");
        assert_ne!(
            chosen.id, curr_id,
            "Autoplay fallback must never select current track when advanced"
        );
    }
}

// =========================================================================
// 5. Autoplay Edge Cases: Single-Track Library, Empty Library, Empty Queue
// =========================================================================

#[test]
fn test_autoplay_edge_cases_single_empty_null() {
    let mut q = StandardQueueManager::new();

    // Edge Case 5A: Single-track library, currently playing that track
    let solo = make_track("solo", "Solo Artist", "Solo Album", "Solo Genre");
    q.set_context_queue(vec![solo.clone()], 0);
    let single_library = vec![solo.clone()];

    for _ in 0..20 {
        let chosen = q.select_autoplay_candidate(&single_library);
        assert!(
            chosen.is_some(),
            "Single-track library must not panic or return None"
        );
        assert_eq!(chosen.unwrap().id, "solo");
    }

    // Edge Case 5B: Empty candidate pool (&[]) with playing track
    let empty_pool: Vec<Track> = Vec::new();
    let fallback = q.select_autoplay_candidate(&empty_pool);
    assert!(
        fallback.is_some(),
        "Empty candidate pool should fall back to current track"
    );
    assert_eq!(fallback.unwrap().id, "solo");

    // Edge Case 5C: Empty candidate pool (&[]) AND empty queue
    let empty_q = StandardQueueManager::new();
    let empty_res = empty_q.select_autoplay_candidate(&empty_pool);
    assert_eq!(
        empty_res, None,
        "Empty queue and empty pool must safely return None"
    );

    // Edge Case 5D: Empty queue (no track loaded), but non-empty candidate pool
    let pool = vec![
        make_track("p1", "Artist 1", "Album 1", "Rock"),
        make_track("p2", "Artist 2", "Album 2", "Pop"),
    ];
    let candidate = empty_q.select_autoplay_candidate(&pool);
    assert!(
        candidate.is_some(),
        "Empty queue with available pool must return an unplayed candidate"
    );
    let cid = candidate.unwrap().id;
    assert!(cid == "p1" || cid == "p2");

    // Edge Case 5E: Current track with None / empty / "unknown" metadata
    let mut q_unknown = StandardQueueManager::new();
    let unk_track = Track {
        id: "unk_curr".into(),
        source: TrackSource::Managed(PathBuf::from("/music/unk.mp3")),
        metadata: TrackMetadata {
            title: Some("Unknown Title".into()),
            artist: Some("Unknown Artist".into()),
            album: Some("Unknown Album".into()),
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: Some("Unknown Genre".into()),
            duration: Duration::from_secs(120),
            sample_rate: None,
            bit_depth: None,
            channels: None,
            format: "MP3".into(),
            lyrics: None,
            ..Default::default()
        },
        date_added: 0,
    };
    q_unknown.set_context_queue(vec![unk_track], 0);

    // Candidate has "Unknown Artist" as well - should NOT receive false match points
    let cand_unk = Track {
        id: "cand_unk".into(),
        source: TrackSource::Managed(PathBuf::from("/music/c_unk.mp3")),
        metadata: TrackMetadata {
            title: Some("Another Track".into()),
            artist: Some("unknown artist".into()),
            album: Some("unknown album".into()),
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: Some("unknown genre".into()),
            duration: Duration::from_secs(120),
            sample_rate: None,
            bit_depth: None,
            channels: None,
            format: "MP3".into(),
            lyrics: None,
            ..Default::default()
        },
        date_added: 0,
    };
    let cand_valid = make_track("cand_valid", "Real Artist", "Real Album", "Rock");

    // Neither cand_unk nor cand_valid match legitimate metadata, so both score 0
    let unk_pool = vec![cand_unk.clone(), cand_valid.clone()];
    let mut seen_ids = HashSet::new();
    for _ in 0..100 {
        let chosen = q_unknown.select_autoplay_candidate(&unk_pool).unwrap();
        seen_ids.insert(chosen.id);
    }
    // Since unknown strings don't grant bonuses, scores are tied at 0 and both should be chosen
    assert_eq!(
        seen_ids.len(),
        2,
        "Unknown artist/album/genre strings must not produce false match advantages"
    );
}

// =========================================================================
// 6. Autoplay Large Candidate Pool Stress Test (10,000 Tracks)
// =========================================================================

#[test]
fn test_autoplay_large_candidate_pool_stress_10k() {
    let mut q = StandardQueueManager::new();
    let current = make_track("curr_metal", "Megadeth", "Rust in Peace", "Thrash Metal");
    q.set_context_queue(vec![current], 0);

    // Generate 10,000 tracks
    let mut pool = Vec::with_capacity(10_000);
    // 1 perfect match track
    pool.push(make_track(
        "t_perfect",
        "Megadeth",
        "Rust in Peace",
        "Thrash Metal",
    ));
    // 5 artist-only matches
    for i in 0..5 {
        pool.push(make_track(
            &format!("t_artist_{i}"),
            "Megadeth",
            &format!("Other Album {i}"),
            "Heavy Metal",
        ));
    }
    // 10 album-only matches
    for i in 0..10 {
        pool.push(make_track(
            &format!("t_album_{i}"),
            &format!("Tribute Artist {i}"),
            "Rust in Peace",
            "Metal",
        ));
    }
    // 20 genre-only matches
    for i in 0..20 {
        pool.push(make_track(
            &format!("t_genre_{i}"),
            &format!("Slayer {i}"),
            &format!("Album {i}"),
            "Thrash Metal",
        ));
    }
    // 9,964 completely unrelated tracks
    for i in 0..9_964 {
        pool.push(make_track(
            &format!("t_unrelated_{i}"),
            &format!("Ambient Artist {i}"),
            &format!("Ambient Album {i}"),
            "Ambient",
        ));
    }
    assert_eq!(pool.len(), 10_000);

    let start = std::time::Instant::now();
    let chosen = q
        .select_autoplay_candidate(&pool)
        .expect("must select candidate");
    let elapsed = start.elapsed();

    assert_eq!(
        chosen.id, "t_perfect",
        "Must pick the 1 perfect match out of 10,000 candidates"
    );
    assert!(
        elapsed < Duration::from_millis(500),
        "10k candidate selection took too long: {:?}",
        elapsed
    );

    // Now queue t_perfect, verify one of the 5 artist matches is picked next
    q.push_back(chosen);
    let chosen2 = q
        .select_autoplay_candidate(&pool)
        .expect("must select candidate");
    assert!(
        chosen2.id.starts_with("t_artist_"),
        "After t_perfect is queued, top tier must be one of the Megadeth tracks, got {}",
        chosen2.id
    );
}

// =========================================================================
// 7. QueueStateSnapshot Serde: camelCase Serialization Verification
// =========================================================================

#[test]
fn test_queue_state_snapshot_serde_camelcase_serialization() {
    let t_curr = make_track("curr", "Artist A", "Album A", "Rock");
    let t_u1 = make_track("u1", "Artist B", "Album B", "Pop");
    let t_u2 = make_track("u2", "Artist C", "Album C", "Jazz");
    let t_c1 = make_track("c1", "Artist D", "Album D", "Classical");
    let t_c2 = make_track("c2", "Artist E", "Album E", "Electronic");
    let t_h1 = make_track("h1", "Artist F", "Album F", "Blues");

    let snapshot = QueueStateSnapshot {
        current_track: Some(t_curr.clone()),
        current_index: Some(1),
        user_queue: vec![t_u1.clone(), t_u2.clone()],
        context_queue: vec![t_c1.clone(), t_c2.clone()],
        context_index: Some(0),
        queue: vec![t_c1, t_u1, t_u2, t_c2],
        is_shuffle: true,
        loop_mode: LoopMode::Queue,
        is_autoplay: true,
        history: vec![t_h1],
        shuffle_indices: vec![1, 0, 2, 3],
        shuffle_pos: 0,
    };

    let json_val = serde_json::to_value(&snapshot).expect("must serialize QueueStateSnapshot");
    let obj = json_val
        .as_object()
        .expect("serialized snapshot must be a JSON object");

    // Explicit verification of required camelCase keys:
    // currentTrack, currentIndex, userQueue, contextQueue, contextIndex, queue, isShuffle, loopMode, isAutoplay, history
    assert!(
        obj.contains_key("currentTrack"),
        "JSON must contain camelCase 'currentTrack'"
    );
    assert!(
        obj.contains_key("currentIndex"),
        "JSON must contain camelCase 'currentIndex'"
    );
    assert!(
        obj.contains_key("userQueue"),
        "JSON must contain camelCase 'userQueue'"
    );
    assert!(
        obj.contains_key("contextQueue"),
        "JSON must contain camelCase 'contextQueue'"
    );
    assert!(
        obj.contains_key("contextIndex"),
        "JSON must contain camelCase 'contextIndex'"
    );
    assert!(
        obj.contains_key("queue"),
        "JSON must contain camelCase 'queue'"
    );
    assert!(
        obj.contains_key("isShuffle"),
        "JSON must contain camelCase 'isShuffle'"
    );
    assert!(
        obj.contains_key("loopMode"),
        "JSON must contain camelCase 'loopMode'"
    );
    assert!(
        obj.contains_key("isAutoplay"),
        "JSON must contain camelCase 'isAutoplay'"
    );
    assert!(
        obj.contains_key("history"),
        "JSON must contain camelCase 'history'"
    );

    // Verify ABSOLUTE ABSENCE of snake_case keys in outgoing serialization
    assert!(
        !obj.contains_key("current_track"),
        "JSON must NOT contain snake_case 'current_track'"
    );
    assert!(
        !obj.contains_key("current_index"),
        "JSON must NOT contain snake_case 'current_index'"
    );
    assert!(
        !obj.contains_key("user_queue"),
        "JSON must NOT contain snake_case 'user_queue'"
    );
    assert!(
        !obj.contains_key("context_queue"),
        "JSON must NOT contain snake_case 'context_queue'"
    );
    assert!(
        !obj.contains_key("context_index"),
        "JSON must NOT contain snake_case 'context_index'"
    );
    assert!(
        !obj.contains_key("is_shuffle"),
        "JSON must NOT contain snake_case 'is_shuffle'"
    );
    assert!(
        !obj.contains_key("loop_mode"),
        "JSON must NOT contain snake_case 'loop_mode'"
    );
    assert!(
        !obj.contains_key("is_autoplay"),
        "JSON must NOT contain snake_case 'is_autoplay'"
    );

    // Verify value representations
    assert_eq!(obj["isShuffle"], serde_json::Value::Bool(true));
    assert_eq!(obj["isAutoplay"], serde_json::Value::Bool(true));
    assert_eq!(obj["currentIndex"], serde_json::Value::from(1));
    assert_eq!(obj["loopMode"], serde_json::Value::String("Queue".into()));
    assert_eq!(obj["userQueue"].as_array().unwrap().len(), 2);
    assert_eq!(obj["contextQueue"].as_array().unwrap().len(), 2);
    assert_eq!(obj["history"].as_array().unwrap().len(), 1);
}

// =========================================================================
// 8. QueueStateSnapshot Serde: snake_case Deserialization Tolerance
// =========================================================================

#[test]
fn test_queue_state_snapshot_serde_snake_case_deserialization() {
    let snake_json = r#"{
        "current_track": {
            "id": "t_snake",
            "source": { "Managed": "/music/snake.flac" },
            "metadata": {
                "title": "Snake Title",
                "artist": "Snake Artist",
                "album": "Snake Album",
                "album_artist": null,
                "track_number": 1,
                "disc_number": 1,
                "year": 2026,
                "genre": "Rock",
                "duration": { "secs": 180, "nanos": 0 },
                "sample_rate": 44100,
                "bit_depth": 16,
                "channels": 2,
                "format": "FLAC",
                "lyrics": null
            },
            "date_added": 1700000000
        },
        "current_index": 2,
        "user_queue": [],
        "context_queue": [],
        "context_index": 1,
        "queue": [],
        "is_shuffle": true,
        "loop_mode": "Track",
        "is_autoplay": true,
        "history": []
    }"#;

    let snapshot: QueueStateSnapshot = serde_json::from_str(snake_json)
        .expect("QueueStateSnapshot MUST successfully deserialize from snake_case JSON aliases");

    assert!(snapshot.current_track.is_some());
    assert_eq!(snapshot.current_track.as_ref().unwrap().id, "t_snake");
    assert_eq!(snapshot.current_index, Some(2));
    assert_eq!(snapshot.context_index, Some(1));
    assert!(snapshot.is_shuffle);
    assert_eq!(snapshot.loop_mode, LoopMode::Track);
    assert!(snapshot.is_autoplay);
}

// =========================================================================
// 9. QueueStateSnapshot Serde: Full Data Fidelity Roundtrips & Defaults
// =========================================================================

#[test]
fn test_queue_state_snapshot_serde_fidelity_and_defaults() {
    // Subtest 9A: Full roundtrip data fidelity
    let t1 = make_track("t1", "Artist 1", "Album 1", "Rock");
    let t2 = make_track("t2", "Artist 2", "Album 2", "Jazz");
    let t3 = make_track("t3", "Artist 3", "Album 3", "Electronic");

    for loop_mode in [LoopMode::Off, LoopMode::Track, LoopMode::Queue] {
        for is_shuffle in [false, true] {
            for is_autoplay in [false, true] {
                let original = QueueStateSnapshot {
                    current_track: Some(t1.clone()),
                    current_index: Some(0),
                    user_queue: vec![t2.clone()],
                    context_queue: vec![t1.clone(), t3.clone()],
                    context_index: Some(0),
                    queue: vec![t1.clone(), t2.clone(), t3.clone()],
                    is_shuffle,
                    loop_mode,
                    is_autoplay,
                    history: vec![t3.clone()],
                    shuffle_indices: if is_shuffle { vec![0, 1, 2] } else { Vec::new() },
                    shuffle_pos: 0,
                };

                let serialized = serde_json::to_string(&original).unwrap();
                let deserialized: QueueStateSnapshot = serde_json::from_str(&serialized).unwrap();
                assert_eq!(
                    original, deserialized,
                    "Roundtrip failed for loop_mode={:?}, shuffle={}, autoplay={}",
                    loop_mode, is_shuffle, is_autoplay
                );
            }
        }
    }

    // Subtest 9B: Minimal / Empty JSON defaults smoothly without error
    let empty_json = "{}";
    let default_snap: QueueStateSnapshot =
        serde_json::from_str(empty_json).expect("Empty JSON must deserialize into default snapshot");
    assert_eq!(default_snap, QueueStateSnapshot::default());
    assert_eq!(default_snap.current_track, None);
    assert_eq!(default_snap.current_index, None);
    assert!(default_snap.user_queue.is_empty());
    assert!(default_snap.context_queue.is_empty());
    assert_eq!(default_snap.context_index, None);
    assert!(!default_snap.is_shuffle);
    assert_eq!(default_snap.loop_mode, LoopMode::Off);
    assert!(!default_snap.is_autoplay);
    assert!(default_snap.history.is_empty());

    // Subtest 9C: Partial JSON with missing fields
    let partial_json = r#"{
        "isAutoplay": true,
        "loopMode": "Queue"
    }"#;
    let partial_snap: QueueStateSnapshot =
        serde_json::from_str(partial_json).expect("Partial JSON must deserialize smoothly");
    assert!(partial_snap.is_autoplay);
    assert_eq!(partial_snap.loop_mode, LoopMode::Queue);
    assert_eq!(partial_snap.current_track, None);
    assert!(!partial_snap.is_shuffle);
}

// =========================================================================
// 10. Autoplay Top-Tier Tie-Breaking Distribution
// =========================================================================

#[test]
fn test_autoplay_tie_breaking_distribution() {
    let mut q = StandardQueueManager::new();
    let current = make_track("curr", "The National", "High Violet", "Indie Rock");
    q.set_context_queue(vec![current], 0);

    // Three candidates with exact same score: all have matching Artist (+50)
    let c1 = make_track("c1", "The National", "Boxer", "Rock");
    let c2 = make_track("c2", "The National", "Trouble Will Find Me", "Alternative");
    let c3 = make_track("c3", "The National", "Sleep Well Beast", "Post-Punk");

    let pool = vec![c1.clone(), c2.clone(), c3.clone()];
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for _ in 0..300 {
        let chosen = q
            .select_autoplay_candidate(&pool)
            .expect("must select candidate");
        *counts.entry(chosen.id).or_insert(0) += 1;
    }

    assert_eq!(
        counts.len(),
        3,
        "All three tied candidates must be chosen at least once across 300 trials"
    );
    for (id, count) in &counts {
        assert!(
            *count > 40,
            "Distribution for candidate {} was suspiciously low ({}/300)",
            id,
            count
        );
    }
}

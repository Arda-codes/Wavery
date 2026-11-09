//! Adversarial Stress & Verification Test Suite for Milestone M3:
//! Queue Authority & Autoplay Recommendation Engine.
//!
//! Evaluates the core requirements:
//! 1. User priority queue transitions: verify adding via `play_next` and `push_back` drains
//!    user queue strictly when items play, and preserves `context_idx`.
//! 2. Reordering: reorder user queue items when interleaved with context tracks and verify
//!    that no context tracks are corrupted.
//! 3. Backward traversal with threshold: call `previous()` with Duration > 3s (4s) verifying
//!    restart of current track without history pop, and <= 3s (2s) verifying backward traversal
//!    and history pop.
//! 4. History cap: verify history length never exceeds 100 entries under extreme usage.
//! 5. Shuffle & loop modes: verify LIFO splicing and queue loop wraparound under stress.
//! 6. Autoplay recommendation engine: scoring oracle, candidate pool exclusion, history penalty,
//!    and pool exhaustion handling.
//! 7. 1,000-step randomized state machine fuzzing.

use rand::prelude::*;
use std::path::PathBuf;
use std::time::Duration;
use wavery_audio::queue::StandardQueueManager;
use wavery_core::models::{LoopMode, Track, TrackMetadata, TrackSource};
use wavery_core::traits::QueueManager;

/// Helper to create reproducible track instances for adversarial testing.
fn make_test_track(id: &str, artist: &str, album: &str, genre: &str, duration_secs: u64) -> Track {
    Track {
        id: id.to_string(),
        source: TrackSource::Managed(PathBuf::from(format!("/music/{id}.flac"))),
        metadata: TrackMetadata {
            title: Some(format!("Title {id}")),
            artist: Some(artist.to_string()),
            album: Some(album.to_string()),
            album_artist: Some(artist.to_string()),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2026),
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

// ============================================================================
// 1. USER PRIORITY QUEUE TRANSITIONS & CONTEXT_IDX PRESERVATION
// ============================================================================

#[test]
fn test_adversarial_user_priority_queue_drain_and_context_idx_invariants() {
    let mut q = StandardQueueManager::new();

    let c0 = make_test_track("c0", "Artist A", "Album 1", "Rock", 180);
    let c1 = make_test_track("c1", "Artist A", "Album 1", "Rock", 190);
    let c2 = make_test_track("c2", "Artist A", "Album 1", "Rock", 200);
    let c3 = make_test_track("c3", "Artist A", "Album 1", "Rock", 210);
    let c4 = make_test_track("c4", "Artist A", "Album 1", "Rock", 220);

    q.set_context_queue(vec![c0.clone(), c1.clone(), c2.clone(), c3.clone(), c4.clone()], 0);
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.context_index(), Some(0));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("c0"));
    assert_eq!(q.user_queue().len(), 0);

    // Queue 2 priority items via play_next (LIFO order: u2 will play before u1)
    let u1 = make_test_track("u1", "Artist B", "Album 2", "Pop", 200);
    let u2 = make_test_track("u2", "Artist B", "Album 2", "Pop", 205);
    q.play_next(u1.clone());
    q.play_next(u2.clone());

    // Queue 2 priority items via push_back (FIFO order at queue end)
    let u3 = make_test_track("u3", "Artist C", "Album 3", "Jazz", 300);
    let u4 = make_test_track("u4", "Artist C", "Album 3", "Jazz", 310);
    q.push_back(u3.clone());
    q.push_back(u4.clone());

    // User queue should have [u2, u1, u3, u4]
    assert_eq!(q.user_queue().len(), 4);
    assert_eq!(q.user_queue()[0].id, "u2");
    assert_eq!(q.user_queue()[1].id, "u1");
    assert_eq!(q.user_queue()[2].id, "u3");
    assert_eq!(q.user_queue()[3].id, "u4");

    // Unified queue layout: [c0, u2, u1, c1, c2, c3, c4, u3, u4]
    assert_eq!(q.queue().len(), 9);
    assert_eq!(q.context_index(), Some(0));

    // Step 1: Advance to next track -> u2 (user track)
    let t1 = q.next();
    assert_eq!(t1.map(|t| t.id.as_str()), Some("u2"));
    assert_eq!(q.user_queue().len(), 3, "u2 should be strictly drained from user_queue");
    assert_eq!(q.context_index(), Some(0), "context_idx must remain anchored at c0 while playing user queue");

    // Step 2: Advance to next track -> u1 (user track)
    let t2 = q.next();
    assert_eq!(t2.map(|t| t.id.as_str()), Some("u1"));
    assert_eq!(q.user_queue().len(), 2, "u1 should be strictly drained from user_queue");
    assert_eq!(q.context_index(), Some(0), "context_idx must remain anchored at c0");

    // Step 3: Advance to next track -> c1 (resumes context queue)
    let t3 = q.next();
    assert_eq!(t3.map(|t| t.id.as_str()), Some("c1"));
    assert_eq!(q.user_queue().len(), 2, "user_queue must NOT drain when playing context track");
    assert_eq!(q.context_index(), Some(1), "context_idx must advance to c1 (index 1)");

    // Step 4: Dynamically inject another play_next track while playing c1!
    let u_interleaved = make_test_track("u_inter", "Artist D", "Album 4", "Funk", 150);
    q.play_next(u_interleaved.clone());
    assert_eq!(q.user_queue().len(), 3);
    assert_eq!(q.user_queue()[0].id, "u_inter");

    // Next must immediately play u_interleaved
    let t4 = q.next();
    assert_eq!(t4.map(|t| t.id.as_str()), Some("u_inter"));
    assert_eq!(q.user_queue().len(), 2, "u_inter drained");
    assert_eq!(q.context_index(), Some(1), "context_idx stays at c1 (index 1)");

    // Step 5: Advance through remaining context tracks c2, c3, c4
    let t5 = q.next();
    assert_eq!(t5.map(|t| t.id.as_str()), Some("c2"));
    assert_eq!(q.context_index(), Some(2));
    assert_eq!(q.user_queue().len(), 2);

    let t6 = q.next();
    assert_eq!(t6.map(|t| t.id.as_str()), Some("c3"));
    assert_eq!(q.context_index(), Some(3));
    assert_eq!(q.user_queue().len(), 2);

    let t7 = q.next();
    assert_eq!(t7.map(|t| t.id.as_str()), Some("c4"));
    assert_eq!(q.context_index(), Some(4));
    assert_eq!(q.user_queue().len(), 2);

    // Step 6: Advance to push_back user tracks u3, u4
    let t8 = q.next();
    assert_eq!(t8.map(|t| t.id.as_str()), Some("u3"));
    assert_eq!(q.user_queue().len(), 1, "u3 drained");
    assert_eq!(q.context_index(), Some(4), "context_idx preserved at 4");

    let t9 = q.next();
    assert_eq!(t9.map(|t| t.id.as_str()), Some("u4"));
    assert_eq!(q.user_queue().len(), 0, "u4 drained, user_queue empty");
    assert_eq!(q.context_index(), Some(4));

    // End of queue
    let t10 = q.next();
    assert_eq!(t10, None);
    assert_eq!(q.user_queue().len(), 0);
}

// ============================================================================
// 2. REORDERING SAFETY WITH INTERLEAVED CONTEXT TRACKS
// ============================================================================

#[test]
fn test_adversarial_interleaved_reordering_context_integrity() {
    let mut q = StandardQueueManager::new();

    // 10 Context tracks
    let context_tracks: Vec<Track> = (0..10)
        .map(|i| make_test_track(&format!("c{i}"), "Artist C", "Context Album", "Rock", 180 + i))
        .collect();

    q.set_context_queue(context_tracks.clone(), 0);

    // Add 4 user tracks interleaved: 2 play_next and 2 push_back
    let u1 = make_test_track("u1", "Artist U", "User Album 1", "Electronic", 210);
    let u2 = make_test_track("u2", "Artist U", "User Album 2", "Electronic", 220);
    let u3 = make_test_track("u3", "Artist U", "User Album 3", "Electronic", 230);
    let u4 = make_test_track("u4", "Artist U", "User Album 4", "Electronic", 240);

    q.play_next(u1);
    q.play_next(u2);
    q.push_back(u3);
    q.push_back(u4);

    // Expected user tracks: [u2, u1, u3, u4]
    assert_eq!(q.user_queue().len(), 4);
    assert_eq!(q.user_queue()[0].id, "u2");
    assert_eq!(q.user_queue()[1].id, "u1");
    assert_eq!(q.user_queue()[2].id, "u3");
    assert_eq!(q.user_queue()[3].id, "u4");

    // Helper closure to assert context tracks remain completely uncorrupted in queue
    let assert_context_integrity = |queue_mgr: &StandardQueueManager| {
        let current_queue = queue_mgr.queue();
        let extracted_context_tracks: Vec<&Track> = current_queue
            .iter()
            .filter(|t| t.id.starts_with('c'))
            .collect();

        assert_eq!(
            extracted_context_tracks.len(),
            context_tracks.len(),
            "All 10 context tracks must remain present"
        );
        for (i, t) in extracted_context_tracks.iter().enumerate() {
            assert_eq!(t.id, format!("c{i}"), "Context track index {i} corrupted!");
            assert_eq!(t.metadata.title, Some(format!("Title c{i}")));
            assert_eq!(t.metadata.album, Some("Context Album".to_string()));
        }
    };

    assert_context_integrity(&q);

    // Reorder 1: Move front to back (0 -> 3)
    q.reorder_user_queue(0, 3);
    assert_eq!(q.user_queue()[0].id, "u1");
    assert_eq!(q.user_queue()[1].id, "u3");
    assert_eq!(q.user_queue()[2].id, "u4");
    assert_eq!(q.user_queue()[3].id, "u2");
    assert_context_integrity(&q);

    // Reorder 2: Move back to front (3 -> 0)
    q.reorder_user_queue(3, 0);
    assert_eq!(q.user_queue()[0].id, "u2");
    assert_eq!(q.user_queue()[1].id, "u1");
    assert_eq!(q.user_queue()[2].id, "u3");
    assert_eq!(q.user_queue()[3].id, "u4");
    assert_context_integrity(&q);

    // Reorder 3: Swap adjacent middle (1 -> 2)
    q.reorder_user_queue(1, 2);
    assert_eq!(q.user_queue()[1].id, "u3");
    assert_eq!(q.user_queue()[2].id, "u1");
    assert_context_integrity(&q);

    // Adversarial boundaries:
    // Out of bounds from/to
    q.reorder_user_queue(100, 0);
    q.reorder_user_queue(0, 100);
    q.reorder_user_queue(usize::MAX, 2);
    assert_context_integrity(&q);

    // Self reordering
    q.reorder_user_queue(1, 1);
    assert_context_integrity(&q);

    // Stress testing 50 randomized reorder operations
    let mut rng = StdRng::seed_from_u64(0xDEADBEEF);
    for _ in 0..50 {
        let from = rng.gen_range(0..q.user_queue().len());
        let to = rng.gen_range(0..q.user_queue().len());
        q.reorder_user_queue(from, to);
        assert_context_integrity(&q);
    }
}

// ============================================================================
// 3. BACKWARD TRAVERSAL WITH THRESHOLD (4S RESTART VS 2S STEP-BACK)
// ============================================================================

#[test]
fn test_adversarial_backward_traversal_threshold() {
    let mut q = StandardQueueManager::new();

    let t0 = make_test_track("t0", "Artist A", "Album 1", "Rock", 200);
    let t1 = make_test_track("t1", "Artist A", "Album 1", "Rock", 210);
    let t2 = make_test_track("t2", "Artist A", "Album 1", "Rock", 220);

    q.set_context_queue(vec![t0.clone(), t1.clone(), t2.clone()], 0);

    // Advance to t1
    q.next();
    assert_eq!(q.current_index(), Some(1));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("t1"));
    assert_eq!(q.history().len(), 1);
    assert_eq!(q.history()[0].id, "t0");

    // Case 1: Call previous with Duration::from_secs(4) (> 3s)
    // Must restart current track: returns t1, current_index remains 1, history untouched
    let restarted = q.previous(Duration::from_secs(4));
    assert_eq!(restarted.map(|t| t.id.as_str()), Some("t1"));
    assert_eq!(q.current_index(), Some(1), "Index must not change on restart");
    assert_eq!(q.history().len(), 1, "History must not pop on restart");
    assert_eq!(q.history()[0].id, "t0");

    // Case 2: Call previous with Duration::from_millis(3001) (> 3s)
    let restarted_micro = q.previous(Duration::from_millis(3001));
    assert_eq!(restarted_micro.map(|t| t.id.as_str()), Some("t1"));
    assert_eq!(q.current_index(), Some(1));
    assert_eq!(q.history().len(), 1);

    // Case 3: Call previous with Duration::from_secs(2) (<= 3s)
    // Must step backward to t0: returns t0, current_index becomes 0, history popped
    let stepped_back = q.previous(Duration::from_secs(2));
    assert_eq!(stepped_back.map(|t| t.id.as_str()), Some("t0"));
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.history().len(), 0, "History should be popped");

    // Advance to t1, then t2
    q.next(); // to t1
    q.next(); // to t2
    assert_eq!(q.current_index(), Some(2));
    assert_eq!(q.history().len(), 2);
    assert_eq!(q.history()[0].id, "t0");
    assert_eq!(q.history()[1].id, "t1");

    // Case 4: Call previous with Duration::from_secs(3) (exactly 3s: 3 > 3 is false)
    // Boundary check: exactly 3.0s should step backward to t1 and pop history
    let stepped_at_3s = q.previous(Duration::from_secs(3));
    assert_eq!(stepped_at_3s.map(|t| t.id.as_str()), Some("t1"));
    assert_eq!(q.current_index(), Some(1));
    assert_eq!(q.history().len(), 1);
    assert_eq!(q.history()[0].id, "t0");

    // Step back to t0 with Duration::ZERO
    let stepped_zero = q.previous(Duration::ZERO);
    assert_eq!(stepped_zero.map(|t| t.id.as_str()), Some("t0"));
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.history().len(), 0);

    // Repeated previous calls at beginning of queue must not underflow or panic
    for _ in 0..10 {
        let repeated = q.previous(Duration::ZERO);
        assert_eq!(repeated.map(|t| t.id.as_str()), Some("t0"));
        assert_eq!(q.current_index(), Some(0));
        assert_eq!(q.history().len(), 0);
    }
}

// ============================================================================
// 4. HISTORY BOUNDED CAPACITY (MAX 100 ENTRIES) UNDER STRESS
// ============================================================================

#[test]
fn test_adversarial_history_cap_100_stress() {
    let mut q = StandardQueueManager::new();

    // Generate 250 tracks
    let tracks: Vec<Track> = (0..250)
        .map(|i| make_test_track(&format!("track_{i}"), "Artist H", "Album H", "Rock", 100))
        .collect();

    q.set_context_queue(tracks, 0);
    assert_eq!(q.history().len(), 0);

    // Advance through 200 tracks
    for step in 0..200 {
        q.next();
        let expected_cap = (step + 1).min(100);
        assert_eq!(
            q.history().len(),
            expected_cap,
            "History length must be exactly {expected_cap} at step {step}"
        );
        assert!(
            q.history().len() <= 100,
            "History length exceeded 100 entries: {}",
            q.history().len()
        );
    }

    // After 200 transitions (currently at track_200):
    // History contains exactly tracks 100 through 199 (FIFO pruning)
    assert_eq!(q.history().len(), 100);
    assert_eq!(q.history()[0].id, "track_100", "Oldest entry should be track_100");
    assert_eq!(q.history()[99].id, "track_199", "Newest entry should be track_199");

    // Perform 150 random jump_to_index operations and verify cap is never breached
    let mut rng = StdRng::seed_from_u64(0xCAFEBABE);
    for _ in 0..150 {
        let target = rng.gen_range(0..250);
        q.jump_to_index(target);
        assert!(
            q.history().len() <= 100,
            "History capacity breached during jump_to_index: {}",
            q.history().len()
        );
    }

    // Verify history can be popped backwards up to 100 times without panic
    let initial_hist_len = q.history().len();
    assert_eq!(initial_hist_len, 100);

    for i in 0..initial_hist_len {
        q.previous(Duration::from_secs(1));
        assert_eq!(
            q.history().len(),
            initial_hist_len - 1 - i,
            "History did not pop monotonically"
        );
    }
    assert_eq!(q.history().len(), 0);
}

// ============================================================================
// 5. SHUFFLE LIFO SPLICING & QUEUE LOOP WRAPAROUND UNDER STRESS
// ============================================================================

#[test]
fn test_adversarial_shuffle_lifo_splicing_and_loop_wraparound() {
    let mut q = StandardQueueManager::new();

    let tracks: Vec<Track> = (0..6)
        .map(|i| make_test_track(&format!("base_{i}"), "Artist S", "Album S", "Ambient", 200))
        .collect();

    q.set_context_queue(tracks, 0);
    q.set_shuffle(true);
    assert!(q.is_shuffle());

    // Verify LIFO Splicing in shuffle mode:
    // Call play_next(S_U1), then play_next(S_U2)
    let s_u1 = make_test_track("s_u1", "Artist U", "User Album", "Pop", 190);
    let s_u2 = make_test_track("s_u2", "Artist U", "User Album", "Pop", 195);

    q.play_next(s_u1);
    q.play_next(s_u2);

    // Next must be s_u2 (last queued = first played in LIFO)
    let next1 = q.next();
    assert_eq!(
        next1.map(|t| t.id.as_str()),
        Some("s_u2"),
        "Shuffle play_next must follow strict LIFO splicing"
    );

    // Next after s_u2 must be s_u1
    let next2 = q.next();
    assert_eq!(
        next2.map(|t| t.id.as_str()),
        Some("s_u1"),
        "Second track played must be earlier play_next item"
    );

    // Test LoopMode::Queue wraparound under shuffle
    q.set_loop_mode(LoopMode::Queue);

    // Advance through the entire shuffled queue and trigger multiple wraparounds
    for cycle in 0..50 {
        let next_track = q.next();
        assert!(
            next_track.is_some(),
            "LoopMode::Queue under shuffle must never return None during cycle {cycle}"
        );
    }
}

// ============================================================================
// 6. AUTOPLAY RECOMMENDATION ENGINE ORACLE & EXHAUSTION
// ============================================================================

#[test]
fn test_adversarial_autoplay_candidate_scoring_and_pool_exhaustion() {
    let mut q = StandardQueueManager::new();

    let curr = make_test_track("curr", "Pink Floyd", "The Wall", "Prog Rock", 300);
    q.set_context_queue(vec![curr.clone()], 0);

    // Candidate variants:
    // 1. Same Artist only: +50
    let cand_artist = make_test_track("c_art", "Pink Floyd", "Dark Side", "Classic Rock", 320);

    // 2. Same Album (+30) & Same Genre (+20): 30 + 20 = 50
    let cand_alb_gen = make_test_track("c_ag", "David Gilmour", "The Wall", "Prog Rock", 280);

    // 3. Same Artist (+50), Same Album (+30), Same Genre (+20): 100
    let cand_perfect = make_test_track("c_perf", "Pink Floyd", "The Wall", "Prog Rock", 310);

    // 4. Completely unrelated track: 0
    let cand_unrelated = make_test_track("c_unrel", "Miles Davis", "Kind of Blue", "Jazz", 500);

    // Pool with unqueued candidates
    let pool = vec![
        cand_artist.clone(),
        cand_alb_gen.clone(),
        cand_perfect.clone(),
        cand_unrelated.clone(),
    ];

    // cand_perfect scores 100, which beats all others (50, 50, 0)
    let selected = q.select_autoplay_candidate(&pool);
    assert_eq!(
        selected.map(|t| t.id),
        Some("c_perf".to_string()),
        "Autoplay must choose cand_perfect with highest score (+100)"
    );

    // Test candidate exclusion: tracks already queued must be ignored
    q.push_back(cand_perfect.clone()); // now cand_perfect is in queue!
    let selected2 = q.select_autoplay_candidate(&pool);
    // Now cand_perfect is in queue, top tier is cand_artist (50) and cand_alb_gen (50)
    let chosen_id = selected2.map(|t| t.id).unwrap();
    assert!(
        chosen_id == "c_art" || chosen_id == "c_ag",
        "Must pick from top unqueued candidates with score 50, got: {chosen_id}"
    );

    // Test history penalty (-100) when all candidate tracks are in queue:
    let mut hist_q = StandardQueueManager::new();
    let played_track = make_test_track("played_art", "Pink Floyd", "Album P", "Indie", 200);
    let curr_track = make_test_track("curr_t", "Pink Floyd", "The Wall", "Prog Rock", 300);
    let unplayed_track = make_test_track("unplayed_art", "Pink Floyd", "Album U", "Metal", 200);

    hist_q.set_context_queue(
        vec![played_track.clone(), curr_track.clone(), unplayed_track.clone()],
        0,
    );
    // At index 0 (played_track). Advance to curr_track:
    hist_q.next();
    assert_eq!(hist_q.current_track().map(|t| t.id.as_str()), Some("curr_t"));
    assert_eq!(hist_q.history().len(), 1);
    assert_eq!(hist_q.history()[0].id, "played_art");

    // Candidate pool where all candidates are in queue:
    // played_track: Same Artist (+50), In History (-100) -> net score -50
    // unplayed_track: Same Artist (+50), In History (0) -> net score +50
    let hist_pool = vec![
        played_track.clone(),
        curr_track.clone(),
        unplayed_track.clone(),
    ];

    let hist_selected = hist_q.select_autoplay_candidate(&hist_pool);
    assert_eq!(
        hist_selected.map(|t| t.id),
        Some("unplayed_art".to_string()),
        "Autoplay candidate in history must be penalized by -100 points"
    );

    // Test library exhaustion fallback when all candidates have identical scores
    let mut exhaust_q = StandardQueueManager::new();
    let t_a = make_test_track("ta", "Art A", "Alb 1", "Rock", 100);
    let t_b = make_test_track("tb", "Art B", "Alb 2", "Pop", 100);
    exhaust_q.set_context_queue(vec![t_a.clone(), t_b.clone()], 0);

    let small_pool = vec![t_a.clone(), t_b.clone()];
    // Both t_a and t_b are in queue. Currently playing t_a.
    // Exhaustion fallback must pick t_b (not t_a).
    let fallback = exhaust_q.select_autoplay_candidate(&small_pool);
    assert_eq!(fallback.map(|t| t.id), Some("tb".to_string()));
}

// ============================================================================
// 7. 1,000-STEP RANDOMIZED STATE MACHINE FUZZING
// ============================================================================

#[test]
fn test_adversarial_1000_step_state_machine_fuzz() {
    let mut q = StandardQueueManager::new();
    let mut rng = StdRng::seed_from_u64(0x1337BEEF);

    // Initialize with 10 context tracks
    let init_tracks: Vec<Track> = (0..10)
        .map(|i| make_test_track(&format!("init_{i}"), "Artist Fuzz", "Album Fuzz", "Electronic", 150))
        .collect();
    q.set_context_queue(init_tracks, 0);

    let mut user_counter = 0;

    for step in 0..1000 {
        let action = rng.gen_range(0..10);
        match action {
            0 => {
                // next()
                let _ = q.next();
            }
            1 => {
                // previous() with random duration
                let secs = rng.gen_range(0..6);
                let _ = q.previous(Duration::from_secs(secs));
            }
            2 => {
                // play_next()
                user_counter += 1;
                let t = make_test_track(
                    &format!("u_{user_counter}"),
                    "User Artist",
                    "User Album",
                    "Jazz",
                    180,
                );
                q.play_next(t);
            }
            3 => {
                // push_back()
                user_counter += 1;
                let t = make_test_track(
                    &format!("u_{user_counter}"),
                    "User Artist",
                    "User Album",
                    "Jazz",
                    180,
                );
                q.push_back(t);
            }
            4 => {
                // reorder_user_queue()
                if !q.user_queue().is_empty() {
                    let from = rng.gen_range(0..q.user_queue().len());
                    let to = rng.gen_range(0..q.user_queue().len());
                    q.reorder_user_queue(from, to);
                }
            }
            5 => {
                // jump_to_index()
                if !q.queue().is_empty() {
                    let idx = rng.gen_range(0..q.queue().len());
                    q.jump_to_index(idx);
                }
            }
            6 => {
                // toggle shuffle
                let shuffle = rng.gen_bool(0.5);
                q.set_shuffle(shuffle);
            }
            7 => {
                // set loop mode
                let mode = match rng.gen_range(0..3) {
                    0 => LoopMode::Off,
                    1 => LoopMode::Track,
                    _ => LoopMode::Queue,
                };
                q.set_loop_mode(mode);
            }
            8 => {
                // clear user queue
                q.clear_user_queue();
            }
            9 => {
                // remove user track
                if !q.user_queue().is_empty() {
                    let idx = rng.gen_range(0..q.user_queue().len());
                    q.remove_user_track(idx);
                }
            }
            _ => unreachable!(),
        }

        // --- Invariant assertions after every single operation ---
        assert!(
            q.history().len() <= 100,
            "History capacity exceeded 100 at step {step}: {}",
            q.history().len()
        );

        if !q.queue().is_empty() {
            if let Some(curr_idx) = q.current_index() {
                assert!(
                    curr_idx < q.queue().len(),
                    "current_index {curr_idx} >= queue.len() {} at step {step}",
                    q.queue().len()
                );
            }
        }

        if !q.context_queue().is_empty() {
            if let Some(ctx_idx) = q.context_index() {
                assert!(
                    ctx_idx < q.context_queue().len(),
                    "context_index {ctx_idx} >= context_queue.len() {} at step {step}",
                    q.context_queue().len()
                );
            }
        }

        assert!(
            q.user_queue().len() <= q.queue().len(),
            "user_queue length {} > queue length {} at step {step}",
            q.user_queue().len(),
            q.queue().len()
        );

        // Snapshot serialization check: must serialize without error
        let snap = q.get_state();
        assert_eq!(snap.history.len(), q.history().len());
        assert_eq!(snap.user_queue.len(), q.user_queue().len());
    }
}

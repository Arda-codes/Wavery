//! Comprehensive 4-Tier Opaque-Box E2E Tests for Feature 10: Two-Tier Playback Queue.
//!
//! Covers:
//! - Tier 1: Feature Coverage (Context queue, User priority queue play_next & push_back,
//!   clear_user_queue, remove_user_track, reorder_user_queue, history tracking)
//! - Tier 2: Boundary & Corner Cases (Empty queues, single item, 3.0s threshold boundary,
//!   out-of-bounds start indices, loop mode behaviors)
//! - Tier 3: Cross-Feature Combinations (Two-tier transitions with shuffle, context replacement
//!   preserving user queue, history pruning at 100 items limit)
//! - Tier 4: Real-World Scenarios (Party DJ session, listening workflow with seek/prev restarts)

use std::path::PathBuf;
use std::time::Duration;
use wavery_audio::queue::StandardQueueManager;
use wavery_core::models::{LoopMode, Track, TrackMetadata, TrackSource};
use wavery_core::traits::QueueManager;

fn make_track(id: &str, title: &str, artist: &str, duration_secs: u64) -> Track {
    Track {
        id: id.into(),
        source: TrackSource::Managed(PathBuf::from(format!("/music/{id}.flac"))),
        metadata: TrackMetadata {
            title: Some(title.into()),
            artist: Some(artist.into()),
            album: Some("E2E Album".into()),
            album_artist: Some(artist.into()),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2026),
            genre: Some("Electronic".into()),
            duration: Duration::from_secs(duration_secs),
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "FLAC".into(),
            lyrics: None,
            ..Default::default()
        },
        date_added: 1700000000,
    }
}

// ============================================================================
// TIER 1: FEATURE COVERAGE
// ============================================================================

#[test]
fn test_tier1_context_queue_linear_progression() {
    let mut q = StandardQueueManager::new();
    let tracks = vec![
        make_track("t1", "Track One", "Artist A", 180),
        make_track("t2", "Track Two", "Artist A", 200),
        make_track("t3", "Track Three", "Artist A", 220),
    ];

    q.set_context_queue(tracks, 0);
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("t1"));

    let next1 = q.next();
    assert_eq!(next1.map(|t| t.id.as_str()), Some("t2"));
    assert_eq!(q.current_index(), Some(1));

    let next2 = q.next();
    assert_eq!(next2.map(|t| t.id.as_str()), Some("t3"));
    assert_eq!(q.current_index(), Some(2));

    let next3 = q.next();
    assert_eq!(next3, None, "At end of queue with LoopMode::Off, next should return None");
}

#[test]
fn test_tier1_user_priority_queue_play_next() {
    let mut q = StandardQueueManager::new();
    let context_tracks = vec![
        make_track("c1", "Context 1", "Artist A", 180),
        make_track("c2", "Context 2", "Artist A", 190),
    ];
    q.set_context_queue(context_tracks, 0);

    let priority_track = make_track("u1", "Priority Track", "Artist B", 210);
    q.play_next(priority_track.clone());

    assert_eq!(q.user_queue().len(), 1);
    assert_eq!(q.user_queue()[0].id, "u1");

    // Next track must be the user priority track
    let next = q.next();
    assert_eq!(next.map(|t| t.id.as_str()), Some("u1"));
    assert_eq!(q.user_queue().len(), 0, "Played user track should be consumed from user_queue");

    // Following track resumes context queue
    let after_user = q.next();
    assert_eq!(after_user.map(|t| t.id.as_str()), Some("c2"));
}

#[test]
fn test_tier1_user_priority_queue_push_back() {
    let mut q = StandardQueueManager::new();
    let context_tracks = vec![
        make_track("c1", "Context 1", "Artist A", 180),
        make_track("c2", "Context 2", "Artist A", 190),
    ];
    q.set_context_queue(context_tracks, 0);

    let back_track = make_track("u_back", "Back Track", "Artist C", 240);
    q.push_back(back_track);

    assert_eq!(q.user_queue().len(), 1);
    assert_eq!(q.queue().last().map(|t| t.id.as_str()), Some("u_back"));
}

#[test]
fn test_tier1_clear_and_remove_user_queue() {
    let mut q = StandardQueueManager::new();
    q.set_context_queue(
        vec![
            make_track("c1", "Context 1", "Artist A", 180),
            make_track("c2", "Context 2", "Artist A", 190),
        ],
        0,
    );

    q.play_next(make_track("u1", "User 1", "Artist B", 120));
    q.push_back(make_track("u2", "User 2", "Artist C", 130));
    assert_eq!(q.user_queue().len(), 2);

    // Remove single track
    let removed = q.remove_user_track(0);
    assert_eq!(removed.map(|t| t.id), Some("u1".into()));
    assert_eq!(q.user_queue().len(), 1);

    // Clear remaining
    q.clear_user_queue();
    assert!(q.user_queue().is_empty());
}

#[test]
fn test_tier1_history_recording_and_previous() {
    let mut q = StandardQueueManager::new();
    q.set_context_queue(
        vec![
            make_track("t1", "Track 1", "Artist A", 180),
            make_track("t2", "Track 2", "Artist A", 190),
        ],
        0,
    );

    assert!(q.history().is_empty());
    q.next(); // transitions to t2
    assert_eq!(q.history().len(), 1);
    assert_eq!(q.history()[0].id, "t1");

    // Call previous before 3 seconds threshold
    let prev = q.previous(Duration::from_secs(1));
    assert_eq!(prev.map(|t| t.id.as_str()), Some("t1"));
    assert_eq!(q.current_index(), Some(0));
}

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES
// ============================================================================

#[test]
fn test_tier2_empty_queue_boundaries() {
    let mut q = StandardQueueManager::new();
    assert_eq!(q.current_track(), None);
    assert_eq!(q.current_index(), None);
    assert_eq!(q.next(), None);
    assert_eq!(q.previous(Duration::from_secs(0)), None);

    // Set empty queue with large start index
    q.set_context_queue(vec![], 999);
    assert_eq!(q.current_track(), None);
    assert_eq!(q.current_index(), None);
    assert!(q.user_queue().is_empty());
    assert!(q.history().is_empty());
}

#[test]
fn test_tier2_single_track_queue_boundaries() {
    let mut q = StandardQueueManager::new();
    q.set_context_queue(vec![make_track("s1", "Solo", "Soloist", 200)], 0);

    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.next(), None, "Single track at end should return None");

    // With LoopMode::Track
    q.set_loop_mode(LoopMode::Track);
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("s1"));

    // With LoopMode::Queue
    q.set_loop_mode(LoopMode::Queue);
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("s1"));
}

#[test]
fn test_tier2_previous_threshold_exact_boundary() {
    let mut q = StandardQueueManager::new();
    q.set_context_queue(
        vec![
            make_track("t1", "Track 1", "Artist A", 200),
            make_track("t2", "Track 2", "Artist A", 200),
        ],
        1,
    );

    // Over 3.0 seconds (> Duration::from_secs(3)) restarts current track
    let restarted = q.previous(Duration::from_millis(3001));
    assert_eq!(restarted.map(|t| t.id.as_str()), Some("t2"));
    assert_eq!(q.current_index(), Some(1));

    // Under 3.0 seconds (<= Duration::from_secs(3)) jumps to previous track
    let went_prev = q.previous(Duration::from_millis(2999));
    assert_eq!(went_prev.map(|t| t.id.as_str()), Some("t1"));
    assert_eq!(q.current_index(), Some(0));
}

#[test]
fn test_tier2_start_index_clamping() {
    let mut q = StandardQueueManager::new();
    let tracks = vec![
        make_track("t1", "Track 1", "Artist A", 180),
        make_track("t2", "Track 2", "Artist A", 180),
    ];

    // Out-of-bounds start index 100 should clamp to last index (1)
    q.set_context_queue(tracks, 100);
    assert_eq!(q.current_index(), Some(1));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("t2"));
}

#[test]
fn test_tier2_reorder_user_queue_out_of_bounds() {
    let mut q = StandardQueueManager::new();
    q.set_context_queue(vec![make_track("c1", "C1", "Artist A", 180)], 0);
    q.play_next(make_track("u1", "U1", "Artist B", 120));

    // Reorder with invalid indices should be safe no-op
    q.reorder_user_queue(0, 10);
    assert_eq!(q.user_queue().len(), 1);
    assert_eq!(q.user_queue()[0].id, "u1");

    q.reorder_user_queue(10, 0);
    assert_eq!(q.user_queue().len(), 1);
}

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS
// ============================================================================

#[test]
fn test_tier3_context_queue_switch_preserves_user_queue() {
    let mut q = StandardQueueManager::new();
    // Context Album 1
    q.set_context_queue(
        vec![
            make_track("a1_1", "Album 1 Track 1", "Artist 1", 180),
            make_track("a1_2", "Album 1 Track 2", "Artist 1", 180),
        ],
        0,
    );

    // User queues high priority track
    q.play_next(make_track("user_fav", "My Favorite Track", "Artist X", 240));
    assert_eq!(q.user_queue().len(), 1);

    // User switches context to Album 2
    q.set_context_queue(
        vec![
            make_track("a2_1", "Album 2 Track 1", "Artist 2", 200),
            make_track("a2_2", "Album 2 Track 2", "Artist 2", 200),
        ],
        0,
    );

    // User priority queue must be preserved across context replacement!
    assert_eq!(q.user_queue().len(), 1);
    assert_eq!(q.user_queue()[0].id, "user_fav");

    // The next track played should still be the user queued track
    let next = q.next();
    assert_eq!(next.map(|t| t.id.as_str()), Some("user_fav"));
}

#[test]
fn test_tier3_two_tier_with_shuffle_and_play_next() {
    let mut q = StandardQueueManager::new();
    let tracks = (1..=10)
        .map(|i| make_track(&format!("t{i}"), &format!("Track {i}"), "Artist", 180))
        .collect();

    q.set_context_queue(tracks, 0);
    q.set_shuffle(true);
    assert!(q.is_shuffle());

    // Insert user track while shuffle is active
    let user_track = make_track("u_special", "Special Track", "Guest", 210);
    q.play_next(user_track);

    // User track must be immediately next even in shuffle mode
    let next = q.next();
    assert_eq!(next.map(|t| t.id.as_str()), Some("u_special"));
}

#[test]
fn test_tier3_history_bounded_capacity() {
    let mut q = StandardQueueManager::new();
    let tracks: Vec<Track> = (0..150)
        .map(|i| make_track(&format!("t{i}"), &format!("Track {i}"), "Artist", 60))
        .collect();

    q.set_context_queue(tracks, 0);

    for _ in 0..120 {
        q.next();
    }

    // History must be capped at 100 items to prevent unbounded memory growth
    assert!(q.history().len() <= 100);
}

#[test]
fn test_tier3_loop_queue_wraparound_with_user_queue() {
    let mut q = StandardQueueManager::new();
    q.set_context_queue(
        vec![
            make_track("t1", "Track 1", "Artist A", 180),
            make_track("t2", "Track 2", "Artist A", 180),
        ],
        0,
    );
    q.set_loop_mode(LoopMode::Queue);

    q.play_next(make_track("u1", "User 1", "Artist B", 180));

    // First next: u1
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("u1"));
    // Second next: t2
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("t2"));
    // Third next: wraps around to index 0 (t1) in LoopMode::Queue
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("t1"));
}

#[test]
fn test_tier3_reorder_user_queue_multiple_items() {
    let mut q = StandardQueueManager::new();
    q.set_context_queue(vec![make_track("c1", "Context 1", "Artist A", 180)], 0);

    q.push_back(make_track("u1", "User 1", "Artist B", 180));
    q.push_back(make_track("u2", "User 2", "Artist C", 180));
    q.push_back(make_track("u3", "User 3", "Artist D", 180));

    assert_eq!(q.user_queue()[0].id, "u1");
    assert_eq!(q.user_queue()[1].id, "u2");
    assert_eq!(q.user_queue()[2].id, "u3");

    // Move u3 to head
    q.reorder_user_queue(2, 0);
    assert_eq!(q.user_queue()[0].id, "u3");
    assert_eq!(q.user_queue()[1].id, "u1");
    assert_eq!(q.user_queue()[2].id, "u2");

    // Playing next should give u3 first
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("u3"));
}

// ============================================================================
// TIER 4: REAL-WORLD APPLICATION SCENARIOS
// ============================================================================

#[test]
fn test_tier4_party_dj_session_workflow() {
    let mut q = StandardQueueManager::new();

    // 1. Host starts playback of a playlist with 5 tracks
    let playlist_tracks = vec![
        make_track("p1", "Intro", "DJ", 120),
        make_track("p2", "Warm Up", "DJ", 180),
        make_track("p3", "Main Beat", "DJ", 240),
        make_track("p4", "Peak Energy", "DJ", 300),
        make_track("p5", "Cool Down", "DJ", 200),
    ];
    q.set_context_queue(playlist_tracks, 0);
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("p1"));

    // 2. Guest requests "Song A" to play next
    q.play_next(make_track("req1", "Song A (Requested)", "Guest 1", 210));

    // 3. Another guest queues "Song B" at end of user queue
    q.push_back(make_track("req2", "Song B (Requested)", "Guest 2", 195));

    // 4. Host skips to next track -> plays "Song A"
    let current = q.next();
    assert_eq!(current.map(|t| t.id.as_str()), Some("req1"));

    // 5. Host checks user queue: "Song B" is pending at the back
    assert_eq!(q.user_queue().len(), 1);
    assert_eq!(q.user_queue()[0].id, "req2");

    // 6. Next -> resumes context queue at p2 (since req2 was pushed to back)
    let current = q.next();
    assert_eq!(current.map(|t| t.id.as_str()), Some("p2"));

    // 7. Advance through rest of context: p3, p4, p5
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("p3"));
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("p4"));
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("p5"));

    // 8. Finally, req2 plays at the end of queue
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("req2"));

    // 9. History contains all played tracks in exact order
    let hist_ids: Vec<_> = q.history().iter().map(|t| t.id.as_str()).collect();
    assert_eq!(hist_ids, vec!["p1", "req1", "p2", "p3", "p4", "p5"]);
}

#[test]
fn test_tier4_repeated_seeking_and_restarting_scenario() {
    let mut q = StandardQueueManager::new();
    let tracks = vec![
        make_track("t1", "Track 1", "Artist", 240),
        make_track("t2", "Track 2", "Artist", 240),
        make_track("t3", "Track 3", "Artist", 240),
    ];
    q.set_context_queue(tracks, 0);

    // Play t1, advance to t2
    q.next();
    assert_eq!(q.current_index(), Some(1));

    // User is 10 seconds into t2 and presses 'previous'
    // Should restart t2 because position > 3s
    let restarted = q.previous(Duration::from_secs(10));
    assert_eq!(restarted.map(|t| t.id.as_str()), Some("t2"));
    assert_eq!(q.current_index(), Some(1));

    // User immediately presses 'previous' again within 2 seconds
    // Should now go to t1 because position <= 3s
    let prev = q.previous(Duration::from_secs(1));
    assert_eq!(prev.map(|t| t.id.as_str()), Some("t1"));
    assert_eq!(q.current_index(), Some(0));
}

#[test]
fn test_tier4_user_queue_cancellation_under_active_playback() {
    let mut q = StandardQueueManager::new();
    q.set_context_queue(
        vec![
            make_track("c1", "Track 1", "Artist", 180),
            make_track("c2", "Track 2", "Artist", 180),
            make_track("c3", "Track 3", "Artist", 180),
        ],
        0,
    );

    // User queues 3 songs
    q.push_back(make_track("u1", "User 1", "Artist U", 180));
    q.push_back(make_track("u2", "User 2", "Artist U", 180));
    q.push_back(make_track("u3", "User 3", "Artist U", 180));

    // Decides to clear the user queue
    q.clear_user_queue();
    assert!(q.user_queue().is_empty());

    // Advancing should continue normally with c2
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("c2"));
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("c3"));
    assert_eq!(q.next(), None);
}

#[test]
fn test_tier4_rapid_queue_shuffling_stability() {
    let mut q = StandardQueueManager::new();
    let tracks: Vec<Track> = (0..50)
        .map(|i| make_track(&format!("t{i}"), &format!("Track {i}"), "Artist", 180))
        .collect();

    q.set_context_queue(tracks, 10);
    assert_eq!(q.current_index(), Some(10));

    // Toggle shuffle multiple times
    for _ in 0..10 {
        q.set_shuffle(true);
        // Current track must remain stable immediately after shuffle
        assert_eq!(q.current_index(), Some(10));
        q.set_shuffle(false);
        assert_eq!(q.current_index(), Some(10));
    }
}

#[test]
fn test_tier4_large_queue_stress_and_drain() {
    let mut q = StandardQueueManager::new();
    let tracks: Vec<Track> = (0..500)
        .map(|i| make_track(&format!("t{i}"), &format!("Track {i}"), "Artist", 60))
        .collect();

    q.set_context_queue(tracks, 0);

    // Fast-forward through entire queue
    let mut count = 1;
    while q.next().is_some() {
        count += 1;
    }

    assert_eq!(count, 500);
    assert_eq!(q.history().len(), 100); // history bounded at 100
}

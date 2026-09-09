//! Challenger 1 Adversarial Fuzzing and Invariant Verification Suite for Milestone 1.
//!
//! Stress-tests `StandardQueueManager` state machine invariants, 100k+ randomized fuzzing ops,
//! 500-item `play_next` shuffle splicing, rapid shuffle toggling, and permutation uniqueness.

use rand::Rng;
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;
use wavery_audio::queue::StandardQueueManager;
use wavery_core::models::{LoopMode, Track, TrackMetadata, TrackSource};
use wavery_core::traits::QueueManager;

fn make_test_track(id: &str, title: &str) -> Track {
    Track {
        id: id.into(),
        source: TrackSource::Managed(PathBuf::from(format!("/music/{id}.flac"))),
        metadata: TrackMetadata {
            title: Some(title.into()),
            artist: Some("Adversarial Artist".into()),
            album: Some("Adversarial Album".into()),
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            duration: Duration::from_secs(200),
            sample_rate: Some(48000),
            bit_depth: Some(24),
            channels: Some(2),
            format: "FLAC".into(),
            lyrics: None,
        },
        date_added: 0,
    }
}

/// Adversarial Test 1: 150,000+ randomized operations fuzzing across various initial queue sizes.
/// Validates bounds, non-null guarantees, index synchronization, and state machine consistency.
#[test]
fn test_challenger_150k_randomized_fuzzing_state_machine_invariants() {
    let mut q = StandardQueueManager::new();
    let mut rng = rand::thread_rng();

    let queue_sizes = [0, 1, 2, 3, 5, 10, 25, 100, 300];

    for &size in &queue_sizes {
        let initial_tracks: Vec<Track> = (0..size)
            .map(|i| make_test_track(&format!("fuzz_{size}_{i}"), &format!("Song {i}")))
            .collect();

        let start_idx = if size > 0 { rng.gen_range(0..size) } else { 0 };
        q.set_queue(initial_tracks, start_idx);

        // Run 20,000 operations per initial queue size = 180,000 total operations
        for op in 0..20_000 {
            let choice = rng.gen_range(0..10);
            match choice {
                0 => {
                    // next()
                    let _ = q.next();
                }
                1 => {
                    // previous() short (< 3s)
                    let _ = q.previous(Duration::from_millis(500));
                }
                2 => {
                    // previous() long (>= 3s)
                    let _ = q.previous(Duration::from_secs(10));
                }
                3 => {
                    // toggle shuffle
                    q.set_shuffle(rng.gen_bool(0.5));
                }
                4 => {
                    // set loop mode
                    let mode = match rng.gen_range(0..3) {
                        0 => LoopMode::Off,
                        1 => LoopMode::Track,
                        _ => LoopMode::Queue,
                    };
                    q.set_loop_mode(mode);
                }
                5 => {
                    // play_next
                    let insert_id = format!("pn_{size}_{op}");
                    q.play_next(make_test_track(&insert_id, "Played Next Track"));
                }
                6 => {
                    // push_back
                    let append_id = format!("pb_{size}_{op}");
                    q.push_back(make_test_track(&append_id, "Appended Track"));
                }
                7 => {
                    // occasional set_queue with random size
                    if rng.gen_bool(0.02) {
                        let new_len = rng.gen_range(0..50);
                        let trks: Vec<Track> = (0..new_len)
                            .map(|i| make_test_track(&format!("reset_{i}"), &format!("Reset {i}")))
                            .collect();
                        let s_idx = if new_len > 0 { rng.gen_range(0..new_len * 2) } else { 0 };
                        q.set_queue(trks, s_idx);
                    }
                }
                8 => {
                    // rapid previous toggling
                    let dur = Duration::from_secs(rng.gen_range(0..5));
                    let _ = q.previous(dur);
                }
                9 => {
                    // read-only inspector methods
                    let _ = q.current_index();
                    let _ = q.current_track();
                    let _ = q.queue();
                }
                _ => unreachable!(),
            }

            // INVARIANT VERIFICATION ON EVERY OPERATION
            let q_len = q.queue().len();
            let curr_idx = q.current_index();
            let curr_trk = q.current_track();

            if q_len == 0 {
                assert_eq!(curr_idx, None, "Op {op} (size {size}): Empty queue must have current_index == None");
                assert_eq!(curr_trk, None, "Op {op} (size {size}): Empty queue must have current_track == None");
            } else {
                assert!(curr_idx.is_some(), "Op {op} (size {size}): Non-empty queue must have current_index");
                let idx = curr_idx.unwrap();
                assert!(
                    idx < q_len,
                    "Op {op} (size {size}): current_index {idx} is out of bounds for queue length {q_len}"
                );
                assert!(curr_trk.is_some(), "Op {op} (size {size}): Non-empty queue must have current_track");
                assert_eq!(
                    curr_trk.unwrap().id,
                    q.queue()[idx].id,
                    "Op {op} (size {size}): current_track ID mismatch with queue[current_index]"
                );
            }
        }
    }
}

/// Adversarial Test 2: Inserting 500 items via `play_next` in shuffle mode.
/// Tests LIFO order, backward history traversal across all 500 items, and complete permutation uniqueness.
#[test]
fn test_challenger_inserting_500_items_play_next_in_shuffle() {
    let mut q = StandardQueueManager::new();
    let initial_count = 10;
    let initial_tracks: Vec<Track> = (0..initial_count)
        .map(|i| make_test_track(&format!("base_{i:02}"), &format!("Base Song {i}")))
        .collect();

    q.set_queue(initial_tracks, 0);
    q.set_shuffle(true);
    q.set_loop_mode(LoopMode::Off);

    // Initial track and advance 3 times
    let mut played_history = Vec::new();
    played_history.push(q.current_track().unwrap().id.clone());
    for _ in 0..3 {
        let nxt = q.next().expect("Expected next track");
        played_history.push(nxt.id.clone());
    }
    assert_eq!(played_history.len(), 4);

    let active_track_before_splice = q.current_track().unwrap().id.clone();
    assert_eq!(active_track_before_splice, played_history[3]);

    // Insert 500 items sequentially via play_next
    let insert_count = 500;
    for i in 0..insert_count {
        let track = make_test_track(&format!("splice_{i:04}"), &format!("Splice Song {i}"));
        q.play_next(track);
        // Invariant: current track must NOT change during play_next
        assert_eq!(q.current_track().unwrap().id, active_track_before_splice);
    }

    assert_eq!(q.queue().len(), initial_count + insert_count);

    // Because play_next inserts right after current position, sequential insertions act as a LIFO stack.
    // The next 500 tracks played MUST be splice_0499 down to splice_0000.
    let mut spliced_visited = Vec::new();
    for expected_num in (0..insert_count).rev() {
        let nxt = q.next().expect("Expected spliced next track");
        let expected_id = format!("splice_{expected_num:04}");
        assert_eq!(nxt.id, expected_id, "Expected spliced track {expected_id}");
        spliced_visited.push(nxt.id.clone());
    }
    assert_eq!(spliced_visited.len(), insert_count);

    // Step back from splice_0000 to splice_0499:
    for expected_num in 1..insert_count {
        let prev = q.previous(Duration::from_secs(1)).expect("Expected previous spliced track");
        let expected_id = format!("splice_{expected_num:04}");
        assert_eq!(prev.id, expected_id);
    }

    // Step back into original history: played_history[3], [2], [1], [0]
    for step in (0..4).rev() {
        let prev = q.previous(Duration::from_secs(1)).expect("Expected history track");
        assert_eq!(prev.id, played_history[step]);
    }

    // Step forward all the way to the end of the queue
    let mut all_traversed = played_history;
    // Step forward from history[0] to history[3]
    for expected_id in &all_traversed.clone()[1..] {
        let fwd = q.next().expect("Expected forward track in history");
        assert_eq!(&fwd.id, expected_id);
    }

    // Forward through all 500 spliced tracks
    for expected_id in &spliced_visited {
        let fwd = q.next().expect("Expected forward spliced track");
        assert_eq!(&fwd.id, expected_id);
        all_traversed.push(fwd.id.clone());
    }

    // Traverse remaining unplayed base tracks (initial 10 - 4 played = 6 remaining)
    let mut remaining = Vec::new();
    while let Some(t) = q.next() {
        remaining.push(t.id.clone());
        all_traversed.push(t.id.clone());
    }
    assert_eq!(remaining.len(), 6);

    // Total tracks traversed must equal 510, with ZERO duplicates
    assert_eq!(all_traversed.len(), initial_count + insert_count);
    let unique_set: HashSet<String> = all_traversed.into_iter().collect();
    assert_eq!(unique_set.len(), initial_count + insert_count);
}

/// Adversarial Test 3: Rapid shuffle toggling under dynamic queue operations.
#[test]
fn test_challenger_rapid_shuffle_toggling_with_state_mutations() {
    let mut q = StandardQueueManager::new();
    let size = 30;
    let tracks: Vec<Track> = (0..size)
        .map(|i| make_test_track(&format!("toggle_{i}"), &format!("Toggle Song {i}")))
        .collect();

    q.set_queue(tracks, 5);

    let mut rng = rand::thread_rng();

    for i in 0..10_000 {
        // Toggle shuffle
        let enable = rng.gen_bool(0.5);
        q.set_shuffle(enable);

        // Perform mutation
        if i % 3 == 0 {
            let _ = q.next();
        } else if i % 5 == 0 {
            q.play_next(make_test_track(&format!("tog_pn_{i}"), "Tog PN"));
        } else if i % 7 == 0 {
            q.push_back(make_test_track(&format!("tog_pb_{i}"), "Tog PB"));
        } else if i % 11 == 0 {
            let _ = q.previous(Duration::from_millis(500));
        }

        // Validate bounds
        let q_len = q.queue().len();
        let idx = q.current_index().expect("Index must be Some for non-empty queue");
        assert!(idx < q_len, "Index {idx} out of bounds for queue len {q_len}");
        let trk = q.current_track().expect("Track must be Some");
        assert_eq!(trk.id, q.queue()[idx].id);
    }
}

/// Adversarial Test 4: Extreme edge cases on empty and single-element queues.
#[test]
fn test_challenger_empty_and_boundary_state_transitions() {
    let mut q = StandardQueueManager::new();

    // 1. Calling everything on empty queue
    assert_eq!(q.next(), None);
    assert_eq!(q.previous(Duration::ZERO), None);
    assert_eq!(q.previous(Duration::from_secs(100)), None);
    assert_eq!(q.current_index(), None);
    assert_eq!(q.current_track(), None);
    assert!(q.queue().is_empty());

    // Shuffle and loop mode on empty queue
    q.set_shuffle(true);
    assert_eq!(q.next(), None);
    q.set_loop_mode(LoopMode::Track);
    assert_eq!(q.next(), None);
    q.set_loop_mode(LoopMode::Queue);
    assert_eq!(q.next(), None);
    q.set_shuffle(false);
    assert_eq!(q.next(), None);

    // Out of bounds start_index on set_queue
    let t1 = make_test_track("single_1", "Single 1");
    q.set_queue(vec![t1.clone()], 999999);
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("single_1"));

    // Resetting back to empty
    q.set_queue(vec![], usize::MAX);
    assert_eq!(q.current_index(), None);
    assert_eq!(q.current_track(), None);

    // play_next on empty queue
    q.set_shuffle(true);
    let t2 = make_test_track("single_2", "Single 2");
    q.play_next(t2);
    assert_eq!(q.queue().len(), 1);
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("single_2"));

    // Reset back to empty
    q.set_queue(vec![], 0);
    // push_back on empty queue
    q.set_shuffle(true);
    let t3 = make_test_track("single_3", "Single 3");
    q.push_back(t3);
    assert_eq!(q.queue().len(), 1);
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("single_3"));
}

/// Adversarial Test 5: Shuffle Permutation Uniqueness & Completeness on 500+ iterations across various sizes.
#[test]
fn test_challenger_shuffle_permutation_rigor() {
    let mut q = StandardQueueManager::new();
    let mut rng = rand::thread_rng();

    for size in [2, 4, 7, 13, 31, 64, 128] {
        let tracks: Vec<Track> = (0..size)
            .map(|i| make_test_track(&format!("perm_{size}_{i}"), &format!("Song {i}")))
            .collect();

        for cycle in 0..100 {
            let start_idx = rng.gen_range(0..size);
            q.set_queue(tracks.clone(), start_idx);
            q.set_shuffle(true);
            q.set_loop_mode(LoopMode::Off);

            let initial_id = format!("perm_{size}_{start_idx}");
            assert_eq!(q.current_track().map(|t| t.id.as_str()), Some(initial_id.as_str()));

            let mut visited = Vec::with_capacity(size);
            visited.push(initial_id);

            for _ in 1..size {
                let nxt = q.next().expect("Expected next track during complete shuffle traversal");
                visited.push(nxt.id.clone());
            }

            assert_eq!(visited.len(), size);
            let unique_set: HashSet<String> = visited.into_iter().collect();
            assert_eq!(
                unique_set.len(),
                size,
                "Cycle {cycle} for size {size} failed: duplicate items found in shuffle sequence"
            );

            // In LoopMode::Off, the (size+1)-th next() must return None
            assert_eq!(q.next(), None);
        }
    }
}

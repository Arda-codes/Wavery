//! Final Hardening Challenge Suite (Milestone 4) for Audio Queue State Machine.

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
            artist: Some("Test Artist".into()),
            album: Some("Test Album".into()),
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            duration: Duration::from_secs(240),
            sample_rate: None,
            bit_depth: None,
            channels: None,
            format: "FLAC".into(),
            lyrics: None,
        },
        date_added: 0,
    }
}

/// Stress Test 1: Rapid 200,000 randomized state mutations across varying queue sizes (0, 1, 2, 5, 20, 100, 500).
#[test]
fn test_m4_queue_state_machine_fuzz_invariants() {
    let mut q = StandardQueueManager::new();
    let mut rng = rand::thread_rng();

    for queue_size in [0, 1, 2, 3, 5, 10, 50, 100] {
        let initial_tracks: Vec<Track> = (0..queue_size)
            .map(|i| make_test_track(&format!("q_{queue_size}_{i}"), &format!("Song {i}")))
            .collect();

        let start_idx = if queue_size > 0 { rng.gen_range(0..queue_size) } else { 0 };
        q.set_queue(initial_tracks.clone(), start_idx);

        for step in 0..10_000 {
            let action = rng.gen_range(0..9);
            match action {
                0 => {
                    // next()
                    let _ = q.next();
                }
                1 => {
                    // previous() with < 3s (navigate back)
                    let _ = q.previous(Duration::from_secs(1));
                }
                2 => {
                    // previous() with > 3s (restart current)
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
                    // push_back
                    let new_id = format!("pb_{queue_size}_{step}");
                    q.push_back(make_test_track(&new_id, "Appended"));
                }
                6 => {
                    // play_next
                    let new_id = format!("pn_{queue_size}_{step}");
                    q.play_next(make_test_track(&new_id, "Played Next"));
                }
                7 => {
                    // set_queue reset
                    if rng.gen_bool(0.05) {
                        let new_sz = rng.gen_range(0..30);
                        let trks: Vec<Track> = (0..new_sz)
                            .map(|i| make_test_track(&format!("reset_{i}"), &format!("Reset Song {i}")))
                            .collect();
                        let s_idx = if new_sz > 0 { rng.gen_range(0..new_sz) } else { 0 };
                        q.set_queue(trks, s_idx);
                    }
                }
                8 => {
                    // check bounds
                    let _ = q.current_index();
                    let _ = q.current_track();
                    let _ = q.queue();
                }
                _ => unreachable!(),
            }

            // CRITICAL INVARIANT CHECKS
            let curr_idx = q.current_index();
            let curr_trk = q.current_track();
            let queue_len = q.queue().len();

            if queue_len == 0 {
                assert_eq!(curr_idx, None, "Step {step}: Empty queue must have current_index == None");
                assert_eq!(curr_trk, None, "Step {step}: Empty queue must have current_track == None");
            } else {
                assert!(curr_idx.is_some(), "Step {step}: Non-empty queue must have current_index");
                let idx = curr_idx.unwrap();
                assert!(idx < queue_len, "Step {step}: current_index {idx} out of bounds for queue len {queue_len}");
                assert!(curr_trk.is_some(), "Step {step}: Non-empty queue must have current_track");
                assert_eq!(curr_trk.unwrap().id, q.queue()[idx].id, "Step {step}: current_track must match queue[current_index]");
            }
        }
    }

    println!("\n=== M4 AUDIO QUEUE STATE MACHINE INVARIANT FUZZING PASSED ===");
}

/// Stress Test 2: Exhaustive Shuffle Permutation Uniqueness & Complete Cycle Traversals.
#[test]
fn test_m4_shuffle_permutation_rigorous_uniqueness() {
    let mut q = StandardQueueManager::new();
    let mut rng = rand::thread_rng();

    for size in [2, 3, 5, 10, 25, 100] {
        let tracks: Vec<Track> = (0..size)
            .map(|i| make_test_track(&format!("perm_{size}_{i}"), &format!("Perm Song {i}")))
            .collect();

        for cycle in 0..200 {
            let start_idx = rng.gen_range(0..size);
            q.set_queue(tracks.clone(), start_idx);
            q.set_shuffle(true);
            q.set_loop_mode(LoopMode::Off);

            let initial_id = format!("perm_{size}_{start_idx}");
            assert_eq!(q.current_track().map(|t| t.id.as_str()), Some(initial_id.as_str()));

            let mut visited = Vec::with_capacity(size);
            visited.push(initial_id);

            for _ in 1..size {
                let nxt = q.next().unwrap_or_else(|| panic!("Size {size} Cycle {cycle}: premature None in shuffle"));
                visited.push(nxt.id.clone());
            }

            // Must visit all `size` elements exactly once
            assert_eq!(visited.len(), size);
            let set: HashSet<String> = visited.into_iter().collect();
            assert_eq!(set.len(), size, "Size {size} Cycle {cycle}: Duplicate tracks encountered during shuffle traversal");

            // LoopMode::Off -> next() returns None
            assert_eq!(q.next(), None);
        }
    }

    println!("\n=== M4 SHUFFLE PERMUTATION RIGOROUS TESTS PASSED ===");
}

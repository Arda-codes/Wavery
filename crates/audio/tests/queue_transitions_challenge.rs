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
        source: TrackSource::Managed(PathBuf::from(format!("/music/{id}.mp3"))),
        metadata: TrackMetadata {
            title: Some(title.into()),
            artist: Some("Test Artist".into()),
            album: Some("Test Album".into()),
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            duration: Duration::from_secs(180),
            sample_rate: None,
            bit_depth: None,
            channels: None,
            format: "MP3".into(),
        },
        date_added: 0,
    }
}

/// Adversarial Challenge 1: Queue size 0 (empty queue invariants).
#[test]
fn test_challenge_queue_size_0_exhaustive() {
    let mut q = StandardQueueManager::new();

    for start_idx in [0, 1, 10, usize::MAX] {
        q.set_queue(vec![], start_idx);
        assert_eq!(q.current_index(), None);
        assert_eq!(q.current_track(), None);
        assert!(q.queue().is_empty());

        for mode in [LoopMode::Off, LoopMode::Track, LoopMode::Queue] {
            q.set_loop_mode(mode);
            for shuffle in [false, true] {
                q.set_shuffle(shuffle);

                for _ in 0..100 {
                    assert_eq!(q.next(), None);
                    assert_eq!(q.current_index(), None);
                    assert_eq!(q.current_track(), None);
                }

                for secs in [0, 1, 3, 5, 3600] {
                    assert_eq!(q.previous(Duration::from_secs(secs)), None);
                    assert_eq!(q.current_index(), None);
                    assert_eq!(q.current_track(), None);
                }
            }
        }
    }
}

/// Adversarial Challenge 2: Queue size 1 (single-item queue).
#[test]
fn test_challenge_queue_size_1_transitions() {
    let mut q = StandardQueueManager::new();
    let t0 = make_test_track("single_0", "Single Track");

    q.set_queue(vec![t0.clone()], 0);
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("single_0"));

    // 1. LoopMode::Off with shuffle enabled / disabled
    for shuffle in [false, true] {
        q.set_shuffle(shuffle);
        q.set_loop_mode(LoopMode::Off);
        // Next on single track with LoopMode::Off returns None and does not panic or change current index
        assert_eq!(q.next(), None);
        assert_eq!(q.current_index(), Some(0));
        assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("single_0"));

        // Previous on single track always returns current track
        assert_eq!(q.previous(Duration::from_secs(1)).map(|t| t.id.as_str()), Some("single_0"));
        assert_eq!(q.previous(Duration::from_secs(10)).map(|t| t.id.as_str()), Some("single_0"));
    }

    // 2. LoopMode::Track high-iteration loop
    q.set_loop_mode(LoopMode::Track);
    for shuffle in [false, true] {
        q.set_shuffle(shuffle);
        for _ in 0..1_000 {
            let next_t = q.next();
            assert_eq!(next_t.map(|t| t.id.as_str()), Some("single_0"));
            assert_eq!(q.current_index(), Some(0));
        }
    }

    // 3. LoopMode::Queue high-iteration loop with shuffle
    q.set_loop_mode(LoopMode::Queue);
    q.set_shuffle(true);
    for _ in 0..1_000 {
        let next_t = q.next();
        assert_eq!(next_t.map(|t| t.id.as_str()), Some("single_0"));
        assert_eq!(q.current_index(), Some(0));
    }

    // 4. Random state-fuzzing on size 1
    let mut rng = rand::thread_rng();
    for _ in 0..5_000 {
        match rng.gen_range(0..4) {
            0 => {
                let _ = q.next();
            }
            1 => {
                let dur = Duration::from_secs(rng.gen_range(0..10));
                let _ = q.previous(dur);
            }
            2 => {
                let mode = match rng.gen_range(0..3) {
                    0 => LoopMode::Off,
                    1 => LoopMode::Track,
                    _ => LoopMode::Queue,
                };
                q.set_loop_mode(mode);
            }
            3 => {
                q.set_shuffle(rng.gen_bool(0.5));
            }
            _ => unreachable!(),
        }
        assert_eq!(q.current_index(), Some(0));
        assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("single_0"));
    }
}

/// Adversarial Challenge 3: Queue size 2 (2-item shuffle permutations and transitions).
#[test]
fn test_challenge_queue_size_2_permutations() {
    let mut q = StandardQueueManager::new();
    let t0 = make_test_track("t0", "Track 0");
    let t1 = make_test_track("t1", "Track 1");

    for start_index in [0, 1] {
        let expected_first = format!("t{start_index}");
        let expected_second = format!("t{}", 1 - start_index);

        for _ in 0..500 {
            q.set_queue(vec![t0.clone(), t1.clone()], start_index);
            q.set_shuffle(true);

            // First track must be the chosen start track
            assert_eq!(q.current_track().map(|t| t.id.as_str()), Some(expected_first.as_str()));

            // Next track must be the other track (complete 2-item permutation)
            let next_track = q.next().expect("Expected next track in 2-item shuffle");
            assert_eq!(next_track.id, expected_second);
            assert_eq!(q.current_track().map(|t| t.id.as_str()), Some(expected_second.as_str()));

            // In LoopMode::Off, subsequent next returns None
            q.set_loop_mode(LoopMode::Off);
            assert_eq!(q.next(), None);

            // Previous navigates back to first track
            let prev_track = q.previous(Duration::from_secs(1));
            assert_eq!(prev_track.map(|t| t.id.as_str()), Some(expected_first.as_str()));
        }
    }
}

/// Adversarial Challenge 4: Queue size 50 (50 items across 1,000 shuffle cycles and 50,000 fuzz operations).
#[test]
fn test_challenge_queue_size_50_shuffle_permutations_and_stress() {
    let mut q = StandardQueueManager::new();
    let size = 50;
    let tracks: Vec<Track> = (0..size)
        .map(|i| make_test_track(&format!("track_{i}"), &format!("Track {i}")))
        .collect();

    let mut rng = rand::thread_rng();

    // 1. Test 1,000 full shuffle permutation cycles
    for cycle in 0..1_000 {
        let start_idx = rng.gen_range(0..size);
        q.set_queue(tracks.clone(), start_idx);
        q.set_shuffle(true);
        q.set_loop_mode(LoopMode::Off);

        let initial_id = format!("track_{start_idx}");
        assert_eq!(q.current_track().map(|t| t.id.as_str()), Some(initial_id.as_str()));

        let mut visited = Vec::with_capacity(size);
        visited.push(initial_id);

        for _ in 1..size {
            let next_t = q.next().unwrap_or_else(|| panic!("Cycle {cycle}: next() returned None unexpectedly before visiting all items"));
            visited.push(next_t.id.clone());
        }

        // Verify complete permutation of exactly 50 items
        assert_eq!(visited.len(), size);
        let unique_set: HashSet<&String> = visited.iter().collect();
        assert_eq!(unique_set.len(), size, "Cycle {cycle} produced duplicate tracks in shuffle permutation: {:?}", visited);

        for i in 0..size {
            let expected_id = format!("track_{i}");
            assert!(unique_set.contains(&expected_id), "Cycle {cycle} missing track {expected_id}");
        }

        // LoopMode::Off -> next() returns None at end of queue
        assert_eq!(q.next(), None);

        // Previous navigation backwards through the shuffle sequence
        for back_idx in (0..size - 1).rev() {
            let prev_t = q.previous(Duration::from_secs(1)).expect("Expected previous track during back navigation");
            assert_eq!(prev_t.id, visited[back_idx]);
        }
    }

    // 2. 50,000 random operations fuzz test on size 50
    q.set_queue(tracks.clone(), 0);
    for step in 0..50_000 {
        let action = rng.gen_range(0..7);
        match action {
            0 => {
                let _ = q.next();
            }
            1 => {
                let dur = Duration::from_secs(rng.gen_range(0..10));
                let _ = q.previous(dur);
            }
            2 => {
                let mode = match rng.gen_range(0..3) {
                    0 => LoopMode::Off,
                    1 => LoopMode::Track,
                    _ => LoopMode::Queue,
                };
                q.set_loop_mode(mode);
            }
            3 => {
                q.set_shuffle(rng.gen_bool(0.5));
            }
            4 => {
                let insert_id = format!("fuzz_next_{step}");
                q.play_next(make_test_track(&insert_id, "Inserted Fuzz"));
            }
            5 => {
                let append_id = format!("fuzz_back_{step}");
                q.push_back(make_test_track(&append_id, "Appended Fuzz"));
            }
            6 => {
                let new_start = rng.gen_range(0..size);
                q.set_queue(tracks.clone(), new_start);
            }
            _ => unreachable!(),
        }

        // Invariants after every single operation
        let curr_idx = q.current_index();
        let curr_track = q.current_track();
        if q.queue().is_empty() {
            assert_eq!(curr_idx, None);
            assert_eq!(curr_track, None);
        } else {
            assert!(curr_idx.is_some());
            let idx = curr_idx.unwrap();
            assert!(idx < q.queue().len(), "Step {step}: current_index {idx} out of bounds for queue len {}", q.queue().len());
            assert!(curr_track.is_some());
            assert_eq!(curr_track.unwrap().id, q.queue()[idx].id);
        }
    }
}

/// Adversarial Challenge 5: Queue size 1000 (large playlist scale, complete permutations and 100,000 stress loop).
#[test]
fn test_challenge_queue_size_1000_large_scale() {
    let size = 1000;
    let tracks: Vec<Track> = (0..size)
        .map(|i| make_test_track(&format!("trk_{i:04}"), &format!("Large Track {i}")))
        .collect();

    let mut q = StandardQueueManager::new();
    let mut rng = rand::thread_rng();

    // 1. Test 50 full 1,000-item shuffle cycles for permutation integrity
    for cycle in 0..50 {
        let start_idx = rng.gen_range(0..size);
        q.set_queue(tracks.clone(), start_idx);
        q.set_shuffle(true);
        q.set_loop_mode(LoopMode::Off);

        let initial_id = format!("trk_{start_idx:04}");
        assert_eq!(q.current_track().map(|t| t.id.as_str()), Some(initial_id.as_str()));

        let mut visited = Vec::with_capacity(size);
        visited.push(initial_id);

        for _ in 1..size {
            let next_t = q.next().unwrap_or_else(|| panic!("Large Scale Cycle {cycle}: unexpected None before 1000 items"));
            visited.push(next_t.id.clone());
        }

        assert_eq!(visited.len(), size);
        let unique_set: HashSet<&String> = visited.iter().collect();
        assert_eq!(unique_set.len(), size, "Large scale cycle {cycle} failed 1000-permutation uniqueness");
        assert_eq!(q.next(), None);
    }

    // 2. 100,000 high-iteration rapid loop transitions
    q.set_queue(tracks, 0);
    q.set_shuffle(true);
    q.set_loop_mode(LoopMode::Queue);

    for step in 0..100_000 {
        let next_track = q.next().expect("LoopMode::Queue must never return None on non-empty queue");
        assert!(next_track.id.starts_with("trk_"));
        if step % 5_000 == 0 {
            // Toggle shuffle or restart track occasionally
            q.set_shuffle(step % 10_000 == 0);
            let _ = q.previous(Duration::from_secs(5));
        }
    }
}

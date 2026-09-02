//! Integration and Stress Test Suite for Audio Pipeline Hardening & Resilient Playback Engine (Milestone 1).

use rand::Rng;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use wavery_audio::player::RodioPlayer;
use wavery_audio::queue::StandardQueueManager;
use wavery_core::models::{LoopMode, Track, TrackMetadata, TrackSource};
use wavery_core::traits::{PlayerEngine, QueueManager};

fn make_test_track(id: &str, title: &str) -> Track {
    Track {
        id: id.into(),
        source: TrackSource::Managed(PathBuf::from(format!("/music/{id}.flac"))),
        metadata: TrackMetadata {
            title: Some(title.into()),
            artist: Some("Hardening Artist".into()),
            album: Some("Hardening Album".into()),
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            duration: Duration::from_secs(180),
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "FLAC".into(),
        },
        date_added: 0,
    }
}

/// Challenge 1: Shuffle Splicing Invariant Fuzzing under Random Mutations (10,000 steps).
#[test]
fn test_shuffle_splicing_heavy_stress_invariants() {
    let mut q = StandardQueueManager::new();
    let mut rng = rand::thread_rng();

    for initial_size in [1, 2, 5, 15, 50] {
        let initial_tracks: Vec<Track> = (0..initial_size)
            .map(|i| make_test_track(&format!("init_{initial_size}_{i}"), &format!("Init {i}")))
            .collect();

        let start = rng.gen_range(0..initial_size);
        q.set_queue(initial_tracks, start);
        q.set_shuffle(true);

        for step in 0..2_000 {
            match rng.gen_range(0..8) {
                0 => {
                    // next()
                    let _ = q.next();
                }
                1 => {
                    // previous() < 3s (step back)
                    let _ = q.previous(Duration::from_secs(1));
                }
                2 => {
                    // previous() >= 3s (restart current)
                    let _ = q.previous(Duration::from_secs(5));
                }
                3 => {
                    // play_next (splicing)
                    let splice_id = format!("splice_{initial_size}_{step}");
                    q.play_next(make_test_track(&splice_id, "Spliced Track"));
                }
                4 => {
                    // push_back (appending)
                    let append_id = format!("append_{initial_size}_{step}");
                    q.push_back(make_test_track(&append_id, "Appended Track"));
                }
                5 => {
                    // loop mode switch
                    let mode = match rng.gen_range(0..3) {
                        0 => LoopMode::Off,
                        1 => LoopMode::Track,
                        _ => LoopMode::Queue,
                    };
                    q.set_loop_mode(mode);
                }
                6 => {
                    // shuffle toggle
                    q.set_shuffle(rng.gen_bool(0.7));
                }
                7 => {
                    // query current track & index
                    let _ = q.current_index();
                    let _ = q.current_track();
                }
                _ => unreachable!(),
            }

            // Invariant verification on every step
            let q_len = q.queue().len();
            let curr_idx = q.current_index();
            let curr_trk = q.current_track();

            if q_len == 0 {
                assert_eq!(curr_idx, None);
                assert_eq!(curr_trk, None);
            } else {
                assert!(curr_idx.is_some(), "Step {step}: Non-empty queue must have current_index");
                let idx = curr_idx.unwrap();
                assert!(idx < q_len, "Step {step}: current_index {idx} out of bounds for len {q_len}");
                assert!(curr_trk.is_some(), "Step {step}: Non-empty queue must have current_track");
                assert_eq!(curr_trk.unwrap().id, q.queue()[idx].id);
            }
        }
    }
}

/// Challenge 2: Strict Shuffle Played History Preservation across Multi-Track Splicing and Appending.
#[test]
fn test_shuffle_history_preservation_across_multiple_splices() {
    let mut q = StandardQueueManager::new();
    let size = 20;
    let tracks: Vec<Track> = (0..size)
        .map(|i| make_test_track(&format!("base_{i:02}"), &format!("Base Track {i}")))
        .collect();

    q.set_queue(tracks, 0);
    q.set_shuffle(true);
    q.set_loop_mode(LoopMode::Off);

    // Initial track and advance 5 times
    let mut history = Vec::new();
    history.push(q.current_track().unwrap().id.clone());

    for _ in 0..5 {
        let nxt = q.next().expect("Expected next track");
        history.push(nxt.id.clone());
    }
    // We have visited 6 tracks: history[0..=5]
    assert_eq!(history.len(), 6);

    // Perform 3 sequential play_next splices
    q.play_next(make_test_track("splice_A", "Splice A"));
    q.play_next(make_test_track("splice_B", "Splice B"));
    q.play_next(make_test_track("splice_C", "Splice C"));

    // Perform 2 sequential push_back appends
    q.push_back(make_test_track("append_X", "Append X"));
    q.push_back(make_test_track("append_Y", "Append Y"));

    // Current track must still be history[5]
    assert_eq!(q.current_track().unwrap().id, history[5]);

    // Backward navigation must traverse history[4], history[3], history[2], history[1], history[0]
    for step in (0..5).rev() {
        let prev = q.previous(Duration::from_secs(1)).expect("Expected previous history track");
        assert_eq!(prev.id, history[step], "History mismatch at step {step}");
    }

    // Step forward back to history[5]
    for expected in &history[1..=5] {
        let fwd = q.next().expect("Expected forward history track");
        assert_eq!(&fwd.id, expected);
    }

    // Next 3 steps MUST yield spliced tracks in LIFO order of insertion (C, then B, then A)
    let s_c = q.next().expect("Expected splice C");
    assert_eq!(s_c.id, "splice_C");

    let s_b = q.next().expect("Expected splice B");
    assert_eq!(s_b.id, "splice_B");

    let s_a = q.next().expect("Expected splice A");
    assert_eq!(s_a.id, "splice_A");

    // Traverse all remaining tracks to end of queue
    let mut remaining = Vec::new();
    while let Some(t) = q.next() {
        remaining.push(t.id.clone());
    }

    // Remaining must include the 14 unplayed base tracks + 2 appended tracks = 16 tracks
    assert_eq!(remaining.len(), 16);

    // Total visited: 6 history + 3 spliced + 16 remaining = 25 tracks
    let mut all_visited = history;
    all_visited.push("splice_C".into());
    all_visited.push("splice_B".into());
    all_visited.push("splice_A".into());
    all_visited.extend(remaining);

    assert_eq!(all_visited.len(), 25);
    let unique: HashSet<String> = all_visited.into_iter().collect();
    assert_eq!(unique.len(), 25, "Found duplicate or omitted tracks in shuffle queue");
}

/// Challenge 3: Concurrent Multi-Threaded State Inspection and Control Safety.
#[test]
fn test_player_concurrent_inspection_and_control_safety() {
    if let Ok(player) = RodioPlayer::try_new() {
        let player = Arc::new(parking_lot::Mutex::new(player));
        let mut handles = Vec::new();

        // Spawn 4 threads concurrently inspecting and commanding player
        for t_idx in 0..4 {
            let p = Arc::clone(&player);
            handles.push(thread::spawn(move || {
                for i in 0..500 {
                    let mut lock = p.lock();
                    let _ = lock.position();
                    let _ = lock.duration();
                    let _ = lock.state();
                    let _ = lock.volume();
                    if i % 10 == 0 {
                        let vol = (t_idx as f32 * 0.2 + (i as f32 * 0.01)) % 1.0;
                        lock.set_volume(vol);
                    }
                    if i % 50 == 0 {
                        let _ = lock.pause();
                        let _ = lock.play();
                    }
                }
            }));
        }

        for h in handles {
            h.join().expect("Worker thread panicked during concurrent control");
        }

        let mut lock = player.lock();
        let _ = lock.stop();
    }
}

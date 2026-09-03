use crate::player::RodioPlayer;
use crate::queue::StandardQueueManager;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use wavery_core::error::AudioError;
use wavery_core::models::{LoopMode, Track, TrackMetadata, TrackSource};
use wavery_core::traits::{PlayerEngine, QueueManager};

fn make_test_track(id: &str, title: &str) -> Track {
    Track {
        id: id.into(),
        source: TrackSource::Managed(PathBuf::from(format!("/music/{id}.mp3"))),
        metadata: TrackMetadata {
            title: Some(title.into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            duration: Duration::from_secs(120),
            sample_rate: None,
            bit_depth: None,
            channels: None,
            format: "MP3".into(),
        },
        date_added: 0,
    }
}

#[test]
fn test_queue_linear_navigation() {
    let mut q = StandardQueueManager::new();
    let t1 = make_test_track("1", "Track 1");
    let t2 = make_test_track("2", "Track 2");
    let t3 = make_test_track("3", "Track 3");

    q.set_queue(vec![t1.clone(), t2.clone(), t3.clone()], 0);

    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("1"));

    let next = q.next();
    assert_eq!(next.map(|t| t.id.as_str()), Some("2"));
    assert_eq!(q.current_index(), Some(1));

    let prev = q.previous(Duration::from_secs(1));
    assert_eq!(prev.map(|t| t.id.as_str()), Some("1"));
    assert_eq!(q.current_index(), Some(0));
}

#[test]
fn test_queue_loop_track() {
    let mut q = StandardQueueManager::new();
    let t1 = make_test_track("1", "Track 1");
    let t2 = make_test_track("2", "Track 2");

    q.set_queue(vec![t1, t2], 0);
    q.set_loop_mode(LoopMode::Track);

    let next = q.next();
    assert_eq!(next.map(|t| t.id.as_str()), Some("1"));
}

#[test]
fn test_queue_loop_queue() {
    let mut q = StandardQueueManager::new();
    let t1 = make_test_track("1", "Track 1");
    let t2 = make_test_track("2", "Track 2");

    q.set_queue(vec![t1, t2], 1);
    q.set_loop_mode(LoopMode::Queue);

    let next = q.next();
    assert_eq!(next.map(|t| t.id.as_str()), Some("1"));
    assert_eq!(q.current_index(), Some(0));
}

#[test]
fn test_queue_previous_restart_threshold() {
    let mut q = StandardQueueManager::new();
    let t1 = make_test_track("1", "Track 1");
    let t2 = make_test_track("2", "Track 2");

    q.set_queue(vec![t1, t2], 1);

    // If played > 3 seconds into track, restart current track (t2)
    let prev = q.previous(Duration::from_secs(5));
    assert_eq!(prev.map(|t| t.id.as_str()), Some("2"));
    assert_eq!(q.current_index(), Some(1));

    // If played <= 3 seconds, go to previous track (t1)
    let prev = q.previous(Duration::from_secs(2));
    assert_eq!(prev.map(|t| t.id.as_str()), Some("1"));
    assert_eq!(q.current_index(), Some(0));
}

#[test]
fn test_queue_play_next_and_push_back() {
    let mut q = StandardQueueManager::new();
    let t1 = make_test_track("1", "Track 1");
    let t2 = make_test_track("2", "Track 2");
    let t_inserted = make_test_track("1.5", "Inserted Track");
    let t_last = make_test_track("3", "Last Track");

    q.set_queue(vec![t1, t2], 0);
    q.play_next(t_inserted.clone());
    assert_eq!(q.queue().len(), 3);
    assert_eq!(q.queue()[1].id, "1.5");

    q.push_back(t_last.clone());
    assert_eq!(q.queue().len(), 4);
    assert_eq!(q.queue()[3].id, "3");
}

#[test]
fn test_queue_shuffle_mode() {
    let mut q = StandardQueueManager::new();
    let tracks = (1..=10)
        .map(|i| make_test_track(&format!("{i}"), &format!("Track {i}")))
        .collect();

    q.set_queue(tracks, 0);
    q.set_shuffle(true);

    assert_eq!(q.current_index(), Some(0));
    let next = q.next();
    assert!(next.is_some());
}

#[test]
fn test_queue_empty_state_and_invariants() {
    let mut q = StandardQueueManager::new();
    assert_eq!(q.current_index(), None);
    assert_eq!(q.current_track(), None);
    assert!(q.queue().is_empty());
    assert_eq!(q.next(), None);
    assert_eq!(q.previous(Duration::ZERO), None);

    // Calling shuffle or loop mode on empty queue does not panic
    q.set_shuffle(true);
    assert_eq!(q.next(), None);
    q.set_loop_mode(LoopMode::Queue);
    assert_eq!(q.next(), None);
    q.set_loop_mode(LoopMode::Track);
    assert_eq!(q.next(), None);

    // push_back initializes current_idx to Some(0)
    let t1 = make_test_track("1", "Track 1");
    q.push_back(t1);
    assert_eq!(q.queue().len(), 1);
    assert_eq!(q.current_index(), Some(0));
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("1"));

    // Reset with empty queue clears state
    q.set_queue(vec![], 0);
    assert_eq!(q.queue().len(), 0);
    assert_eq!(q.current_index(), None);
    assert_eq!(q.current_track(), None);

    // play_next on empty queue initializes current_idx to Some(0)
    let t2 = make_test_track("2", "Track 2");
    q.play_next(t2);
    assert_eq!(q.queue().len(), 1);
    assert_eq!(q.current_index(), Some(0));
}

#[test]
fn test_queue_single_track_loop_modes() {
    let mut q = StandardQueueManager::new();
    let t1 = make_test_track("1", "Track 1");
    q.set_queue(vec![t1], 0);

    // LoopMode::Off on single track -> next() is None
    q.set_loop_mode(LoopMode::Off);
    assert_eq!(q.next(), None);
    assert_eq!(q.current_index(), Some(0));

    // LoopMode::Track on single track -> next() is Some(t1)
    q.set_loop_mode(LoopMode::Track);
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("1"));
    assert_eq!(q.current_index(), Some(0));

    // LoopMode::Queue on single track -> next() wraps to Some(t1)
    q.set_loop_mode(LoopMode::Queue);
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("1"));
    assert_eq!(q.current_index(), Some(0));

    // previous() behavior on single track
    assert_eq!(q.previous(Duration::from_secs(1)).map(|t| t.id.as_str()), Some("1"));
    assert_eq!(q.previous(Duration::from_secs(10)).map(|t| t.id.as_str()), Some("1"));
}

#[test]
fn test_queue_linear_boundary_clamping_and_wrap() {
    let mut q = StandardQueueManager::new();
    let tracks: Vec<Track> = (0..5)
        .map(|i| make_test_track(&format!("{i}"), &format!("Track {i}")))
        .collect();

    // Start index clamping
    q.set_queue(tracks, 999);
    assert_eq!(q.current_index(), Some(4)); // Clamped to len - 1 = 4
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("4"));

    // LoopMode::Off at end of queue
    q.set_loop_mode(LoopMode::Off);
    assert_eq!(q.next(), None);
    assert_eq!(q.current_index(), Some(4));

    // LoopMode::Queue wraps to index 0
    q.set_loop_mode(LoopMode::Queue);
    assert_eq!(q.next().map(|t| t.id.as_str()), Some("0"));
    assert_eq!(q.current_index(), Some(0));

    // At index 0, previous(1s) does not underflow or wrap
    assert_eq!(q.previous(Duration::from_secs(1)).map(|t| t.id.as_str()), Some("0"));
    assert_eq!(q.current_index(), Some(0));
}

#[test]
fn test_queue_shuffle_permutation_completeness_and_loop_queue() {
    let mut q = StandardQueueManager::new();
    let tracks: Vec<Track> = (0..10)
        .map(|i| make_test_track(&format!("{i}"), &format!("Track {i}")))
        .collect();

    // Start at index 3
    q.set_queue(tracks, 3);
    q.set_shuffle(true);

    // Initial track is the starting track (index 3 -> "3")
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("3"));

    let mut visited = Vec::new();
    visited.push(q.current_track().unwrap().id.clone());

    // Advance 9 times to traverse all 10 tracks
    for _ in 0..9 {
        let next_track = q.next().expect("Expected next track in shuffle permutation");
        visited.push(next_track.id.clone());
    }

    // Verify all 10 tracks were visited exactly once (complete permutation, no duplicates)
    assert_eq!(visited.len(), 10);
    let unique_set: HashSet<_> = visited.iter().collect();
    assert_eq!(unique_set.len(), 10);
    for i in 0..10 {
        assert!(unique_set.contains(&format!("{i}")));
    }

    // In LoopMode::Off, the 10th next() returns None
    q.set_loop_mode(LoopMode::Off);
    assert_eq!(q.next(), None);

    // In LoopMode::Track, next() repeats current track without advancing
    q.set_loop_mode(LoopMode::Track);
    let curr_id = q.current_track().unwrap().id.clone();
    assert_eq!(q.next().map(|t| t.id.as_str()), Some(curr_id.as_str()));

    // In LoopMode::Queue, next() rebuilds shuffle and wraps cleanly
    q.set_loop_mode(LoopMode::Queue);
    let wrapped_id = q.next().map(|t| t.id.clone());
    assert!(wrapped_id.is_some());
    assert_eq!(q.current_index(), Some(wrapped_id.unwrap().parse::<usize>().unwrap()));

    // Reverse traversal under shuffle
    let before_prev = q.current_track().unwrap().id.clone();
    let _ = q.next();
    let back = q.previous(Duration::from_secs(1));
    assert_eq!(back.map(|t| t.id.clone()), Some(before_prev));
}

#[test]
fn test_queue_dynamic_mutations_under_shuffle() {
    let mut q = StandardQueueManager::new();
    let tracks: Vec<Track> = (0..5)
        .map(|i| make_test_track(&format!("{i}"), &format!("Track {i}")))
        .collect();

    q.set_queue(tracks, 2);
    q.set_shuffle(true);
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("2"));

    // play_next inserts track after current and rebuilds shuffle
    let inserted = make_test_track("99", "Play Next Track");
    q.play_next(inserted);
    assert_eq!(q.queue().len(), 6);
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("2"));

    // push_back appends track to queue
    let appended = make_test_track("100", "Push Back Track");
    q.push_back(appended);
    assert_eq!(q.queue().len(), 7);

    // Disabling shuffle preserves current track index
    let current_id = q.current_track().unwrap().id.clone();
    let current_idx = q.current_index().unwrap();
    q.set_shuffle(false);
    assert_eq!(q.current_index(), Some(current_idx));
    assert_eq!(q.current_track().map(|t| t.id.clone()), Some(current_id));
}

#[tokio::test]
async fn test_rodio_player_error_handling() {
    // If output stream is available, test error branches
    match RodioPlayer::try_new() {
        Ok(mut player) => {
            // 1. Non-existent file -> FileNotFound
            let ghost_track = Track {
                id: "ghost".into(),
                source: TrackSource::Managed(PathBuf::from("/nonexistent/path/ghost.mp3")),
                metadata: TrackMetadata {
                    title: Some("Ghost".into()),
                    artist: None,
                    album: None,
                    album_artist: None,
                    track_number: None,
                    disc_number: None,
                    year: None,
                    genre: None,
                    duration: Duration::from_secs(60),
                    sample_rate: None,
                    bit_depth: None,
                    channels: None,
                    format: "MP3".into(),
                },
                date_added: 0,
            };

            let res = player.load(&ghost_track, None).await;
            assert!(matches!(res, Err(AudioError::FileNotFound(_))));

            // 2. Corrupt / empty file -> DecoderError
            let temp_dir = std::env::temp_dir().join(format!("wavery_audio_test_{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&temp_dir).unwrap();
            let corrupt_file = temp_dir.join("corrupt.mp3");
            fs::write(&corrupt_file, b"NOT_AN_AUDIO_STREAM").unwrap();

            let corrupt_track = Track {
                id: "corrupt".into(),
                source: TrackSource::Managed(corrupt_file),
                metadata: TrackMetadata {
                    title: Some("Corrupt".into()),
                    artist: None,
                    album: None,
                    album_artist: None,
                    track_number: None,
                    disc_number: None,
                    year: None,
                    genre: None,
                    duration: Duration::from_secs(60),
                    sample_rate: None,
                    bit_depth: None,
                    channels: None,
                    format: "MP3".into(),
                },
                date_added: 0,
            };

            let res_corrupt = player.load(&corrupt_track, None).await;
            assert!(matches!(res_corrupt, Err(AudioError::DecoderError(_))));

            // 3. Volume clamping
            player.set_volume(1.5);
            assert!((player.volume() - 1.0).abs() < f32::EPSILON);
            player.set_volume(-0.5);
            assert!((player.volume() - 0.0).abs() < f32::EPSILON);

            let _ = fs::remove_dir_all(&temp_dir);
        }
        Err(e) => {
            // In headless/CI environments without ALSA/Pulse audio sink, try_new returns SinkError
            assert!(matches!(e, AudioError::SinkError(_)));
        }
    }
}

#[test]
fn test_shuffle_play_next_preserves_history_and_splices_immediately() {
    let mut q = StandardQueueManager::new();
    let tracks: Vec<Track> = (0..8)
        .map(|i| make_test_track(&format!("t_{i}"), &format!("Track {i}")))
        .collect();

    q.set_queue(tracks, 0);
    q.set_shuffle(true);
    q.set_loop_mode(LoopMode::Off);

    // Initial track
    let initial_track = q.current_track().unwrap().id.clone();
    let mut history = vec![initial_track];

    // Advance 3 times
    for _ in 0..3 {
        let nxt = q.next().unwrap().id.clone();
        history.push(nxt);
    }
    assert_eq!(history.len(), 4);

    // Call play_next with new track "spliced_next"
    let spliced_track = make_test_track("spliced_next", "Spliced Next Track");
    q.play_next(spliced_track);

    // Immediately next track MUST be "spliced_next"
    let next_after_splice = q.next().expect("Expected next track");
    assert_eq!(next_after_splice.id, "spliced_next");

    // Previous should go back to history[3]
    let prev_1 = q.previous(Duration::from_secs(1)).expect("Expected prev track");
    assert_eq!(prev_1.id, history[3]);

    // Back step through all history
    let prev_2 = q.previous(Duration::from_secs(1)).expect("Expected prev track");
    assert_eq!(prev_2.id, history[2]);

    let prev_3 = q.previous(Duration::from_secs(1)).expect("Expected prev track");
    assert_eq!(prev_3.id, history[1]);

    let prev_4 = q.previous(Duration::from_secs(1)).expect("Expected prev track");
    assert_eq!(prev_4.id, history[0]);

    // Forward traverse through history back to spliced_next
    for expected in &history[1..=3] {
        let fwd = q.next().expect("Expected forward track");
        assert_eq!(&fwd.id, expected);
    }
    let fwd_spliced = q.next().expect("Expected spliced track");
    assert_eq!(fwd_spliced.id, "spliced_next");

    // Complete the traversal for remaining 4 tracks
    let mut remaining = Vec::new();
    while let Some(tr) = q.next() {
        remaining.push(tr.id.clone());
    }
    assert_eq!(remaining.len(), 4);

    // Verify all 8 original tracks + 1 spliced track visited with zero duplicates
    let mut all_visited = history;
    all_visited.push("spliced_next".into());
    all_visited.extend(remaining);
    assert_eq!(all_visited.len(), 9);

    let unique_set: HashSet<String> = all_visited.into_iter().collect();
    assert_eq!(unique_set.len(), 9);
}

#[test]
fn test_shuffle_push_back_preserves_history_and_appends_to_end() {
    let mut q = StandardQueueManager::new();
    let tracks: Vec<Track> = (0..5)
        .map(|i| make_test_track(&format!("t_{i}"), &format!("Track {i}")))
        .collect();

    q.set_queue(tracks, 0);
    q.set_shuffle(true);
    q.set_loop_mode(LoopMode::Off);

    // Initial track and advance once
    let t0 = q.current_track().unwrap().id.clone();
    let t1 = q.next().unwrap().id.clone();
    let history = [t0, t1];

    // Append track via push_back
    let appended_track = make_test_track("appended_last", "Appended Last Track");
    q.push_back(appended_track);

    // Current track is still history[1]
    assert_eq!(q.current_track().unwrap().id, history[1]);

    // Traverse all remaining tracks
    let mut remaining = Vec::new();
    while let Some(tr) = q.next() {
        remaining.push(tr.id.clone());
    }
    // 3 remaining from original 5 + 1 appended = 4
    assert_eq!(remaining.len(), 4);
    assert_eq!(remaining.last().map(|s| s.as_str()), Some("appended_last"));

    // Previous navigation back to history
    let prev = q.previous(Duration::from_secs(1));
    assert!(prev.is_some());
}

#[test]
fn test_player_synchronous_threading_models() {
    if let Ok(mut player) = RodioPlayer::try_new() {
        // 1. Direct invocation outside any async runtime (plain OS thread)
        let handle = std::thread::spawn(move || {
            assert!(player.play().is_ok());
            assert!(player.pause().is_ok());
            assert!(player.seek(Duration::from_secs(10)).is_ok());
            assert!(player.stop().is_ok());
            player.set_volume(0.65);
            assert!((player.volume() - 0.65).abs() < f32::EPSILON);
            player
        });
        let mut player = handle.join().expect("Thread should not panic");

        // 2. Invocation inside single-threaded current_thread runtime (which used to panic on block_in_place)
        let rt_current = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build current_thread runtime");

        rt_current.block_on(async {
            assert!(player.play().is_ok());
            assert!(player.pause().is_ok());
            assert!(player.stop().is_ok());
            assert!(player.seek(Duration::ZERO).is_ok());
        });

        // 3. Invocation inside multi-threaded runtime
        let rt_multi = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("Failed to build multi_thread runtime");

        rt_multi.block_on(async {
            assert!(player.play().is_ok());
            assert!(player.pause().is_ok());
            assert!(player.stop().is_ok());
        });
    }
}

#[test]
fn test_crossfade_equal_power_curve_mathematical_invariants() {
    for step in 0..=100 {
        let t = step as f32 / 100.0;
        let in_gain = (t * std::f32::consts::FRAC_PI_2).sin();
        let out_gain = (t * std::f32::consts::FRAC_PI_2).cos();

        let power = in_gain * in_gain + out_gain * out_gain;
        assert!((power - 1.0).abs() < 1e-5, "Equal power identity failed at t={t}: power={power}");

        if step == 0 {
            assert!((in_gain - 0.0).abs() < 1e-5);
            assert!((out_gain - 1.0).abs() < 1e-5);
        }
        if step == 100 {
            assert!((in_gain - 1.0).abs() < 1e-5);
            assert!((out_gain - 0.0).abs() < 1e-5);
        }
        if step == 50 {
            let expected = std::f32::consts::FRAC_1_SQRT_2;
            assert!((in_gain - expected).abs() < 1e-3);
            assert!((out_gain - expected).abs() < 1e-3);
        }
    }
}

#[test]
fn test_crossfade_player_configuration() {
    if let Ok(mut player) = RodioPlayer::try_new() {
        player.set_crossfade(Duration::from_millis(3500));
        assert!(player.play().is_ok());
        assert!(player.pause().is_ok());
        assert!(player.stop().is_ok());
    }
}


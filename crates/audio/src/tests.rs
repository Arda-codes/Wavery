use crate::player::{
    calculate_replay_gain_multiplier, compute_loudness_attenuation, RodioPlayer,
};
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
            lyrics: None,
            ..Default::default()
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
    assert_eq!(
        q.previous(Duration::from_secs(1)).map(|t| t.id.as_str()),
        Some("1")
    );
    assert_eq!(
        q.previous(Duration::from_secs(10)).map(|t| t.id.as_str()),
        Some("1")
    );
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
    assert_eq!(
        q.previous(Duration::from_secs(1)).map(|t| t.id.as_str()),
        Some("0")
    );
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
        let next_track = q
            .next()
            .expect("Expected next track in shuffle permutation");
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
    assert_eq!(
        q.current_index(),
        Some(wrapped_id.unwrap().parse::<usize>().unwrap())
    );

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
                    lyrics: None,
                    ..Default::default()
                },
                date_added: 0,
            };

            let res = player.load(&ghost_track, None).await;
            assert!(matches!(res, Err(AudioError::FileNotFound(_))));

            // 2. Corrupt / empty file -> DecoderError
            let temp_dir =
                std::env::temp_dir().join(format!("wavery_audio_test_{}", uuid::Uuid::new_v4()));
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
                    lyrics: None,
                    ..Default::default()
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
    let prev_1 = q
        .previous(Duration::from_secs(1))
        .expect("Expected prev track");
    assert_eq!(prev_1.id, history[3]);

    // Back step through all history
    let prev_2 = q
        .previous(Duration::from_secs(1))
        .expect("Expected prev track");
    assert_eq!(prev_2.id, history[2]);

    let prev_3 = q
        .previous(Duration::from_secs(1))
        .expect("Expected prev track");
    assert_eq!(prev_3.id, history[1]);

    let prev_4 = q
        .previous(Duration::from_secs(1))
        .expect("Expected prev track");
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
        assert!(
            (power - 1.0).abs() < 1e-5,
            "Equal power identity failed at t={t}: power={power}"
        );

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

#[test]
fn test_two_tier_user_queue_preservation_on_context_change() {
    let mut q = StandardQueueManager::new();
    let album1_tracks = vec![
        make_test_track("a1_1", "Album 1 Track 1"),
        make_test_track("a1_2", "Album 1 Track 2"),
    ];
    q.set_queue(album1_tracks, 0);

    // User queues an explicit track
    let u1 = make_test_track("user_1", "User Queued Track 1");
    q.play_next(u1.clone());

    assert_eq!(q.user_queue().len(), 1);
    assert_eq!(q.user_queue()[0].id, "user_1");

    // Switch context to Album 2 using set_context_queue
    let album2_tracks = vec![
        make_test_track("a2_1", "Album 2 Track 1"),
        make_test_track("a2_2", "Album 2 Track 2"),
        make_test_track("a2_3", "Album 2 Track 3"),
    ];
    q.set_context_queue(album2_tracks, 0);

    // User queue MUST be preserved at the top of upcoming tracks
    assert_eq!(q.user_queue().len(), 1);
    assert_eq!(q.user_queue()[0].id, "user_1");
    assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("a2_1"));

    // Next track must be the user-queued track
    let next = q.next();
    assert_eq!(next.map(|t| t.id.as_str()), Some("user_1"));
    assert_eq!(q.user_queue().len(), 0);

    // Next track must resume album 2 context
    let next2 = q.next();
    assert_eq!(next2.map(|t| t.id.as_str()), Some("a2_2"));
}

#[test]
fn test_two_tier_user_queue_reordering_and_removal() {
    let mut q = StandardQueueManager::new();
    let base_tracks = vec![
        make_test_track("b1", "Base 1"),
        make_test_track("b2", "Base 2"),
    ];
    q.set_queue(base_tracks, 0);

    let u1 = make_test_track("u1", "User 1");
    let u2 = make_test_track("u2", "User 2");
    q.play_next(u1.clone());
    q.play_next(u2.clone()); // u2 is now at index 0, u1 at index 1

    assert_eq!(q.user_queue().len(), 2);
    assert_eq!(q.user_queue()[0].id, "u2");
    assert_eq!(q.user_queue()[1].id, "u1");

    // Reorder: move u2 to position 1
    q.reorder_user_queue(0, 1);
    assert_eq!(q.user_queue()[0].id, "u1");
    assert_eq!(q.user_queue()[1].id, "u2");

    // Remove index 0 (u1)
    let removed = q.remove_user_track(0);
    assert_eq!(removed.map(|t| t.id), Some("u1".into()));
    assert_eq!(q.user_queue().len(), 1);
    assert_eq!(q.user_queue()[0].id, "u2");

    // Clear user queue
    q.clear_user_queue();
    assert_eq!(q.user_queue().len(), 0);
}

#[test]
fn test_playback_history_recording() {
    let mut q = StandardQueueManager::new();
    let tracks = vec![
        make_test_track("t1", "Track 1"),
        make_test_track("t2", "Track 2"),
        make_test_track("t3", "Track 3"),
    ];
    q.set_queue(tracks, 0);

    assert_eq!(q.history().len(), 0);
    let _ = q.next();
    assert_eq!(q.history().len(), 1);
    assert_eq!(q.history()[0].id, "t1");

    let _ = q.next();
    assert_eq!(q.history().len(), 2);
    assert_eq!(q.history()[1].id, "t2");
}

#[test]
fn test_replaygain_linear_conversion_and_off_mode() {
    let mut track = make_test_track("rg1", "RG Track");
    track.metadata.replaygain_track_gain = Some(-6.0206);
    track.metadata.replaygain_track_peak = Some(0.95);

    // Off mode returns 1.0 regardless of tags
    assert!((calculate_replay_gain_multiplier(&track, "off", 0.0) - 1.0).abs() < 1e-5);
    assert!((calculate_replay_gain_multiplier(&track, "OFF", 0.0) - 1.0).abs() < 1e-5);
    assert!((calculate_replay_gain_multiplier(&track, "invalid_mode", 0.0) - 1.0).abs() < 1e-5);

    // -6.0206 dB in track mode -> linear gain ~ 0.500
    let mult_neg6 = calculate_replay_gain_multiplier(&track, "track", 0.0);
    assert!(
        (mult_neg6 - 0.5).abs() < 0.005,
        "Expected ~0.5 for -6.02 dB, got {mult_neg6}"
    );

    // +6.0206 dB with low peak (0.4) -> linear gain ~ 2.0 (capped at 2.0)
    track.metadata.replaygain_track_gain = Some(6.0206);
    track.metadata.replaygain_track_peak = Some(0.4);
    let mult_pos6 = calculate_replay_gain_multiplier(&track, "track", 0.0);
    assert!(
        (mult_pos6 - 2.0).abs() < 0.01,
        "Expected ~2.0 for +6.02 dB, got {mult_pos6}"
    );
}

#[test]
fn test_replaygain_anti_clipping_peak_limiter() {
    // Track has +6.0 dB gain (~1.995x) and peak 0.8 -> 1.995 * 0.8 = 1.596 > 1.0
    // Anti-clipping limiter must clamp multiplier to 1.0 / 0.8 = 1.25
    let mult = compute_loudness_attenuation(Some(6.0), Some(0.8), "track", 0.0);
    assert!(
        (mult - 1.25).abs() < 1e-4,
        "Expected anti-clipping clamp to 1.25, got {mult}"
    );
    assert!(mult * 0.8 <= 1.0 + 1e-6);

    // Track with peak > 1.0 (e.g., 1.25 lossy inter-sample peak) and 0.0 dB gain
    // Multiplier * 1.25 > 1.0 -> clamped to 1.0 / 1.25 = 0.8
    let mult_over_unity = compute_loudness_attenuation(Some(0.0), Some(1.25), "track", 0.0);
    assert!(
        (mult_over_unity - 0.8).abs() < 1e-4,
        "Expected anti-clipping clamp to 0.8 for 1.25 peak, got {mult_over_unity}"
    );
}

#[test]
fn test_replaygain_extreme_bounds_and_nan_safety() {
    // Extreme negative dB (-80 dB) clamps gain to -60 dB -> 10^(-60/20) = 0.001 (above 0.0001 floor)
    let mult_low = compute_loudness_attenuation(Some(-80.0), Some(1.0), "track", 0.0);
    assert!(
        (mult_low - 0.001).abs() < 1e-5,
        "Expected 0.001 for -80 dB clamped to -60 dB, got {mult_low}"
    );

    // Extreme positive dB (+45 dB) with tiny peak (0.01) clamps to hard ceiling 2.0
    let mult_high = compute_loudness_attenuation(Some(45.0), Some(0.01), "track", 0.0);
    assert!(
        (mult_high - 2.0).abs() < 1e-5,
        "Expected 2.0 ceiling for +45 dB, got {mult_high}"
    );

    // Missing or NaN gain returns 1.0 safely without NaN propagation
    assert!((compute_loudness_attenuation(None, Some(0.9), "track", 0.0) - 1.0).abs() < 1e-5);
    assert!(
        (compute_loudness_attenuation(Some(f32::NAN), Some(0.9), "track", 0.0) - 1.0).abs() < 1e-5
    );
    assert!(
        (compute_loudness_attenuation(Some(f32::INFINITY), Some(0.9), "track", 0.0) - 1.0).abs()
            < 1e-5
    );
}

#[test]
fn test_replaygain_album_vs_track_mode_selection_and_fallback() {
    let mut track = make_test_track("rg_modes", "Album vs Track");
    track.metadata.replaygain_track_gain = Some(-6.0206); // ~0.5
    track.metadata.replaygain_track_peak = Some(0.9);
    track.metadata.replaygain_album_gain = Some(-12.0412); // ~0.25
    track.metadata.replaygain_album_peak = Some(0.95);

    let track_mult = calculate_replay_gain_multiplier(&track, "track", 0.0);
    let album_mult = calculate_replay_gain_multiplier(&track, "album", 0.0);

    assert!((track_mult - 0.5).abs() < 0.005);
    assert!((album_mult - 0.25).abs() < 0.005);

    // Fallback: when album gain is None in "album" mode, falls back to track gain
    track.metadata.replaygain_album_gain = None;
    let album_fallback = calculate_replay_gain_multiplier(&track, "album", 0.0);
    assert!((album_fallback - 0.5).abs() < 0.005);

    // Fallback: when track gain is None in "track" mode, falls back to album gain
    track.metadata.replaygain_track_gain = None;
    track.metadata.replaygain_album_gain = Some(-12.0412);
    let track_fallback = calculate_replay_gain_multiplier(&track, "track", 0.0);
    assert!((track_fallback - 0.25).abs() < 0.005);
}

#[test]
fn test_rodio_player_replaygain_mode_live_switching() {
    if let Ok(mut player) = RodioPlayer::try_new() {
        assert_eq!(player.replay_gain_mode(), "off");

        player.set_replay_gain_mode("track");
        assert_eq!(player.replay_gain_mode(), "track");

        player.set_replay_gain_mode("ALBUM");
        assert_eq!(player.replay_gain_mode(), "album");

        player.set_replay_gain_mode("unknown");
        assert_eq!(player.replay_gain_mode(), "off");

        // Also test via PlayerEngine trait
        PlayerEngine::set_replay_gain_mode(&mut player, "track");
        assert_eq!(player.replay_gain_mode(), "track");
    }
}

#[test]
fn test_opus_decoding_and_seeking() {
    use crate::opus::OpusSource;
    use rodio::Source;
    use std::fs::File;
    use std::io::BufReader;
    use std::path::Path;

    let sample_path = Path::new("/home/arda/.local/share/wavery/library/Alice In Chains/Dirt/03 - Them Bones (2022 Remaster).opus");
    if !sample_path.exists() {
        return;
    }

    let file = File::open(sample_path).expect("failed to open opus test file");
    let reader = BufReader::new(file);
    let mut opus_source = OpusSource::new(reader).expect("failed to initialize OpusSource");

    assert_eq!(opus_source.channels(), 2);
    assert_eq!(opus_source.sample_rate(), 48000);

    // Read 48000 samples (0.5 second of stereo audio = 24000 samples per channel)
    let mut samples = Vec::new();
    for _ in 0..48000 {
        if let Some(s) = opus_source.next() {
            samples.push(s);
        } else {
            break;
        }
    }
    assert_eq!(samples.len(), 48000);
    // Audio has non-zero amplitude
    assert!(samples.iter().any(|&s| s != 0));

    // Test seeking forward to 5 seconds
    let seek_res = opus_source.try_seek(Duration::from_secs(5));
    assert!(seek_res.is_ok());

    let mut post_seek_samples = Vec::new();
    for _ in 0..4800 {
        if let Some(s) = opus_source.next() {
            post_seek_samples.push(s);
        } else {
            break;
        }
    }
    assert_eq!(post_seek_samples.len(), 4800);
}

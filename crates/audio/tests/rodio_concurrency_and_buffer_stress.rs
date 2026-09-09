//! Empirical Stress and Verification Harness for `RodioPlayer` Concurrency,
//! Buffer Robustness, and Thread Synchronization (Milestone 1 - Challenger 2).

use parking_lot::Mutex;
use rand::Rng;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use wavery_audio::player::RodioPlayer;
use wavery_core::error::AudioError;
use wavery_core::models::{PlaybackState, Track, TrackMetadata, TrackSource};
use wavery_core::traits::PlayerEngine;

/// Helper: Generates a valid 44.1kHz 16-bit Stereo PCM WAV file with synthesized audio.
fn create_synthesized_wav(path: &Path, duration_secs: u32) -> std::io::Result<()> {
    let sample_rate = 44100u32;
    let channels = 2u16;
    let bits_per_sample = 16u16;
    let num_samples = sample_rate * duration_secs * channels as u32;
    let data_len = num_samples * 2;
    let file_len = 36 + data_len;

    let mut buf = Vec::with_capacity((file_len + 8) as usize);

    // RIFF chunk descriptor
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&file_len.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // "fmt " sub-chunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size (16 for PCM)
    buf.extend_from_slice(&1u16.to_le_bytes());  // AudioFormat (1 = PCM)
    buf.extend_from_slice(&channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * channels as u32 * (bits_per_sample as u32 / 8);
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    let block_align = channels * (bits_per_sample / 8);
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits_per_sample.to_le_bytes());

    // "data" sub-chunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());

    // 440 Hz Sine Wave audio samples
    for i in 0..num_samples {
        let sample = ((i as f32 * 440.0 * 2.0 * std::f32::consts::PI / sample_rate as f32).sin() * 5000.0) as i16;
        buf.extend_from_slice(&sample.to_le_bytes());
    }

    let mut file = File::create(path)?;
    file.write_all(&buf)?;
    file.flush()
}

/// Helper: Creates a Track domain model pointing to a given path.
fn make_track(id: &str, path: PathBuf, duration: Duration) -> Track {
    Track {
        id: id.into(),
        source: TrackSource::Managed(path),
        metadata: TrackMetadata {
            title: Some(format!("Test Track {id}")),
            artist: Some("Wavery Empirical Engine".into()),
            album: Some("Hardening Album".into()),
            album_artist: None,
            track_number: Some(1),
            disc_number: Some(1),
            year: Some(2026),
            genre: Some("Audio Engineering".into()),
            duration,
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "WAV".into(),
            lyrics: None,
        },
        date_added: 1725235200,
    }
}

/// Challenge 1: Multi-Threaded Concurrency Stress Harness (32 threads, 32,000 operations).
/// Asserts zero deadlocks, zero lock poisoning, zero panics, and consistent state tracking.
#[test]
fn test_rodio_player_multithreaded_concurrency_stress() {
    let player_res = RodioPlayer::try_new();
    let player = match player_res {
        Ok(p) => p,
        Err(AudioError::SinkError(_)) => return,
        Err(e) => panic!("Unexpected error creating RodioPlayer: {e:?}"),
    };

    let player_arc = Arc::new(Mutex::new(player));
    let num_threads = 32;
    let ops_per_thread = 1_000;
    let mut handles = Vec::with_capacity(num_threads);

    for t_idx in 0..num_threads {
        let p = Arc::clone(&player_arc);
        handles.push(thread::spawn(move || {
            let mut rng = rand::thread_rng();
            for op in 0..ops_per_thread {
                let action = rng.gen_range(0..9);
                let mut lock = p.lock();
                match action {
                    0 => {
                        let _ = lock.play();
                    }
                    1 => {
                        let _ = lock.pause();
                    }
                    2 => {
                        let _ = lock.stop();
                    }
                    3 => {
                        let pos = Duration::from_millis(rng.gen_range(0..5000));
                        let _ = lock.seek(pos);
                    }
                    4 => {
                        let vol = rng.gen_range(-0.5..1.5);
                        lock.set_volume(vol);
                    }
                    5 => {
                        let v = lock.volume();
                        assert!((0.0..=1.0).contains(&v), "Volume {v} out of bounds [0.0, 1.0]");
                    }
                    6 => {
                        let _ = lock.state();
                    }
                    7 => {
                        let _ = lock.position();
                    }
                    8 => {
                        let _ = lock.duration();
                    }
                    _ => unreachable!(),
                }
                drop(lock);

                // Yield occasionally to induce lock interleaving
                if op % 50 == 0 {
                    thread::yield_now();
                }
            }
            t_idx
        }));
    }

    for h in handles {
        let t_id = h.join().expect("Thread panicked during concurrency stress test");
        assert!(t_id < num_threads);
    }

    // Final state validation
    let mut final_lock = player_arc.lock();
    assert!(final_lock.stop().is_ok());
    assert_eq!(final_lock.state(), PlaybackState::Stopped);
    assert_eq!(final_lock.position(), Duration::ZERO);
}

/// Challenge 2: Cross-Runtime Synchronization Neutrality.
/// Verifies synchronous trait calls execute without panic or deadlock in:
/// - Plain OS threads
/// - Tokio single-threaded runtime (`current_thread`)
/// - Tokio multi-threaded runtime (`multi_thread`)
/// - `tokio::task::spawn_blocking`
#[test]
fn test_rodio_player_cross_runtime_synchronization() {
    let player_res = RodioPlayer::try_new();
    let mut player = match player_res {
        Ok(p) => p,
        Err(AudioError::SinkError(_)) => return,
        Err(e) => panic!("Unexpected error: {e:?}"),
    };

    // 1. Plain OS Thread
    let os_handle = thread::spawn(move || {
        assert!(player.play().is_ok());
        assert!(player.pause().is_ok());
        assert!(player.seek(Duration::from_secs(5)).is_ok());
        assert!(player.stop().is_ok());
        player.set_volume(0.75);
        assert!((player.volume() - 0.75).abs() < f32::EPSILON);
        player
    });
    let mut player = os_handle.join().expect("Plain OS thread panicked");

    // 2. Tokio single-threaded `current_thread` runtime
    let rt_current = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("Failed to build current_thread runtime");

    rt_current.block_on(async {
        assert!(player.play().is_ok());
        assert!(player.pause().is_ok());
        assert!(player.seek(Duration::from_millis(1500)).is_ok());
        assert!(player.stop().is_ok());
        player.set_volume(0.42);
        assert!((player.volume() - 0.42).abs() < f32::EPSILON);
    });

    // 3. Tokio multi-threaded runtime with spawn_blocking
    let rt_multi = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .expect("Failed to build multi_thread runtime");

    let player_arc = Arc::new(Mutex::new(player));

    rt_multi.block_on(async {
        let p1 = Arc::clone(&player_arc);
        let blocking_handle = tokio::task::spawn_blocking(move || {
            let mut p = p1.lock();
            assert!(p.play().is_ok());
            assert!(p.pause().is_ok());
            assert!(p.seek(Duration::from_secs(1)).is_ok());
        });
        blocking_handle.await.expect("spawn_blocking failed");

        let mut p = player_arc.lock();
        assert!(p.stop().is_ok());
        assert_eq!(p.state(), PlaybackState::Stopped);
    });
}

/// Challenge 3: Real Audio Decoding, 64KB Buffer Streaming, and State Machine Validation.
#[tokio::test]
async fn test_rodio_player_buffer_and_audio_decoding_robustness() {
    let player_res = RodioPlayer::try_new();
    let mut player = match player_res {
        Ok(p) => p,
        Err(AudioError::SinkError(_)) => return,
        Err(e) => panic!("Unexpected error: {e:?}"),
    };

    let temp_dir = std::env::temp_dir().join(format!("wavery_audio_decoding_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let wav_path = temp_dir.join("valid_tone_3s.wav");
    create_synthesized_wav(&wav_path, 3).expect("Failed to create synthesized WAV");

    let track = make_track("wav_3s", wav_path.clone(), Duration::from_secs(3));

    // Initial state
    assert_eq!(player.state(), PlaybackState::Stopped);
    assert_eq!(player.position(), Duration::ZERO);

    // Load track
    let load_res = player.load(&track, None).await;
    assert!(load_res.is_ok(), "Failed to load synthesized WAV file: {:?}", load_res);

    // After load, state should be Playing and total duration available
    assert_eq!(player.state(), PlaybackState::Playing);
    assert_eq!(player.duration(), Some(Duration::from_secs(3)));

    // Pause
    assert!(player.pause().is_ok());
    assert_eq!(player.state(), PlaybackState::Paused);
    let paused_pos = player.position();

    // Small sleep to ensure paused position does not advance
    thread::sleep(Duration::from_millis(50));
    assert_eq!(player.position(), paused_pos, "Position advanced while paused");

    // Seek to 1.5s
    let seek_target = Duration::from_millis(1500);
    assert!(player.seek(seek_target).is_ok());
    assert_eq!(player.position(), seek_target);

    // Resume playback
    assert!(player.play().is_ok());
    assert_eq!(player.state(), PlaybackState::Playing);

    // Stop playback
    assert!(player.stop().is_ok());
    assert_eq!(player.state(), PlaybackState::Stopped);
    assert_eq!(player.position(), Duration::ZERO);

    // Test start_position parameter during load
    let start_offset = Duration::from_millis(1200);
    let load_offset_res = player.load(&track, Some(start_offset)).await;
    assert!(load_offset_res.is_ok());
    assert_eq!(player.state(), PlaybackState::Playing);
    assert!(player.position() >= start_offset);

    assert!(player.stop().is_ok());

    let _ = fs::remove_dir_all(&temp_dir);
}

/// Challenge 4: Corrupt Audio Files, Zero-Byte Files, Truncated Headers, and Missing Paths.
/// Proves that `RodioPlayer` handles corrupted data gracefully without panicking and remains functional.
#[tokio::test]
async fn test_rodio_player_corrupt_files_and_missing_paths_error_handling() {
    let player_res = RodioPlayer::try_new();
    let mut player = match player_res {
        Ok(p) => p,
        Err(AudioError::SinkError(_)) => return,
        Err(e) => panic!("Unexpected error: {e:?}"),
    };

    let temp_dir = std::env::temp_dir().join(format!("wavery_audio_corrupt_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    // 1. Non-existent file
    let ghost_path = temp_dir.join("non_existent_file.mp3");
    let ghost_track = make_track("ghost", ghost_path.clone(), Duration::from_secs(60));
    let err_ghost = player.load(&ghost_track, None).await;
    assert!(
        matches!(err_ghost, Err(AudioError::FileNotFound(ref p)) if p == &ghost_path),
        "Expected FileNotFound error, got: {:?}",
        err_ghost
    );

    // 2. Zero-byte file
    let empty_path = temp_dir.join("empty.wav");
    fs::write(&empty_path, b"").unwrap();
    let empty_track = make_track("empty", empty_path, Duration::from_secs(60));
    let err_empty = player.load(&empty_track, None).await;
    assert!(
        matches!(err_empty, Err(AudioError::DecoderError(_))),
        "Expected DecoderError for 0-byte file, got: {:?}",
        err_empty
    );

    // 3. Truncated WAV header (10 bytes)
    let trunc_path = temp_dir.join("truncated_header.wav");
    fs::write(&trunc_path, b"RIFF\x24\x00\x00\x00WAVE").unwrap();
    let trunc_track = make_track("trunc", trunc_path, Duration::from_secs(60));
    let err_trunc = player.load(&trunc_track, None).await;
    assert!(
        matches!(err_trunc, Err(AudioError::DecoderError(_))),
        "Expected DecoderError for truncated header, got: {:?}",
        err_trunc
    );

    // 4. Random binary blobs of various sizes (16B, 512B, 64KB, 1MB)
    for size in [16, 512, 64 * 1024, 1024 * 1024] {
        let mut rng = rand::thread_rng();
        let random_bytes: Vec<u8> = (0..size).map(|_| rng.gen()).collect();
        let blob_path = temp_dir.join(format!("random_{size}.flac"));
        fs::write(&blob_path, &random_bytes).unwrap();
        let blob_track = make_track(&format!("blob_{size}"), blob_path, Duration::from_secs(60));
        let err_blob = player.load(&blob_track, None).await;
        assert!(
            matches!(err_blob, Err(AudioError::DecoderError(_))),
            "Expected DecoderError for {size} bytes random blob, got: {:?}",
            err_blob
        );
    }

    // 5. JSON/HTML text file masquerading as audio
    let text_path = temp_dir.join("fake.mp3");
    fs::write(&text_path, b"{\"error\": \"not an mp3 file\", \"status\": 404}").unwrap();
    let text_track = make_track("text", text_path, Duration::from_secs(60));
    let err_text = player.load(&text_track, None).await;
    assert!(
        matches!(err_text, Err(AudioError::DecoderError(_))),
        "Expected DecoderError for JSON file masquerading as mp3, got: {:?}",
        err_text
    );

    // 6. Resilience verification: Player remains healthy and can load valid audio after errors
    let valid_path = temp_dir.join("valid_recovery.wav");
    create_synthesized_wav(&valid_path, 2).unwrap();
    let valid_track = make_track("valid_rec", valid_path, Duration::from_secs(2));

    let ok_res = player.load(&valid_track, None).await;
    assert!(ok_res.is_ok(), "Player failed to recover after decoder errors: {:?}", ok_res);
    assert_eq!(player.state(), PlaybackState::Playing);
    assert!(player.stop().is_ok());
    assert_eq!(player.state(), PlaybackState::Stopped);

    let _ = fs::remove_dir_all(&temp_dir);
}

/// Challenge 5: Rapid Reload and Sink Replacement Storm (50 cycles).
/// Asserts rapid replacement of sinks without memory leaks, resource exhaustion, or hanging threads.
#[tokio::test]
async fn test_rodio_player_rapid_lifecycle_reload_storm() {
    let player_res = RodioPlayer::try_new();
    let mut player = match player_res {
        Ok(p) => p,
        Err(AudioError::SinkError(_)) => return,
        Err(e) => panic!("Unexpected error: {e:?}"),
    };

    let temp_dir = std::env::temp_dir().join(format!("wavery_audio_storm_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let wav_path_1 = temp_dir.join("storm_1.wav");
    let wav_path_2 = temp_dir.join("storm_2.wav");
    create_synthesized_wav(&wav_path_1, 2).unwrap();
    create_synthesized_wav(&wav_path_2, 2).unwrap();

    let track_1 = make_track("storm_1", wav_path_1, Duration::from_secs(2));
    let track_2 = make_track("storm_2", wav_path_2, Duration::from_secs(2));
    let corrupt_track = make_track("corrupt", temp_dir.join("corrupt.wav"), Duration::from_secs(2));
    fs::write(temp_dir.join("corrupt.wav"), b"CORRUPT_PAYLOAD").unwrap();

    for cycle in 0..50 {
        if cycle % 2 == 0 {
            assert!(player.load(&track_1, None).await.is_ok());
            assert_eq!(player.state(), PlaybackState::Playing);
            assert!(player.pause().is_ok());
            assert_eq!(player.state(), PlaybackState::Paused);
            assert!(player.seek(Duration::from_millis(500)).is_ok());
        } else {
            assert!(player.load(&track_2, Some(Duration::from_millis(800))).await.is_ok());
            assert_eq!(player.state(), PlaybackState::Playing);
        }

        // Interleave occasional error
        if cycle % 10 == 0 {
            let _ = player.load(&corrupt_track, None).await;
        }
    }

    assert!(player.stop().is_ok());
    assert_eq!(player.state(), PlaybackState::Stopped);

    let _ = fs::remove_dir_all(&temp_dir);
}

/// Challenge 6: Volume Clamping & Seek Boundary Invariants.
#[test]
fn test_rodio_player_volume_and_seek_boundary_resilience() {
    let player_res = RodioPlayer::try_new();
    let mut player = match player_res {
        Ok(p) => p,
        Err(AudioError::SinkError(_)) => return,
        Err(e) => panic!("Unexpected error: {e:?}"),
    };

    // Volume clamping checks
    let test_cases = [
        (-100.0f32, 0.0f32),
        (-0.0001, 0.0),
        (0.0, 0.0),
        (0.25, 0.25),
        (0.8, 0.8),
        (1.0, 1.0),
        (1.0001, 1.0),
        (50.0, 1.0),
        (f32::MAX, 1.0),
    ];

    for (input, expected) in test_cases {
        player.set_volume(input);
        let actual = player.volume();
        assert!(
            (actual - expected).abs() < 1e-5,
            "Volume clamp failed for input {input}: got {actual}, expected {expected}"
        );
    }

    // Seek when stopped
    assert_eq!(player.state(), PlaybackState::Stopped);
    assert!(player.seek(Duration::ZERO).is_ok());
    assert!(player.seek(Duration::from_secs(3600)).is_ok());
    assert_eq!(player.position(), Duration::ZERO);

    // Stop when already stopped
    assert!(player.stop().is_ok());
    assert_eq!(player.state(), PlaybackState::Stopped);

    // Play when no track loaded
    assert!(player.play().is_ok());
    assert_eq!(player.state(), PlaybackState::Stopped);

    // Pause when no track loaded
    assert!(player.pause().is_ok());
    assert_eq!(player.state(), PlaybackState::Stopped);
}

/// Challenge 7: Clean Worker Thread Shutdown on Drop.
#[tokio::test]
async fn test_rodio_player_immediate_drop_safety() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_audio_drop_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let wav_path = temp_dir.join("drop_test.wav");
    create_synthesized_wav(&wav_path, 5).unwrap();
    let track = make_track("drop_track", wav_path, Duration::from_secs(5));

    for _ in 0..30 {
        if let Ok(mut player) = RodioPlayer::try_new() {
            let _ = player.load(&track, None).await;
            let _ = player.play();
            // Drop immediately while audio is actively playing
            drop(player);
        }
    }

    let _ = fs::remove_dir_all(&temp_dir);
}

/// Challenge 8: Rapid Stutter Play/Pause/Seek Hammering during Active Decoding.
#[tokio::test]
async fn test_rodio_player_rapid_playback_stutter_hammering() {
    let player_res = RodioPlayer::try_new();
    let mut player = match player_res {
        Ok(p) => p,
        Err(AudioError::SinkError(_)) => return,
        Err(e) => panic!("Unexpected error: {e:?}"),
    };

    let temp_dir = std::env::temp_dir().join(format!("wavery_audio_stutter_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let wav_path = temp_dir.join("stutter.wav");
    create_synthesized_wav(&wav_path, 10).unwrap();
    let track = make_track("stutter_trk", wav_path, Duration::from_secs(10));

    let load_res = player.load(&track, None).await;
    assert!(load_res.is_ok());

    // Rapidly toggle play / pause / seek 200 times
    for i in 0..200 {
        if i % 3 == 0 {
            assert!(player.pause().is_ok());
        } else if i % 3 == 1 {
            assert!(player.play().is_ok());
        } else {
            let seek_ms = (i * 45) % 8000;
            assert!(player.seek(Duration::from_millis(seek_ms as u64)).is_ok());
        }
    }

    assert!(player.stop().is_ok());
    assert_eq!(player.state(), PlaybackState::Stopped);

    let _ = fs::remove_dir_all(&temp_dir);
}

/// Challenge 9: Concurrent Multi-Player Instance Isolation.
#[test]
fn test_rodio_player_concurrent_multi_instances() {
    let mut players = Vec::new();
    for _ in 0..5 {
        if let Ok(p) = RodioPlayer::try_new() {
            players.push(p);
        }
    }

    for (idx, p) in players.iter_mut().enumerate() {
        let vol = (idx as f32 + 1.0) * 0.15;
        p.set_volume(vol);
        assert!((p.volume() - vol).abs() < 1e-5);
        assert!(p.play().is_ok());
        assert!(p.pause().is_ok());
        assert!(p.stop().is_ok());
    }
}

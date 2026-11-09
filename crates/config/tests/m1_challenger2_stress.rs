//! Empirical Adversarial Stress Test Suite for Milestone M1 (`wavery-config`).
//!
//! Tests:
//! 1. `ServerConfig` host transitions, edge cases, whitespace, and LAN mode.
//! 2. `AudioConfig` replay gain sanitization, mixed case, non-ASCII, and boundary clamping.
//! 3. Concurrent atomic `save()` and `save_session_atomic()` stress, race condition, and temp file leak detection.
//! 4. Deserialization from legacy TOML missing newly added fields, empty collections, and unknown keys.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use wavery_config::{
    load_or_create, load_session, save, save_session_atomic, Config, ServerConfig, ThemeMode,
};

fn create_temp_dir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("{}_{}", prefix, uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("Failed to create temporary directory");
    dir
}

#[test]
fn test_server_config_host_transitions_and_edge_cases() {
    let mut server = ServerConfig::default();

    // Default state: 127.0.0.1, port 4242, LAN disabled
    assert_eq!(server.host, "127.0.0.1");
    assert_eq!(server.port, 4242);
    assert!(!server.is_lan_enabled());

    // 1. Host transitions via set_lan_enabled
    server.set_lan_enabled(true);
    assert_eq!(server.host, "0.0.0.0");
    assert!(server.is_lan_enabled());

    server.set_lan_enabled(false);
    assert_eq!(server.host, "127.0.0.1");
    assert!(!server.is_lan_enabled());

    // Repeated rapid transitions
    for i in 0..100 {
        let enable = i % 2 == 0;
        server.set_lan_enabled(enable);
        assert_eq!(server.is_lan_enabled(), enable);
        if enable {
            assert_eq!(server.host, "0.0.0.0");
        } else {
            assert_eq!(server.host, "127.0.0.1");
        }
    }

    // 2. LAN mode detection across varied host formats
    let lan_hosts = [
        "0.0.0.0",
        "::",
        "  0.0.0.0  ",
        "\t0.0.0.0\n",
        "  ::  ",
        "\r\n::\t",
    ];
    for host in lan_hosts {
        server.host = host.to_string();
        assert!(
            server.is_lan_enabled(),
            "Host '{}' should be recognized as LAN enabled",
            host
        );
    }

    // Non-LAN hosts (loopbacks, specific IPs, hostnames, invalid formats)
    let non_lan_hosts = [
        "127.0.0.1",
        "  127.0.0.1  ",
        "::1",
        "  ::1  ",
        "localhost",
        "LOCALHOST",
        "  LOCALHOST  ",
        "LocalHost",
        "192.168.1.1",
        "10.0.0.5",
        "172.16.0.1",
        "255.255.255.255",
        "999.999.999.999",
        "invalid_host",
        "",
        "   ",
        "\t\r\n",
        "::2",
        "0.0.0.1",
        "0.0.0.0.1",
    ];
    for host in non_lan_hosts {
        server.host = host.to_string();
        assert!(
            !server.is_lan_enabled(),
            "Host '{}' should NOT be recognized as LAN enabled",
            host
        );
    }

    // 3. ServerConfig::sanitize edge cases
    let mut s1 = ServerConfig {
        host: "".to_string(),
        port: 0,
        enable_browser_client: true,
    };
    s1.sanitize();
    assert_eq!(s1.host, "127.0.0.1", "Empty host must sanitize to 127.0.0.1");
    assert_eq!(s1.port, 4242, "Port 0 must sanitize to 4242");

    let mut s2 = ServerConfig {
        host: "   \t \r \n  ".to_string(),
        port: 8080,
        enable_browser_client: false,
    };
    s2.sanitize();
    assert_eq!(
        s2.host, "127.0.0.1",
        "Whitespace-only host must sanitize to 127.0.0.1"
    );
    assert_eq!(s2.port, 8080, "Non-zero port must be preserved");

    let mut s3 = ServerConfig {
        host: "   LOCALHOST   ".to_string(),
        port: 9000,
        enable_browser_client: true,
    };
    s3.sanitize();
    assert_eq!(
        s3.host, "LOCALHOST",
        "Host with leading/trailing whitespace must be trimmed"
    );

    let mut s4 = ServerConfig {
        host: "  ::1  ".to_string(),
        port: 3000,
        enable_browser_client: true,
    };
    s4.sanitize();
    assert_eq!(s4.host, "::1", "IPv6 loopback must be trimmed");

    // 4. Config top-level delegation
    let mut root_cfg = Config::default();
    assert!(!root_cfg.is_lan_enabled());
    root_cfg.set_lan_enabled(true);
    assert!(root_cfg.is_lan_enabled());
    assert_eq!(root_cfg.server.host, "0.0.0.0");
    root_cfg.server.host = "   ".to_string();
    root_cfg.server.port = 0;
    root_cfg.sanitize();
    assert_eq!(root_cfg.server.host, "127.0.0.1");
    assert_eq!(root_cfg.server.port, 4242);
}

#[test]
fn test_audio_config_replay_gain_adversarial_matrix() {
    let mut cfg = Config::default();

    // 1. Valid modes with mixed case, whitespace, tabs, newlines
    let valid_track_cases = [
        "track",
        "TRACK",
        "TrAcK",
        "tRaCk",
        "  track  ",
        "\ttrack\n",
        "  TRACK  ",
        "\r\nTrAcK\t",
    ];
    for input in valid_track_cases {
        cfg.audio.replay_gain_mode = input.to_string();
        cfg.audio.sanitize();
        assert_eq!(
            cfg.audio.replay_gain_mode, "track",
            "Input '{}' should sanitize to 'track'",
            input
        );
        assert!(cfg.audio.is_replay_gain_enabled());
    }

    let valid_album_cases = [
        "album",
        "ALBUM",
        "AlBuM",
        "aLbUm",
        "  album  ",
        "\talbum\n",
        "  ALBUM  ",
        "\r\nAlBuM\t",
    ];
    for input in valid_album_cases {
        cfg.audio.replay_gain_mode = input.to_string();
        cfg.audio.sanitize();
        assert_eq!(
            cfg.audio.replay_gain_mode, "album",
            "Input '{}' should sanitize to 'album'",
            input
        );
        assert!(cfg.audio.is_replay_gain_enabled());
    }

    let valid_off_cases = [
        "off",
        "OFF",
        "OfF",
        "oFf",
        "  off  ",
        "\toff\n",
        "  OFF  ",
        "\r\nOfF\t",
    ];
    for input in valid_off_cases {
        cfg.audio.replay_gain_mode = input.to_string();
        cfg.audio.sanitize();
        assert_eq!(
            cfg.audio.replay_gain_mode, "off",
            "Input '{}' should sanitize to 'off'",
            input
        );
        assert!(!cfg.audio.is_replay_gain_enabled());
    }

    // 2. Adversarial inputs: invalid strings, non-ASCII, emojis, symbols, nulls
    let adversarial_inputs = [
        "",
        "   ",
        "\t\r\n",
        "none",
        "NONE",
        "disabled",
        "auto",
        "track_gain",
        "album_gain",
        "track1",
        "album2",
        "super_boost",
        "1",
        "0",
        "true",
        "false",
        "null",
        "tråck",
        "ÁLBUM",
        "ТРЕК",
        "АЛЬБОМ",
        "日本語",
        "🎵",
        "🔊",
        "track\0injected",
        "album\0injected",
        "track\u{200B}",       // zero-width space
        "track\u{FEFF}",       // byte order mark
        &"a".repeat(10_000),   // long string stress
        &"track ".repeat(100), // repeated token
    ];

    for input in adversarial_inputs {
        cfg.audio.replay_gain_mode = input.to_string();
        cfg.audio.sanitize();
        assert_eq!(
            cfg.audio.replay_gain_mode, "off",
            "Adversarial input '{:?}' must sanitize to 'off'",
            input
        );
        assert!(
            !cfg.audio.is_replay_gain_enabled(),
            "Adversarial input '{:?}' must disable replay gain",
            input
        );
    }

    // 3. AudioConfig numerical clamping boundaries
    // default_volume: [0.0, 1.0]
    let volume_cases = [
        (f32::NAN, 0.0),
        (-0.01, 0.0),
        (-100.0, 0.0),
        (f32::NEG_INFINITY, 0.0),
        (0.0, 0.0),
        (0.5, 0.5),
        (1.0, 1.0),
        (1.01, 1.0),
        (100.0, 1.0),
        (f32::INFINITY, 1.0),
    ];
    for (val, expected) in volume_cases {
        cfg.audio.default_volume = val;
        cfg.audio.sanitize();
        assert!(
            (cfg.audio.default_volume - expected).abs() < f32::EPSILON,
            "Volume {} should clamp to {}",
            val,
            expected
        );
    }

    // volume_step: (0.0, 1.0], fallback 0.05
    let step_cases = [
        (f32::NAN, 0.05),
        (0.0, 0.05),
        (-0.05, 0.05),
        (-1.0, 0.05),
        (0.01, 0.01),
        (0.1, 0.1),
        (1.0, 1.0),
        (1.05, 0.05),
        (5.0, 0.05),
    ];
    for (val, expected) in step_cases {
        cfg.audio.volume_step = val;
        cfg.audio.sanitize();
        assert!(
            (cfg.audio.volume_step - expected).abs() < f32::EPSILON,
            "Volume step {} should clamp to {}",
            val,
            expected
        );
    }

    // buffer_size_frames: [256, 65536], fallback 2048
    let buffer_cases = [
        (0, 2048),
        (1, 2048),
        (255, 2048),
        (256, 256),
        (1024, 1024),
        (2048, 2048),
        (4096, 4096),
        (65536, 65536),
        (65537, 2048),
        (1_000_000, 2048),
        (usize::MAX, 2048),
    ];
    for (val, expected) in buffer_cases {
        cfg.audio.buffer_size_frames = val;
        cfg.audio.sanitize();
        assert_eq!(
            cfg.audio.buffer_size_frames, expected,
            "Buffer size {} should clamp to {}",
            val, expected
        );
    }
}

#[test]
fn test_concurrent_atomic_save_stress_and_leak_detection() {
    let temp_dir = create_temp_dir("wavery_m1_challenger2_atomic_stress");
    let cfg_path = Arc::new(temp_dir.join("config.toml"));

    // Write initial clean config
    save(&cfg_path, &Config::default()).expect("Initial save must succeed");
    assert!(cfg_path.exists());

    let num_writer_threads = 24;
    let num_reader_threads = 12;
    let iterations_per_writer = 50;

    let stop_readers = Arc::new(AtomicBool::new(false));
    let mut writer_handles = Vec::new();
    let mut reader_handles = Vec::new();

    // 1. Spawn concurrent writers
    for writer_id in 0..num_writer_threads {
        let p = Arc::clone(&cfg_path);
        writer_handles.push(thread::spawn(move || {
            for iter in 0..iterations_per_writer {
                let mut cfg = Config::default();
                cfg.server.port = (1000 + writer_id * 100 + iter) as u16;
                cfg.server.host = if (writer_id + iter) % 2 == 0 {
                    "0.0.0.0".to_string()
                } else {
                    "127.0.0.1".to_string()
                };
                cfg.audio.replay_gain_mode = if iter % 3 == 0 {
                    "TRACK".to_string()
                } else if iter % 3 == 1 {
                    "Album".to_string()
                } else {
                    "OFF".to_string()
                };
                cfg.theme.mode = if iter % 2 == 0 {
                    ThemeMode::Oled
                } else {
                    ThemeMode::Macchiato
                };
                cfg.general.language = format!("lang_{writer_id}_{iter}");

                let res = save(&p, &cfg);
                assert!(
                    res.is_ok(),
                    "Writer {} at iteration {} failed save: {:?}",
                    writer_id,
                    iter,
                    res
                );
            }
        }));
    }

    // 2. Spawn concurrent readers
    for reader_id in 0..num_reader_threads {
        let p = Arc::clone(&cfg_path);
        let stop_flag = Arc::clone(&stop_readers);
        reader_handles.push(thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                match load_or_create(&p) {
                    Ok(loaded) => {
                        // Integrity invariant: Server port should be either default (4242) or >= 1000
                        assert!(
                            loaded.server.port == 4242 || loaded.server.port >= 1000,
                            "Corrupted server port observed by reader {}: {}",
                            reader_id,
                            loaded.server.port
                        );
                        // Integrity invariant: Replay gain mode must be normalized to "track", "album", or "off"
                        assert!(
                            loaded.audio.replay_gain_mode == "track"
                                || loaded.audio.replay_gain_mode == "album"
                                || loaded.audio.replay_gain_mode == "off",
                            "Unsanitized replay gain mode observed: {}",
                            loaded.audio.replay_gain_mode
                        );
                    }
                    Err(e) => {
                        panic!(
                            "Reader {} observed unparseable or corrupted config: {:?}",
                            reader_id, e
                        );
                    }
                }
                thread::yield_now();
            }
        }));
    }

    // Wait for all writers to finish
    for handle in writer_handles {
        handle.join().expect("Writer thread panicked");
    }

    // Stop reader threads and wait for them to finish
    stop_readers.store(true, Ordering::Relaxed);
    for handle in reader_handles {
        handle.join().expect("Reader thread panicked");
    }

    // 3. Temporary file leak check!
    // Scan temp_dir for any files matching `*tmp*` or starting with `.`
    let entries = fs::read_dir(&temp_dir).expect("Failed to read directory");
    let mut unexpected_files = Vec::new();
    let mut config_found = false;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "config.toml" {
            config_found = true;
        } else {
            unexpected_files.push(name);
        }
    }

    assert!(
        config_found,
        "Target file 'config.toml' must exist in temp dir"
    );
    assert!(
        unexpected_files.is_empty(),
        "Leaked temporary files detected in directory: {:?}",
        unexpected_files
    );

    // 4. Final read and verify that config is completely parseable and valid
    let final_cfg = load_or_create(&cfg_path).expect("Final config load must succeed");
    assert!(
        final_cfg.server.port >= 1000,
        "Final port must be from writers"
    );
    assert!(
        final_cfg.audio.replay_gain_mode == "track"
            || final_cfg.audio.replay_gain_mode == "album"
            || final_cfg.audio.replay_gain_mode == "off"
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_concurrent_session_atomic_stress_and_leak_detection() {
    let temp_dir = create_temp_dir("wavery_m1_challenger2_session_stress");
    let sess_path = Arc::new(temp_dir.join("session.json"));

    let num_writer_threads = 16;
    let num_reader_threads = 8;
    let iterations = 40;

    let stop_readers = Arc::new(AtomicBool::new(false));
    let mut writer_handles = Vec::new();
    let mut reader_handles = Vec::new();

    // Writers
    for writer_id in 0..num_writer_threads {
        let p = Arc::clone(&sess_path);
        writer_handles.push(thread::spawn(move || {
            for iter in 0..iterations {
                let session = wavery_core::models::PlaybackSession {
                    current_track_id: Some(format!("track_{writer_id}_{iter}")),
                    queue_index: writer_id * 10 + iter,
                    position_secs: (iter as f64) * 1.5,
                    is_playing: iter % 2 == 0,
                    active_client: Some("native".to_string()),
                    volume: Some(0.85),
                    ..Default::default()
                };
                let res = save_session_atomic(&p, &session);
                assert!(res.is_ok(), "Session save failed: {:?}", res);
            }
        }));
    }

    // Readers
    for reader_id in 0..num_reader_threads {
        let p = Arc::clone(&sess_path);
        let stop_flag = Arc::clone(&stop_readers);
        reader_handles.push(thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                if let Ok(Some(sess)) = load_session(&p) {
                    assert!(
                        sess.current_track_id.is_some(),
                        "Session track ID missing for reader {}",
                        reader_id
                    );
                }
                thread::yield_now();
            }
        }));
    }

    // Wait for writers
    for handle in writer_handles {
        handle.join().expect("Session writer panicked");
    }

    // Stop readers
    stop_readers.store(true, Ordering::Relaxed);
    for handle in reader_handles {
        handle.join().expect("Session reader panicked");
    }

    // Verify no temporary files leaked
    let entries = fs::read_dir(&temp_dir).expect("Failed to read dir");
    let mut unexpected = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name != "session.json" {
            unexpected.push(name);
        }
    }
    assert!(
        unexpected.is_empty(),
        "Leaked temporary session files: {:?}",
        unexpected
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_legacy_toml_deserialization_matrix() {
    // 1. Bare minimal v0 TOML (no server, no integrations, no replay gain, missing UI fields)
    let legacy_v0_toml = r##"
[general]
language = "en"
check_updates = false
enable_mpris = true
minimize_to_tray = false

[audio]
backend = "rodio"
default_volume = 0.75
volume_step = 0.05
buffer_size_frames = 2048
crossfade_duration_ms = 500

[library]
managed_directory = "/custom/music"
database_path = "/custom/music/library.db"
cache_directory = "/custom/music/cache"
supported_extensions = ["mp3", "flac"]
scan_on_startup = true

[ui]
window_width = 1280.0
window_height = 800.0
scale_factor = 1.25

[theme]
mode = "dark"
primary = "#FF00FF"

[keybinds]
toggle_play = "Space"
seek_forward_5s = "Shift+Right"
seek_backward_5s = "Shift+Left"
"##;

    let cfg: Config = toml::from_str(legacy_v0_toml).expect("Legacy v0 TOML must deserialize");

    // Check existing fields
    assert_eq!(cfg.general.language, "en");
    assert!((cfg.audio.default_volume - 0.75).abs() < f32::EPSILON);
    assert_eq!(cfg.library.managed_directory, Path::new("/custom/music"));
    assert_eq!(cfg.theme.primary, "#FF00FF");

    // Check alias resolution for legacy seek keys
    assert_eq!(cfg.keybinds.seek_forward, "Shift+Right");
    assert_eq!(cfg.keybinds.seek_backward, "Shift+Left");

    // Check missing [server] table defaults
    assert_eq!(cfg.server.host, "127.0.0.1");
    assert_eq!(cfg.server.port, 4242);
    assert!(cfg.server.enable_browser_client);
    assert!(!cfg.server.is_lan_enabled());

    // Check missing replay_gain_mode in [audio]
    assert_eq!(cfg.audio.replay_gain_mode, "off");
    assert!(!cfg.audio.is_replay_gain_enabled());

    // Check missing [integrations] defaults
    assert!(cfg.integrations.enable_media_session);
    assert!(!cfg.integrations.enable_discord_rpc);
    assert_eq!(cfg.integrations.discord_app_id, None);

    // Check missing [ui] visualizer fields defaults
    assert!(cfg.ui.show_wave_visualizer);
    assert!(cfg.ui.show_visualizer);
    assert!(cfg.ui.show_lyrics_smooth_scroll);
    assert!(!cfg.ui.simplify_mode);
    assert!(cfg.ui.enable_gradients);

    // Check missing [general] new fields defaults
    assert!(cfg.general.notifications_enabled);
    assert!(!cfg.general.auto_resume_playback);

    // 2. Because LibraryConfig has #[serde(default)], omitted fields immediately get defaults
    assert!(
        !cfg.library.protected_artists.is_empty(),
        "Omitted protected_artists should automatically default via #[serde(default)]"
    );
    assert!(
        cfg.library
            .protected_artists
            .contains(&"Tyler, The Creator".to_string())
    );
    assert!(
        !cfg.library.genre_mappings.is_empty(),
        "Omitted genre_mappings should automatically default via #[serde(default)]"
    );

    // 2b. If explicitly set to empty in TOML, sanitize() restores standard defaults
    let explicit_empty_toml = r#"
[library]
protected_artists = []
genre_mappings = {}
"#;
    let mut empty_coll_cfg: Config =
        toml::from_str(explicit_empty_toml).expect("Explicit empty collections must parse");
    assert!(empty_coll_cfg.library.protected_artists.is_empty());
    assert!(empty_coll_cfg.library.genre_mappings.is_empty());

    empty_coll_cfg.sanitize();
    assert!(
        !empty_coll_cfg.library.protected_artists.is_empty(),
        "Sanitize should restore default protected artists when empty"
    );
    assert!(
        empty_coll_cfg
            .library
            .protected_artists
            .contains(&"Tyler, The Creator".to_string())
    );
    assert!(
        !empty_coll_cfg.library.genre_mappings.is_empty(),
        "Sanitize should restore default genre mappings when empty"
    );
    assert_eq!(
        empty_coll_cfg.library.genre_mappings.get("hip hop"),
        Some(&"Hip-Hop".to_string())
    );

    // 3. Completely empty TOML string
    let empty_cfg: Config = toml::from_str("").expect("Empty TOML must deserialize");
    assert_eq!(empty_cfg, Config::default());

    // 4. TOML containing forward-compatible unknown fields (future versions)
    let forward_compat_toml = r#"
[general]
language = "de"
future_unknown_feature = true
schema_version = 42

[server]
host = "192.168.1.50"
port = 7777
tls_enabled = true

[audio]
replay_gain_mode = "track"
dsp_pipeline = ["eq", "compressor"]

[unknown_section]
mystery_key = "mystery_value"
"#;
    let mut forward_cfg: Config =
        toml::from_str(forward_compat_toml).expect("Unknown fields must be ignored gracefully");
    assert_eq!(forward_cfg.general.language, "de");
    assert_eq!(forward_cfg.server.host, "192.168.1.50");
    assert_eq!(forward_cfg.server.port, 7777);
    assert_eq!(forward_cfg.audio.replay_gain_mode, "track");
    assert!(forward_cfg.audio.is_replay_gain_enabled());

    forward_cfg.sanitize();
    assert_eq!(forward_cfg.server.host, "192.168.1.50");
    assert_eq!(forward_cfg.audio.replay_gain_mode, "track");

    // 5. Roundtrip: save legacy converted config and re-read it
    let temp_dir = create_temp_dir("wavery_m1_challenger2_legacy_save");
    let cfg_path = temp_dir.join("config.toml");
    save(&cfg_path, &forward_cfg).expect("Save must succeed");

    let reloaded = load_or_create(&cfg_path).expect("Reload must succeed");
    assert_eq!(reloaded.general.language, "de");
    assert_eq!(reloaded.server.host, "192.168.1.50");
    assert_eq!(reloaded.server.port, 7777);
    assert_eq!(reloaded.audio.replay_gain_mode, "track");

    let _ = fs::remove_dir_all(&temp_dir);
}

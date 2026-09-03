use crate::{
    load_or_create, load_session, save, save_session_atomic, AudioBackendKind, Config, ConfigError,
    ThemeMode,
};
use std::fs;
use std::sync::Arc;
use std::thread;

#[test]
fn test_config_defaults() {
    let cfg = Config::default();

    // General defaults
    assert_eq!(cfg.general.language, "en");
    assert!(!cfg.general.check_updates);
    assert!(cfg.general.enable_mpris);
    assert!(!cfg.general.minimize_to_tray);
    assert!(cfg.general.notifications_enabled);
    assert!(!cfg.general.auto_resume_playback);

    // Audio defaults
    assert_eq!(cfg.audio.backend, AudioBackendKind::Rodio);
    assert!((cfg.audio.default_volume - 0.8).abs() < f32::EPSILON);
    assert!((cfg.audio.volume_step - 0.05).abs() < f32::EPSILON);
    assert_eq!(cfg.audio.buffer_size_frames, 2048);
    assert_eq!(cfg.audio.crossfade_duration_ms, 0);
    assert_eq!(cfg.audio.output_device, None);
    assert!(cfg.audio.gapless_playback);
    assert_eq!(cfg.audio.replay_gain_mode, "off");

    // UI defaults
    assert_eq!(cfg.ui.album_grid_size, "medium");
    assert_eq!(cfg.ui.row_density, "comfortable");
    assert!(cfg.ui.show_visualizer);
    assert!(cfg.ui.show_lyrics_smooth_scroll);
    assert!(!cfg.ui.simplify_mode);
    assert!(!cfg.ui.is_linux_banner_dismissed);

    // Library defaults
    assert!(cfg.library.scan_on_startup);
    assert!(cfg.library.supported_extensions.contains(&"flac".to_string()));

    // Server defaults
    assert_eq!(cfg.server.host, "127.0.0.1");
    assert_eq!(cfg.server.port, 4242);
    assert!(cfg.server.enable_browser_client);

    // Theme defaults
    assert_eq!(cfg.theme.mode, ThemeMode::Dark);
    assert_eq!(cfg.theme.background, "#121214");

    // Keybinds defaults
    assert_eq!(cfg.keybinds.toggle_play, "Space");
    assert_eq!(cfg.keybinds.next_track, "Ctrl+Right");
    assert_eq!(cfg.keybinds.prev_track, "Ctrl+Left");
    assert_eq!(cfg.keybinds.volume_up, "Up");
    assert_eq!(cfg.keybinds.volume_down, "Down");
    assert_eq!(cfg.keybinds.seek_forward, "Right");
    assert_eq!(cfg.keybinds.seek_backward, "Left");
    assert_eq!(cfg.keybinds.open_search, "Ctrl+F");
    assert_eq!(cfg.keybinds.toggle_mute, "M");
    assert_eq!(cfg.keybinds.toggle_fullscreen, "F");
    assert_eq!(cfg.keybinds.toggle_lyrics, "L");
}

#[test]
fn test_config_save_and_load_roundtrip() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_cfg_{}", uuid::Uuid::new_v4()));
    let cfg_path = temp_dir.join("config.toml");

    let mut cfg = Config::default();
    cfg.general.language = "fr".into();
    cfg.general.notifications_enabled = false;
    cfg.general.auto_resume_playback = true;
    cfg.general.minimize_to_tray = true;
    cfg.audio.default_volume = 0.65;
    cfg.server.port = 8080;
    cfg.theme.mode = ThemeMode::Midnight;
    cfg.keybinds.toggle_mute = "Ctrl+M".into();
    cfg.keybinds.toggle_fullscreen = "F11".into();
    cfg.keybinds.toggle_lyrics = "Alt+L".into();
    cfg.keybinds.seek_forward = "Shift+Right".into();
    cfg.keybinds.seek_backward = "Shift+Left".into();

    save(&cfg_path, &cfg).unwrap();
    assert!(cfg_path.exists());

    let loaded = load_or_create(&cfg_path).unwrap();
    assert_eq!(loaded.general.language, "fr");
    assert!(!loaded.general.notifications_enabled);
    assert!(loaded.general.auto_resume_playback);
    assert!(loaded.general.minimize_to_tray);
    assert!((loaded.audio.default_volume - 0.65).abs() < f32::EPSILON);
    assert_eq!(loaded.server.port, 8080);
    assert_eq!(loaded.theme.mode, ThemeMode::Midnight);
    assert_eq!(loaded.keybinds.toggle_mute, "Ctrl+M");
    assert_eq!(loaded.keybinds.toggle_fullscreen, "F11");
    assert_eq!(loaded.keybinds.toggle_lyrics, "Alt+L");
    assert_eq!(loaded.keybinds.seek_forward, "Shift+Right");
    assert_eq!(loaded.keybinds.seek_backward, "Shift+Left");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_config_theme_modes_all_variants() {
    let cases = [
        (ThemeMode::Dark, "dark"),
        (ThemeMode::Light, "light"),
        (ThemeMode::System, "system"),
        (ThemeMode::Oled, "oled"),
        (ThemeMode::Midnight, "midnight"),
    ];

    for (mode_enum, mode_str) in cases {
        // Deserialization check
        let toml_snippet = format!("[theme]\nmode = \"{}\"\n", mode_str);
        let parsed: Config = toml::from_str(&toml_snippet).unwrap();
        assert_eq!(parsed.theme.mode, mode_enum);

        // Serialization check
        let mut cfg = Config::default();
        cfg.theme.mode = mode_enum;
        let serialized = toml::to_string(&cfg).unwrap();
        assert!(
            serialized.contains(&format!("mode = \"{}\"", mode_str)),
            "Expected mode = \"{}\" in serialized TOML",
            mode_str
        );
    }
}

#[test]
fn test_config_invalid_toml_error() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_cfg_err_{}", uuid::Uuid::new_v4()));
    let cfg_path = temp_dir.join("config.toml");
    fs::create_dir_all(&temp_dir).unwrap();

    fs::write(&cfg_path, "invalid toml syntax [[[[").unwrap();

    let res = load_or_create(&cfg_path);
    assert!(matches!(res, Err(ConfigError::Toml(_))));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_config_partial_toml_fallback_and_defaults() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_cfg_partial_{}", uuid::Uuid::new_v4()));
    let cfg_path = temp_dir.join("config.toml");
    fs::create_dir_all(&temp_dir).unwrap();

    // Partial TOML containing only general.language and custom keybind
    let partial_toml = r#"
[general]
language = "ja"

[keybinds]
toggle_play = "KeyP"
"#;
    fs::write(&cfg_path, partial_toml).unwrap();

    let loaded = load_or_create(&cfg_path).unwrap();
    // Custom set values
    assert_eq!(loaded.general.language, "ja");
    assert_eq!(loaded.keybinds.toggle_play, "KeyP");

    // Defaults for omitted fields in specified tables
    assert!(!loaded.general.check_updates);
    assert!(loaded.general.enable_mpris);
    assert!(!loaded.general.minimize_to_tray);
    assert!(loaded.general.notifications_enabled);
    assert!(!loaded.general.auto_resume_playback);
    assert_eq!(loaded.keybinds.next_track, "Ctrl+Right");
    assert_eq!(loaded.keybinds.prev_track, "Ctrl+Left");
    assert_eq!(loaded.keybinds.volume_up, "Up");
    assert_eq!(loaded.keybinds.volume_down, "Down");
    assert_eq!(loaded.keybinds.seek_forward, "Right");
    assert_eq!(loaded.keybinds.seek_backward, "Left");
    assert_eq!(loaded.keybinds.open_search, "Ctrl+F");
    assert_eq!(loaded.keybinds.toggle_mute, "M");
    assert_eq!(loaded.keybinds.toggle_fullscreen, "F");
    assert_eq!(loaded.keybinds.toggle_lyrics, "L");

    // Defaults for entire omitted tables
    assert_eq!(loaded.audio.backend, AudioBackendKind::Rodio);
    assert!((loaded.audio.default_volume - 0.8).abs() < f32::EPSILON);
    assert_eq!(loaded.server.port, 4242);
    assert_eq!(loaded.theme.mode, ThemeMode::Dark);
    assert!(loaded.library.supported_extensions.contains(&"flac".to_string()));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_config_legacy_v1_backward_compatibility() {
    let legacy_toml = r#"
[general]
language = "en"
check_updates = false
enable_mpris = true
minimize_to_tray = false

[keybinds]
toggle_play = "Space"
next_track = "Ctrl+Right"
prev_track = "Ctrl+Left"
volume_up = "Up"
volume_down = "Down"
seek_forward_5s = "Shift+Right"
seek_backward_5s = "Shift+Left"
open_search = "Ctrl+F"
"#;

    let loaded: Config = toml::from_str(legacy_toml).unwrap();

    // Verify alias mapped legacy seek keys to normalized seek keys
    assert_eq!(loaded.keybinds.seek_forward, "Shift+Right");
    assert_eq!(loaded.keybinds.seek_backward, "Shift+Left");

    // Verify missing new fields in [general] fallback to default
    assert!(loaded.general.notifications_enabled);
    assert!(!loaded.general.auto_resume_playback);

    // Verify missing new fields in [keybinds] fallback to default
    assert_eq!(loaded.keybinds.toggle_mute, "M");
    assert_eq!(loaded.keybinds.toggle_fullscreen, "F");
    assert_eq!(loaded.keybinds.toggle_lyrics, "L");
}

#[test]
fn test_config_invalid_types_and_unknown_fields() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_cfg_types_{}", uuid::Uuid::new_v4()));
    let cfg_path = temp_dir.join("config.toml");
    fs::create_dir_all(&temp_dir).unwrap();

    // 1. Invalid field type for port (string instead of int)
    fs::write(&cfg_path, "[server]\nport = \"not_a_number\"\n").unwrap();
    let res = load_or_create(&cfg_path);
    assert!(matches!(res, Err(ConfigError::Toml(_))));

    // 2. Invalid field type for enum
    fs::write(&cfg_path, "[audio]\nbackend = \"unsupported_engine\"\n").unwrap();
    let res2 = load_or_create(&cfg_path);
    assert!(matches!(res2, Err(ConfigError::Toml(_))));

    // 3. Invalid theme mode enum
    fs::write(&cfg_path, "[theme]\nmode = \"neon_cyberpunk\"\n").unwrap();
    let res3 = load_or_create(&cfg_path);
    assert!(matches!(res3, Err(ConfigError::Toml(_))));

    // 4. Invalid boolean type
    fs::write(&cfg_path, "[general]\nnotifications_enabled = \"yes\"\n").unwrap();
    let res4 = load_or_create(&cfg_path);
    assert!(matches!(res4, Err(ConfigError::Toml(_))));

    // 5. Extra/unknown fields are ignored gracefully by serde
    let unknown_toml = r#"
[general]
language = "de"
future_setting = true
unknown_number = 42
"#;
    fs::write(&cfg_path, unknown_toml).unwrap();
    let loaded = load_or_create(&cfg_path).unwrap();
    assert_eq!(loaded.general.language, "de");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_config_atomic_save_and_concurrency() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_cfg_atomic_{}", uuid::Uuid::new_v4()));
    let cfg_path = Arc::new(temp_dir.join("config.toml"));
    fs::create_dir_all(&temp_dir).unwrap();

    let base_cfg = Config::default();
    save(&cfg_path, &base_cfg).unwrap();

    // Ensure tmp file does not remain after atomic rename
    let tmp_path = cfg_path.with_extension("tmp");
    assert!(!tmp_path.exists());
    assert!(cfg_path.exists());

    // Concurrent writers and readers
    let mut handles = Vec::new();
    for i in 0..10 {
        let p = Arc::clone(&cfg_path);
        handles.push(thread::spawn(move || {
            let mut cfg = Config::default();
            cfg.server.port = 4000 + i;
            save(&p, &cfg).expect("Concurrent save must succeed");
            // Read back
            if let Ok(loaded) = load_or_create(&p) {
                assert!(loaded.server.port >= 4000);
            }
        }));
    }

    for handle in handles {
        handle.join().unwrap();
    }

    // Final read verification
    let final_cfg = load_or_create(&cfg_path).unwrap();
    assert!(final_cfg.server.port >= 4000);
    assert!(!tmp_path.exists());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_session_atomic_save_and_load() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_sess_test_{}", uuid::Uuid::new_v4()));
    let sess_path = temp_dir.join("session.json");
    fs::create_dir_all(&temp_dir).unwrap();

    // 1. Loading non-existent session returns None
    assert_eq!(load_session(&sess_path).unwrap(), None);

    // 2. Save session atomically
    let session = wavery_core::models::PlaybackSession {
        current_track_id: Some("track-123".into()),
        queue_index: 2,
        position_secs: 42.5,
        is_playing: false,
        active_client: Some("native".into()),
        ..Default::default()
    };

    save_session_atomic(&sess_path, &session).expect("Session save must succeed");
    assert!(sess_path.exists());

    // 3. Load back and verify equality
    let loaded = load_session(&sess_path).expect("Session load must succeed").expect("Session must exist");
    assert_eq!(loaded.current_track_id, Some("track-123".into()));
    assert_eq!(loaded.queue_index, 2);
    assert!((loaded.position_secs - 42.5).abs() < f64::EPSILON);
    assert_eq!(loaded.active_client, Some("native".into()));

    let _ = fs::remove_dir_all(&temp_dir);
}

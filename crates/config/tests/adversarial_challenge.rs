use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use wavery_config::{
    default_config_path, load_or_create, save, Config, ThemeMode,
};

fn create_temp_dir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("{}_{}", prefix, uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("Failed to create temporary directory");
    dir
}

#[test]
fn challenge_theme_modes_all_five_variants_exhaustive() {
    let expected_variants = [
        (ThemeMode::Dark, "dark"),
        (ThemeMode::Light, "light"),
        (ThemeMode::System, "system"),
        (ThemeMode::Oled, "oled"),
        (ThemeMode::Midnight, "midnight"),
    ];

    for (mode, str_val) in expected_variants {
        // 1. Serialization
        let mut cfg = Config::default();
        cfg.theme.mode = mode;
        let toml_out = toml::to_string(&cfg).expect("TOML serialization should succeed");
        assert!(
            toml_out.contains(&format!("mode = \"{}\"", str_val)),
            "Expected mode = \"{}\" in TOML output: {}",
            str_val,
            toml_out
        );

        let json_out = serde_json::to_string(&cfg).expect("JSON serialization should succeed");
        assert!(
            json_out.contains(&format!("\"mode\":\"{}\"", str_val)),
            "Expected \"mode\":\"{}\" in JSON output: {}",
            str_val,
            json_out
        );

        // 2. Deserialization from TOML
        let toml_in = format!("[theme]\nmode = \"{}\"\n", str_val);
        let parsed: Config = toml::from_str(&toml_in).expect("TOML deserialization should succeed");
        assert_eq!(parsed.theme.mode, mode);

        // 3. Deserialization from JSON
        let json_in = format!("{{\"theme\": {{\"mode\": \"{}\"}}}}", str_val);
        let parsed_json: Config =
            serde_json::from_str(&json_in).expect("JSON deserialization should succeed");
        assert_eq!(parsed_json.theme.mode, mode);
    }

    // Invalid theme modes must fail cleanly
    let invalid_themes = ["DARK", "Midnight", "oled_dark", "Solarized", "custom", "123"];
    for invalid in invalid_themes {
        let toml_in = format!("[theme]\nmode = \"{}\"\n", invalid);
        let res: Result<Config, _> = toml::from_str(&toml_in);
        assert!(
            res.is_err(),
            "Theme mode '{}' should be rejected by serde",
            invalid
        );

        let json_in = format!("{{\"theme\": {{\"mode\": \"{}\"}}}}", invalid);
        let res_json: Result<Config, _> = serde_json::from_str(&json_in);
        assert!(
            res_json.is_err(),
            "Theme mode '{}' should be rejected in JSON",
            invalid
        );
    }
}

#[test]
fn challenge_legacy_and_modern_keybind_aliases() {
    // 1. Legacy keys present (seek_forward_5s, seek_backward_5s)
    let legacy_toml = r#"
[keybinds]
toggle_play = "Space"
seek_forward_5s = "Ctrl+Shift+Right"
seek_backward_5s = "Ctrl+Shift+Left"
"#;
    let cfg: Config = toml::from_str(legacy_toml).expect("Legacy keybinds must parse successfully");
    assert_eq!(cfg.keybinds.seek_forward, "Ctrl+Shift+Right");
    assert_eq!(cfg.keybinds.seek_backward, "Ctrl+Shift+Left");
    assert_eq!(cfg.keybinds.toggle_play, "Space");
    assert_eq!(cfg.keybinds.toggle_mute, "M");
    assert_eq!(cfg.keybinds.toggle_fullscreen, "F");
    assert_eq!(cfg.keybinds.toggle_lyrics, "L");

    // 2. Normalized keys present (seek_forward, seek_backward)
    let modern_toml = r#"
[keybinds]
seek_forward = "KeyD"
seek_backward = "KeyA"
toggle_mute = "Ctrl+M"
toggle_fullscreen = "F11"
toggle_lyrics = "KeyL"
"#;
    let modern_cfg: Config =
        toml::from_str(modern_toml).expect("Modern keybinds must parse successfully");
    assert_eq!(modern_cfg.keybinds.seek_forward, "KeyD");
    assert_eq!(modern_cfg.keybinds.seek_backward, "KeyA");
    assert_eq!(modern_cfg.keybinds.toggle_mute, "Ctrl+M");
    assert_eq!(modern_cfg.keybinds.toggle_fullscreen, "F11");
    assert_eq!(modern_cfg.keybinds.toggle_lyrics, "KeyL");

    // 3. Legacy JSON deserialization with alias
    let legacy_json = r#"
{
    "keybinds": {
        "seek_forward_5s": "PageUp",
        "seek_backward_5s": "PageDown"
    }
}
"#;
    let json_cfg: Config =
        serde_json::from_str(legacy_json).expect("Legacy keybinds JSON alias must parse");
    assert_eq!(json_cfg.keybinds.seek_forward, "PageUp");
    assert_eq!(json_cfg.keybinds.seek_backward, "PageDown");
}

#[test]
fn challenge_general_config_new_fields_and_fallbacks() {
    // 1. Default values check
    let def = Config::default();
    assert!(def.general.notifications_enabled);
    assert!(!def.general.auto_resume_playback);

    // 2. Explicit overrides in TOML
    let toml_str = r#"
[general]
notifications_enabled = false
auto_resume_playback = true
"#;
    let cfg: Config = toml::from_str(toml_str).expect("Custom general flags should parse");
    assert!(!cfg.general.notifications_enabled);
    assert!(cfg.general.auto_resume_playback);
    assert_eq!(cfg.general.language, "en");
    assert!(cfg.general.enable_mpris);

    // 3. Omitted fields in legacy config fall back to defaults
    let omitted_toml = r#"
[general]
language = "es"
check_updates = true
"#;
    let omitted_cfg: Config = toml::from_str(omitted_toml).expect("Omitted fields should parse");
    assert_eq!(omitted_cfg.general.language, "es");
    assert!(omitted_cfg.general.check_updates);
    assert!(omitted_cfg.general.notifications_enabled);
    assert!(!omitted_cfg.general.auto_resume_playback);
}

#[test]
fn challenge_partial_toml_and_empty_inputs() {
    // Empty string
    let empty_cfg: Config = toml::from_str("").expect("Empty TOML must produce default Config");
    assert_eq!(empty_cfg, Config::default());

    // Only whitespace and comments
    let comment_toml = "# Wavery configuration\n   \n# end of file\n";
    let comment_cfg: Config =
        toml::from_str(comment_toml).expect("Comments only must produce default Config");
    assert_eq!(comment_cfg, Config::default());

    // Empty tables
    let empty_tables = r#"
[general]
[audio]
[library]
[server]
[theme]
[keybinds]
"#;
    let tables_cfg: Config =
        toml::from_str(empty_tables).expect("Empty tables must produce default Config");
    assert_eq!(tables_cfg, Config::default());

    // Single nested field in one table
    let single_field = "[audio]\ndefault_volume = 0.42\n";
    let single_cfg: Config =
        toml::from_str(single_field).expect("Single field must parse with defaults");
    assert!((single_cfg.audio.default_volume - 0.42).abs() < f32::EPSILON);
    assert_eq!(single_cfg.general, Config::default().general);
    assert_eq!(single_cfg.theme, Config::default().theme);
    assert_eq!(single_cfg.keybinds, Config::default().keybinds);
}

#[test]
fn challenge_type_mismatches_and_malformed_inputs() {
    let bad_cases = [
        ("[general]\nnotifications_enabled = 123\n", "integer instead of bool"),
        ("[general]\nauto_resume_playback = \"yes\"\n", "string instead of bool"),
        ("[server]\nport = \"8080\"\n", "string instead of u16"),
        ("[server]\nport = 9999999\n", "overflowing u16"),
        ("[audio]\nbackend = 42\n", "int instead of enum string"),
        ("[audio]\nbackend = \"invalid_backend\"\n", "unknown enum variant"),
        ("[audio]\ndefault_volume = \"loud\"\n", "string instead of float"),
        ("[theme]\nmode = true\n", "bool instead of enum string"),
        ("[theme]\nmode = \"invalid_mode\"\n", "invalid theme mode string"),
        ("keybinds = \"not a table\"\n", "string instead of table"),
        ("general = [1, 2, 3]\n", "array instead of table"),
    ];

    for (snippet, desc) in bad_cases {
        let res: Result<Config, _> = toml::from_str(snippet);
        assert!(
            res.is_err(),
            "Expected failure for case: {} (input: {})",
            desc,
            snippet
        );
    }

    // Malformed TOML syntax
    let syntax_errors = [
        "[[[general]]",
        "key = = value",
        "\"unclosed string",
        "[general\nkey=1",
    ];

    for syntax in syntax_errors {
        let res: Result<Config, _> = toml::from_str(syntax);
        assert!(res.is_err(), "Expected syntax error for: {}", syntax);
    }
}

#[test]
fn challenge_missing_parent_directory_creation() {
    let temp_dir = create_temp_dir("wavery_missing_dir");
    let deep_path = temp_dir
        .join("nested_a")
        .join("nested_b")
        .join("nested_c")
        .join("config.toml");

    assert!(!deep_path.parent().unwrap().exists());

    // 1. load_or_create on non-existent deep path
    let cfg = load_or_create(&deep_path).expect("load_or_create should create deep directories");
    assert_eq!(cfg, Config::default());
    assert!(deep_path.exists());

    // 2. Save modified config to another deep path
    let deep_path_2 = temp_dir.join("sub1").join("sub2").join("saved.toml");
    let mut custom = Config::default();
    custom.server.port = 9999;
    save(&deep_path_2, &custom).expect("save should create non-existent directories");
    assert!(deep_path_2.exists());

    let loaded = load_or_create(&deep_path_2).expect("should load cleanly");
    assert_eq!(loaded.server.port, 9999);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn challenge_high_concurrency_atomic_save_and_load() {
    let temp_dir = create_temp_dir("wavery_concurrency_stress");
    let cfg_path = Arc::new(temp_dir.join("config.toml"));

    // Pre-create file
    save(&cfg_path, &Config::default()).expect("Initial save must succeed");

    let num_writer_threads = 16;
    let num_reader_threads = 16;
    let iterations = 50;

    let mut handles = Vec::new();

    // Spawn writers
    for t in 0..num_writer_threads {
        let p = Arc::clone(&cfg_path);
        handles.push(thread::spawn(move || {
            for i in 0..iterations {
                let mut cfg = Config::default();
                cfg.server.port = 10000 + (t * iterations + i) as u16;
                cfg.general.language = format!("lang_{t}_{i}");
                if (t + i) % 2 == 0 {
                    cfg.theme.mode = ThemeMode::Oled;
                } else {
                    cfg.theme.mode = ThemeMode::Midnight;
                }
                let res = save(&p, &cfg);
                assert!(res.is_ok(), "Concurrent save failed: {:?}", res);
            }
        }));
    }

    // Spawn readers
    for _ in 0..num_reader_threads {
        let p = Arc::clone(&cfg_path);
        handles.push(thread::spawn(move || {
            for _ in 0..iterations {
                match load_or_create(&p) {
                    Ok(cfg) => {
                        assert!(cfg.server.port >= 10000 || cfg.server.port == 4242);
                    }
                    Err(err) => {
                        // Because rename is atomic in POSIX, read should never see corrupt half-written state
                        panic!("Concurrent load_or_create encountered error: {:?}", err);
                    }
                }
            }
        }));
    }

    for h in handles {
        h.join().expect("Worker thread panicked");
    }

    // Confirm no leftover temp files
    let tmp_path = cfg_path.with_extension("tmp");
    assert!(!tmp_path.exists(), "Temporary file should not remain on disk");
    assert!(cfg_path.exists(), "Target config file must exist");

    // Final read must succeed cleanly
    let final_cfg = load_or_create(&cfg_path).expect("Final config read must succeed");
    assert!(final_cfg.server.port >= 10000 || final_cfg.server.port == 4242);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn challenge_default_config_path_resolution() {
    let res = default_config_path();
    assert!(
        res.is_ok(),
        "default_config_path should successfully resolve on standard Linux/macOS/Windows"
    );
    let path = res.unwrap();
    assert!(
        path.to_string_lossy().contains("wavery"),
        "Path should contain wavery: {:?}",
        path
    );
    assert!(
        path.ends_with("config.toml"),
        "Path should end with config.toml: {:?}",
        path
    );
}

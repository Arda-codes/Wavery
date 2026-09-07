//! Configuration structures and XDG-compliant path resolution for Wavery.

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Error type for configuration load and save operations.
#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("IO error while handling configuration: {0}")]
    Io(#[from] std::io::Error),
    #[error("TOML serialization/deserialization failed: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("TOML string conversion error: {0}")]
    TomlSerialize(#[from] toml::ser::Error),
    #[error("JSON serialization/deserialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Failed to determine user home or config directories")]
    DirectoryResolutionFailed,
}

/// Root application configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub general: GeneralConfig,
    pub audio: AudioConfig,
    pub library: LibraryConfig,
    pub server: ServerConfig,
    pub theme: ThemeConfig,
    pub keybinds: KeybindsConfig,
    pub ui: UiConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct GeneralConfig {
    pub language: String,
    pub check_updates: bool,
    pub enable_mpris: bool,
    pub minimize_to_tray: bool,
    pub notifications_enabled: bool,
    pub auto_resume_playback: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AudioConfig {
    pub backend: AudioBackendKind,
    pub default_volume: f32,       // 0.0 to 1.0
    pub volume_step: f32,          // default e.g. 0.05
    pub buffer_size_frames: usize, // e.g. 2048
    pub crossfade_duration_ms: u32,
    pub output_device: Option<String>,
    pub gapless_playback: bool,
    pub replay_gain_mode: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioBackendKind {
    Rodio,
    Symphonia,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct LibraryConfig {
    pub managed_directory: PathBuf,
    pub database_path: PathBuf,
    pub cache_directory: PathBuf,
    pub supported_extensions: Vec<String>,
    pub scan_on_startup: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub enable_browser_client: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeConfig {
    pub mode: ThemeMode,
    pub background: String,
    pub surface: String,
    pub surface_hover: String,
    pub primary: String,
    pub text_primary: String,
    pub text_muted: String,
    pub accent: String,
    pub error: String,
    pub custom_colors: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    Dark,
    Light,
    System,
    Oled,
    Midnight,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct KeybindsConfig {
    pub toggle_play: String,
    pub next_track: String,
    pub prev_track: String,
    pub volume_up: String,
    pub volume_down: String,
    #[serde(alias = "seek_forward_5s")]
    pub seek_forward: String,
    #[serde(alias = "seek_backward_5s")]
    pub seek_backward: String,
    pub open_search: String,
    pub toggle_mute: String,
    pub toggle_fullscreen: String,
    pub toggle_lyrics: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct UiConfig {
    pub window_width: f32,
    pub window_height: f32,
    pub min_width: f32,
    pub min_height: f32,
    pub scale_factor: f64,
    pub album_art_size: u32,
    pub show_wave_visualizer: bool,
    pub album_grid_size: String,
    pub row_density: String,
    pub show_visualizer: bool,
    pub show_lyrics_smooth_scroll: bool,
    pub simplify_mode: bool,
    pub is_linux_banner_dismissed: bool,
}

impl Default for Config {
    fn default() -> Self {
        let (managed_dir, db_path, cache_dir) = resolve_default_paths();

        Self {
            general: GeneralConfig::default(),
            audio: AudioConfig::default(),
            library: LibraryConfig {
                managed_directory: managed_dir,
                database_path: db_path,
                cache_directory: cache_dir,
                supported_extensions: vec![
                    "mp3".into(),
                    "flac".into(),
                    "ogg".into(),
                    "opus".into(),
                    "m4a".into(),
                    "wav".into(),
                ],
                scan_on_startup: true,
            },
            server: ServerConfig::default(),
            theme: ThemeConfig::default(),
            keybinds: KeybindsConfig::default(),
            ui: UiConfig::default(),
        }
    }
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            language: "en".into(),
            check_updates: false,
            enable_mpris: true,
            minimize_to_tray: false,
            notifications_enabled: true,
            auto_resume_playback: false,
        }
    }
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            backend: AudioBackendKind::Rodio,
            default_volume: 0.8,
            volume_step: 0.05,
            buffer_size_frames: 2048,
            crossfade_duration_ms: 0,
            output_device: None,
            gapless_playback: true,
            replay_gain_mode: "off".into(),
        }
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            window_width: 1080.0,
            window_height: 720.0,
            min_width: 800.0,
            min_height: 500.0,
            scale_factor: 1.0,
            album_art_size: 160,
            show_wave_visualizer: true,
            album_grid_size: "medium".into(),
            row_density: "comfortable".into(),
            show_visualizer: true,
            show_lyrics_smooth_scroll: true,
            simplify_mode: false,
            is_linux_banner_dismissed: false,
        }
    }
}

impl Default for LibraryConfig {
    fn default() -> Self {
        let (managed_dir, db_path, cache_dir) = resolve_default_paths();
        Self {
            managed_directory: managed_dir,
            database_path: db_path,
            cache_directory: cache_dir,
            supported_extensions: vec![
                "mp3".into(),
                "flac".into(),
                "ogg".into(),
                "opus".into(),
                "m4a".into(),
                "wav".into(),
            ],
            scan_on_startup: true,
        }
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 4242,
            enable_browser_client: true,
        }
    }
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self {
            mode: ThemeMode::Dark,
            background: "#121214".into(),
            surface: "#1A1A1E".into(),
            surface_hover: "#26262E".into(),
            primary: "#6C5CE7".into(),
            text_primary: "#ECEFF4".into(),
            text_muted: "#8F93A0".into(),
            accent: "#00D2D3".into(),
            error: "#FF5252".into(),
            custom_colors: Vec::new(),
        }
    }
}

impl Default for KeybindsConfig {
    fn default() -> Self {
        Self {
            toggle_play: "Space".into(),
            next_track: "Ctrl+Right".into(),
            prev_track: "Ctrl+Left".into(),
            volume_up: "Up".into(),
            volume_down: "Down".into(),
            seek_forward: "Right".into(),
            seek_backward: "Left".into(),
            open_search: "Ctrl+F".into(),
            toggle_mute: "M".into(),
            toggle_fullscreen: "F".into(),
            toggle_lyrics: "L".into(),
        }
    }
}

pub fn resolve_default_paths() -> (PathBuf, PathBuf, PathBuf) {
    if let Some(proj_dirs) = ProjectDirs::from("org", "wavery", "wavery") {
        let data_dir = proj_dirs.data_dir();
        let cache_dir = proj_dirs.cache_dir();
        (
            data_dir.join("library"),
            data_dir.join("library.db"),
            cache_dir.join("album_art"),
        )
    } else {
        (
            PathBuf::from("wavery_library"),
            PathBuf::from("library.db"),
            PathBuf::from("wavery_cache"),
        )
    }
}

impl Config {
    /// Validates and ensures paths are not empty, falling back to standard XDG defaults.
    pub fn sanitize(&mut self) {
        let (default_managed, default_db, default_cache) = resolve_default_paths();
        if self.library.managed_directory.as_os_str().is_empty() {
            self.library.managed_directory = default_managed;
        }
        if self.library.database_path.as_os_str().is_empty() {
            self.library.database_path = default_db;
        }
        if self.library.cache_directory.as_os_str().is_empty() {
            self.library.cache_directory = default_cache;
        }
        if self.library.supported_extensions.is_empty() {
            self.library.supported_extensions = vec![
                "mp3".into(),
                "flac".into(),
                "ogg".into(),
                "opus".into(),
                "m4a".into(),
                "wav".into(),
            ];
        }
    }
}

/// Resolves standard XDG configuration file path `~/.config/wavery/config.toml`.
pub fn default_config_path() -> Result<PathBuf, ConfigError> {
    if let Some(proj_dirs) = ProjectDirs::from("org", "wavery", "wavery") {
        let config_dir = proj_dirs.config_dir();
        fs::create_dir_all(config_dir)?;
        Ok(config_dir.join("config.toml"))
    } else {
        Err(ConfigError::DirectoryResolutionFailed)
    }
}

/// Loads configuration from the specified path or creates standard defaults.
pub fn load_or_create(path: &Path) -> Result<Config, ConfigError> {
    if path.exists() {
        let contents = fs::read_to_string(path)?;
        let mut config: Config = toml::from_str(&contents)?;
        config.sanitize();
        Ok(config)
    } else {
        let default_cfg = Config::default();
        save(path, &default_cfg)?;
        Ok(default_cfg)
    }
}

static TMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Persists configuration to file atomically.
pub fn save(path: &Path, config: &Config) -> Result<(), ConfigError> {
    let mut config_clone = config.clone();
    config_clone.sanitize();

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let toml_str = toml::to_string_pretty(&config_clone)?;
    let count = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    let file_stem = path.file_name().and_then(|n| n.to_str()).unwrap_or("config.toml");
    let tmp_path = parent.join(format!(".{file_stem}.tmp.{pid}_{count}_{nanos}"));

    {
        let mut file = File::create(&tmp_path)?;
        file.write_all(toml_str.as_bytes())?;
        file.sync_all()?;
    }

    #[cfg(target_os = "windows")]
    {
        let mut replaced = false;
        let mut last_err = None;
        for _ in 0..25 {
            match fs::rename(&tmp_path, path) {
                Ok(_) => {
                    replaced = true;
                    break;
                }
                Err(e) => {
                    last_err = Some(e);
                }
            }
            if fs::copy(&tmp_path, path).is_ok() {
                let _ = fs::remove_file(&tmp_path);
                replaced = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !replaced {
            let _ = fs::remove_file(&tmp_path);
            if let Some(err) = last_err {
                return Err(ConfigError::Io(err));
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(&tmp_path, path)?;
    }
    Ok(())
}

/// Resolves standard XDG session file path `~/.config/wavery/session.json`.
pub fn default_session_path() -> Result<PathBuf, ConfigError> {
    if let Some(proj_dirs) = ProjectDirs::from("org", "wavery", "wavery") {
        let config_dir = proj_dirs.config_dir();
        fs::create_dir_all(config_dir)?;
        Ok(config_dir.join("session.json"))
    } else {
        Err(ConfigError::DirectoryResolutionFailed)
    }
}

/// Loads playback session from the specified path. Returns None if file does not exist.
pub fn load_session(path: &Path) -> Result<Option<wavery_core::models::PlaybackSession>, ConfigError> {
    if path.exists() {
        let contents = fs::read_to_string(path)?;
        if contents.trim().is_empty() {
            return Ok(None);
        }
        let session: wavery_core::models::PlaybackSession = serde_json::from_str(&contents)?;
        Ok(Some(session))
    } else {
        Ok(None)
    }
}

/// Persists playback session to file atomically.
pub fn save_session_atomic(
    path: &Path,
    session: &wavery_core::models::PlaybackSession,
) -> Result<(), ConfigError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let json_str = serde_json::to_string_pretty(session)?;
    let count = TMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    let file_stem = path.file_name().and_then(|n| n.to_str()).unwrap_or("session.json");
    let tmp_path = parent.join(format!(".{file_stem}.tmp.{pid}_{count}_{nanos}"));

    {
        let mut file = File::create(&tmp_path)?;
        file.write_all(json_str.as_bytes())?;
        file.sync_all()?;
    }

    #[cfg(target_os = "windows")]
    {
        let mut replaced = false;
        let mut last_err = None;
        for _ in 0..25 {
            match fs::rename(&tmp_path, path) {
                Ok(_) => {
                    replaced = true;
                    break;
                }
                Err(e) => {
                    last_err = Some(e);
                }
            }
            if fs::copy(&tmp_path, path).is_ok() {
                let _ = fs::remove_file(&tmp_path);
                replaced = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !replaced {
            let _ = fs::remove_file(&tmp_path);
            if let Some(err) = last_err {
                return Err(ConfigError::Io(err));
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(&tmp_path, path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;


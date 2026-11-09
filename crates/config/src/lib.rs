//! Configuration structures and XDG-compliant path resolution for Wavery.

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Config {
    pub general: GeneralConfig,
    pub audio: AudioConfig,
    pub library: LibraryConfig,
    pub server: ServerConfig,
    pub theme: ThemeConfig,
    pub keybinds: KeybindsConfig,
    pub ui: UiConfig,
    pub integrations: IntegrationsConfig,
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

impl AudioConfig {
    /// Returns true if replay gain normalization is enabled (mode is "track" or "album").
    #[must_use]
    pub fn is_replay_gain_enabled(&self) -> bool {
        self.replay_gain_mode == "track" || self.replay_gain_mode == "album"
    }

    /// Sanitizes audio configuration fields, clamping numerical ranges and validating replay gain mode.
    pub fn sanitize(&mut self) {
        if self.default_volume.is_nan() || self.default_volume < 0.0 {
            self.default_volume = 0.0;
        } else if self.default_volume > 1.0 {
            self.default_volume = 1.0;
        }

        if self.volume_step.is_nan()
            || self.volume_step <= 0.0
            || self.volume_step > 1.0
        {
            self.volume_step = 0.05;
        }

        if self.buffer_size_frames < 256 || self.buffer_size_frames > 65536 {
            self.buffer_size_frames = 2048;
        }

        let mode_lower = self.replay_gain_mode.trim().to_lowercase();
        if mode_lower == "track" || mode_lower == "album" || mode_lower == "off" {
            self.replay_gain_mode = mode_lower;
        } else {
            self.replay_gain_mode = "off".to_string();
        }
    }
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
    pub protected_artists: Vec<String>,
    pub genre_mappings: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub enable_browser_client: bool,
}

impl ServerConfig {
    /// Checks whether the server is configured to bind on all network interfaces (LAN mode).
    #[must_use]
    pub fn is_lan_enabled(&self) -> bool {
        let trimmed = self.host.trim();
        trimmed == "0.0.0.0" || trimmed == "::"
    }

    /// Configures the server host to listen on all interfaces (`0.0.0.0`) when enabled,
    /// or restricted to local loopback (`127.0.0.1`) when disabled.
    pub fn set_lan_enabled(&mut self, enabled: bool) {
        if enabled {
            self.host = "0.0.0.0".to_string();
        } else {
            self.host = "127.0.0.1".to_string();
        }
    }

    /// Sanitizes server configuration fields, restoring defaults for invalid or empty values.
    pub fn sanitize(&mut self) {
        let trimmed = self.host.trim();
        if trimmed.is_empty() {
            self.host = "127.0.0.1".to_string();
        } else {
            self.host = trimmed.to_string();
        }

        if self.port == 0 {
            self.port = 4242;
        }
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_theme_json: Option<String>,
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
    Ocean,
    Purple,
    Forest,
    Mocha,
    Macchiato,
    Frappe,
    Latte,
    Custom,
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
    pub enable_gradients: bool,
    /// Transport affordance on the collapsed mobile mini player:
    /// `"buttons"` shows previous/next, `"swipe"` hides them and skips on
    /// horizontal swipe instead.
    pub mini_player_controls: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct IntegrationsConfig {
    pub enable_media_session: bool,
    pub enable_discord_rpc: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discord_app_id: Option<String>,
}

impl Default for IntegrationsConfig {
    fn default() -> Self {
        Self {
            enable_media_session: true,
            enable_discord_rpc: false,
            discord_app_id: None,
        }
    }
}

pub fn default_protected_artists() -> Vec<String> {
    vec![
        "Crosby, Stills, Nash & Young".into(),
        "Crosby, Stills, Nash and Young".into(),
        "Crosby, Stills & Nash".into(),
        "Crosby, Stills and Nash".into(),
        "Earth, Wind & Fire".into(),
        "Earth, Wind and Fire".into(),
        "Blood, Sweat & Tears".into(),
        "Blood, Sweat and Tears".into(),
        "Emerson, Lake & Palmer".into(),
        "Emerson, Lake and Palmer".into(),
        "Peter, Paul and Mary".into(),
        "Peter, Paul & Mary".into(),
        "Tyler, The Creator".into(),
        "Tom Petty and the Heartbreakers".into(),
        "Tom Petty & The Heartbreakers".into(),
        "Grandmaster Flash and the Furious Five".into(),
        "Grandmaster Flash & the Furious Five".into(),
        "Frankie Lymon & The Teenagers".into(),
        "Frankie Lymon and the Teenagers".into(),
        "King Gizzard & The Lizard Wizard".into(),
        "King Gizzard and the Lizard Wizard".into(),
        "Bob Marley & The Wailers".into(),
        "Bob Marley and the Wailers".into(),
        "Sly & The Family Stone".into(),
        "Sly and the Family Stone".into(),
        "Toots and the Maytals".into(),
        "Toots & The Maytals".into(),
        "Siouxsie and the Banshees".into(),
        "Siouxsie & The Banshees".into(),
        "Huey Lewis & The News".into(),
        "Huey Lewis and the News".into(),
        "KC and the Sunshine Band".into(),
        "KC & The Sunshine Band".into(),
        "The Mamas & The Papas".into(),
        "The Mamas and the Papas".into(),
        "Derek & The Dominos".into(),
        "Derek and the Dominos".into(),
        "Echo & The Bunnymen".into(),
        "Echo and the Bunnymen".into(),
        "Katrina and the Waves".into(),
        "Katrina & The Waves".into(),
        "Marina and the Diamonds".into(),
        "Marina & The Diamonds".into(),
        "Florence + The Machine".into(),
        "Florence and the Machine".into(),
        "Joan Jett & the Blackhearts".into(),
        "Joan Jett and the Blackhearts".into(),
        "Sun Ra and His Intergalactic Solar Arkestra".into(),
        "Sun Ra and His Arkestra".into(),
        "Tony! Toni! Toné!".into(),
        "Tony! Toni! Tone!".into(),
        "Simon & Garfunkel".into(),
        "Captain & Tennille".into(),
        "Captain and Tennille".into(),
        "Hall & Oates".into(),
        "Sunn O)))".into(),
        "Panic! At The Disco".into(),
        "!!! (Chk Chk Chk)".into(),
        "$uicideboy$".into(),
        "AC/DC".into(),
    ]
}

/// Returns the default multilingual and transliterated genre alias mapping.
pub fn default_genre_mappings() -> HashMap<String, String> {
    wavery_core::heuristics::DEFAULT_GENRE_MAPPINGS
        .iter()
        .map(|&(k, v)| (k.to_string(), v.to_string()))
        .collect()
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
            enable_gradients: true,
            mini_player_controls: "buttons".into(),
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
            protected_artists: default_protected_artists(),
            genre_mappings: default_genre_mappings(),
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
            custom_theme_json: None,
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

        if self.library.protected_artists.is_empty() {
            self.library.protected_artists = default_protected_artists();
        }
        if self.library.genre_mappings.is_empty() {
            self.library.genre_mappings = default_genre_mappings();
        }

        // Sanitize audio settings
        self.audio.sanitize();

        // Sanitize server settings
        self.server.sanitize();

        // Sanitize UI scale factor
        if self.ui.scale_factor.is_nan() || self.ui.scale_factor < 0.25 || self.ui.scale_factor > 4.0 {
            self.ui.scale_factor = 1.0;
        }
    }

    /// Checks whether the server is configured to bind on all network interfaces (LAN mode).
    #[must_use]
    pub fn is_lan_enabled(&self) -> bool {
        self.server.is_lan_enabled()
    }

    /// Configures the server host to listen on all interfaces (`0.0.0.0`) when enabled,
    /// or restricted to local loopback (`127.0.0.1`) when disabled.
    pub fn set_lan_enabled(&mut self, enabled: bool) {
        self.server.set_lan_enabled(enabled);
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

/// Resolves standard XDG crash log path `~/.local/share/wavery/crash.log` (or `%APPDATA%\wavery\crash.log`).
pub fn default_crash_log_path() -> Result<PathBuf, ConfigError> {
    if let Some(proj_dirs) = ProjectDirs::from("org", "wavery", "wavery") {
        let data_dir = proj_dirs.data_dir();
        fs::create_dir_all(data_dir)?;
        Ok(data_dir.join("crash.log"))
    } else {
        Err(ConfigError::DirectoryResolutionFailed)
    }
}

/// Installs a local panic hook that writes panic diagnostics and stack traces
/// to the XDG data directory (`crash.log`). Contains zero network calls or remote telemetry.
pub fn install_panic_hook(app_name: &'static str) {
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let location = panic_info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Box<dyn Any> payload (unknown type)".to_string()
        };

        let backtrace = std::backtrace::Backtrace::capture();

        let report = format!(
            "\n================================================================================\n\
             [WAVERY CRASH REPORT]\n\
             Timestamp: {timestamp} (Unix Epoch Seconds)\n\
             Application: {app_name} v{version}\n\
             Location: {location}\n\
             Message: {payload}\n\
             Backtrace:\n\
             {backtrace}\n\
             ================================================================================\n",
            version = env!("CARGO_PKG_VERSION")
        );

        if let Ok(crash_path) = default_crash_log_path() {
            if let Ok(mut file) = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&crash_path)
            {
                let _ = file.write_all(report.as_bytes());
            }
        }

        prev_hook(panic_info);
    }));
}

/// Loads configuration from the specified path or creates standard defaults.
pub fn load_or_create(path: &Path) -> Result<Config, ConfigError> {
    let mut last_err = None;
    for _ in 0..30 {
        if path.exists() {
            match fs::read_to_string(path) {
                Ok(contents) => {
                    let mut config: Config = toml::from_str(&contents)?;
                    config.sanitize();
                    return Ok(config);
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::PermissionDenied
                        || e.raw_os_error() == Some(5)
                        || e.raw_os_error() == Some(32) =>
                {
                    last_err = Some(ConfigError::Io(e));
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    continue;
                }
                Err(e) => return Err(ConfigError::Io(e)),
            }
        } else {
            let default_cfg = Config::default();
            match save(path, &default_cfg) {
                Ok(()) => return Ok(default_cfg),
                Err(ConfigError::Io(e))
                    if e.kind() == std::io::ErrorKind::PermissionDenied
                        || e.raw_os_error() == Some(5)
                        || e.raw_os_error() == Some(32) =>
                {
                    last_err = Some(ConfigError::Io(e));
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
    }
    if let Some(err) = last_err {
        return Err(err);
    }
    let default_cfg = Config::default();
    Ok(default_cfg)
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
        if let Err(e) = fs::rename(&tmp_path, path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(ConfigError::Io(e));
        }
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
        if let Err(e) = fs::rename(&tmp_path, path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(ConfigError::Io(e));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;


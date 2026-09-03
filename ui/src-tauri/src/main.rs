//! Tauri desktop shell application for Wavery.
//!
//! Note: As mandated by architecture rules, Tauri commands are thin wrappers
//! that call into core/audio/library/config and contain zero business logic.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use parking_lot::Mutex as SyncMutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;
use wavery_audio::{RodioPlayer, StandardQueueManager};
use wavery_config::{default_config_path, load_or_create, save as save_config_file, Config};
use wavery_core::models::{ImportStrategy, LoopMode, PlaybackState, Playlist, Track};
use wavery_core::traits::{LibraryManager, PlayerEngine, QueueManager};
use wavery_library::SqliteLibraryManager;

const MAX_ARTWORK_CACHE_ENTRIES: usize = 64;

/// Structured IPC error types returned across the Tauri bridge.
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "type", content = "message")]
pub enum IpcError {
    #[error("Library subsystem is not initialized")]
    LibraryNotInitialized,

    #[error("Audio playback engine is unavailable")]
    AudioEngineUnavailable,

    #[error("Track not found: {0}")]
    TrackNotFound(String),

    #[error("Audio error: {0}")]
    Audio(String),

    #[error("Library error: {0}")]
    Library(String),

    #[error("Internal task error: {0}")]
    Task(String),

    #[error("Configuration error: {0}")]
    Config(String),
}

impl From<wavery_core::error::AudioError> for IpcError {
    fn from(err: wavery_core::error::AudioError) -> Self {
        IpcError::Audio(err.to_string())
    }
}

impl From<wavery_core::error::LibraryError> for IpcError {
    fn from(err: wavery_core::error::LibraryError) -> Self {
        IpcError::Library(err.to_string())
    }
}

impl From<tokio::task::JoinError> for IpcError {
    fn from(err: tokio::task::JoinError) -> Self {
        IpcError::Task(err.to_string())
    }
}

impl From<wavery_config::ConfigError> for IpcError {
    fn from(err: wavery_config::ConfigError) -> Self {
        IpcError::Config(err.to_string())
    }
}

impl From<serde_json::Error> for IpcError {
    fn from(err: serde_json::Error) -> Self {
        IpcError::Config(err.to_string())
    }
}

/// Bounded LRU in-memory cache for base64 encoded album artwork.
#[derive(Debug)]
pub struct ArtworkCache {
    entries: std::collections::HashMap<String, Option<String>>,
    order: std::collections::VecDeque<String>,
    max_capacity: usize,
}

impl ArtworkCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: std::collections::HashMap::with_capacity(capacity),
            order: std::collections::VecDeque::with_capacity(capacity),
            max_capacity: capacity,
        }
    }

    pub fn get(&mut self, key: &str) -> Option<Option<String>> {
        if self.entries.contains_key(key) {
            if let Some(pos) = self.order.iter().position(|k| k == key) {
                self.order.remove(pos);
            }
            self.order.push_back(key.to_string());
            self.entries.get(key).cloned()
        } else {
            None
        }
    }

    pub fn insert(&mut self, key: String, value: Option<String>) {
        if self.entries.contains_key(&key) {
            if let Some(pos) = self.order.iter().position(|k| *k == key) {
                self.order.remove(pos);
            }
        } else if self.entries.len() >= self.max_capacity {
            if let Some(oldest_key) = self.order.pop_front() {
                self.entries.remove(&oldest_key);
            }
        }
        self.order.push_back(key.clone());
        self.entries.insert(key, value);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

struct AppState {
    player: AsyncMutex<Option<RodioPlayer>>,
    library: Option<Arc<AsyncMutex<SqliteLibraryManager>>>,
    queue: SyncMutex<StandardQueueManager>,
    config: SyncMutex<Config>,
    artwork_cache: SyncMutex<ArtworkCache>,
    server_process: SyncMutex<Option<std::process::Child>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlayerStatus {
    pub state: PlaybackState,
    pub volume: f32,
    pub position_secs: f64,
    pub duration_secs: Option<f64>,
    pub current_track: Option<Track>,
    pub loop_mode: LoopMode,
}

#[tauri::command]
async fn get_tracks(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.all_tracks().to_vec())
}

#[tauri::command]
async fn import_file(
    source_path: String,
    strategy: ImportStrategy,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Track, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let mut lib = lib_arc.lock().await;
    let path = PathBuf::from(source_path);
    let track = lib.import_track(&path, strategy).await?;
    Ok(track)
}

#[tauri::command]
async fn import_folder(
    dir_path: String,
    strategy: ImportStrategy,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let mut lib = lib_arc.lock().await;
    let path = PathBuf::from(dir_path);
    let tracks = lib.import_directory(&path, strategy).await?;
    Ok(tracks)
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct AlbumTrackUpdateDto {
    #[serde(alias = "trackId")]
    pub track_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    #[serde(alias = "trackNumber")]
    pub track_number: Option<u32>,
    #[serde(alias = "discNumber")]
    pub disc_number: Option<u32>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct UpdateAlbumMetadataDto {
    pub album: Option<String>,
    #[serde(alias = "albumArtist")]
    pub album_artist: Option<String>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub tracks: Vec<AlbumTrackUpdateDto>,
    #[serde(alias = "writeTags")]
    pub write_tags: Option<bool>,
}

#[tauri::command]
async fn update_album_metadata(
    req: UpdateAlbumMetadataDto,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let mut lib = lib_arc.lock().await;
    let write_tags = req.write_tags.unwrap_or(true);
    let mut updated_tracks = Vec::new();

    for track_update in req.tracks {
        if let Some(existing) = lib.get_track(&track_update.track_id).cloned() {
            let mut meta = existing.metadata.clone();
            if let Some(album) = &req.album {
                meta.album = Some(album.clone());
            }
            if let Some(album_artist) = &req.album_artist {
                meta.album_artist = Some(album_artist.clone());
            }
            if let Some(year) = req.year {
                meta.year = Some(year);
            }
            if let Some(genre) = &req.genre {
                meta.genre = Some(genre.clone());
            }
            if let Some(title) = track_update.title {
                meta.title = Some(title);
            }
            if let Some(artist) = track_update.artist {
                meta.artist = Some(artist);
            }
            if let Some(track_num) = track_update.track_number {
                meta.track_number = Some(track_num);
            }
            if let Some(disc_num) = track_update.disc_number {
                meta.disc_number = Some(disc_num);
            }

            let updated = lib
                .update_track_metadata(&track_update.track_id, &meta, write_tags)
                .await?;
            updated_tracks.push(updated);
        }
    }

    Ok(updated_tracks)
}

#[tauri::command]
async fn rebuild_library(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let mut lib = lib_arc.lock().await;
    let tracks = lib.rebuild_library().await?;

    // Clear artwork cache
    {
        let mut cache = state.artwork_cache.lock();
        cache.clear();
    }

    Ok(tracks)
}

#[tauri::command]
async fn vacuum_library(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.vacuum_database()?;
    Ok(())
}

#[tauri::command]
async fn clear_artwork_cache(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut cache = state.artwork_cache.lock();
    cache.clear();
    Ok(())
}

#[tauri::command]
async fn pick_file() -> Result<Option<String>, IpcError> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("Audio Files", &["mp3", "flac", "ogg", "opus", "m4a", "wav", "aac"])
        .set_title("Select Audio Track to Ingest")
        .pick_file()
        .await;
    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn pick_folder() -> Result<Option<String>, IpcError> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Select Music Directory to Ingest")
        .pick_folder()
        .await;
    Ok(folder.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn play_track(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let track = {
        let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
        let lib = lib_arc.lock().await;
        lib.get_track(&track_id)
            .cloned()
            .ok_or_else(|| IpcError::TrackNotFound(track_id.clone()))?
    };

    {
        let mut queue = state.queue.lock();
        queue.set_queue(vec![track.clone()], 0);
    }

    let mut player_guard = state.player.lock().await;
    let player = player_guard.as_mut().ok_or(IpcError::AudioEngineUnavailable)?;
    player.load(&track, None).await?;
    Ok(())
}

#[tauri::command]
async fn pause_playback(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard.as_mut().ok_or(IpcError::AudioEngineUnavailable)?;
    player.pause()?;
    Ok(())
}

#[tauri::command]
async fn resume_playback(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard.as_mut().ok_or(IpcError::AudioEngineUnavailable)?;
    player.play()?;
    Ok(())
}

#[tauri::command]
async fn stop_playback(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard.as_mut().ok_or(IpcError::AudioEngineUnavailable)?;
    player.stop()?;
    Ok(())
}

#[tauri::command]
async fn seek_playback(
    position_secs: f64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard.as_mut().ok_or(IpcError::AudioEngineUnavailable)?;
    player.seek(Duration::from_secs_f64(position_secs.max(0.0)))?;
    Ok(())
}

#[tauri::command]
async fn set_volume(volume: f32, state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard.as_mut().ok_or(IpcError::AudioEngineUnavailable)?;
    player.set_volume(volume);
    Ok(())
}

#[tauri::command]
async fn get_status(state: tauri::State<'_, Arc<AppState>>) -> Result<PlayerStatus, IpcError> {
    let player_guard = state.player.lock().await;
    let queue_guard = state.queue.lock();

    if let Some(player) = player_guard.as_ref() {
        Ok(PlayerStatus {
            state: player.state(),
            volume: player.volume(),
            position_secs: player.position().as_secs_f64(),
            duration_secs: player.duration().map(|d| d.as_secs_f64()),
            current_track: queue_guard.current_track().cloned(),
            loop_mode: LoopMode::Off,
        })
    } else {
        Ok(PlayerStatus {
            state: PlaybackState::Stopped,
            volume: 0.8,
            position_secs: 0.0,
            duration_secs: None,
            current_track: None,
            loop_mode: LoopMode::Off,
        })
    }
}

#[tauri::command]
async fn search_tracks(
    query: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.search(&query).into_iter().cloned().collect())
}

#[tauri::command]
async fn get_artwork(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<String>, IpcError> {
    // 1. Fast sync cache check
    {
        let mut cache = state.artwork_cache.lock();
        if let Some(cached) = cache.get(&track_id) {
            return Ok(cached);
        }
    }

    // 2. Fetch track path and immediately drop library lock
    let track_path = {
        let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
        let lib = lib_arc.lock().await;
        let track = lib
            .get_track(&track_id)
            .ok_or_else(|| IpcError::TrackNotFound(track_id.clone()))?;
        track.source.path().clone()
    };

    // 3. Offload disk I/O and tag parsing to blocking worker pool
    let art_result = tokio::task::spawn_blocking(move || {
        use wavery_core::traits::MetadataReader;
        let reader = wavery_library::LoftyMetadataReader::new();
        reader.read_artwork(&track_path).ok().flatten()
    })
    .await?;

    let base64_opt = art_result.map(|art| {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&art.data);
        format!("data:{};base64,{}", art.mime_type, b64)
    });

    // 4. Store in bounded cache
    {
        let mut cache = state.artwork_cache.lock();
        cache.insert(track_id, base64_opt.clone());
    }

    Ok(base64_opt)
}

#[tauri::command]
fn get_config(state: tauri::State<Arc<AppState>>) -> Config {
    state.config.lock().clone()
}

#[tauri::command]
async fn save_config(
    mut config: Config,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    config.sanitize();
    let cfg_path = default_config_path()?;
    save_config_file(&cfg_path, &config)?;
    {
        let mut guard = state.config.lock();
        *guard = config.clone();
    }
    {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            player.set_crossfade(Duration::from_millis(config.audio.crossfade_duration_ms as u64));
        }
    }
    Ok(())
}

#[tauri::command]
async fn import_config_json(
    json_str: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Config, IpcError> {
    let mut imported_config: Config = serde_json::from_str(&json_str)?;
    imported_config.sanitize();
    let cfg_path = default_config_path()?;
    save_config_file(&cfg_path, &imported_config)?;
    {
        let mut guard = state.config.lock();
        *guard = imported_config.clone();
    }
    {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            player.set_crossfade(Duration::from_millis(imported_config.audio.crossfade_duration_ms as u64));
        }
    }
    Ok(imported_config)
}

#[tauri::command]
async fn export_config_json(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<String, IpcError> {
    let config = {
        let guard = state.config.lock();
        guard.clone()
    };
    let json_str = serde_json::to_string_pretty(&config)?;
    Ok(json_str)
}

fn find_project_root() -> PathBuf {
    if let Ok(current) = std::env::current_exe() {
        let mut dir = current;
        while let Some(parent) = dir.parent() {
            if parent.join("Cargo.toml").exists() && parent.join("ui").exists() {
                return parent.to_path_buf();
            }
            dir = parent.to_path_buf();
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut dir = cwd;
        loop {
            if dir.join("Cargo.toml").exists() && dir.join("ui").exists() {
                return dir;
            }
            if let Some(parent) = dir.parent() {
                dir = parent.to_path_buf();
            } else {
                break;
            }
        }
    }
    PathBuf::from(".")
}

fn find_server_executable() -> Option<PathBuf> {
    let root = find_project_root();
    let candidates = if cfg!(debug_assertions) {
        [
            root.join("target/debug/wavery-server"),
            root.join("target/debug/wavery-server.exe"),
            root.join("target/release/wavery-server"),
            root.join("target/release/wavery-server.exe"),
        ]
    } else {
        [
            root.join("target/release/wavery-server"),
            root.join("target/release/wavery-server.exe"),
            root.join("target/debug/wavery-server"),
            root.join("target/debug/wavery-server.exe"),
        ]
    };

    for p in &candidates {
        if p.is_file() {
            return Some(p.clone());
        }
    }

    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let candidates = ["wavery-server", "wavery-server.exe"];
            for cand in &candidates {
                let p = parent.join(cand);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }

    None
}

fn open_browser_url(url: &str) -> Result<(), std::io::Error> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/c", "start", "", url]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(url)
            .spawn();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let mut spawned = false;

        if std::process::Command::new("xdg-open")
            .arg(url)
            .env_remove("GDK_BACKEND")
            .env_remove("WEBKIT_DISABLE_COMPOSITING_MODE")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .is_ok()
        {
            spawned = true;
        }

        if !spawned
            && std::process::Command::new("gio")
                .args(["open", url])
                .env_remove("GDK_BACKEND")
                .env_remove("WEBKIT_DISABLE_COMPOSITING_MODE")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .is_ok()
        {
            spawned = true;
        }

        if !spawned {
            for browser in [
                "firefox",
                "google-chrome",
                "chromium",
                "brave-browser",
                "x-www-browser",
                "sensible-browser",
            ] {
                if std::process::Command::new(browser)
                    .arg(url)
                    .env_remove("GDK_BACKEND")
                    .env_remove("WEBKIT_DISABLE_COMPOSITING_MODE")
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .is_ok()
                {
                    spawned = true;
                    break;
                }
            }
        }

        if !spawned {
            let _ = std::process::Command::new("python3")
                .args(["-m", "webbrowser", url])
                .env_remove("GDK_BACKEND")
                .env_remove("WEBKIT_DISABLE_COMPOSITING_MODE")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    }
    Ok(())
}

/// Terminates any existing wavery-server processes to guarantee mutual exclusivity.
fn terminate_server_instances() {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-f", "wavery-server"])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut kill_cmd = std::process::Command::new("taskkill");
        kill_cmd.args(["/F", "/IM", "wavery-server.exe"]);
        kill_cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = kill_cmd.status();
    }
}

fn spawn_detached_server_process() -> Result<(), std::io::Error> {
    let root = find_project_root();
    let mut cmd = if let Some(exe) = find_server_executable() {
        let mut c = std::process::Command::new(&exe);
        c.current_dir(&root);
        c
    } else {
        let mut c = std::process::Command::new("cargo");
        c.current_dir(&root);
        c.args(["run", "-p", "wavery-server"]);
        c
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::inherit());
    cmd.stderr(std::process::Stdio::inherit());

    cmd.spawn()?;
    Ok(())
}

/// Forcefully terminates all spawned background child processes and subprocess trees.
fn kill_all_subprocesses(state: &AppState) {
    // 1. Terminate tracked server child process and its child tree
    let mut proc_guard = state.server_process.lock();
    if let Some(mut child) = proc_guard.take() {
        let pid = child.id();
        let _ = child.kill();
        let _ = child.wait();

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut kill_cmd = std::process::Command::new("taskkill");
            kill_cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
            kill_cmd.creation_flags(CREATE_NO_WINDOW);
            let _ = kill_cmd.status();
        }

        #[cfg(unix)]
        {
            let _ = std::process::Command::new("pkill")
                .args(["-P", &pid.to_string()])
                .status();
        }
    }

    // 2. Clean up any remaining background server processes
    terminate_server_instances();
}

#[tauri::command]
async fn get_saved_session() -> Result<Option<wavery_core::models::PlaybackSession>, IpcError> {
    let path = wavery_config::default_session_path()?;
    let session = wavery_config::load_session(&path)?;
    Ok(session)
}

#[tauri::command]
async fn save_session_state(
    session: wavery_core::models::PlaybackSession,
) -> Result<(), IpcError> {
    let path = wavery_config::default_session_path()?;
    wavery_config::save_session_atomic(&path, &session)?;
    Ok(())
}

#[tauri::command]
async fn switch_to_web(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    // 1. Stop native playback
    {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            let _ = player.stop();
        }
    }

    // 2. Notify frontend to pause and suppress auto-advance
    let _ = app_handle.emit("external-pause", ());

    // 3. Save current playback session to session.json
    let current_session = {
        let queue_guard = state.queue.lock();
        let loop_mode = match queue_guard.loop_mode() {
            LoopMode::Off => "Off",
            LoopMode::Queue => "Queue",
            LoopMode::Track => "Track",
        };
        wavery_core::models::PlaybackSession {
            current_track_id: queue_guard.current_track().map(|t| t.id.clone()),
            queue: queue_guard.queue().to_vec(),
            queue_index: queue_guard.current_index().unwrap_or(0),
            position_secs: 0.0,
            is_playing: false,
            volume: None,
            is_shuffle: queue_guard.is_shuffle(),
            is_autoplay: true,
            loop_mode: Some(loop_mode.to_string()),
            active_client: Some("web".to_string()),
        }
    };

    if let Ok(sess_path) = wavery_config::default_session_path() {
        let _ = wavery_config::save_session_atomic(&sess_path, &current_session);
    }

    let (server_host, server_port) = {
        let config = state.config.lock();
        (config.server.host.clone(), config.server.port)
    };

    let target_url = format!("http://{}:{}", server_host, server_port);

    // 4. Launch wavery-server detached in the background
    let _ = spawn_detached_server_process();

    // 5. Wait briefly for server to bind port
    let addr = format!("{}:{}", server_host, server_port);
    for _ in 0..20 {
        if std::net::TcpStream::connect(&addr).is_ok() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    // 6. Launch browser to target url
    let _ = open_browser_url(&target_url);

    // 7. Hide the window (music already stopped) — Tauri stays alive in the tray.
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }

    Ok(())
}

#[tauri::command]
async fn get_liked_tracks(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.get_liked_tracks()?)
}

#[tauri::command]
async fn get_liked_track_ids(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<String>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.get_liked_track_ids()?)
}

#[tauri::command]
async fn toggle_like(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<bool, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.toggle_like(&track_id)?)
}

#[tauri::command]
async fn like_track(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.like_track(&track_id)?;
    Ok(())
}

#[tauri::command]
async fn unlike_track(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.unlike_track(&track_id)?;
    Ok(())
}

#[tauri::command]
async fn list_playlists(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Playlist>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.list_playlists()?)
}

#[tauri::command]
async fn create_playlist(
    name: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Playlist, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.create_playlist(&name)?)
}

#[tauri::command]
async fn get_playlist(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<Playlist>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.get_playlist(&id)?)
}

#[tauri::command]
async fn get_playlist_tracks(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.get_playlist_tracks(&id)?)
}

#[tauri::command]
async fn rename_playlist(
    id: String,
    name: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.rename_playlist(&id, &name)?;
    Ok(())
}

#[tauri::command]
async fn delete_playlist(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.delete_playlist(&id)?;
    Ok(())
}

#[tauri::command]
async fn add_tracks_to_playlist(
    playlist_id: String,
    track_ids: Vec<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.add_tracks_to_playlist(&playlist_id, &track_ids)?;
    Ok(())
}

#[tauri::command]
async fn remove_track_from_playlist(
    playlist_id: String,
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.remove_track_from_playlist(&playlist_id, &track_id)?;
    Ok(())
}

#[tauri::command]
async fn save_playlist(
    playlist: Playlist,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state.library.as_ref().ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.save_playlist(&playlist)?;
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    {
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "x11,wayland");
        }
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    let cfg_path = default_config_path().unwrap_or_else(|_| PathBuf::from("config.toml"));
    let config = load_or_create(&cfg_path).unwrap_or_default();

    let mut player = RodioPlayer::try_new().ok();
    if let Some(ref mut p) = player {
        p.set_crossfade(Duration::from_millis(config.audio.crossfade_duration_ms as u64));
        p.set_volume(config.audio.default_volume);
    }
    let library_res = SqliteLibraryManager::new(
        config.library.managed_directory.clone(),
        config.library.database_path.clone(),
    );

    let shared_library = match library_res {
        Ok(lib) => Some(Arc::new(AsyncMutex::new(lib))),
        Err(e) => {
            eprintln!("Failed to initialize SQLite library: {e}");
            None
        }
    };

    // Async background startup scan if enabled in configuration
    if config.library.scan_on_startup {
        if let Some(scan_lib) = shared_library.clone() {
            let managed_dir = config.library.managed_directory.clone();
            tauri::async_runtime::spawn(async move {
                let mut lib = scan_lib.lock().await;
                match lib.import_directory(&managed_dir, ImportStrategy::Copy).await {
                    Ok(tracks) => {
                        eprintln!(
                            "[Wavery] Background startup auto-scan finished: {} tracks indexed",
                            tracks.len()
                        );
                    }
                    Err(err) => {
                        eprintln!("[Wavery] Background startup auto-scan error: {err}");
                    }
                }
            });
        }
    }

    let state = Arc::new(AppState {
        player: AsyncMutex::new(player),
        library: shared_library,
        queue: SyncMutex::new(StandardQueueManager::new()),
        config: SyncMutex::new(config.clone()),
        artwork_cache: SyncMutex::new(ArtworkCache::new(MAX_ARTWORK_CACHE_ENTRIES)),
        server_process: SyncMutex::new(None),
    });

    // Strict mutual exclusivity: Terminate any lingering server instances so only Tauri runs!
    terminate_server_instances();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(state.clone())
        .setup(move |app| {
            let tray_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(), Box<dyn std::error::Error>> {
                let open_desktop_item = MenuItemBuilder::with_id("open_desktop", "Open Desktop App").build(app)?;
                let web_label = format!("Open Web Client (http://{}:{})", config.server.host, config.server.port);
                let open_web_item = MenuItemBuilder::with_id("open_web", &web_label).build(app)?;
                let sep1 = PredefinedMenuItem::separator(app)?;
                let play_item = MenuItemBuilder::with_id("play_pause", "Play / Pause").build(app)?;
                let next_item = MenuItemBuilder::with_id("next", "Next Track").build(app)?;
                let prev_item = MenuItemBuilder::with_id("prev", "Previous Track").build(app)?;
                let sep2 = PredefinedMenuItem::separator(app)?;
                let hide_item = MenuItemBuilder::with_id("hide_window", "Hide Window").build(app)?;
                let sep3 = PredefinedMenuItem::separator(app)?;
                let quit_item = MenuItemBuilder::with_id("quit", "Quit Wavery").build(app)?;

                let tray_menu = MenuBuilder::new(app)
                    .items(&[
                        &open_desktop_item,
                        &open_web_item,
                        &sep1,
                        &play_item,
                        &next_item,
                        &prev_item,
                        &sep2,
                        &hide_item,
                        &sep3,
                        &quit_item,
                    ])
                    .build()?;

                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app_handle, event| {
                        match event.id.as_ref() {
                            "open_desktop" | "toggle" => {
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                            "open_web" | "web" => {
                                let state_handle = app_handle.state::<Arc<AppState>>();
                                let state_clone = state_handle.inner().clone();
                                let app_clone = app_handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    {
                                        let mut player_guard = state_clone.player.lock().await;
                                        if let Some(player) = player_guard.as_mut() {
                                            let _ = player.stop();
                                        }
                                    }
                                    let _ = app_clone.emit("external-pause", ());

                                    // Save current playback session
                                    let current_session = {
                                        let queue_guard = state_clone.queue.lock();
                                        let loop_mode = match queue_guard.loop_mode() {
                                            LoopMode::Off => "Off",
                                            LoopMode::Queue => "Queue",
                                            LoopMode::Track => "Track",
                                        };
                                        wavery_core::models::PlaybackSession {
                                            current_track_id: queue_guard.current_track().map(|t| t.id.clone()),
                                            queue: queue_guard.queue().to_vec(),
                                            queue_index: queue_guard.current_index().unwrap_or(0),
                                            position_secs: 0.0,
                                            is_playing: false,
                                            volume: None,
                                            is_shuffle: queue_guard.is_shuffle(),
                                            is_autoplay: true,
                                            loop_mode: Some(loop_mode.to_string()),
                                            active_client: Some("web".to_string()),
                                        }
                                    };
                                    if let Ok(sess_path) = wavery_config::default_session_path() {
                                        let _ = wavery_config::save_session_atomic(&sess_path, &current_session);
                                    }

                                    let (server_host, server_port) = {
                                        let cfg = state_clone.config.lock();
                                        (cfg.server.host.clone(), cfg.server.port)
                                    };
                                    let url = format!("http://{}:{}", server_host, server_port);
                                    let _ = spawn_detached_server_process();
                                    let addr = format!("{}:{}", server_host, server_port);
                                    for _ in 0..20 {
                                        if std::net::TcpStream::connect(&addr).is_ok() {
                                            break;
                                        }
                                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                                    }
                                    let _ = open_browser_url(&url);
                                    if let Some(window) = app_clone.get_webview_window("main") {
                                        let _ = window.hide();
                                    }
                                });
                            }
                            "hide_window" => {
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let _ = window.hide();
                                }
                            }
                            "play_pause" => {
                                let state_handle = app_handle.state::<Arc<AppState>>();
                                let state_clone = state_handle.inner().clone();
                                tauri::async_runtime::spawn(async move {
                                    let mut player_guard = state_clone.player.lock().await;
                                    if let Some(player) = player_guard.as_mut() {
                                        if player.state() == PlaybackState::Playing {
                                            let _ = player.pause();
                                        } else {
                                            let _ = player.play();
                                        }
                                    }
                                });
                            }
                            "next" => {
                                let state_handle = app_handle.state::<Arc<AppState>>();
                                let state_clone = state_handle.inner().clone();
                                tauri::async_runtime::spawn(async move {
                                    let next_track = {
                                        let mut queue = state_clone.queue.lock();
                                        queue.next().cloned()
                                    };
                                    if let Some(track) = next_track {
                                        let mut player_guard = state_clone.player.lock().await;
                                        if let Some(player) = player_guard.as_mut() {
                                            let _ = player.load(&track, None).await;
                                        }
                                    }
                                });
                            }
                            "prev" => {
                                let state_handle = app_handle.state::<Arc<AppState>>();
                                let state_clone = state_handle.inner().clone();
                                tauri::async_runtime::spawn(async move {
                                    let prev_track = {
                                        let mut queue = state_clone.queue.lock();
                                        queue.previous(Duration::ZERO).cloned()
                                    };
                                    if let Some(track) = prev_track {
                                        let mut player_guard = state_clone.player.lock().await;
                                        if let Some(player) = player_guard.as_mut() {
                                            let _ = player.load(&track, None).await;
                                        }
                                    }
                                });
                            }
                            "quit" => {
                                let state_handle = app_handle.state::<Arc<AppState>>();
                                let state_clone = state_handle.inner().clone();
                                let app_clone = app_handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    {
                                        let mut player_guard = state_clone.player.lock().await;
                                        if let Some(player) = player_guard.as_mut() {
                                            let _ = player.stop();
                                        }
                                    }
                                    kill_all_subprocesses(&state_clone);
                                    terminate_server_instances();
                                    app_clone.exit(0);
                                });
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    });

                let icon = app.default_window_icon().cloned().or_else(|| {
                    tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).ok()
                });
                if let Some(icon) = icon {
                    tray_builder = tray_builder.icon(icon);
                }

                let _ = tray_builder.build(app)?;

                Ok(())
            }));

            if tray_result.is_err() {
                eprintln!("[Wavery] System tray indicator library (libappindicator3/libayatana-appindicator3) not found on system. Running with standard window interface.");
            } else if let Ok(Err(e)) = tray_result {
                eprintln!("[Wavery] System tray initialization warning: {e}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state_handle = app.state::<Arc<AppState>>();
                let minimize_to_tray = {
                    let cfg = state_handle.config.lock();
                    cfg.general.minimize_to_tray
                };
                if minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    kill_all_subprocesses(&state_handle);
                    terminate_server_instances();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_tracks,
            import_file,
            import_folder,
            pick_file,
            pick_folder,
            play_track,
            pause_playback,
            resume_playback,
            stop_playback,
            seek_playback,
            set_volume,
            get_status,
            search_tracks,
            get_artwork,
            get_config,
            save_config,
            import_config_json,
            export_config_json,
            update_album_metadata,
            rebuild_library,
            vacuum_library,
            clear_artwork_cache,
            switch_to_web,
            get_saved_session,
            save_session_state,
            get_liked_tracks,
            get_liked_track_ids,
            toggle_like,
            like_track,
            unlike_track,
            list_playlists,
            create_playlist,
            get_playlist,
            get_playlist_tracks,
            rename_playlist,
            delete_playlist,
            add_tracks_to_playlist,
            remove_track_from_playlist,
            save_playlist
        ])
        .build(tauri::generate_context!())?;

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            // Only allow the process to exit when code is Some (explicit exit call, e.g. from
            // the "Quit Wavery" tray action which uses app_handle.exit(0)).
            // When code is None it means all windows were closed/hidden — keep alive in tray.
            if code.is_none() {
                api.prevent_exit();
            }
        }
        tauri::RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                kill_all_subprocesses(&state);
            }
        }
        _ => {}
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn test_artwork_cache_bounding_and_eviction() {
        let mut cache = ArtworkCache::new(3);
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());

        cache.insert("track1".into(), Some("art1".into()));
        cache.insert("track2".into(), Some("art2".into()));
        cache.insert("track3".into(), Some("art3".into()));

        assert_eq!(cache.len(), 3);
        assert_eq!(cache.get("track1"), Some(Some("art1".into())));

        // Inserting a 4th item must evict track2 (since track1 was accessed and became most recent)
        cache.insert("track4".into(), Some("art4".into()));
        assert_eq!(cache.len(), 3);
        assert_eq!(cache.get("track2"), None);
        assert_eq!(cache.get("track1"), Some(Some("art1".into())));
        assert_eq!(cache.get("track3"), Some(Some("art3".into())));
        assert_eq!(cache.get("track4"), Some(Some("art4".into())));

        cache.clear();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_artwork_cache_large_scale_bounding_eviction() {
        let capacity = MAX_ARTWORK_CACHE_ENTRIES; // 64
        let mut cache = ArtworkCache::new(capacity);

        // Insert 1000 entries
        for i in 0..1000 {
            cache.insert(format!("track_{i}"), Some(format!("data:image/jpeg;base64,{i}")));
            assert!(cache.len() <= capacity);
        }

        assert_eq!(cache.len(), capacity);

        // The oldest 936 entries (0..936) must have been evicted in strict FIFO order
        for i in 0..(1000 - capacity) {
            assert_eq!(cache.get(&format!("track_{i}")), None, "track_{i} should be evicted");
        }

        // The newest 64 entries (936..1000) must still exist
        for i in (1000 - capacity)..1000 {
            assert_eq!(
                cache.get(&format!("track_{i}")),
                Some(Some(format!("data:image/jpeg;base64,{i}"))),
                "track_{i} should still be cached"
            );
        }
    }

    #[test]
    fn test_artwork_cache_lru_access_ordering() {
        let capacity = 64;
        let mut cache = ArtworkCache::new(capacity);

        for i in 0..capacity {
            cache.insert(format!("t_{i}"), Some(format!("v_{i}")));
        }
        assert_eq!(cache.len(), capacity);

        // Access the oldest 3 items: t_0, t_1, t_2
        assert_eq!(cache.get("t_0"), Some(Some("v_0".into())));
        assert_eq!(cache.get("t_1"), Some(Some("v_1".into())));
        assert_eq!(cache.get("t_2"), Some(Some("v_2".into())));

        // Now LRU order (oldest to newest): t_3, t_4, ..., t_63, t_0, t_1, t_2
        // Inserting 3 new items should evict t_3, t_4, t_5
        cache.insert("new_1".into(), Some("nv_1".into()));
        cache.insert("new_2".into(), Some("nv_2".into()));
        cache.insert("new_3".into(), Some("nv_3".into()));

        assert_eq!(cache.len(), capacity);

        // t_3, t_4, t_5 must be evicted
        assert_eq!(cache.get("t_3"), None);
        assert_eq!(cache.get("t_4"), None);
        assert_eq!(cache.get("t_5"), None);

        // t_0, t_1, t_2 must still be present
        assert_eq!(cache.get("t_0"), Some(Some("v_0".into())));
        assert_eq!(cache.get("t_1"), Some(Some("v_1".into())));
        assert_eq!(cache.get("t_2"), Some(Some("v_2".into())));

        // t_6..t_63 must still be present
        for i in 6..capacity {
            assert_eq!(cache.get(&format!("t_{i}")), Some(Some(format!("v_{i}"))));
        }
    }

    #[test]
    fn test_artwork_cache_update_existing_entry() {
        let mut cache = ArtworkCache::new(3);

        cache.insert("k1".into(), Some("v1_old".into()));
        cache.insert("k2".into(), Some("v2".into()));
        cache.insert("k3".into(), Some("v3".into()));

        // Update k1 with new value
        cache.insert("k1".into(), Some("v1_new".into()));
        assert_eq!(cache.len(), 3);
        assert_eq!(cache.get("k1"), Some(Some("v1_new".into())));

        // Inserting k4 must evict k2 (because k1 was refreshed and k3 was inserted after k2)
        cache.insert("k4".into(), Some("v4".into()));
        assert_eq!(cache.len(), 3);
        assert_eq!(cache.get("k2"), None);
        assert_eq!(cache.get("k3"), Some(Some("v3".into())));
        assert_eq!(cache.get("k1"), Some(Some("v1_new".into())));
        assert_eq!(cache.get("k4"), Some(Some("v4".into())));
    }

    #[test]
    fn test_artwork_cache_negative_caching() {
        let mut cache = ArtworkCache::new(2);

        // Negative cache entry (track has no artwork)
        cache.insert("no_art_track".into(), None);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.get("no_art_track"), Some(None));

        cache.insert("with_art".into(), Some("art_data".into()));
        assert_eq!(cache.len(), 2);

        // Evict no_art_track
        cache.insert("third".into(), Some("third_data".into()));
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.get("no_art_track"), None);
        assert_eq!(cache.get("with_art"), Some(Some("art_data".into())));
        assert_eq!(cache.get("third"), Some(Some("third_data".into())));
    }

    #[test]
    fn test_artwork_cache_concurrent_stress() {
        let cache = Arc::new(SyncMutex::new(ArtworkCache::new(MAX_ARTWORK_CACHE_ENTRIES)));
        let num_threads = 16;
        let ops_per_thread = 2000;
        let mut handles = Vec::new();

        for t in 0..num_threads {
            let cache_clone = Arc::clone(&cache);
            let handle = thread::spawn(move || {
                for op in 0..ops_per_thread {
                    let key = format!("track_{}", (t * 100 + op) % 200);
                    if op % 5 == 0 {
                        // Clear occasionally
                        let mut guard = cache_clone.lock();
                        if op % 500 == 0 {
                            guard.clear();
                        } else {
                            let _ = guard.is_empty();
                        }
                    } else if op % 2 == 0 {
                        let mut guard = cache_clone.lock();
                        guard.insert(key, Some(format!("payload_{t}_{op}")));
                        assert!(guard.len() <= MAX_ARTWORK_CACHE_ENTRIES);
                    } else {
                        let mut guard = cache_clone.lock();
                        let _ = guard.get(&key);
                        assert!(guard.len() <= MAX_ARTWORK_CACHE_ENTRIES);
                    }
                }
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().expect("thread finished without panic or deadlock");
        }

        let final_cache = cache.lock();
        assert!(final_cache.len() <= MAX_ARTWORK_CACHE_ENTRIES);
    }

    #[test]
    fn test_ipc_error_serialization_and_roundtrip_all_variants() {
        let cases = vec![
            (
                IpcError::LibraryNotInitialized,
                "{\"type\":\"LibraryNotInitialized\"}",
            ),
            (
                IpcError::AudioEngineUnavailable,
                "{\"type\":\"AudioEngineUnavailable\"}",
            ),
            (
                IpcError::TrackNotFound("uuid-123".into()),
                "{\"type\":\"TrackNotFound\",\"message\":\"uuid-123\"}",
            ),
            (
                IpcError::Audio("sink error".into()),
                "{\"type\":\"Audio\",\"message\":\"sink error\"}",
            ),
            (
                IpcError::Library("sqlite query error".into()),
                "{\"type\":\"Library\",\"message\":\"sqlite query error\"}",
            ),
            (
                IpcError::Task("tokio task panicked".into()),
                "{\"type\":\"Task\",\"message\":\"tokio task panicked\"}",
            ),
            (
                IpcError::Config("config error".into()),
                "{\"type\":\"Config\",\"message\":\"config error\"}",
            ),
        ];

        for (err, expected_json) in cases {
            let serialized = serde_json::to_string(&err).expect("serialization succeeds");
            assert_eq!(serialized, expected_json, "JSON serialization format mismatch");

            let deserialized: IpcError =
                serde_json::from_str(&serialized).expect("deserialization succeeds");
            assert_eq!(
                err.to_string(),
                deserialized.to_string(),
                "Display string should match after roundtrip"
            );
        }
    }

    #[test]
    fn test_ipc_error_from_conversions() {
        use wavery_core::error::{AudioError, LibraryError};

        let audio_err: IpcError = AudioError::SinkError("output device busy".into()).into();
        assert!(matches!(audio_err, IpcError::Audio(_)));
        assert!(audio_err.to_string().contains("output device busy"));

        let lib_err: IpcError = LibraryError::TrackNotFound("t99".into()).into();
        assert!(matches!(lib_err, IpcError::Library(_)));
        assert!(lib_err.to_string().contains("t99"));
    }

    #[test]
    fn test_ipc_error_config_variant_serialization() {
        let err = IpcError::Config("failed to parse TOML".into());
        let serialized = serde_json::to_string(&err).expect("serialization succeeds");
        assert_eq!(
            serialized,
            "{\"type\":\"Config\",\"message\":\"failed to parse TOML\"}"
        );

        let deserialized: IpcError =
            serde_json::from_str(&serialized).expect("deserialization succeeds");
        assert_eq!(err.to_string(), deserialized.to_string());
    }

    #[test]
    fn test_ipc_error_from_all_config_error_variants() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "cannot write file");
        let cfg_io_err = wavery_config::ConfigError::Io(io_err);
        let ipc_err1: IpcError = cfg_io_err.into();
        assert!(matches!(ipc_err1, IpcError::Config(_)));
        assert!(ipc_err1.to_string().contains("cannot write file"));

        let cfg_dir_err = wavery_config::ConfigError::DirectoryResolutionFailed;
        let ipc_err2: IpcError = cfg_dir_err.into();
        assert!(matches!(ipc_err2, IpcError::Config(_)));
        assert!(ipc_err2.to_string().contains("resolution failed") || ipc_err2.to_string().contains("Configuration error"));

        let json_err = serde_json::from_str::<Config>("{ \"malformed\": true ").unwrap_err();
        let ipc_err3: IpcError = json_err.into();
        assert!(matches!(ipc_err3, IpcError::Config(_)));
    }

    #[test]
    fn test_custom_config_json_export_and_import_roundtrip() {
        use wavery_config::{AudioBackendKind, ThemeMode};

        let theme_variants = [
            ThemeMode::Dark,
            ThemeMode::Light,
            ThemeMode::System,
            ThemeMode::Oled,
            ThemeMode::Midnight,
        ];

        for theme in theme_variants {
            let mut cfg = Config::default();
            cfg.general.language = "tr".into();
            cfg.general.notifications_enabled = false;
            cfg.general.auto_resume_playback = true;
            cfg.general.minimize_to_tray = true;
            cfg.general.check_updates = true;
            cfg.general.enable_mpris = false;

            cfg.audio.backend = AudioBackendKind::Rodio;
            cfg.audio.default_volume = 0.42;
            cfg.audio.volume_step = 0.02;
            cfg.audio.buffer_size_frames = 4096;
            cfg.audio.crossfade_duration_ms = 3500;
            cfg.audio.output_device = Some("Virtual_Sink_1".into());

            cfg.library.managed_directory = PathBuf::from("/tmp/custom_music_dir");
            cfg.library.database_path = PathBuf::from("/tmp/custom_db.sqlite");
            cfg.library.scan_on_startup = false;
            cfg.library.supported_extensions = vec!["mp3".into(), "wav".into(), "opus".into()];

            cfg.server.host = "0.0.0.0".into();
            cfg.server.port = 9090;
            cfg.server.enable_browser_client = false;

            cfg.theme.mode = theme;
            cfg.theme.background = "#050505".into();
            cfg.theme.accent = "#00ffcc".into();
            cfg.theme.surface = "#101010".into();
            cfg.theme.surface_hover = "#202020".into();
            cfg.theme.primary = "#aa00ff".into();
            cfg.theme.text_primary = "#eeeeee".into();
            cfg.theme.text_muted = "#888888".into();
            cfg.theme.error = "#ff0033".into();

            cfg.keybinds.toggle_play = "KeyP".into();
            cfg.keybinds.next_track = "KeyN".into();
            cfg.keybinds.prev_track = "KeyB".into();
            cfg.keybinds.volume_up = "KeyU".into();
            cfg.keybinds.volume_down = "KeyD".into();
            cfg.keybinds.seek_forward = "Shift+Right".into();
            cfg.keybinds.seek_backward = "Shift+Left".into();
            cfg.keybinds.open_search = "Ctrl+K".into();
            cfg.keybinds.toggle_mute = "Ctrl+M".into();
            cfg.keybinds.toggle_fullscreen = "F11".into();
            cfg.keybinds.toggle_lyrics = "Alt+L".into();

            let json_str = serde_json::to_string_pretty(&cfg).expect("JSON serialization succeeds");
            let deserialized: Config = serde_json::from_str(&json_str).expect("JSON deserialization succeeds");

            assert_eq!(cfg, deserialized);
            assert_eq!(deserialized.theme.mode, theme);
            assert_eq!(deserialized.general.language, "tr");
            assert!(!deserialized.general.notifications_enabled);
            assert!(deserialized.general.auto_resume_playback);
            assert_eq!(deserialized.server.port, 9090);
            assert_eq!(deserialized.keybinds.toggle_mute, "Ctrl+M");
            assert_eq!(deserialized.keybinds.toggle_fullscreen, "F11");
            assert_eq!(deserialized.keybinds.toggle_lyrics, "Alt+L");
            assert_eq!(deserialized.keybinds.seek_forward, "Shift+Right");
            assert_eq!(deserialized.keybinds.seek_backward, "Shift+Left");
        }
    }

    #[test]
    fn test_import_config_json_malformed_exhaustive() {
        let test_cases = vec![
            ("", "empty string"),
            ("   ", "whitespace only"),
            ("{ incomplete json", "truncated syntax"),
            ("42", "scalar integer"),
            ("\"just a string\"", "scalar string"),
            ("true", "scalar boolean"),
            ("null", "null literal"),
            ("[1, 2, 3]", "json array"),
            ("{\"audio\": {\"backend\": \"non_existent_engine\"}}", "invalid enum backend"),
            ("{\"theme\": {\"mode\": \"cyberpunk_neon\"}}", "invalid enum theme mode"),
            ("{\"server\": {\"port\": \"not_a_number\"}}", "type mismatch for u16"),
            ("{\"general\": {\"notifications_enabled\": \"yes\"}}", "type mismatch for bool"),
            ("{\"audio\": {\"default_volume\": \"loud\"}}", "type mismatch for f32"),
        ];

        for (invalid_json, description) in test_cases {
            let res = serde_json::from_str::<Config>(invalid_json);
            assert!(res.is_err(), "Expected error for case: {}", description);
            let ipc_err: IpcError = res.unwrap_err().into();
            assert!(
                matches!(ipc_err, IpcError::Config(_)),
                "Expected IpcError::Config for case: {}",
                description
            );
        }
    }

    #[tokio::test]
    async fn test_startup_autoscan_logic_resilience() {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("wavery_scan_test_{}", unique_id));
        let db_path = temp_dir.join("test_library.sqlite");
        let music_dir = temp_dir.join("music");
        std::fs::create_dir_all(&music_dir).unwrap();

        let lib_res = SqliteLibraryManager::new(music_dir.clone(), db_path);
        assert!(lib_res.is_ok());
        let shared_lib = Arc::new(AsyncMutex::new(lib_res.unwrap()));

        // Case 1: Scan empty directory
        {
            let mut lib = shared_lib.lock().await;
            let res = lib.import_directory(&music_dir, ImportStrategy::Copy).await;
            assert!(res.is_ok());
            assert_eq!(res.unwrap().len(), 0);
        }

        // Case 2: Scan non-existent directory (should return Ok(vec![]) or handled gracefully, no panic)
        {
            let non_existent = temp_dir.join("non_existent_subdir");
            let mut lib = shared_lib.lock().await;
            let res = lib.import_directory(&non_existent, ImportStrategy::Copy).await;
            assert!(res.is_ok());
            assert_eq!(res.unwrap().len(), 0);
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_minimize_to_tray_config_flag_logic() {
        let mut cfg = Config::default();
        assert!(!cfg.general.minimize_to_tray);

        cfg.general.minimize_to_tray = true;
        assert!(cfg.general.minimize_to_tray);

        let state = AppState {
            player: AsyncMutex::new(None),
            library: None,
            queue: SyncMutex::new(StandardQueueManager::new()),
            config: SyncMutex::new(cfg),
            artwork_cache: SyncMutex::new(ArtworkCache::new(MAX_ARTWORK_CACHE_ENTRIES)),
            server_process: SyncMutex::new(None),
        };

        let minimize = state.config.lock().general.minimize_to_tray;
        assert!(minimize);
    }

    fn make_test_track(id: &str, path: &str) -> Track {
        Track {
            id: id.to_string(),
            source: wavery_core::models::TrackSource::Managed(PathBuf::from(path)),
            metadata: wavery_core::models::TrackMetadata {
                title: Some(id.to_string()),
                artist: Some("Test Artist".into()),
                album: Some("Test Album".into()),
                album_artist: None,
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2026),
                genre: Some("Electronic".into()),
                duration: Duration::from_secs(180),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".into(),
            },
            date_added: 0,
        }
    }

    #[tokio::test]
    async fn test_tray_menu_queue_navigation_simulation() {
        let mut queue = StandardQueueManager::new();
        let track1 = make_test_track("track-1", "/music/song1.flac");
        let track2 = make_test_track("track-2", "/music/song2.flac");
        queue.set_queue(vec![track1.clone(), track2.clone()], 0);

        assert_eq!(queue.current_track().map(|t| t.id.clone()), Some(track1.id.clone()));

        // Simulate "next" tray menu action
        let next_track = queue.next().cloned();
        assert_eq!(next_track.map(|t| t.id.clone()), Some(track2.id.clone()));

        // Simulate "prev" tray menu action
        let prev_track = queue.previous(Duration::ZERO).cloned();
        assert_eq!(prev_track.map(|t| t.id.clone()), Some(track1.id.clone()));
    }
}




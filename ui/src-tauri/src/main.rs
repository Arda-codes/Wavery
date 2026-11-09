//! Tauri desktop shell application for Wavery.
//!
//! Note: As mandated by architecture rules, Tauri commands are thin wrappers
//! that call into core/audio/library/config and contain zero business logic.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use parking_lot::Mutex as SyncMutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
#[cfg(target_os = "macos")]
use tauri::menu::Menu;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(not(target_os = "macos"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;
use wavery_audio::{RodioPlayer, StandardQueueManager};
use wavery_config::{default_config_path, load_or_create, save as save_config_file, Config};
use wavery_core::lyrics::{
    LyricCandidate, LyricLine, LyricTargetInfo, ParsedLyrics, ScoredLyricCandidate,
};
use wavery_core::models::{
    Album, Artist, GenreInfo, ImportStrategy, LoopMode, PlaybackState, Playlist, QueueStateSnapshot,
    Track, WaveformData,
};
use wavery_core::traits::{LibraryManager, MprisBridge, PlayerEngine, QueueManager};
use wavery_library::{DatabaseBackup, DatabaseHealth, DatabaseStats, SqliteLibraryManager};

const MAX_ARTWORK_CACHE_ENTRIES: usize = 64;

/// Structured IPC error types returned across the Tauri bridge.
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "type", content = "message")]
pub enum IpcError {
    #[error("Library subsystem is not initialized")]
    LibraryNotInitialized,

    #[error("Audio playback engine is unavailable")]
    AudioEngineUnavailable,

    /// Raised by `resume_playback` when the engine holds no resumable track
    /// (restored session that was never loaded, or a track that already
    /// ended). The UI reloads the track instead of faking playback.
    #[error("Nothing to resume: no track is loaded")]
    NothingToResume,

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

    pub fn remove(&mut self, key: &str) {
        if self.entries.remove(key).is_some() {
            if let Some(pos) = self.order.iter().position(|k| k == key) {
                self.order.remove(pos);
            }
        }
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
    server_shutdown_tx: SyncMutex<Option<tokio::sync::watch::Sender<bool>>>,
    server_abort_handle: SyncMutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    discord_handle: wavery_server::discord::DiscordHandle,
    last_normal_size: SyncMutex<(u32, u32)>,
    mpris_bridge: Arc<AsyncMutex<wavery_mpris::ZbusMprisBridge>>,
}

/// Synchronizes current playback state, track metadata, and position with the MPRIS D-Bus bridge.
async fn sync_mpris_state(state: &Arc<AppState>) {
    use wavery_core::traits::MprisBridge;
    let (status, current_track, position) = {
        let player_guard = state.player.lock().await;
        let queue_guard = state.queue.lock();
        let s = player_guard
            .as_ref()
            .map(|p| p.state())
            .unwrap_or(PlaybackState::Stopped);
        let pos = player_guard
            .as_ref()
            .map(|p| p.position())
            .unwrap_or(Duration::ZERO);
        let t = queue_guard.current_track().cloned();
        (s, t, pos)
    };
    let mut bridge = state.mpris_bridge.lock().await;
    let _ = bridge.update_status(status).await;
    let _ = bridge.update_position(position).await;
    if let Some(ref track) = current_track {
        let _ = bridge.update_metadata(track, None).await;
    }
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
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.all_tracks().to_vec())
}

/// Returns pre-aggregated album list with compilation detection and track listings.
#[tauri::command]
async fn get_albums(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Album>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.list_albums().map_err(Into::into)
}

/// Returns pre-aggregated artist profiles with owned albums, appearances, and track rosters.
#[tauri::command]
async fn get_artists(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Artist>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.list_artists().map_err(Into::into)
}

/// Returns pre-aggregated genres with track listings sorted descending by popularity.
#[tauri::command]
async fn get_genres(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<GenreInfo>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.list_genres().map_err(Into::into)
}

/// Returns detailed album profile by title and optional artist.
#[tauri::command]
async fn get_album_details(
    title: String,
    artist: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<Album>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    let albums = lib.list_albums().map_err(IpcError::from)?;
    let title_lower = title.trim().to_lowercase();
    let artist_lower = artist.as_deref().map(|a| a.trim().to_lowercase());

    let found = albums.into_iter().find(|alb| {
        alb.title.to_lowercase() == title_lower
            && artist_lower
                .as_ref()
                .is_none_or(|a| alb.artist.to_lowercase() == *a)
    });
    Ok(found)
}

/// Returns detailed artist profile by name.
#[tauri::command]
async fn get_artist_details(
    name: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<Artist>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    let artists = lib.list_artists().map_err(IpcError::from)?;
    let name_lower = name.trim().to_lowercase();

    let found = artists
        .into_iter()
        .find(|art| art.name.to_lowercase() == name_lower);
    Ok(found)
}

/// Parses raw LRC lyrics string into structured parsed lines and metadata.
#[tauri::command]
async fn parse_lrc_content(raw: String) -> Result<ParsedLyrics, IpcError> {
    Ok(wavery_core::lyrics::parse_lrc(&raw))
}

/// Finds the active lyric index for a given playback position in seconds.
#[tauri::command]
async fn find_active_lyric_line(
    lines: Vec<LyricLine>,
    position_secs: f64,
) -> Result<Option<usize>, IpcError> {
    Ok(wavery_core::lyrics::get_active_lyric_index(&lines, position_secs))
}

/// Scores and ranks candidate lyrics from LRCLIB against target track metadata.
#[tauri::command]
async fn score_lyric_candidates(
    target: LyricTargetInfo,
    candidates: Vec<LyricCandidate>,
) -> Result<Vec<ScoredLyricCandidate>, IpcError> {
    Ok(wavery_core::lyrics::score_lyric_candidates(&target, candidates))
}

#[tauri::command]
async fn import_file(
    source_path: String,
    strategy: ImportStrategy,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Track, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
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
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let mut lib = lib_arc.lock().await;
    let path = PathBuf::from(dir_path);
    let tracks = lib.import_directory(&path, strategy).await?;
    Ok(tracks)
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct UpdateTrackMetadataDto {
    #[serde(alias = "trackId")]
    pub track_id: String,
    pub metadata: Option<wavery_core::models::TrackMetadata>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    #[serde(alias = "albumArtist")]
    pub album_artist: Option<String>,
    #[serde(alias = "trackNumber")]
    pub track_number: Option<u32>,
    #[serde(alias = "discNumber")]
    pub disc_number: Option<u32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub lyrics: Option<String>,
    #[serde(alias = "writeTags")]
    pub write_tags: Option<bool>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct UpdateArtistMetadataDto {
    #[serde(alias = "originalName")]
    pub original_name: String,
    #[serde(alias = "newName")]
    pub new_name: String,
    #[serde(alias = "updateAlbumArtist")]
    pub update_album_artist: Option<bool>,
    #[serde(alias = "writeTags")]
    pub write_tags: Option<bool>,
}

#[tauri::command]
async fn update_track_metadata(
    req: UpdateTrackMetadataDto,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Track, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let mut lib = lib_arc.lock().await;
    let write_tags = req.write_tags.unwrap_or(true);
    let mut meta = if let Some(m) = req.metadata {
        m
    } else {
        let existing = lib
            .get_track(&req.track_id)
            .cloned()
            .ok_or_else(|| IpcError::TrackNotFound(req.track_id.clone()))?;
        existing.metadata
    };

    if let Some(title) = req.title {
        meta.title = Some(title);
    }
    if let Some(artist) = req.artist {
        meta.artist = Some(artist);
    }
    if let Some(album) = req.album {
        meta.album = Some(album);
    }
    if let Some(album_artist) = req.album_artist {
        meta.album_artist = Some(album_artist);
    }
    if let Some(track_number) = req.track_number {
        meta.track_number = Some(track_number);
    }
    if let Some(disc_number) = req.disc_number {
        meta.disc_number = Some(disc_number);
    }
    if let Some(year) = req.year {
        meta.year = Some(year);
    }
    if let Some(genre) = req.genre {
        meta.genre = Some(genre);
    }
    if let Some(lyrics) = req.lyrics {
        meta.lyrics = if lyrics.trim().is_empty() {
            None
        } else {
            Some(lyrics)
        };
    }

    let updated = lib
        .update_track_metadata(&req.track_id, &meta, write_tags)
        .await
        .map_err(|e| IpcError::Library(e.to_string()))?;
    Ok(updated)
}

#[tauri::command]
async fn update_artist_metadata(
    req: UpdateArtistMetadataDto,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let mut lib = lib_arc.lock().await;
    let write_tags = req.write_tags.unwrap_or(true);
    let update_album_artist = req.update_album_artist.unwrap_or(true);
    let orig_lower = req.original_name.trim().to_lowercase();
    let is_orig_unknown = orig_lower == "unknown artist" || orig_lower.is_empty();

    let mut matching_track_ids: Vec<(String, bool, bool)> = Vec::new();
    for track in lib.all_tracks() {
        let artist_match = track
            .metadata
            .artist
            .as_deref()
            .map(|a| {
                let a_trimmed = a.trim();
                a_trimmed.to_lowercase() == orig_lower || (is_orig_unknown && a_trimmed.is_empty())
            })
            .unwrap_or(is_orig_unknown);

        let album_artist_match = if update_album_artist {
            track
                .metadata
                .album_artist
                .as_deref()
                .map(|a| {
                    let a_trimmed = a.trim();
                    a_trimmed.to_lowercase() == orig_lower
                        || (is_orig_unknown && a_trimmed.is_empty())
                })
                .unwrap_or(false)
        } else {
            false
        };

        if artist_match || album_artist_match {
            matching_track_ids.push((track.id.to_string(), artist_match, album_artist_match));
        }
    }

    let mut updated_tracks = Vec::new();
    for (track_id, artist_match, album_artist_match) in matching_track_ids {
        if let Some(track) = lib.get_track(&track_id).cloned() {
            let mut meta = track.metadata.clone();
            if artist_match {
                meta.artist = Some(req.new_name.clone());
            }
            if album_artist_match {
                meta.album_artist = Some(req.new_name.clone());
            }
            let updated = lib
                .update_track_metadata(&track_id, &meta, write_tags)
                .await
                .map_err(|e| IpcError::Library(e.to_string()))?;
            updated_tracks.push(updated);
        }
    }

    Ok(updated_tracks)
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
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
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
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
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
async fn delete_track(
    track_id: String,
    remove_file: Option<bool>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    {
        let lib_arc = state
            .library
            .as_ref()
            .ok_or(IpcError::LibraryNotInitialized)?;
        let mut lib = lib_arc.lock().await;
        lib.delete_track(&track_id, remove_file.unwrap_or(false))
            .await?;
    }

    // If currently playing, stop playback
    let is_current = {
        let queue = state.queue.lock();
        queue
            .current_track()
            .map(|t| t.id == track_id)
            .unwrap_or(false)
    };
    if is_current {
        let mut player = state.player.lock().await;
        if let Some(p) = player.as_mut() {
            let _ = p.stop();
        }
    }

    // Evict artwork from cache
    {
        let mut cache = state.artwork_cache.lock();
        cache.remove(&track_id);
    }

    Ok(())
}

#[tauri::command]
async fn vacuum_library(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.vacuum_database()?;
    Ok(())
}

#[tauri::command]
async fn get_database_stats(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<DatabaseStats, IpcError> {
    let artwork_cache_dir = state.config.lock().library.cache_directory.clone();
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.database_stats(&artwork_cache_dir)?)
}

#[tauri::command]
async fn check_database_health(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<DatabaseHealth, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.database_health()?)
}

#[tauri::command]
async fn prune_missing_tracks(state: tauri::State<'_, Arc<AppState>>) -> Result<usize, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let mut lib = lib_arc.lock().await;
    Ok(lib.prune_missing_tracks()?)
}

#[tauri::command]
async fn backup_database(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<DatabaseBackup>, IpcError> {
    let file = rfd::AsyncFileDialog::new()
        .set_title("Back Up Wavery Database")
        .set_file_name("wavery-library-backup.db")
        .add_filter("SQLite Database", &["db"])
        .save_file()
        .await;

    let Some(file) = file else {
        return Ok(None);
    };

    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(Some(lib.backup_database(file.path())?))
}

#[tauri::command]
async fn reveal_database_location(
    location: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let (path, select_file) = {
        let cfg = state.config.lock();
        match location.as_str() {
            "database" => (cfg.library.database_path.clone(), true),
            "library" => (cfg.library.managed_directory.clone(), false),
            "artwork" => (cfg.library.cache_directory.clone(), false),
            other => {
                return Err(IpcError::Config(format!(
                    "Unknown database location: {other}"
                )))
            }
        }
    };

    if !select_file {
        std::fs::create_dir_all(&path).map_err(|e| IpcError::Config(e.to_string()))?;
    }
    reveal_in_file_manager(&path, select_file);
    Ok(())
}

/// Opens the platform file manager at `path`, optionally selecting a file.
fn reveal_in_file_manager(path: &Path, select_file: bool) {
    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("explorer");
        if select_file {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }
        let _ = command.spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        if select_file {
            command.arg("-R");
        }
        let _ = command.arg(path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let target = if select_file {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        let _ = std::process::Command::new("xdg-open").arg(target).spawn();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (path, select_file);
    }
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
        .add_filter(
            "Audio Files",
            &[
                "mp3", "flac", "ogg", "opus", "m4a", "wav", "aac", "alac", "aiff", "aif",
                "weba", "webm",
            ],
        )
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

/// Opens a file picker for playlist files (.m3u, .m3u8, or yt-dlp JSON).
#[tauri::command]
async fn pick_playlist_file() -> Result<Option<String>, IpcError> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter(
            "Playlist Files (*.m3u, *.m3u8, *.json)",
            &["m3u", "m3u8", "json"],
        )
        .set_title("Select a Playlist File (.m3u, .m3u8, or yt-dlp JSON)")
        .pick_file()
        .await;
    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}

/// Builds a Wavery playlist from an M3U, M3U8, or yt-dlp JSON file.
///
/// Entries are matched against tracks already in the library. No audio file is
/// downloaded, moved, or re-tagged; only playlist order is stored.
#[tauri::command]
async fn import_playlist_file(
    file_path: Option<String>,
    json_path: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wavery_library::playlist_import::PlaylistImportSummary, IpcError> {
    let path = file_path
        .or(json_path)
        .ok_or_else(|| IpcError::Library("No playlist file path provided".into()))?;
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    let summary = lib.import_playlist_file(&PathBuf::from(path))?;
    Ok(summary)
}

#[tauri::command]
async fn play_track(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let track = {
        let lib_arc = state
            .library
            .as_ref()
            .ok_or(IpcError::LibraryNotInitialized)?;
        let lib = lib_arc.lock().await;
        if let Some(t) = lib.get_track(&track_id) {
            t.clone()
        } else if let Ok(Some(t)) = lib.db().get_track(&track_id, lib.library_root()) {
            t
        } else if let Some(t) = state.queue.lock().queue().iter().find(|t| t.id == track_id).cloned() {
            t
        } else {
            return Err(IpcError::TrackNotFound(track_id.clone()));
        }
    };

    {
        let mut queue = state.queue.lock();
        if let Some(pos) = queue.queue().iter().position(|t| t.id == track_id) {
            let tracks = queue.queue().to_vec();
            queue.set_queue(tracks, pos);
        } else {
            queue.set_queue(vec![track.clone()], 0);
        }
    }

    let mut player_guard = state.player.lock().await;
    let player = player_guard
        .as_mut()
        .ok_or(IpcError::AudioEngineUnavailable)?;
    if let Err(e) = player.load(&track, None).await {
        eprintln!("[Audio] Failed to load track '{}': {e}", track.id);
        let _ = player.stop();
        return Err(e.into());
    }
    player.play()?;
    drop(player_guard);
    sync_mpris_state(&state).await;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct SyncQueuePayload {
    pub user_queue: Vec<Track>,
    pub context_queue: Vec<Track>,
    pub current_track_id: Option<String>,
    pub is_shuffle: bool,
    pub loop_mode: String,
}

#[tauri::command]
async fn sync_queue(
    payload: SyncQueuePayload,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let mut queue = state.queue.lock();
    let start_idx = if let Some(ref tid) = payload.current_track_id {
        payload
            .context_queue
            .iter()
            .position(|t| &t.id == tid)
            .unwrap_or(0)
    } else {
        0
    };
    queue.set_context_queue(payload.context_queue, start_idx);
    queue.set_shuffle(payload.is_shuffle);
    let loop_mode = match payload.loop_mode.as_str() {
        "Track" => LoopMode::Track,
        "Queue" => LoopMode::Queue,
        _ => LoopMode::Off,
    };
    queue.set_loop_mode(loop_mode);
    queue.clear_user_queue();
    for track in payload.user_queue.into_iter().rev() {
        queue.play_next(track);
    }
    Ok(())
}

// ============================================================================
// Queue Authority & Autoplay Helpers and Tauri IPC Commands (Milestone M3)
// ============================================================================

/// Advances playback to the next track across two-tier user/context queues,
/// falling back to library autoplay recommendations if enabled and queue is exhausted.
///
/// Emits `"queue-track-changed"` upon successful transition.
pub(crate) async fn advance_queue_next(
    app_handle: &tauri::AppHandle,
    state: &AppState,
) -> Result<QueueStateSnapshot, IpcError> {
    // 1. Initial queue progression
    let initial_next = {
        let mut queue = state.queue.lock();
        queue.next().cloned()
    };

    // 2. Autoplay fallback if next track is None but autoplay is enabled
    let track_to_play = if let Some(track) = initial_next {
        Some(track)
    } else {
        let is_autoplay = state.queue.lock().is_autoplay();
        if is_autoplay {
            let library_tracks = if let Some(ref lib_arc) = state.library {
                let lib = lib_arc.lock().await;
                lib.all_tracks().to_vec()
            } else {
                Vec::new()
            };

            let mut queue = state.queue.lock();
            if let Some(candidate) = queue.select_autoplay_candidate(&library_tracks) {
                queue.append_autoplay_track(candidate.clone());
                Some(candidate)
            } else {
                None
            }
        } else {
            None
        }
    };

    // 3. Update player and emit event
    if let Some(ref track) = track_to_play {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            if let Err(e) = player.load(track, None).await {
                eprintln!("[Audio] Failed to load track '{}': {e}", track.id);
                let _ = player.stop();
                return Err(e.into());
            }
            player.play()?;
        }
        let _ = app_handle.emit("queue-track-changed", track);
    } else {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            let _ = player.stop();
        }
    }

    let queue = state.queue.lock();
    Ok(queue.get_state())
}

/// Reverts playback to the previous track or restarts current track if elapsed position exceeds threshold.
///
/// Emits `"queue-track-changed"` upon track transition or restart.
pub(crate) async fn advance_queue_previous(
    position_secs: f64,
    app_handle: &tauri::AppHandle,
    state: &AppState,
) -> Result<QueueStateSnapshot, IpcError> {
    let prev_track = {
        let mut queue = state.queue.lock();
        queue
            .previous(Duration::from_secs_f64(position_secs.max(0.0)))
            .cloned()
    };

    if let Some(ref track) = prev_track {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            if let Err(e) = player.load(track, None).await {
                eprintln!("[Audio] Failed to load track '{}': {e}", track.id);
                let _ = player.stop();
                return Err(e.into());
            }
            player.play()?;
        }
        let _ = app_handle.emit("queue-track-changed", track);
    }

    let queue = state.queue.lock();
    Ok(queue.get_state())
}

/// Sets the context queue (e.g. album or playlist) and initiates playback at `start_index`.
#[tauri::command]
async fn queue_set_context(
    tracks: Vec<Track>,
    start_index: usize,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let (curr_track, snapshot) = {
        let mut queue = state.queue.lock();
        queue.set_context_queue(tracks, start_index);
        (queue.current_track().cloned(), queue.get_state())
    };

    if let Some(ref track) = curr_track {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            if let Err(e) = player.load(track, None).await {
                eprintln!("[Audio] Failed to load track '{}': {e}", track.id);
                let _ = player.stop();
                return Err(e.into());
            }
            player.play()?;
        }
        let _ = app_handle.emit("queue-track-changed", track);
    } else {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            let _ = player.stop();
        }
    }

    Ok(snapshot)
}

/// Appends tracks to the back of the user priority queue ("Add to Queue").
#[tauri::command]
async fn queue_add_user(
    tracks: Vec<Track>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let snapshot = {
        let mut queue = state.queue.lock();
        for track in tracks {
            queue.push_back(track);
        }
        queue.get_state()
    };
    Ok(snapshot)
}

/// Inserts tracks at the front of the user priority queue ("Play Next").
#[tauri::command]
async fn queue_play_next(
    tracks: Vec<Track>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let snapshot = {
        let mut queue = state.queue.lock();
        for track in tracks.into_iter().rev() {
            queue.play_next(track);
        }
        queue.get_state()
    };
    Ok(snapshot)
}

/// Removes a track at 0-based index from the user priority queue.
#[tauri::command]
async fn queue_remove_user_track(
    index: usize,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let snapshot = {
        let mut queue = state.queue.lock();
        queue.remove_user_track(index);
        queue.get_state()
    };
    Ok(snapshot)
}

/// Reorders a track within the user priority queue from index `from` to index `to`.
#[tauri::command]
async fn queue_reorder_user(
    from: usize,
    to: usize,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let snapshot = {
        let mut queue = state.queue.lock();
        queue.reorder_user_queue(from, to);
        queue.get_state()
    };
    Ok(snapshot)
}

/// Clears all tracks from the user priority queue.
#[tauri::command]
async fn queue_clear_user(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let snapshot = {
        let mut queue = state.queue.lock();
        queue.clear_user_queue();
        queue.get_state()
    };
    Ok(snapshot)
}

/// Advances playback to the next track (User Queue -> Context Queue -> Autoplay).
#[tauri::command]
async fn queue_next(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    advance_queue_next(&app_handle, &state).await
}

/// Steps back to previous track in history or restarts current track if elapsed position > 3s.
#[tauri::command]
async fn queue_previous(
    position_secs: f64,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    advance_queue_previous(position_secs, &app_handle, &state).await
}

/// Jumps directly to a track at index in the synthesized flattened queue.
#[tauri::command]
async fn queue_jump_to_index(
    index: usize,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let (track, snapshot) = {
        let mut queue = state.queue.lock();
        let t = queue.jump_to_index(index).cloned();
        (t, queue.get_state())
    };

    if let Some(ref t) = track {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            if let Err(e) = player.load(t, None).await {
                eprintln!("[Audio] Failed to load track '{}': {e}", t.id);
                let _ = player.stop();
                return Err(e.into());
            }
            player.play()?;
        }
        let _ = app_handle.emit("queue-track-changed", t);
    }
    Ok(snapshot)
}

/// Jumps directly to a track at index within the context queue.
#[tauri::command]
async fn queue_jump_to_context_track(
    context_index: usize,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let (track, snapshot) = {
        let mut queue = state.queue.lock();
        let t = queue.jump_to_context_track(context_index).cloned();
        (t, queue.get_state())
    };

    if let Some(ref t) = track {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            if let Err(e) = player.load(t, None).await {
                eprintln!("[Audio] Failed to load track '{}': {e}", t.id);
                let _ = player.stop();
                return Err(e.into());
            }
            player.play()?;
        }
        let _ = app_handle.emit("queue-track-changed", t);
    }
    Ok(snapshot)
}

/// Jumps directly to a track at index within the user priority queue.
#[tauri::command]
async fn queue_jump_to_user_track(
    user_index: usize,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let (track, snapshot) = {
        let mut queue = state.queue.lock();
        let t = queue.jump_to_user_track(user_index).cloned();
        (t, queue.get_state())
    };

    if let Some(ref t) = track {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            if let Err(e) = player.load(t, None).await {
                eprintln!("[Audio] Failed to load track '{}': {e}", t.id);
                let _ = player.stop();
                return Err(e.into());
            }
            player.play()?;
        }
        let _ = app_handle.emit("queue-track-changed", t);
    }
    Ok(snapshot)
}

/// Sets queue shuffle mode on or off.
#[tauri::command]
async fn queue_set_shuffle(
    enabled: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let snapshot = {
        let mut queue = state.queue.lock();
        queue.set_shuffle(enabled);
        queue.get_state()
    };
    Ok(snapshot)
}

/// Sets queue loop mode (`Off`, `Track`, `Queue`).
#[tauri::command]
async fn queue_set_loop_mode(
    mode: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let loop_mode = match mode.to_lowercase().as_str() {
        "track" => LoopMode::Track,
        "queue" => LoopMode::Queue,
        _ => LoopMode::Off,
    };
    let snapshot = {
        let mut queue = state.queue.lock();
        queue.set_loop_mode(loop_mode);
        queue.get_state()
    };
    Ok(snapshot)
}

/// Sets autoplay continuous playback mode on or off.
#[tauri::command]
async fn queue_set_autoplay(
    enabled: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let snapshot = {
        let mut queue = state.queue.lock();
        queue.set_autoplay(enabled);
        queue.get_state()
    };
    Ok(snapshot)
}

/// Clears all queues and stops active playback.
#[tauri::command]
async fn queue_clear(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let snapshot = {
        let mut queue = state.queue.lock();
        queue.clear();
        queue.get_state()
    };

    let mut player_guard = state.player.lock().await;
    if let Some(player) = player_guard.as_mut() {
        let _ = player.stop();
    }

    Ok(snapshot)
}

/// Queries the full canonical QueueStateSnapshot.
#[tauri::command]
async fn queue_get_state(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<QueueStateSnapshot, IpcError> {
    let queue = state.queue.lock();
    Ok(queue.get_state())
}

/// Queries the next autoplay candidate track without mutating queue state.
#[tauri::command]
async fn get_autoplay_next(
    candidate_pool: Option<Vec<Track>>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<Track>, IpcError> {
    let pool = match candidate_pool {
        Some(pool) if !pool.is_empty() => pool,
        _ => {
            if let Some(ref lib_arc) = state.library {
                let lib = lib_arc.lock().await;
                lib.all_tracks().to_vec()
            } else {
                Vec::new()
            }
        }
    };

    let queue = state.queue.lock();
    Ok(queue.select_autoplay_candidate(&pool))
}

#[tauri::command]
async fn pause_playback(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard
        .as_mut()
        .ok_or(IpcError::AudioEngineUnavailable)?;
    player.pause()?;
    drop(player_guard);
    sync_mpris_state(&state).await;
    Ok(())
}

#[tauri::command]
async fn resume_playback(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard
        .as_mut()
        .ok_or(IpcError::AudioEngineUnavailable)?;
    player.play()?;
    // `PlayerEngine::play` is a deliberate no-op when there is nothing
    // resumable (a restored session that was never loaded, or a track that
    // already finished). Report that honestly: if possible load from queue first.
    if player.state() != wavery_core::models::PlaybackState::Playing {
        let curr = state.queue.lock().current_track().cloned();
        if let Some(track) = curr {
            player.load(&track, None).await?;
            player.play()?;
        }
    }
    if player.state() != wavery_core::models::PlaybackState::Playing {
        return Err(IpcError::NothingToResume);
    }
    drop(player_guard);
    sync_mpris_state(&state).await;
    Ok(())
}

#[tauri::command]
async fn stop_playback(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard
        .as_mut()
        .ok_or(IpcError::AudioEngineUnavailable)?;
    player.stop()?;
    drop(player_guard);
    sync_mpris_state(&state).await;
    Ok(())
}

#[tauri::command]
async fn seek_playback(
    position_secs: f64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard
        .as_mut()
        .ok_or(IpcError::AudioEngineUnavailable)?;
    player.seek(Duration::from_secs_f64(position_secs.max(0.0)))?;
    drop(player_guard);
    sync_mpris_state(&state).await;
    Ok(())
}

#[tauri::command]
async fn set_volume(volume: f32, state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let mut player_guard = state.player.lock().await;
    let player = player_guard
        .as_mut()
        .ok_or(IpcError::AudioEngineUnavailable)?;
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
            loop_mode: queue_guard.loop_mode(),
        })
    } else {
        Ok(PlayerStatus {
            state: PlaybackState::Stopped,
            volume: 0.8,
            position_secs: 0.0,
            duration_secs: None,
            current_track: None,
            loop_mode: queue_guard.loop_mode(),
        })
    }
}

#[tauri::command]
async fn search_tracks(
    query: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
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
        let lib_arc = state
            .library
            .as_ref()
            .ok_or(IpcError::LibraryNotInitialized)?;
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

/// Status and connection metadata for the embedded HTTP streaming server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerStatusResponse {
    /// Active bind host address (`"127.0.0.1"` or `"0.0.0.0"`).
    pub host: String,
    /// Active HTTP listening port.
    pub port: u16,
    /// Whether LAN streaming mode is enabled (snake_case contract).
    #[serde(default)]
    pub is_lan_enabled: bool,
    /// Whether LAN streaming mode is enabled (camelCase contract).
    #[serde(default, rename = "lanEnabled")]
    pub lan_enabled: bool,
    /// Discovered local network IPv4 address (snake_case contract).
    #[serde(default)]
    pub local_ip: Option<String>,
    /// Discovered local network IPv4 address (camelCase contract).
    #[serde(default, rename = "localIp")]
    pub local_ip_camel: Option<String>,
    /// Full LAN HTTP URL if local IP is available.
    #[serde(default)]
    pub lan_url: Option<String>,
    /// Canonical active streaming URL (`http://<lan_ip>:<port>` when LAN enabled, otherwise `http://127.0.0.1:<port>`).
    #[serde(default, rename = "streamUrl", alias = "stream_url")]
    pub stream_url: String,
}

/// Discovers the local primary LAN IPv4 address via RFC 1122 UDP socket routing table inspection.
///
/// Binds an ephemeral UDP socket to the unspecified IPv4 address and connects to a public
/// routable IPv4 address on port 80 without transmitting any packets, inspecting the
/// kernel-selected source interface address.
#[must_use]
pub fn detect_local_lan_ip() -> Option<String> {
    use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
    let bind_addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0);
    let target_primary = SocketAddrV4::new(Ipv4Addr::new(1, 1, 1, 1), 80);
    let target_fallback = SocketAddrV4::new(Ipv4Addr::new(8, 8, 8, 8), 80);
    let socket = UdpSocket::bind(bind_addr).ok()?;
    if socket.connect(target_primary).is_err() {
        socket.connect(target_fallback).ok()?;
    }
    let local_addr = socket.local_addr().ok()?;
    let ip = local_addr.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        None
    } else {
        Some(ip.to_string())
    }
}

/// Constructs a [`ServerStatusResponse`] from the current [`wavery_config::ServerConfig`] and detected LAN IP.
#[must_use]
pub fn build_server_status_response(
    server_cfg: &wavery_config::ServerConfig,
    detected_ip: Option<String>,
) -> ServerStatusResponse {
    let is_lan = server_cfg.is_lan_enabled();
    let host = server_cfg.host.clone();
    let port = server_cfg.port;
    let lan_url = detected_ip.as_ref().map(|ip| format!("http://{ip}:{port}"));
    let loopback_ip = std::net::Ipv4Addr::LOCALHOST;
    let stream_url = if is_lan {
        lan_url
            .clone()
            .unwrap_or_else(|| format!("http://{loopback_ip}:{port}"))
    } else {
        format!("http://{loopback_ip}:{port}")
    };
    ServerStatusResponse {
        host,
        port,
        is_lan_enabled: is_lan,
        lan_enabled: is_lan,
        local_ip_camel: detected_ip.clone(),
        local_ip: detected_ip,
        lan_url,
        stream_url,
    }
}

/// Queries the current HTTP streaming server status, bind configuration, and local LAN IP.
#[tauri::command]
async fn get_server_status(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ServerStatusResponse, IpcError> {
    let server_cfg = state.config.lock().server.clone();
    let local_ip = detect_local_lan_ip();
    Ok(build_server_status_response(&server_cfg, local_ip))
}

/// Dynamically toggles the embedded HTTP streaming server between loopback (`127.0.0.1`)
/// and LAN (`0.0.0.0`) modes, persisting configuration atomically and rolling back to
/// loopback if binding on all interfaces fails.
pub(crate) async fn apply_server_lan_mode(
    state: &Arc<AppState>,
    enabled: bool,
    custom_config_path: Option<&std::path::Path>,
) -> Result<ServerStatusResponse, IpcError> {
    let cfg_path = match custom_config_path {
        Some(p) => p.to_path_buf(),
        None => default_config_path()?,
    };

    // 1. Stop any currently active in-process server before rebinding
    let was_running = {
        let tx_opt = state.server_shutdown_tx.lock().take();
        if let Some(tx) = tx_opt {
            let _ = tx.send(true);
            true
        } else {
            false
        }
    };
    if let Some(handle) = state.server_abort_handle.lock().take() {
        handle.abort();
    }

    // 2. Apply requested LAN mode to configuration and persist atomically
    let mut updated_config = {
        let mut guard = state.config.lock();
        guard.server.set_lan_enabled(enabled);
        guard.server.sanitize();
        guard.clone()
    };
    save_config_file(&cfg_path, &updated_config)?;

    // 3. Verify socket bind availability when enabling LAN mode (0.0.0.0:port)
    let mut bind_failed = false;
    if enabled {
        let bind_addr = std::net::SocketAddrV4::new(
            std::net::Ipv4Addr::UNSPECIFIED,
            updated_config.server.port,
        );
        let max_attempts = if was_running { 10 } else { 1 };
        let mut bound_ok = false;
        for attempt in 0..max_attempts {
            if let Ok(listener) = std::net::TcpListener::bind(bind_addr) {
                drop(listener);
                bound_ok = true;
                break;
            }
            if attempt + 1 < max_attempts {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
        if !bound_ok {
            bind_failed = true;
        }
    }

    // 4. Atomic rollback to loopback (127.0.0.1) if binding to 0.0.0.0 failed
    if bind_failed {
        updated_config = {
            let mut guard = state.config.lock();
            guard.server.set_lan_enabled(false);
            guard.server.sanitize();
            guard.clone()
        };
        save_config_file(&cfg_path, &updated_config)?;
    }

    // 5. Restart the in-process server if browser client is enabled and library is initialized
    if updated_config.server.enable_browser_client && state.library.is_some() {
        start_in_process_server(state);
    }

    let local_ip = detect_local_lan_ip();
    Ok(build_server_status_response(&updated_config.server, local_ip))
}

/// Enables or disables LAN streaming (`0.0.0.0` vs `127.0.0.1`), dynamically restarting
/// the embedded HTTP server and persisting the updated configuration atomically.
#[tauri::command]
async fn set_server_lan_mode(
    enabled: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ServerStatusResponse, IpcError> {
    apply_server_lan_mode(state.inner(), enabled, None).await
}

/// Queries the cached 100-point waveform peak envelope for a track by ID.
pub(crate) async fn query_track_waveform(
    state: &AppState,
    track_id: &str,
) -> Result<Option<WaveformData>, IpcError> {
    let trimmed = track_id.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.get_waveform(trimmed).await.map_err(IpcError::from)
}

/// Returns the pre-computed 100-point waveform peak envelope for a given track ID, if cached.
#[tauri::command]
async fn get_waveform(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<WaveformData>, IpcError> {
    query_track_waveform(&state, &track_id).await
}

#[tauri::command]
async fn save_config(
    mut config: Config,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    config.sanitize();
    let cfg_path = default_config_path()?;
    save_config_file(&cfg_path, &config)?;
    let old_host = {
        let mut guard = state.config.lock();
        let old = guard.server.host.clone();
        *guard = config.clone();
        old
    };
    if old_host != config.server.host {
        let _ = apply_server_lan_mode(
            state.inner(),
            config.server.is_lan_enabled(),
            Some(&cfg_path),
        )
        .await?;
    }
    {
        let mut player_guard = state.player.lock().await;
        if let Some(player) = player_guard.as_mut() {
            player.set_crossfade(Duration::from_millis(
                config.audio.crossfade_duration_ms as u64,
            ));
            player.set_replay_gain_mode(&config.audio.replay_gain_mode);
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
            player.set_crossfade(Duration::from_millis(
                imported_config.audio.crossfade_duration_ms as u64,
            ));
            player.set_replay_gain_mode(&imported_config.audio.replay_gain_mode);
        }
    }
    Ok(imported_config)
}

#[tauri::command]
async fn export_config_json(state: tauri::State<'_, Arc<AppState>>) -> Result<String, IpcError> {
    let config = {
        let guard = state.config.lock();
        guard.clone()
    };
    let json_str = serde_json::to_string_pretty(&config)?;
    Ok(json_str)
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), IpcError> {
    if url.starts_with("http://") || url.starts_with("https://") {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("rundll32")
                .args(["url.dll,FileProtocolHandler", &url])
                .spawn();
        }
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("open").arg(&url).spawn();
        }
        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
        }
    }
    Ok(())
}

#[tauri::command]
async fn show_desktop_notification(
    title: String,
    body: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), IpcError> {
    #[cfg(target_os = "linux")]
    {
        let _ = app_handle;
        let (tx, rx) = tokio::sync::oneshot::channel();
        std::thread::spawn(move || {
            let mut notification = notify_rust::Notification::new();
            notification.summary(&title);
            if let Some(ref b) = body {
                notification.body(b);
            }
            notification.auto_icon();
            let res = notification
                .show()
                .map_err(|e| IpcError::Task(e.to_string()));
            let _ = tx.send(res.map(|_| ()));
        });
        rx.await.map_err(|e| IpcError::Task(e.to_string()))?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        std::thread::spawn(move || {
            use tauri_plugin_notification::NotificationExt;
            let mut builder = app_handle.notification().builder().title(&title);
            if let Some(ref b) = body {
                builder = builder.body(b);
            }
            let res = builder.show().map_err(|e| IpcError::Task(e.to_string()));
            let _ = tx.send(res);
        });
        rx.await.map_err(|e| IpcError::Task(e.to_string()))?
    }
}

#[tauri::command]
async fn export_config_to_file(content: String) -> Result<bool, IpcError> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("JSON Files", &["json"])
        .set_file_name("wavery_config.json")
        .set_title("Save Wavery Configuration")
        .save_file()
        .await;

    if let Some(file) = file {
        file.write(content.as_bytes())
            .await
            .map_err(|e| IpcError::Task(e.to_string()))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn update_discord_presence(
    payload: wavery_server::discord::PresencePayload,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let handle = Arc::clone(&state.discord_handle);
    tokio::task::spawn_blocking(move || {
        let lock = handle.blocking_read();
        let mut rpc = match lock.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        rpc.set_activity(&payload);
    })
    .await
    .map_err(|e| IpcError::Task(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn clear_discord_presence(state: tauri::State<'_, Arc<AppState>>) -> Result<(), IpcError> {
    let handle = Arc::clone(&state.discord_handle);
    tokio::task::spawn_blocking(move || {
        let lock = handle.blocking_read();
        let mut rpc = match lock.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        rpc.clear_activity();
    })
    .await
    .map_err(|e| IpcError::Task(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn get_discord_status(
    custom_app_id: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<wavery_server::discord::DiscordStatusPayload, IpcError> {
    let handle = Arc::clone(&state.discord_handle);
    let status = tokio::task::spawn_blocking(move || {
        let lock = handle.blocking_read();
        let mut rpc = match lock.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Some(ref id) = custom_app_id {
            rpc.set_app_id(Some(id));
        }
        rpc.status()
    })
    .await
    .map_err(|e| IpcError::Task(e.to_string()))?;
    Ok(status)
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

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let p = PathBuf::from(local_app_data)
                .join("Wavery")
                .join("wavery-server.exe");
            if p.is_file() {
                return Some(p);
            }
        }
        let prog_files = PathBuf::from(r"C:\Program Files\Wavery\wavery-server.exe");
        if prog_files.is_file() {
            return Some(prog_files);
        }
    }

    None
}

fn open_browser_url(url: &str) -> Result<(), std::io::Error> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 1. Try launching through default Windows Shell via cmd.exe start
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/c", "start", "", url]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let mut spawned = cmd.spawn().is_ok();

        // 2. Fallback to explorer.exe
        if !spawned {
            let mut exp = std::process::Command::new("explorer");
            exp.arg(url);
            spawned = exp.spawn().is_ok();
        }

        // 3. Fallback to PowerShell Start-Process
        if !spawned {
            let mut ps = std::process::Command::new("powershell");
            ps.args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &format!("Start-Process '{}'", url),
            ]);
            ps.creation_flags(CREATE_NO_WINDOW);
            spawned = ps.spawn().is_ok();
        }

        if !spawned {
            return Err(std::io::Error::other(format!(
                "Failed to launch default web browser for '{url}'"
            )));
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
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
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-f", "wavery-server"])
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

fn notify_server_quit_sync(host: &str, port: u16) {
    use std::io::Write;
    use std::net::TcpStream;
    let addr = format!("{}:{}", host, port);
    if let Ok(addr_sock) = addr.parse() {
        if let Ok(mut stream) =
            TcpStream::connect_timeout(&addr_sock, std::time::Duration::from_millis(300))
        {
            let req = format!(
                "POST /api/app/quit HTTP/1.1\r\nHost: {}:{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                host, port
            );
            let _ = stream.write_all(req.as_bytes());
            let _ = stream.flush();
        }
    } else if let Ok(mut stream) = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(300),
    ) {
        let req = format!(
            "POST /api/app/quit HTTP/1.1\r\nHost: {}:{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            host, port
        );
        let _ = stream.write_all(req.as_bytes());
        let _ = stream.flush();
    }
}

async fn notify_server_close_web_async(host: &str, port: u16) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;
    let addr = format!("{}:{}", host, port);
    let target = if let Ok(sock) = addr.parse() {
        sock
    } else {
        std::net::SocketAddr::from(([127, 0, 0, 1], port))
    };

    if let Ok(Ok(mut stream)) = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        TcpStream::connect(target),
    )
    .await
    {
        let req = format!(
            "POST /api/app/close-web HTTP/1.1\r\nHost: {}:{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            host, port
        );
        let _ = stream.write_all(req.as_bytes()).await;
        let _ = stream.flush().await;

        // Await server response to ensure broadcast was processed before closing connection
        let mut resp_buf = [0u8; 512];
        let _ = tokio::time::timeout(
            std::time::Duration::from_millis(1000),
            stream.read(&mut resp_buf),
        )
        .await;
    }
}

fn resolve_static_dir(root: &std::path::Path) -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    [
        Some(root.join("ui/dist")),
        Some(root.join("dist")),
        exe_dir.as_ref().map(|d| d.join("dist")),
        exe_dir.as_ref().map(|d| d.join("../dist")),
        exe_dir.as_ref().map(|d| d.join("resources/dist")),
        exe_dir.as_ref().map(|d| d.join("resources")),
        exe_dir.as_ref().map(|d| d.join("_up_/dist")),
        Some(PathBuf::from("ui/dist")),
        Some(PathBuf::from("dist")),
    ]
    .into_iter()
    .flatten()
    .find(|p| p.exists())
}

fn start_in_process_server(state: &Arc<AppState>) {
    let Some(shared_lib) = state.library.clone() else {
        return;
    };

    let (server_host, server_port) = {
        let cfg = state.config.lock();
        (cfg.server.host.clone(), cfg.server.port)
    };
    let addr = format!("{}:{}", server_host, server_port);

    // If port is already open (e.g. standalone wavery-server or active server is running), skip binding
    if std::net::TcpStream::connect(&addr).is_ok() {
        return;
    }

    // If port is unreachable but shutdown_tx or abort_handle are still held, reset stale state
    if let Some(tx) = state.server_shutdown_tx.lock().take() {
        let _ = tx.send(true);
    }
    if let Some(handle) = state.server_abort_handle.lock().take() {
        handle.abort();
    }

    let root = find_project_root();
    let static_dir = resolve_static_dir(&root);
    let config = state.config.lock().clone();
    let cfg_path =
        wavery_config::default_config_path().unwrap_or_else(|_| PathBuf::from("config.toml"));

    let server_app_state = Arc::new(wavery_server::AppState::with_config_and_discord(
        shared_lib,
        wavery_library::LoftyMetadataReader::new(),
        static_dir,
        config,
        cfg_path,
        state.discord_handle.clone(),
    ));

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    *state.server_shutdown_tx.lock() = Some(shutdown_tx);

    let state_weak = Arc::downgrade(state);
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) =
            wavery_server::start_server_with_shutdown(server_app_state, &addr, shutdown_rx).await
        {
            eprintln!(
                "[Wavery] In-process web server terminated on {}: {}",
                addr, e
            );
        }
        if let Some(state_arc) = state_weak.upgrade() {
            *state_arc.server_shutdown_tx.lock() = None;
            *state_arc.server_abort_handle.lock() = None;
        }
    });

    *state.server_abort_handle.lock() = Some(handle);
}

async fn ensure_server_running(state: &Arc<AppState>) {
    let (server_host, server_port) = {
        let cfg = state.config.lock();
        (cfg.server.host.clone(), cfg.server.port)
    };
    let addr = format!("{}:{}", server_host, server_port);

    // 1. Fast check if server is already reachable
    if std::net::TcpStream::connect(&addr).is_ok() {
        return;
    }

    // 2. Start in-process server
    start_in_process_server(state);

    // 3. Wait briefly for in-process server to bind
    for _ in 0..20 {
        if std::net::TcpStream::connect(&addr).is_ok() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    // 4. Fallback: try external process if in-process didn't bind
    let _ = spawn_detached_server_process(state);
    for _ in 0..20 {
        if std::net::TcpStream::connect(&addr).is_ok() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

fn spawn_detached_server_process(state: &AppState) -> Result<(), std::io::Error> {
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

    // Suppress secondary tray icon in wavery-server since Tauri provides the master desktop tray
    cmd.env("WAVERY_NO_TRAY", "1");

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

    let child = cmd.spawn()?;
    let mut guard = state.server_process.lock();
    *guard = Some(child);
    Ok(())
}

/// Forcefully terminates all spawned background child processes and subprocess trees.
fn kill_all_subprocesses(state: &AppState) {
    // 0. Gracefully stop in-process web server
    if let Some(tx) = state.server_shutdown_tx.lock().take() {
        let _ = tx.send(true);
    }
    if let Some(handle) = state.server_abort_handle.lock().take() {
        handle.abort();
    }

    // 1. Gracefully notify wavery-server to exit
    let (server_host, server_port) = {
        let config = state.config.lock();
        (config.server.host.clone(), config.server.port)
    };
    notify_server_quit_sync(&server_host, server_port);

    // 2. Terminate tracked server child process and its child tree
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
                .args(["-9", "-P", &pid.to_string()])
                .status();
            let _ = std::process::Command::new("kill")
                .args(["-9", &format!("-{}", pid)])
                .status();
        }
    }

    // 3. Clean up any remaining background server processes
    terminate_server_instances();
}

#[tauri::command]
async fn get_saved_session() -> Result<Option<wavery_core::models::PlaybackSession>, IpcError> {
    let path = wavery_config::default_session_path()?;
    let session = wavery_config::load_session(&path)?;
    Ok(session)
}

#[tauri::command]
async fn save_session_state(session: wavery_core::models::PlaybackSession) -> Result<(), IpcError> {
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

    // 4. Ensure web server is active and reachable
    ensure_server_running(state.inner()).await;

    // 5. Launch browser to target url
    if let Err(e) = open_browser_url(&target_url) {
        eprintln!("[Wavery] Failed to open default browser to {target_url}: {e}");
        return Err(IpcError::Task(format!(
            "Failed to open default web browser: {e}"
        )));
    }

    // 6. Hide the window (music already stopped) — Tauri stays alive in the tray.
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.hide();
    }

    Ok(())
}

#[tauri::command]
async fn get_liked_tracks(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.get_liked_tracks()?)
}

#[tauri::command]
async fn get_liked_track_ids(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<String>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.get_liked_track_ids()?)
}

#[tauri::command]
async fn toggle_like(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<bool, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.toggle_like(&track_id)?)
}

#[tauri::command]
async fn like_track(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.like_track(&track_id)?;
    Ok(())
}

#[tauri::command]
async fn unlike_track(
    track_id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.unlike_track(&track_id)?;
    Ok(())
}

#[tauri::command]
async fn list_playlists(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Playlist>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.list_playlists()?)
}

#[tauri::command]
async fn create_playlist(
    name: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Playlist, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.create_playlist(&name)?)
}

#[tauri::command]
async fn get_playlist(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<Playlist>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.get_playlist(&id)?)
}

#[tauri::command]
async fn get_playlist_tracks(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<Track>, IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    Ok(lib.get_playlist_tracks(&id)?)
}

#[tauri::command]
async fn rename_playlist(
    id: String,
    name: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.rename_playlist(&id, &name)?;
    Ok(())
}

#[tauri::command]
async fn delete_playlist(
    id: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
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
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
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
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.remove_track_from_playlist(&playlist_id, &track_id)?;
    Ok(())
}

#[tauri::command]
async fn save_playlist(
    playlist: Playlist,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let lib_arc = state
        .library
        .as_ref()
        .ok_or(IpcError::LibraryNotInitialized)?;
    let lib = lib_arc.lock().await;
    lib.save_playlist(&playlist)?;
    Ok(())
}

#[tauri::command]
async fn minimize_window(window: tauri::WebviewWindow) -> Result<(), IpcError> {
    let _ = window.emit(
        "window-state-changed",
        serde_json::json!({
            "isMaximized": false,
            "isMinimized": true,
            "isFullscreen": false,
            "width": 0,
            "height": 0
        }),
    );
    window
        .minimize()
        .map_err(|e| IpcError::Task(e.to_string()))?;
    Ok(())
}

#[tauri::command]
async fn toggle_maximize_window(window: tauri::WebviewWindow) -> Result<bool, IpcError> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max {
        window
            .unmaximize()
            .map_err(|e| IpcError::Task(e.to_string()))?;
        let _ = window.emit(
            "window-state-changed",
            serde_json::json!({
                "isMaximized": false,
                "isMinimized": false,
                "isFullscreen": false
            }),
        );
        Ok(false)
    } else {
        window
            .maximize()
            .map_err(|e| IpcError::Task(e.to_string()))?;
        let _ = window.emit(
            "window-state-changed",
            serde_json::json!({
                "isMaximized": true,
                "isMinimized": false,
                "isFullscreen": false
            }),
        );
        Ok(true)
    }
}

#[tauri::command]
async fn is_window_maximized(window: tauri::WebviewWindow) -> Result<bool, IpcError> {
    Ok(window.is_maximized().unwrap_or(false))
}

#[tauri::command]
async fn toggle_fullscreen_window(window: tauri::WebviewWindow) -> Result<bool, IpcError> {
    let is_fs = window.is_fullscreen().unwrap_or(false);
    let next_fs = !is_fs;
    window
        .set_fullscreen(next_fs)
        .map_err(|e| IpcError::Task(e.to_string()))?;
    let _ = window.emit(
        "window-state-changed",
        serde_json::json!({
            "isFullscreen": next_fs
        }),
    );
    Ok(next_fs)
}

#[tauri::command]
async fn is_window_fullscreen(window: tauri::WebviewWindow) -> Result<bool, IpcError> {
    Ok(window.is_fullscreen().unwrap_or(false))
}

#[tauri::command]
async fn close_app_window(
    window: tauri::WebviewWindow,
    _app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let minimize_to_tray = {
        let cfg = state.config.lock();
        cfg.general.minimize_to_tray
    };
    if minimize_to_tray {
        let _ = window.hide();
    } else {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
fn start_header_drag(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), IpcError> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max {
        let max_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 1920,
            height: 1080,
        });

        #[cfg(target_os = "windows")]
        let (phys_cur_x, phys_cur_y) = {
            #[repr(C)]
            struct Point {
                x: i32,
                y: i32,
            }
            extern "system" {
                fn GetCursorPos(lp_point: *mut Point) -> i32;
            }
            let mut pt = Point { x: 0, y: 0 };
            unsafe {
                GetCursorPos(&mut pt);
            }
            (pt.x, pt.y)
        };

        #[cfg(not(target_os = "windows"))]
        let (phys_cur_x, phys_cur_y) = (550, 25);

        // Desired restored floating window dimensions (1100x720 default, clamped to safe floating bounds)
        let saved = *state.last_normal_size.lock();
        let target_w = if saved.0 >= 800 && saved.0 < max_size.width {
            saved.0
        } else {
            1100
        }
        .min(max_size.width.saturating_sub(100))
        .max(800);

        let target_h = if saved.1 >= 500 && saved.1 < max_size.height {
            saved.1
        } else {
            720
        }
        .min(max_size.height.saturating_sub(100))
        .max(500);

        let ratio = if max_size.width > 0 {
            ((phys_cur_x as f64) / (max_size.width as f64)).clamp(0.1, 0.9)
        } else {
            0.5
        };

        let new_x = (phys_cur_x as f64 - (target_w as f64 * ratio)).round() as i32;
        let new_y = (phys_cur_y - 25).max(0);

        #[cfg(target_os = "windows")]
        if let Ok(hwnd) = window.hwnd() {
            extern "system" {
                fn GetWindowLongPtrW(hwnd: isize, n_index: i32) -> isize;
                fn SetWindowLongPtrW(hwnd: isize, n_index: i32, new_long: isize) -> isize;
                fn SetWindowPos(
                    hwnd: isize,
                    hwnd_insert_after: isize,
                    x: i32,
                    y: i32,
                    cx: i32,
                    cy: i32,
                    u_flags: u32,
                ) -> i32;
            }
            const GWL_STYLE: i32 = -16;
            const WS_MAXIMIZE: isize = 0x01000000;
            const SWP_NOZORDER: u32 = 0x0004;
            const SWP_NOACTIVATE: u32 = 0x0010;
            const SWP_FRAMECHANGED: u32 = 0x0020;
            const SWP_NOCOPYBITS: u32 = 0x0100;

            unsafe {
                let style = GetWindowLongPtrW(hwnd.0 as isize, GWL_STYLE);
                if (style & WS_MAXIMIZE) != 0 {
                    SetWindowLongPtrW(hwnd.0 as isize, GWL_STYLE, style & !WS_MAXIMIZE);
                }
                SetWindowPos(
                    hwnd.0 as isize,
                    0,
                    new_x,
                    new_y,
                    target_w as i32,
                    target_h as i32,
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_NOCOPYBITS,
                );
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = window.unmaximize();
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: target_w,
                height: target_h,
            }));
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: new_x,
                y: new_y,
            }));
        }

        let _ = window.emit(
            "window-state-changed",
            serde_json::json!({
                "isMaximized": false,
                "isMinimized": false,
                "isFullscreen": false,
                "width": target_w,
                "height": target_h
            }),
        );
    }

    let _ = window.start_dragging();
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    wavery_config::install_panic_hook("wavery-tauri");
    #[cfg(target_os = "linux")]
    {
        // 1. Window backend: on native Wayland sessions (WAYLAND_DISPLAY set), prioritize native
        // Wayland to leverage zero-latency explicit sync (linux-drm-syncobj-v1). Forcing X11 on
        // Wayland routes the app through Xwayland, which causes severe scaling lag and frame latency.
        if std::env::var("GDK_BACKEND").is_err() {
            if std::env::var("WAYLAND_DISPLAY").is_ok() {
                std::env::set_var("GDK_BACKEND", "wayland,x11");
            } else {
                std::env::set_var("GDK_BACKEND", "x11");
            }
        }

        // 2. Safe default for DMA-BUF renderer: prevents driver deadlocks on older Mesa / NVIDIA
        // without disabling GPU acceleration. Power users can override via WEBKIT_DISABLE_DMABUF_RENDERER=0.
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        // 3. Note: NEVER force WEBKIT_DISABLE_COMPOSITING_MODE=1 by default. Disabling compositing
        // forces WebKit into Cairo CPU software rasterization, turning all CSS blurs and glassmorphism
        // into multi-second CPU bottlenecks and triggering FrameRenderer assertions in WebKitGTK 2.45+.
    }

    let cfg_path = default_config_path().unwrap_or_else(|_| PathBuf::from("config.toml"));
    let config = load_or_create(&cfg_path).unwrap_or_default();

    let mut player = RodioPlayer::try_new().ok();
    if let Some(ref mut p) = player {
        p.set_crossfade(Duration::from_millis(
            config.audio.crossfade_duration_ms as u64,
        ));
        p.set_volume(config.audio.default_volume);
        p.set_replay_gain_mode(&config.audio.replay_gain_mode);
    }
    let library_res = SqliteLibraryManager::new(
        config.library.managed_directory.clone(),
        config.library.database_path.clone(),
    );

    let shared_library = match library_res {
        Ok(mut lib) => {
            lib.set_protected_artists(config.library.protected_artists.clone());
            lib.set_genre_mappings(config.library.genre_mappings.clone());
            Some(Arc::new(AsyncMutex::new(lib)))
        }
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
                match lib
                    .import_directory(&managed_dir, ImportStrategy::Copy)
                    .await
                {
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
        server_shutdown_tx: SyncMutex::new(None),
        server_abort_handle: SyncMutex::new(None),
        discord_handle: wavery_server::discord::new_discord_handle(None),
        last_normal_size: SyncMutex::new((1100, 720)),
        mpris_bridge: Arc::new(AsyncMutex::new(wavery_mpris::ZbusMprisBridge::new())),
    });

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.unminimize();
                }
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(state.clone())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            {
                if let Ok(default_menu) = Menu::default(app.handle()) {
                    let _ = app.set_menu(default_menu);
                }
            }

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

                #[cfg(target_os = "macos")]
                let show_menu_on_left = true;
                #[cfg(not(target_os = "macos"))]
                let show_menu_on_left = false;

                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&tray_menu)
                    .show_menu_on_left_click(show_menu_on_left)
                    .on_menu_event(move |app_handle, event| {
                        match event.id.as_ref() {
                            "open_desktop" | "toggle" => {
                                if let Some(window) = app_handle.get_webview_window("main") {
                                    let _ = window.show();
                                    if window.is_minimized().unwrap_or(false) {
                                        let _ = window.unminimize();
                                    }
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
                                    ensure_server_running(&state_clone).await;
                                    if open_browser_url(&url).is_ok() {
                                        if let Some(window) = app_clone.get_webview_window("main") {
                                            let _ = window.hide();
                                        }
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
                                let app_clone = app_handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = advance_queue_next(&app_clone, &state_clone).await;
                                });
                            }
                            "prev" => {
                                let state_handle = app_handle.state::<Arc<AppState>>();
                                let state_clone = state_handle.inner().clone();
                                let app_clone = app_handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    let current_pos = {
                                        let player_guard = state_clone.player.lock().await;
                                        player_guard
                                            .as_ref()
                                            .map(|p| p.position())
                                            .unwrap_or(Duration::ZERO)
                                    };
                                    let _ = advance_queue_previous(
                                        current_pos.as_secs_f64(),
                                        &app_clone,
                                        &state_clone,
                                    )
                                    .await;
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

                                    // 1. Send signal to desktop webview window and destroy it
                                    let _ = app_clone.emit("close-web-page", ());
                                    if let Some(window) = app_clone.get_webview_window("main") {
                                        let _ = window.emit("close-web-page", ());
                                        let _ = window.destroy();
                                    }

                                    // 2. Send signal to browser web page via wavery-server
                                    let (server_host, server_port) = {
                                        let config = state_clone.config.lock();
                                        (config.server.host.clone(), config.server.port)
                                    };
                                    notify_server_close_web_async(&server_host, server_port).await;

                                    // 3. Grace period for active web clients to process signal
                                    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

                                    kill_all_subprocesses(&state_clone);
                                    terminate_server_instances();
                                    app_clone.exit(0);
                                });
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, _event| {
                        #[cfg(not(target_os = "macos"))]
                        match _event {
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            }
                            | TrayIconEvent::DoubleClick {
                                button: MouseButton::Left,
                                ..
                            } => {
                                let app = tray.app_handle();
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    if window.is_minimized().unwrap_or(false) {
                                        let _ = window.unminimize();
                                    }
                                    let _ = window.set_focus();
                                }
                            }
                            _ => {}
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

            // Start background web server if enabled in configuration
            if config.server.enable_browser_client {
                start_in_process_server(&state);
            }

            // Initialize Linux MPRIS D-Bus integration
            #[cfg(target_os = "linux")]
            if config.general.enable_mpris {
                let bridge_conn = Arc::clone(&state.mpris_bridge);
                tauri::async_runtime::spawn(async move {
                    let mut b = bridge_conn.lock().await;
                    if let Err(e) = b.try_connect_dbus().await {
                        eprintln!("[Wavery] MPRIS D-Bus registration notice: {e}");
                    }
                });

                let bridge_poll = Arc::clone(&state.mpris_bridge);
                let state_mpris = Arc::clone(&state);
                let app_handle_mpris = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut interval = tokio::time::interval(Duration::from_millis(100));
                    loop {
                        interval.tick().await;
                        let cmds = {
                            let mut b = bridge_poll.lock().await;
                            b.poll_events().await
                        };
                        for cmd in cmds {
                            match cmd {
                                wavery_core::traits::MprisCommand::Play => {
                                    let mut p = state_mpris.player.lock().await;
                                    if let Some(player) = p.as_mut() {
                                        let _ = player.play();
                                    }
                                }
                                wavery_core::traits::MprisCommand::Pause => {
                                    let mut p = state_mpris.player.lock().await;
                                    if let Some(player) = p.as_mut() {
                                        let _ = player.pause();
                                    }
                                }
                                wavery_core::traits::MprisCommand::TogglePlayPause => {
                                    let mut p = state_mpris.player.lock().await;
                                    if let Some(player) = p.as_mut() {
                                        if player.state() == PlaybackState::Playing {
                                            let _ = player.pause();
                                        } else {
                                            let _ = player.play();
                                        }
                                    }
                                }
                                wavery_core::traits::MprisCommand::Stop => {
                                    let mut p = state_mpris.player.lock().await;
                                    if let Some(player) = p.as_mut() {
                                        let _ = player.stop();
                                    }
                                }
                                wavery_core::traits::MprisCommand::Next => {
                                    let _ = advance_queue_next(&app_handle_mpris, &state_mpris).await;
                                }
                                wavery_core::traits::MprisCommand::Previous => {
                                    let cur_pos = {
                                        let p = state_mpris.player.lock().await;
                                        p.as_ref().map(|x| x.position()).unwrap_or(Duration::ZERO)
                                    };
                                    let _ = advance_queue_previous(
                                        cur_pos.as_secs_f64(),
                                        &app_handle_mpris,
                                        &state_mpris,
                                    )
                                    .await;
                                }
                                wavery_core::traits::MprisCommand::Seek(offset) => {
                                    let mut p = state_mpris.player.lock().await;
                                    if let Some(player) = p.as_mut() {
                                        let target = player.position().saturating_add(offset);
                                        let _ = player.seek(target);
                                    }
                                }
                                wavery_core::traits::MprisCommand::SetPosition(pos) => {
                                    let mut p = state_mpris.player.lock().await;
                                    if let Some(player) = p.as_mut() {
                                        let _ = player.seek(pos);
                                    }
                                }
                                wavery_core::traits::MprisCommand::SetVolume(vol) => {
                                    let mut p = state_mpris.player.lock().await;
                                    if let Some(player) = p.as_mut() {
                                        player.set_volume(vol.clamp(0.0, 1.0));
                                    }
                                }
                            }
                            sync_mpris_state(&state_mpris).await;
                        }
                    }
                });
            }

            // Ensure main window has proper taskbar restore style flags and is shown on startup
            if let Some(window) = app.get_webview_window("main") {
                let win_icon = app.default_window_icon().cloned().or_else(|| {
                    tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")).ok()
                });
                if let Some(icon) = win_icon {
                    let _ = window.set_icon(icon);
                }
                #[cfg(target_os = "windows")]
                if let Ok(hwnd) = window.hwnd() {
                    extern "system" {
                        fn GetWindowLongW(hwnd: isize, n_index: i32) -> i32;
                        fn SetWindowLongW(hwnd: isize, n_index: i32, new_long: i32) -> i32;
                    }
                    const GWL_STYLE: i32 = -16;
                    const WS_MINIMIZEBOX: i32 = 0x00020000;
                    const WS_MAXIMIZEBOX: i32 = 0x00010000;
                    const WS_SYSMENU: i32 = 0x00080000;

                    unsafe {
                        let current_style = GetWindowLongW(hwnd.0 as isize, GWL_STYLE);
                        SetWindowLongW(
                            hwnd.0 as isize,
                            GWL_STYLE,
                            current_style | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU,
                        );
                    }
                }

                #[cfg(target_os = "windows")]
                let _ = window.with_webview(|webview| {
                    unsafe {
                        use webview2_com::Microsoft::Web::WebView2::Win32::*;
                        use windows_core::Interface;
                        let controller = webview.controller();
                        if let Ok(core) = controller.CoreWebView2() {
                            if let Ok(settings) = core.Settings() {
                                let _ = settings.SetAreDefaultContextMenusEnabled(false);
                                let _ = settings.SetAreDevToolsEnabled(false);
                                let _ = settings.SetIsStatusBarEnabled(false);
                                let _ = settings.SetIsZoomControlEnabled(false);
                                let _ = settings.SetIsBuiltInErrorPageEnabled(false);
                                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                                    let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                                }
                            }
                        }
                    }
                });

                let _ = window.show();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Resized(size) = event {
                let is_max = window.is_maximized().unwrap_or(false);
                if !is_max {
                    let is_monitor_size = if let Ok(Some(mon)) = window.current_monitor() {
                        let m_size = mon.size();
                        size.width >= m_size.width && size.height >= m_size.height
                    } else {
                        false
                    };
                    if !is_monitor_size {
                        if let Some(state_handle) = window.app_handle().try_state::<Arc<AppState>>() {
                            if size.width >= 800 && size.height >= 500 && size.width <= 1600 && size.height <= 1000 {
                                *state_handle.last_normal_size.lock() = (size.width, size.height);
                            }
                        }
                    }
                }
            }

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
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_tracks,
            get_albums,
            get_artists,
            get_genres,
            get_album_details,
            get_artist_details,
            delete_track,
            import_file,
            import_folder,
            pick_file,
            pick_folder,
            pick_playlist_file,
            import_playlist_file,
            play_track,
            sync_queue,
            queue_set_context,
            queue_add_user,
            queue_play_next,
            queue_remove_user_track,
            queue_reorder_user,
            queue_clear_user,
            queue_next,
            queue_previous,
            queue_jump_to_index,
            queue_jump_to_context_track,
            queue_jump_to_user_track,
            queue_set_shuffle,
            queue_set_loop_mode,
            queue_set_autoplay,
            queue_clear,
            queue_get_state,
            get_autoplay_next,
            pause_playback,
            resume_playback,
            stop_playback,
            seek_playback,
            set_volume,
            get_status,
            search_tracks,
            get_artwork,
            get_waveform,
            get_config,
            get_server_status,
            set_server_lan_mode,
            save_config,
            import_config_json,
            export_config_json,
            update_track_metadata,
            update_artist_metadata,
            update_album_metadata,
            rebuild_library,
            vacuum_library,
            get_database_stats,
            check_database_health,
            prune_missing_tracks,
            backup_database,
            reveal_database_location,
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
            save_playlist,
            update_discord_presence,
            clear_discord_presence,
            get_discord_status,
            minimize_window,
            toggle_maximize_window,
            is_window_maximized,
            toggle_fullscreen_window,
            is_window_fullscreen,
            close_app_window,
            start_header_drag,
            open_external_url,
            export_config_to_file,
            show_desktop_notification,
            parse_lrc_content,
            find_active_lyric_line,
            score_lyric_candidates
        ])
        .build(tauri::generate_context!())?;

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            // Only allow the process to stay alive when code is None (system window closure)
            // AND minimize_to_tray is enabled. If minimize_to_tray is disabled, allow process exit.
            if code.is_none() {
                let minimize_to_tray = app_handle
                    .try_state::<Arc<AppState>>()
                    .map(|s| s.config.lock().general.minimize_to_tray)
                    .unwrap_or(false);
                if minimize_to_tray {
                    api.prevent_exit();
                }
            }
        }
        tauri::RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                kill_all_subprocesses(&state);
                terminate_server_instances();
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
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
    fn test_artwork_cache_remove() {
        let mut cache = ArtworkCache::new(5);
        cache.insert("track1".into(), Some("art1".into()));
        cache.insert("track2".into(), Some("art2".into()));
        assert_eq!(cache.len(), 2);

        cache.remove("track1");
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.get("track1"), None);
        assert_eq!(cache.get("track2"), Some(Some("art2".into())));

        // Removing non-existent key is a safe no-op
        cache.remove("track_non_existent");
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_artwork_cache_large_scale_bounding_eviction() {
        let capacity = MAX_ARTWORK_CACHE_ENTRIES; // 64
        let mut cache = ArtworkCache::new(capacity);

        // Insert 1000 entries
        for i in 0..1000 {
            cache.insert(
                format!("track_{i}"),
                Some(format!("data:image/jpeg;base64,{i}")),
            );
            assert!(cache.len() <= capacity);
        }

        assert_eq!(cache.len(), capacity);

        // The oldest 936 entries (0..936) must have been evicted in strict FIFO order
        for i in 0..(1000 - capacity) {
            assert_eq!(
                cache.get(&format!("track_{i}")),
                None,
                "track_{i} should be evicted"
            );
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
            handle
                .join()
                .expect("thread finished without panic or deadlock");
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
            assert_eq!(
                serialized, expected_json,
                "JSON serialization format mismatch"
            );

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
        assert!(
            ipc_err2.to_string().contains("resolution failed")
                || ipc_err2.to_string().contains("Configuration error")
        );

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
            let deserialized: Config =
                serde_json::from_str(&json_str).expect("JSON deserialization succeeds");

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
            (
                "{\"audio\": {\"backend\": \"non_existent_engine\"}}",
                "invalid enum backend",
            ),
            (
                "{\"theme\": {\"mode\": \"cyberpunk_neon\"}}",
                "invalid enum theme mode",
            ),
            (
                "{\"server\": {\"port\": \"not_a_number\"}}",
                "type mismatch for u16",
            ),
            (
                "{\"general\": {\"notifications_enabled\": \"yes\"}}",
                "type mismatch for bool",
            ),
            (
                "{\"audio\": {\"default_volume\": \"loud\"}}",
                "type mismatch for f32",
            ),
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
            let res = lib
                .import_directory(&non_existent, ImportStrategy::Copy)
                .await;
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
            server_shutdown_tx: SyncMutex::new(None),
            server_abort_handle: SyncMutex::new(None),
            discord_handle: wavery_server::discord::new_discord_handle(None),
            last_normal_size: SyncMutex::new((1100, 720)),
            mpris_bridge: Arc::new(AsyncMutex::new(wavery_mpris::ZbusMprisBridge::new())),
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
                lyrics: None,
                ..Default::default()
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

        assert_eq!(
            queue.current_track().map(|t| t.id.clone()),
            Some(track1.id.clone())
        );

        // Simulate "next" tray menu action
        let next_track = queue.next().cloned();
        assert_eq!(next_track.map(|t| t.id.clone()), Some(track2.id.clone()));

        // Simulate "prev" tray menu action with position > 3.0s (restarts current track)
        let restarted = queue.previous(Duration::from_secs(5)).cloned();
        assert_eq!(restarted.map(|t| t.id.clone()), Some(track2.id.clone()));
        assert_eq!(queue.current_index(), Some(1));

        // Simulate "prev" tray menu action with position <= 3.0s (steps back to previous)
        let prev_track = queue.previous(Duration::from_secs(1)).cloned();
        assert_eq!(prev_track.map(|t| t.id.clone()), Some(track1.id.clone()));
        assert_eq!(queue.current_index(), Some(0));
    }

    #[test]
    fn test_queue_state_snapshot_camel_case_serialization_and_roundtrip() {
        let track = make_test_track("t1", "/music/t1.flac");
        let snapshot = QueueStateSnapshot {
            current_track: Some(track.clone()),
            current_index: Some(0),
            user_queue: vec![track.clone()],
            context_queue: vec![track.clone()],
            context_index: Some(0),
            queue: vec![track.clone()],
            is_shuffle: true,
            loop_mode: LoopMode::Queue,
            is_autoplay: true,
            history: vec![track],
            shuffle_indices: vec![0],
            shuffle_pos: 0,
        };

        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(json.contains("\"currentTrack\":{"));
        assert!(json.contains("\"currentIndex\":0"));
        assert!(json.contains("\"userQueue\":["));
        assert!(json.contains("\"contextQueue\":["));
        assert!(json.contains("\"contextIndex\":0"));
        assert!(json.contains("\"isShuffle\":true"));
        assert!(json.contains("\"loopMode\":\"Queue\""));
        assert!(json.contains("\"isAutoplay\":true"));

        // Roundtrip deserialization
        let deserialized: QueueStateSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.current_index, Some(0));
        assert!(deserialized.is_shuffle);
        assert!(deserialized.is_autoplay);
        assert_eq!(deserialized.loop_mode, LoopMode::Queue);

        // Dual snake_case deserialization
        let snake_json = r#"{
            "current_track": null,
            "current_index": 2,
            "user_queue": [],
            "context_queue": [],
            "context_index": 1,
            "queue": [],
            "is_shuffle": false,
            "loop_mode": "Track",
            "is_autoplay": false,
            "history": []
        }"#;
        let snake_parsed: QueueStateSnapshot = serde_json::from_str(snake_json).unwrap();
        assert_eq!(snake_parsed.current_index, Some(2));
        assert_eq!(snake_parsed.context_index, Some(1));
        assert_eq!(snake_parsed.loop_mode, LoopMode::Track);
    }

    #[tokio::test]
    async fn test_queue_autoplay_candidate_selection_via_ipc() {
        let mut queue = StandardQueueManager::new();
        let curr = make_test_track("curr", "/music/curr.flac");
        let mut cand1 = make_test_track("cand1", "/music/cand1.flac");
        cand1.metadata.artist = Some("Test Artist".into()); // matches current artist (+50)
        let mut cand2 = make_test_track("cand2", "/music/cand2.flac");
        cand2.metadata.artist = Some("Different Artist".into());
        cand2.metadata.genre = Some("Other Genre".into());

        queue.set_queue(vec![curr.clone()], 0);
        let pool = vec![cand1.clone(), cand2.clone()];

        let chosen = queue.select_autoplay_candidate(&pool);
        assert!(chosen.is_some());
        assert_eq!(chosen.unwrap().id, "cand1");
    }

    #[test]
    fn test_library_aggregation_ipc_models_and_camel_case_serialization() {
        let album = Album {
            title: "Random Access Memories".into(),
            artist: "Daft Punk".into(),
            album_artist: Some("Daft Punk".into()),
            is_compilation: false,
            year: Some(2013),
            artwork_track_id: Some("track-1".into()),
            tracks: Vec::new(),
            track_count: 13,
            total_duration: Duration::from_secs(4460),
            total_duration_secs: 4460,
        };

        let json = serde_json::to_string(&album).unwrap();
        assert!(json.contains("\"totalDurationSecs\":4460"));
        assert!(json.contains("\"isCompilation\":false"));
        assert!(json.contains("\"trackCount\":13"));
        assert!(json.contains("\"artworkTrackId\":\"track-1\""));
        assert!(json.contains("\"albumArtist\":\"Daft Punk\""));

        let artist = Artist {
            name: "Daft Punk".into(),
            albums: vec![album],
            appears_on: Vec::new(),
            tracks: Vec::new(),
            album_count: 1,
            track_count: 13,
            artwork_track_id: Some("track-1".into()),
        };

        let artist_json = serde_json::to_string(&artist).unwrap();
        assert!(artist_json.contains("\"albumCount\":1"));
        assert!(artist_json.contains("\"trackCount\":13"));
        assert!(artist_json.contains("\"appearsOn\":[]"));

        let genre = GenreInfo {
            name: "Electronic".into(),
            tracks: Vec::new(),
            track_count: 13,
        };
        let genre_json = serde_json::to_string(&genre).unwrap();
        assert!(genre_json.contains("\"trackCount\":13"));
    }

    #[tokio::test]
    async fn test_lyrics_ipc_commands_and_camel_case_serialization() {
        let raw = "[ti: Creep]\n[ar: Radiohead]\n[offset: +250]\n[00:10.00] When you were here before\n[00:20.00] Couldn't look you in the eye";
        let parsed = parse_lrc_content(raw.to_string()).await.unwrap();
        assert!(parsed.is_synced);
        assert_eq!(parsed.offset_ms, 250);
        assert_eq!(parsed.lines.len(), 2);
        assert_eq!(parsed.metadata.title.as_deref(), Some("Creep"));

        let json = serde_json::to_string(&parsed).unwrap();
        assert!(json.contains("\"isSynced\":true"));
        assert!(json.contains("\"offsetMs\":250"));
        assert!(json.contains("\"time\":10.25"));

        let active_idx = find_active_lyric_line(parsed.lines.clone(), 15.0).await.unwrap();
        assert_eq!(active_idx, Some(0));

        let active_idx_2 = find_active_lyric_line(parsed.lines.clone(), 25.0).await.unwrap();
        assert_eq!(active_idx_2, Some(1));

        let target = LyricTargetInfo {
            title: Some("Creep".into()),
            artist: Some("Radiohead".into()),
            album: Some("Pablo Honey".into()),
            duration_secs: Some(238.0),
        };

        let candidate = LyricCandidate {
            id: Some(101),
            track_name: Some("Creep".into()),
            artist_name: Some("Radiohead".into()),
            album_name: Some("Pablo Honey".into()),
            duration: Some(238.5),
            instrumental: Some(false),
            synced_lyrics: Some(raw.to_string()),
            plain_lyrics: None,
        };

        let scored = score_lyric_candidates(target, vec![candidate]).await.unwrap();
        assert_eq!(scored.len(), 1);
        assert!(scored[0].score > 1500);
        assert!(scored[0].is_synced);
        assert!(!scored[0].is_instrumental);

        let scored_json = serde_json::to_string(&scored).unwrap();
        assert!(scored_json.contains("\"isSynced\":true"));
        assert!(scored_json.contains("\"isInstrumental\":false"));
        assert!(scored_json.contains("\"bestLyrics\""));
    }

    #[tokio::test]
    async fn test_adversarial_candidate_scoring_duration_deltas() {
        use wavery_core::lyrics::{score_single_candidate, LyricCandidate, LyricTargetInfo};

        let target = LyricTargetInfo {
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            duration_secs: Some(200.0),
        };

        let make_cand = |id: u64, dur: Option<f64>| LyricCandidate {
            id: Some(id),
            track_name: Some("Song".into()),
            artist_name: Some("Artist".into()),
            album_name: Some("Album".into()),
            duration: dur,
            instrumental: Some(false),
            synced_lyrics: Some("[00:01.00] test".into()),
            plain_lyrics: None,
        };

        // diff = 0.0s -> diff <= 2.0 -> +300 bonus -> score = 1750
        let c_0s = make_cand(1, Some(200.0));
        assert_eq!(score_single_candidate(&c_0s, &target), 1750);

        // diff = 2.0s -> diff <= 2.0 -> +300 bonus -> score = 1750
        let c_2s = make_cand(2, Some(202.0));
        assert_eq!(score_single_candidate(&c_2s, &target), 1750);

        // diff = 2.01s -> diff <= 4.0 -> +150 bonus -> score = 1600
        let c_2_01s = make_cand(3, Some(202.01));
        assert_eq!(score_single_candidate(&c_2_01s, &target), 1600);

        // diff = 4.0s -> diff <= 4.0 -> +150 bonus -> score = 1600
        let c_4s = make_cand(4, Some(204.0));
        assert_eq!(score_single_candidate(&c_4s, &target), 1600);

        // diff = 4.01s -> diff <= 8.0 -> +50 bonus -> score = 1500
        let c_4_01s = make_cand(5, Some(204.01));
        assert_eq!(score_single_candidate(&c_4_01s, &target), 1500);

        // diff = 8.0s -> diff <= 8.0 -> +50 bonus -> score = 1500
        let c_8s = make_cand(6, Some(208.0));
        assert_eq!(score_single_candidate(&c_8s, &target), 1500);

        // diff = 8.01s -> excess = 0.01 -> excess * 10 = 0.1 -> clamped to 50 -> -50 penalty -> score = 1400
        let c_8_01s = make_cand(7, Some(208.01));
        assert_eq!(score_single_candidate(&c_8_01s, &target), 1400);

        // diff = 10.0s -> excess = 2.0 -> excess * 10 = 20 -> clamped to 50 -> -50 penalty -> score = 1400
        let c_10s = make_cand(8, Some(210.0));
        assert_eq!(score_single_candidate(&c_10s, &target), 1400);

        // diff = 20.0s -> excess = 12.0 -> excess * 10 = 120 -> -120 penalty -> score = 1330
        let c_20s = make_cand(9, Some(220.0));
        assert_eq!(score_single_candidate(&c_20s, &target), 1330);

        // diff = 600.0s -> excess = 592.0 -> excess * 10 = 5920 -> clamped to 1500 -> -1500 penalty -> score = -50
        let c_600s = make_cand(10, Some(800.0));
        assert_eq!(score_single_candidate(&c_600s, &target), -50);

        // Boundary duration cases:
        let c_none_dur = make_cand(11, None);
        assert_eq!(score_single_candidate(&c_none_dur, &target), 1450);

        let c_zero_dur = make_cand(12, Some(0.0));
        assert_eq!(score_single_candidate(&c_zero_dur, &target), 1450);

        let c_neg_dur = make_cand(13, Some(-10.0));
        assert_eq!(score_single_candidate(&c_neg_dur, &target), 1450);

        let c_nan_dur = make_cand(14, Some(f64::NAN));
        assert_eq!(score_single_candidate(&c_nan_dur, &target), 1450);

        let target_no_dur = LyricTargetInfo {
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            duration_secs: None,
        };
        assert_eq!(score_single_candidate(&c_0s, &target_no_dur), 1450);

        let candidates = vec![c_600s, c_10s, c_8s, c_4s, c_0s];
        let ranked = super::score_lyric_candidates(target, candidates).await.unwrap();
        assert_eq!(ranked[0].candidate.id, Some(1));
        assert_eq!(ranked[1].candidate.id, Some(4));
        assert_eq!(ranked[2].candidate.id, Some(6));
        assert_eq!(ranked[3].candidate.id, Some(8));
        assert_eq!(ranked[4].candidate.id, Some(10));
    }

    #[tokio::test]
    async fn test_adversarial_candidate_scoring_sorting_stability() {
        use wavery_core::lyrics::{LyricCandidate, LyricTargetInfo};

        let target = LyricTargetInfo {
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            duration_secs: Some(200.0),
        };

        // Create 100 candidates with identical score
        let mut candidates_asc = Vec::new();
        for id in 1..=100 {
            candidates_asc.push(LyricCandidate {
                id: Some(id),
                track_name: Some("Song".into()),
                artist_name: Some("Artist".into()),
                album_name: Some("Album".into()),
                duration: Some(200.0),
                instrumental: Some(false),
                synced_lyrics: Some("[00:01.00] test".into()),
                plain_lyrics: None,
            });
        }

        let scored_asc = super::score_lyric_candidates(target.clone(), candidates_asc).await.unwrap();
        assert_eq!(scored_asc.len(), 100);
        for (idx, sc) in scored_asc.iter().enumerate() {
            assert_eq!(sc.candidate.id, Some((idx + 1) as u64), "Order stability broken at index {}", idx);
        }

        // Now reverse initial input (100 down to 1)
        let mut candidates_desc = Vec::new();
        for id in (1..=100).rev() {
            candidates_desc.push(LyricCandidate {
                id: Some(id),
                track_name: Some("Song".into()),
                artist_name: Some("Artist".into()),
                album_name: Some("Album".into()),
                duration: Some(200.0),
                instrumental: Some(false),
                synced_lyrics: Some("[00:01.00] test".into()),
                plain_lyrics: None,
            });
        }

        let scored_desc = super::score_lyric_candidates(target.clone(), candidates_desc).await.unwrap();
        assert_eq!(scored_desc.len(), 100);
        for (idx, sc) in scored_desc.iter().enumerate() {
            assert_eq!(sc.candidate.id, Some((100 - idx) as u64), "Reverse stability broken at index {}", idx);
        }
    }

    #[test]
    fn test_adversarial_title_and_artist_normalization() {
        use wavery_core::lyrics::*;

        // 1. Title normalization
        assert_eq!(normalize_query("01 - Paranoid Android (Remastered 2021)"), "Paranoid Android");
        assert_eq!(normalize_query("02. Creep [Live at Reading]"), "Creep");
        assert_eq!(normalize_query("105 - Karma Police (feat. Thom Yorke)"), "Karma Police");
        assert_eq!(normalize_query("3_No Surprises (Deluxe Edition)"), "No Surprises");
        assert_eq!(normalize_query("Exit Music (For a Film)"), "Exit Music (For a Film)");
        assert_eq!(normalize_query("Life in a Glasshouse (Full Length Version)"), "Life in a Glasshouse");

        // 2. Clean artists extraction
        assert_eq!(extract_clean_artist("Radiohead; Thom Yorke"), "Radiohead");
        assert_eq!(extract_clean_artist("Kendrick Lamar feat. Rihanna"), "Kendrick Lamar");
        assert_eq!(extract_clean_artist("Kendrick Lamar ft. Rihanna"), "Kendrick Lamar");
        assert_eq!(extract_clean_artist("Daft Punk & Pharrell Williams"), "Daft Punk");
        assert_eq!(extract_clean_artist("Eminem / Rihanna"), "Eminem");

        // 3. Protected band names without featuring
        assert_eq!(extract_clean_artist("AC/DC"), "AC/DC");
        assert_eq!(extract_clean_artist("Earth, Wind & Fire"), "Earth, Wind & Fire");
        assert_eq!(extract_clean_artist("Crosby, Stills, Nash & Young"), "Crosby, Stills, Nash & Young");
        assert_eq!(extract_clean_artist("Tom Petty & The Heartbreakers"), "Tom Petty & The Heartbreakers");
        assert_eq!(extract_clean_artist("Simon & Garfunkel"), "Simon & Garfunkel");
        assert_eq!(extract_clean_artist("Panic! At The Disco"), "Panic! At The Disco");
        assert_eq!(extract_clean_artist("Sunn O)))"), "Sunn O)))");
        assert_eq!(extract_clean_artist("!!! (Chk Chk Chk)"), "!!! (Chk Chk Chk)");
        assert_eq!(extract_clean_artist("$uicideboy$"), "$uicideboy$");

        // 4. Protected band names with featuring artists and candidate scoring
        let target_ewf = LyricTargetInfo {
            title: Some("September".into()),
            artist: Some("Earth, Wind & Fire feat. Friends".into()),
            album: Some("The Best of Earth, Wind & Fire".into()),
            duration_secs: Some(215.0),
        };
        let cand_ewf = LyricCandidate {
            id: Some(1),
            track_name: Some("September".into()),
            artist_name: Some("Earth, Wind & Fire".into()),
            album_name: Some("The Best of Earth, Wind & Fire".into()),
            duration: Some(215.0),
            instrumental: Some(false),
            synced_lyrics: Some("[00:01.00] Do you remember".into()),
            plain_lyrics: None,
        };
        let score_ewf = score_single_candidate(&cand_ewf, &target_ewf);
        assert!(score_ewf >= 1675, "Expected high match for EWF candidate, got {}", score_ewf);

        // 5. AC/DC with feat. test
        let acdc_feat = extract_clean_artist("AC/DC feat. Axl Rose");
        // Document empirical behavior: extract_clean_artist splits on '/' before checking feat., yielding "AC"
        assert_eq!(acdc_feat, "AC");

        let target_acdc = LyricTargetInfo {
            title: Some("Back In Black".into()),
            artist: Some("AC/DC feat. Axl Rose".into()),
            album: None,
            duration_secs: Some(255.0),
        };
        let cand_acdc = LyricCandidate {
            id: Some(1),
            track_name: Some("Back In Black".into()),
            artist_name: Some("AC/DC".into()),
            album_name: None,
            duration: Some(255.0),
            instrumental: Some(false),
            synced_lyrics: Some("[00:01.00] Back in black".into()),
            plain_lyrics: None,
        };
        let cand_jack_white = LyricCandidate {
            id: Some(2),
            track_name: Some("Back In Black".into()),
            artist_name: Some("Jack White".into()),
            album_name: None,
            duration: Some(255.0),
            instrumental: Some(false),
            synced_lyrics: Some("[00:01.00] Back in black".into()),
            plain_lyrics: None,
        };
        let score_acdc = score_single_candidate(&cand_acdc, &target_acdc);
        let score_jack = score_single_candidate(&cand_jack_white, &target_acdc);
        // Both get +75 for artist because "ac/dc".contains("ac") and "jack white".contains("ac")
        assert_eq!(score_acdc, score_jack, "Expected both candidates to tie due to 'ac' substring match");

        // Verify that wavery_core::heuristics::split_artists already correctly handles AC/DC feat.
        let split_result = wavery_core::heuristics::split_artists("AC/DC feat. Axl Rose", &[]);
        assert_eq!(split_result[0], "AC/DC");
        assert_eq!(split_result[1], "Axl Rose");
    }

    #[tokio::test]
    async fn test_adversarial_tauri_ipc_camel_case_and_serialization() {
        use wavery_core::lyrics::*;

        // 1. LyricLine camelCase
        let line = LyricLine { time: 42.5, text: "Some lyric".into() };
        let line_json = serde_json::to_string(&line).unwrap();
        assert!(line_json.contains("\"time\":42.5"));
        assert!(line_json.contains("\"text\":\"Some lyric\""));

        // 2. LrcMetadata camelCase
        let mut meta = LrcMetadata {
            title: Some("Title".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            author: Some("Author".into()),
            creator: Some("Creator".into()),
            length: Some("03:45".into()),
            offset_ms: Some(500),
            additional: std::collections::HashMap::new(),
        };
        meta.additional.insert("re".into(), "Wavery".into());
        let meta_json = serde_json::to_string(&meta).unwrap();
        assert!(meta_json.contains("\"offsetMs\":500"));
        assert!(meta_json.contains("\"title\":\"Title\""));
        assert!(meta_json.contains("\"additional\":{\"re\":\"Wavery\"}"));

        // 3. ParsedLyrics camelCase
        let parsed = ParsedLyrics {
            is_synced: true,
            lines: vec![line.clone()],
            metadata: meta.clone(),
            offset_ms: 500,
        };
        let parsed_json = serde_json::to_string(&parsed).unwrap();
        assert!(parsed_json.contains("\"isSynced\":true"));
        assert!(parsed_json.contains("\"offsetMs\":500"));
        assert!(parsed_json.contains("\"lines\":["));
        assert!(parsed_json.contains("\"metadata\":{"));

        // 4. LyricTargetInfo camelCase
        let target = LyricTargetInfo {
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            duration_secs: Some(180.0),
        };
        let target_json = serde_json::to_string(&target).unwrap();
        assert!(target_json.contains("\"durationSecs\":180.0"));

        // 5. LyricCandidate deserialization from LRCLIB snake_case JSON (track_name)
        let lrclib_raw_json = r#"{
            "id": 9999,
            "track_name": "Karma Police",
            "artist_name": "Radiohead",
            "album_name": "OK Computer",
            "duration": 261.0,
            "instrumental": false,
            "synced_lyrics": "[00:10.00] Karma police",
            "plain_lyrics": "Karma police"
        }"#;
        let cand_from_snake: LyricCandidate = serde_json::from_str(lrclib_raw_json).unwrap();
        assert_eq!(cand_from_snake.id, Some(9999));
        assert_eq!(cand_from_snake.track_name.as_deref(), Some("Karma Police"));
        assert_eq!(cand_from_snake.artist_name.as_deref(), Some("Radiohead"));
        assert_eq!(cand_from_snake.synced_lyrics.as_deref(), Some("[00:10.00] Karma police"));

        // Also test alias 'name'
        let name_alias_json = r#"{
            "id": 7777,
            "name": "Karma Police",
            "artist_name": "Radiohead"
        }"#;
        let cand_from_name: LyricCandidate = serde_json::from_str(name_alias_json).unwrap();
        assert_eq!(cand_from_name.id, Some(7777));
        assert_eq!(cand_from_name.track_name.as_deref(), Some("Karma Police"));

        // Deserialization from frontend camelCase JSON
        let frontend_raw_json = r#"{
            "id": 8888,
            "trackName": "No Surprises",
            "artistName": "Radiohead",
            "albumName": "OK Computer",
            "duration": 229.0,
            "instrumental": false,
            "syncedLyrics": "[00:05.00] A heart that's full up like a landfill",
            "plainLyrics": "A heart that's full up like a landfill"
        }"#;
        let cand_from_camel: LyricCandidate = serde_json::from_str(frontend_raw_json).unwrap();
        assert_eq!(cand_from_camel.id, Some(8888));
        assert_eq!(cand_from_camel.track_name.as_deref(), Some("No Surprises"));
        assert_eq!(cand_from_camel.artist_name.as_deref(), Some("Radiohead"));

        // 6. ScoredLyricCandidate camelCase serialization
        let scored_cand = ScoredLyricCandidate {
            candidate: cand_from_snake,
            score: 1750,
            is_synced: true,
            is_instrumental: false,
            best_lyrics: Some("[00:10.00] Karma police".into()),
        };
        let scored_json = serde_json::to_string(&scored_cand).unwrap();
        assert!(scored_json.contains("\"isSynced\":true"));
        assert!(scored_json.contains("\"isInstrumental\":false"));
        assert!(scored_json.contains("\"bestLyrics\":\"[00:10.00] Karma police\""));
        assert!(scored_json.contains("\"score\":1750"));
    }

    #[tokio::test]
    async fn test_adversarial_tauri_ipc_empty_inputs_and_error_propagation() {
        use wavery_core::lyrics::*;

        // 1. parse_lrc_content empty string
        let empty_parsed = parse_lrc_content("".into()).await.unwrap();
        assert!(!empty_parsed.is_synced);
        assert!(empty_parsed.lines.is_empty());
        assert_eq!(empty_parsed.offset_ms, 0);

        // Whitespace only
        let ws_parsed = parse_lrc_content("   \n\n\t  \r\n   ".into()).await.unwrap();
        assert!(!ws_parsed.is_synced);
        assert!(ws_parsed.lines.is_empty());

        // 2. find_active_lyric_line with empty lines
        assert_eq!(find_active_lyric_line(vec![], 10.0).await.unwrap(), None);

        // Negative position
        let lines = vec![LyricLine { time: 10.0, text: "A".into() }, LyricLine { time: 20.0, text: "B".into() }];
        assert_eq!(find_active_lyric_line(lines.clone(), -5.0).await.unwrap(), None);

        // NaN position
        assert_eq!(find_active_lyric_line(lines.clone(), f64::NAN).await.unwrap(), None);

        // Infinity position -> lands on last line (index 1)
        assert_eq!(find_active_lyric_line(lines.clone(), f64::INFINITY).await.unwrap(), Some(1));

        // Unsynced lines (time < 0)
        let unsynced_lines = vec![LyricLine { time: -1.0, text: "Plain".into() }];
        assert_eq!(find_active_lyric_line(unsynced_lines, 5.0).await.unwrap(), None);

        // 3. score_lyric_candidates with empty candidates
        let target = LyricTargetInfo {
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: None,
            duration_secs: Some(180.0),
        };
        let empty_scored = super::score_lyric_candidates(target.clone(), vec![]).await.unwrap();
        assert!(empty_scored.is_empty());

        // Target with all None fields
        let empty_target = LyricTargetInfo::default();
        let cand = LyricCandidate {
            id: Some(1),
            track_name: None,
            artist_name: None,
            album_name: None,
            duration: None,
            instrumental: Some(false),
            synced_lyrics: None,
            plain_lyrics: None,
        };
        let scored_empty = super::score_lyric_candidates(empty_target, vec![cand]).await.unwrap();
        assert_eq!(scored_empty.len(), 1);
        assert_eq!(scored_empty[0].score, 0);

        // 4. IpcError serialization and roundtrip
        let err = IpcError::Audio("Playback failed".into());
        let err_json = serde_json::to_string(&err).unwrap();
        assert_eq!(err_json, r#"{"type":"Audio","message":"Playback failed"}"#);

        let err_lib = IpcError::Library("DB locked".into());
        let err_lib_json = serde_json::to_string(&err_lib).unwrap();
        assert_eq!(err_lib_json, r#"{"type":"Library","message":"DB locked"}"#);
    }

    #[test]
    fn test_detect_local_lan_ip_rfc1122() {
        let maybe_ip = detect_local_lan_ip();
        if let Some(ip_str) = maybe_ip {
            let parsed: std::net::IpAddr = ip_str.parse().expect("Detected IP must be valid IpAddr");
            assert!(!parsed.is_loopback(), "Detected LAN IP must not be loopback");
            assert!(
                !parsed.is_unspecified(),
                "Detected LAN IP must not be unspecified"
            );
        }
    }

    #[test]
    fn test_server_status_response_dual_case_serialization() {
        let mut srv_cfg = wavery_config::ServerConfig::default();
        assert!(!srv_cfg.is_lan_enabled());

        let status_loopback =
            build_server_status_response(&srv_cfg, Some("192.168.1.50".to_string()));
        assert_eq!(status_loopback.host, "127.0.0.1");
        assert_eq!(status_loopback.port, 4242);
        assert!(!status_loopback.is_lan_enabled);
        assert!(!status_loopback.lan_enabled);
        assert_eq!(status_loopback.local_ip.as_deref(), Some("192.168.1.50"));
        assert_eq!(
            status_loopback.local_ip_camel.as_deref(),
            Some("192.168.1.50")
        );
        assert_eq!(
            status_loopback.lan_url.as_deref(),
            Some("http://192.168.1.50:4242")
        );
        assert_eq!(status_loopback.stream_url, "http://127.0.0.1:4242");

        let json_loopback = serde_json::to_string(&status_loopback).unwrap();
        assert!(json_loopback.contains("\"is_lan_enabled\":false"));
        assert!(json_loopback.contains("\"lanEnabled\":false"));
        assert!(json_loopback.contains("\"local_ip\":\"192.168.1.50\""));
        assert!(json_loopback.contains("\"localIp\":\"192.168.1.50\""));
        assert!(json_loopback.contains("\"lan_url\":\"http://192.168.1.50:4242\""));
        assert!(json_loopback.contains("\"streamUrl\":\"http://127.0.0.1:4242\""));

        srv_cfg.set_lan_enabled(true);
        let status_lan = build_server_status_response(&srv_cfg, Some("192.168.1.50".to_string()));
        assert_eq!(status_lan.host, "0.0.0.0");
        assert!(status_lan.is_lan_enabled);
        assert!(status_lan.lan_enabled);
        assert_eq!(status_lan.stream_url, "http://192.168.1.50:4242");

        let roundtrip: ServerStatusResponse = serde_json::from_str(&json_loopback).unwrap();
        assert_eq!(roundtrip, status_loopback);
    }

    #[tokio::test]
    async fn test_apply_server_lan_mode_toggle_and_atomic_rollback() {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("wavery_lan_m5_test_{}", unique_id));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let cfg_path = temp_dir.join("config.toml");

        // Bind a temporary listener on an ephemeral port to discover a free port first
        let probe = std::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)).unwrap();
        let free_port = probe.local_addr().unwrap().port();
        drop(probe);

        let mut cfg = Config::default();
        cfg.server.port = free_port;
        cfg.server.enable_browser_client = false;

        let state = Arc::new(AppState {
            player: AsyncMutex::new(None),
            library: None,
            queue: SyncMutex::new(StandardQueueManager::new()),
            config: SyncMutex::new(cfg),
            artwork_cache: SyncMutex::new(ArtworkCache::new(MAX_ARTWORK_CACHE_ENTRIES)),
            server_process: SyncMutex::new(None),
            server_shutdown_tx: SyncMutex::new(None),
            server_abort_handle: SyncMutex::new(None),
            discord_handle: wavery_server::discord::new_discord_handle(None),
            last_normal_size: SyncMutex::new((1100, 720)),
            mpris_bridge: Arc::new(AsyncMutex::new(wavery_mpris::ZbusMprisBridge::new())),
        });

        // 1. Enable LAN mode on free port -> succeeds and persists 0.0.0.0
        let status_enabled = apply_server_lan_mode(&state, true, Some(&cfg_path))
            .await
            .unwrap();
        assert!(status_enabled.is_lan_enabled);
        assert!(status_enabled.lan_enabled);
        assert_eq!(status_enabled.host, "0.0.0.0");
        let saved_cfg = load_or_create(&cfg_path).unwrap();
        assert_eq!(saved_cfg.server.host, "0.0.0.0");

        // 2. Disable LAN mode -> reverts and persists 127.0.0.1
        let status_disabled = apply_server_lan_mode(&state, false, Some(&cfg_path))
            .await
            .unwrap();
        assert!(!status_disabled.is_lan_enabled);
        assert!(!status_disabled.lan_enabled);
        assert_eq!(status_disabled.host, "127.0.0.1");
        let saved_cfg_2 = load_or_create(&cfg_path).unwrap();
        assert_eq!(saved_cfg_2.server.host, "127.0.0.1");

        // 3. Occupy a port to simulate bind conflict -> must atomically roll back to 127.0.0.1
        let blocker = std::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)).unwrap();
        let blocked_port = blocker.local_addr().unwrap().port();
        state.config.lock().server.port = blocked_port;

        let status_rollback = apply_server_lan_mode(&state, true, Some(&cfg_path))
            .await
            .unwrap();
        assert!(
            !status_rollback.is_lan_enabled,
            "Port conflict must roll back LAN mode to false"
        );
        assert!(!status_rollback.lan_enabled);
        assert_eq!(status_rollback.host, "127.0.0.1");
        let saved_cfg_rollback = load_or_create(&cfg_path).unwrap();
        assert_eq!(saved_cfg_rollback.server.host, "127.0.0.1");

        drop(blocker);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_query_track_waveform_ipc_transitions() {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("wavery_wav_m5_test_{}", unique_id));
        let db_path = temp_dir.join("test_lib.sqlite");
        let music_dir = temp_dir.join("music");
        std::fs::create_dir_all(&music_dir).unwrap();

        // Uninitialized library state
        let uninit_state = AppState {
            player: AsyncMutex::new(None),
            library: None,
            queue: SyncMutex::new(StandardQueueManager::new()),
            config: SyncMutex::new(Config::default()),
            artwork_cache: SyncMutex::new(ArtworkCache::new(MAX_ARTWORK_CACHE_ENTRIES)),
            server_process: SyncMutex::new(None),
            server_shutdown_tx: SyncMutex::new(None),
            server_abort_handle: SyncMutex::new(None),
            discord_handle: wavery_server::discord::new_discord_handle(None),
            last_normal_size: SyncMutex::new((1100, 720)),
            mpris_bridge: Arc::new(AsyncMutex::new(wavery_mpris::ZbusMprisBridge::new())),
        };

        // Empty track_id returns Ok(None) even before library check
        assert_eq!(query_track_waveform(&uninit_state, "   ").await.unwrap(), None);
        // Non-empty track_id with uninitialized library returns Err(LibraryNotInitialized)
        assert!(matches!(
            query_track_waveform(&uninit_state, "track-1").await,
            Err(IpcError::LibraryNotInitialized)
        ));

        let lib = SqliteLibraryManager::new(music_dir, db_path).unwrap();
        let shared_lib = Arc::new(AsyncMutex::new(lib));
        let init_state = AppState {
            player: AsyncMutex::new(None),
            library: Some(shared_lib),
            queue: SyncMutex::new(StandardQueueManager::new()),
            config: SyncMutex::new(Config::default()),
            artwork_cache: SyncMutex::new(ArtworkCache::new(MAX_ARTWORK_CACHE_ENTRIES)),
            server_process: SyncMutex::new(None),
            server_shutdown_tx: SyncMutex::new(None),
            server_abort_handle: SyncMutex::new(None),
            discord_handle: wavery_server::discord::new_discord_handle(None),
            last_normal_size: SyncMutex::new((1100, 720)),
            mpris_bridge: Arc::new(AsyncMutex::new(wavery_mpris::ZbusMprisBridge::new())),
        };

        // Missing track waveform returns Ok(None)
        assert_eq!(
            query_track_waveform(&init_state, "non-existent-track")
                .await
                .unwrap(),
            None
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}


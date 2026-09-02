//! Local HTTP API and audio file streaming server with HTTP Range support.
//!
//! Note: As mandated by architecture rules, the browser client plays audio via `<audio>`,
//! so this crate does NOT import or use `PlayerEngine` or `wavery-audio`.
//! It serves audio files via Range requests (`206 Partial Content`), serves metadata from `LibraryManager`,
//! and hosts the unified web UI.

use axum::{
    body::{Body, Bytes},
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::SeekFrom;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;
use wavery_core::models::{ImportStrategy, Playlist, Track};
use wavery_core::traits::{LibraryManager, MetadataReader};
use wavery_library::{LoftyMetadataReader, SqliteLibraryManager};

pub mod tray;
pub use tray::ServerTrayManager;

/// Typed error enum for wavery-server operations.
#[derive(Error, Debug)]
pub enum ServerError {
    #[error("Track with ID '{0}' not found")]
    TrackNotFound(String),
    #[error("Audio file not found: {0}")]
    FileNotFound(PathBuf),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Library error: {0}")]
    Library(#[from] wavery_core::error::LibraryError),
    #[error("Invalid range requested: {0}")]
    InvalidRange(String),
    #[error("Internal server error: {0}")]
    Internal(String),
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        let (status, msg) = match &self {
            ServerError::TrackNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            ServerError::FileNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            ServerError::Library(e) => (StatusCode::BAD_REQUEST, e.to_string()),
            ServerError::InvalidRange(_) => (StatusCode::RANGE_NOT_SATISFIABLE, self.to_string()),
            ServerError::Io(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            ServerError::Internal(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.clone()),
        };

        let body = Json(serde_json::json!({
            "error": msg,
            "status": status.as_u16(),
        }));

        (status, body).into_response()
    }
}

/// In-memory representation of extracted artwork.
#[derive(Clone, Debug, PartialEq)]
pub struct CachedArtwork {
    pub data: Bytes,
    pub mime_type: String,
}


/// Bounded LRU cache for extracted artwork with maximum entry count and byte capacity.
pub struct ArtworkCache {
    entries: HashMap<String, Option<CachedArtwork>>,
    lru_order: VecDeque<String>,
    max_entries: usize,
    max_bytes: usize,
    current_bytes: usize,
}

impl ArtworkCache {
    /// Default maximum entries (e.g., 256 album covers).
    pub const DEFAULT_MAX_ENTRIES: usize = 256;
    /// Default maximum cache memory in bytes (e.g., 64 MB).
    pub const DEFAULT_MAX_BYTES: usize = 64 * 1024 * 1024;

    /// Creates a new bounded artwork cache with explicit capacity limits.
    #[must_use]
    pub fn new(max_entries: usize, max_bytes: usize) -> Self {
        let max_entries = max_entries.max(1);
        let max_bytes = max_bytes.max(1);
        Self {
            entries: HashMap::with_capacity(max_entries),
            lru_order: VecDeque::with_capacity(max_entries),
            max_entries,
            max_bytes,
            current_bytes: 0,
        }
    }


    /// Creates a cache with default bounds (256 items, 64 MB).
    #[must_use]
    pub fn with_default_capacity() -> Self {
        Self::new(Self::DEFAULT_MAX_ENTRIES, Self::DEFAULT_MAX_BYTES)
    }

    /// Retrieves an artwork entry if present in the cache, bumping its LRU recency.
    pub fn get(&mut self, track_id: &str) -> Option<Option<CachedArtwork>> {
        if let Some(cached) = self.entries.get(track_id) {
            if let Some(pos) = self.lru_order.iter().position(|id| id == track_id) {
                self.lru_order.remove(pos);
                self.lru_order.push_back(track_id.to_string());
            }
            Some(cached.clone())
        } else {
            None
        }
    }

    /// Inserts or updates an artwork entry, evicting the least recently used entries if needed.
    pub fn insert(&mut self, track_id: String, artwork: Option<CachedArtwork>) {
        let entry_bytes = match &artwork {
            Some(art) => art.data.len() + art.mime_type.len() + track_id.len(),
            None => track_id.len(),
        };

        if let Some(old_entry) = self.entries.remove(&track_id) {
            let old_bytes = match &old_entry {
                Some(art) => art.data.len() + art.mime_type.len() + track_id.len(),
                None => track_id.len(),
            };
            self.current_bytes = self.current_bytes.saturating_sub(old_bytes);
            if let Some(pos) = self.lru_order.iter().position(|id| id == &track_id) {
                self.lru_order.remove(pos);
            }
        }

        while self.entries.len() >= self.max_entries
            || (self.current_bytes + entry_bytes > self.max_bytes && !self.entries.is_empty())
        {
            if let Some(oldest_id) = self.lru_order.pop_front() {
                if let Some(removed_entry) = self.entries.remove(&oldest_id) {
                    let removed_bytes = match &removed_entry {
                        Some(art) => art.data.len() + art.mime_type.len() + oldest_id.len(),
                        None => oldest_id.len(),
                    };
                    self.current_bytes = self.current_bytes.saturating_sub(removed_bytes);
                }
            } else {
                break;
            }
        }


        self.current_bytes += entry_bytes;
        self.lru_order.push_back(track_id.clone());
        self.entries.insert(track_id, artwork);
    }

    /// Number of cached items (both positive and negative).
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Is the cache currently empty?
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Total bytes currently used by cached payloads.
    #[must_use]
    pub fn size_bytes(&self) -> usize {
        self.current_bytes
    }

    /// Maximum entry capacity.
    #[must_use]
    pub fn max_entries(&self) -> usize {
        self.max_entries
    }

    /// Maximum byte capacity.
    #[must_use]
    pub fn max_bytes(&self) -> usize {
        self.max_bytes
    }

    /// Clears all entries from the cache.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.lru_order.clear();
        self.current_bytes = 0;
    }
}

impl Default for ArtworkCache {
    fn default() -> Self {
        Self::with_default_capacity()
    }
}

/// Shared application state for the HTTP server.
pub struct AppState {
    pub library: Arc<tokio::sync::Mutex<SqliteLibraryManager>>,
    pub reader: LoftyMetadataReader,
    pub static_dir: Option<PathBuf>,
    pub artwork_cache: Arc<tokio::sync::RwLock<ArtworkCache>>,
    pub config: Arc<tokio::sync::RwLock<wavery_config::Config>>,
    pub config_path: PathBuf,
    pub session: Arc<tokio::sync::RwLock<Option<wavery_core::models::PlaybackSession>>>,
}

impl AppState {
    /// Creates a new `AppState` instance with default bounded artwork cache.
    #[must_use]
    pub fn new(
        library: Arc<tokio::sync::Mutex<SqliteLibraryManager>>,
        reader: LoftyMetadataReader,
        static_dir: Option<PathBuf>,
    ) -> Self {
        let config_path = wavery_config::default_config_path().unwrap_or_else(|_| PathBuf::from("config.toml"));
        let config = wavery_config::load_or_create(&config_path).unwrap_or_default();
        Self {
            library,
            reader,
            static_dir,
            artwork_cache: Arc::new(tokio::sync::RwLock::new(ArtworkCache::with_default_capacity())),
            config: Arc::new(tokio::sync::RwLock::new(config)),
            config_path,
            session: Arc::new(tokio::sync::RwLock::new(None)),
        }
    }

    /// Creates a new `AppState` with an explicit config and config path.
    #[must_use]
    pub fn with_config(
        library: Arc<tokio::sync::Mutex<SqliteLibraryManager>>,
        reader: LoftyMetadataReader,
        static_dir: Option<PathBuf>,
        config: wavery_config::Config,
        config_path: PathBuf,
    ) -> Self {
        Self {
            library,
            reader,
            static_dir,
            artwork_cache: Arc::new(tokio::sync::RwLock::new(ArtworkCache::with_default_capacity())),
            config: Arc::new(tokio::sync::RwLock::new(config)),
            config_path,
            session: Arc::new(tokio::sync::RwLock::new(None)),
        }
    }
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

#[derive(Deserialize)]
pub struct ImportRequest {
    pub source_path: String,
    pub strategy: ImportStrategy,
}

#[derive(Deserialize)]
pub struct ImportFolderRequest {
    pub dir_path: String,
    pub strategy: ImportStrategy,
}

#[derive(Deserialize)]
pub struct UpdateTrackMetadataRequest {
    pub track_id: String,
    pub metadata: wavery_core::models::TrackMetadata,
    pub write_tags: Option<bool>,
}

#[derive(Deserialize)]
pub struct AlbumTrackUpdate {
    pub track_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
}

#[derive(Deserialize)]
pub struct UpdateAlbumMetadataRequest {
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub tracks: Vec<AlbumTrackUpdate>,
    pub write_tags: Option<bool>,
}

#[derive(Deserialize)]
pub struct CreatePlaylistRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct RenamePlaylistRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct AddPlaylistTracksRequest {
    pub track_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct ToggleLikeResponse {
    pub liked: bool,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub ok: bool,
    pub message: String,
}

/// Builds the Axum router for the local streaming server.
pub fn build_router(state: Arc<AppState>) -> Router {
    let api_router = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/tracks", get(list_tracks_handler))
        .route("/api/tracks/{id}", get(get_track_handler))
        .route("/api/tracks/{id}/artwork", get(get_artwork_handler))
        .route("/api/tracks/metadata", post(update_track_metadata_handler))
        .route("/api/albums/metadata", post(update_album_metadata_handler))
        .route("/api/library/rebuild", post(rebuild_library_handler))
        .route("/api/library/vacuum", post(vacuum_library_handler))
        .route("/api/stream/{id}", get(stream_track_handler))
        .route("/api/import", post(import_handler))
        .route("/api/import/folder", post(import_folder_handler))
        .route("/api/search", get(search_handler))
        .route("/api/liked", get(list_liked_tracks_handler))
        .route("/api/liked/ids", get(list_liked_ids_handler))
        .route(
            "/api/liked/{id}",
            post(like_track_handler).delete(unlike_track_handler),
        )
        .route("/api/liked/{id}/toggle", post(toggle_like_handler))
        .route(
            "/api/playlists",
            get(list_playlists_handler).post(create_playlist_handler),
        )
        .route(
            "/api/playlists/{id}",
            get(get_playlist_handler)
                .put(rename_playlist_handler)
                .delete(delete_playlist_handler),
        )
        .route(
            "/api/playlists/{id}/tracks",
            get(get_playlist_tracks_handler).post(add_playlist_tracks_handler),
        )
        .route(
            "/api/playlists/{id}/tracks/{track_id}",
            delete(remove_playlist_track_handler),
        )
        .route(
            "/api/config",
            get(get_config_handler).post(save_config_handler),
        )
        .route("/api/config/export", get(export_config_handler))
        .route("/api/config/import", post(import_config_handler))
        .route("/api/session", get(get_session_handler).post(save_session_handler))
        .route("/api/app/claim-playback", post(claim_playback_handler))
        .route("/api/app/switch-to-native", post(switch_to_native_handler))
        .route("/api/app/quit", post(quit_app_handler))
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    if let Some(static_dir) = &state.static_dir {
        if static_dir.exists() {
            let serve_dir = tower_http::services::ServeDir::new(static_dir)
                .not_found_service(tower_http::services::ServeFile::new(static_dir.join("index.html")));
            return api_router.fallback_service(serve_dir);
        }
    }

    api_router
}

/// Binds and starts the HTTP streaming and web server on the given address.
pub async fn start_server(state: Arc<AppState>, addr: &str) -> Result<(), std::io::Error> {
    let router = build_router(state);
    let mut listener = None;
    for attempt in 1..=20 {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                if attempt == 20 {
                    return Err(e);
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
            }
            Err(e) => return Err(e),
        }
    }
    let listener = listener.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrInUse, "Port in use")
    })?;
    let _ = axum::serve(listener, router).await;
    Ok(())
}

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "wavery-server",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn list_tracks_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let lib = state.library.lock().await;
    let tracks = lib.all_tracks().to_vec();
    Json(tracks)
}

async fn get_track_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Track>, ServerError> {
    let lib = state.library.lock().await;
    match lib.get_track(&id) {
        Some(t) => Ok(Json(t.clone())),
        None => Err(ServerError::TrackNotFound(id)),
    }
}

async fn search_handler(
    Query(query): Query<SearchQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let lib = state.library.lock().await;
    let q = query.q.unwrap_or_default();
    let results: Vec<Track> = lib.search(&q).into_iter().cloned().collect();
    Json(results)
}

async fn update_track_metadata_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateTrackMetadataRequest>,
) -> Result<Json<Track>, ServerError> {
    let mut lib = state.library.lock().await;
    let write_tags = req.write_tags.unwrap_or(true);
    let updated = lib.update_track_metadata(&req.track_id, &req.metadata, write_tags).await?;
    Ok(Json(updated))
}

async fn update_album_metadata_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateAlbumMetadataRequest>,
) -> Result<Json<Vec<Track>>, ServerError> {
    let mut lib = state.library.lock().await;
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

            let updated = lib.update_track_metadata(&track_update.track_id, &meta, write_tags).await?;
            updated_tracks.push(updated);
        }
    }

    Ok(Json(updated_tracks))
}

async fn rebuild_library_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Track>>, ServerError> {
    let mut lib = state.library.lock().await;
    let tracks = lib.rebuild_library().await?;
    // Clear artwork cache
    {
        let mut cache = state.artwork_cache.write().await;
        cache.clear();
    }
    Ok(Json(tracks))
}

async fn vacuum_library_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StatusResponse>, ServerError> {
    let lib = state.library.lock().await;
    lib.vacuum_database()?;
    Ok(Json(StatusResponse {
        ok: true,
        message: "Database vacuumed and optimized successfully".to_string(),
    }))
}

async fn import_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImportRequest>,
) -> Result<Json<Track>, ServerError> {
    let mut lib = state.library.lock().await;
    let path = PathBuf::from(req.source_path);
    let track = lib.import_track(&path, req.strategy).await?;
    Ok(Json(track))
}

async fn import_folder_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImportFolderRequest>,
) -> Result<Json<Vec<Track>>, ServerError> {
    let mut lib = state.library.lock().await;
    let path = PathBuf::from(req.dir_path);
    let tracks = lib.import_directory(&path, req.strategy).await?;
    Ok(Json(tracks))
}

async fn list_liked_tracks_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Track>>, ServerError> {
    let lib = state.library.lock().await;
    let tracks = lib.get_liked_tracks()?;
    Ok(Json(tracks))
}

async fn list_liked_ids_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<String>>, ServerError> {
    let lib = state.library.lock().await;
    let ids = lib.get_liked_track_ids()?;
    Ok(Json(ids))
}

async fn like_track_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<StatusResponse>, ServerError> {
    let lib = state.library.lock().await;
    lib.like_track(&id)?;
    Ok(Json(StatusResponse {
        ok: true,
        message: "Track liked".into(),
    }))
}

async fn unlike_track_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<StatusResponse>, ServerError> {
    let lib = state.library.lock().await;
    lib.unlike_track(&id)?;
    Ok(Json(StatusResponse {
        ok: true,
        message: "Track unliked".into(),
    }))
}

async fn toggle_like_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<ToggleLikeResponse>, ServerError> {
    let lib = state.library.lock().await;
    let liked = lib.toggle_like(&id)?;
    Ok(Json(ToggleLikeResponse { liked }))
}

async fn list_playlists_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Playlist>>, ServerError> {
    let lib = state.library.lock().await;
    let playlists = lib.list_playlists()?;
    Ok(Json(playlists))
}

async fn create_playlist_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePlaylistRequest>,
) -> Result<Json<Playlist>, ServerError> {
    let lib = state.library.lock().await;
    let playlist = lib.create_playlist(&req.name)?;
    Ok(Json(playlist))
}

async fn get_playlist_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Playlist>, ServerError> {
    let lib = state.library.lock().await;
    match lib.get_playlist(&id)? {
        Some(p) => Ok(Json(p)),
        None => Err(ServerError::Internal(format!("Playlist '{id}' not found"))),
    }
}

async fn rename_playlist_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<RenamePlaylistRequest>,
) -> Result<Json<StatusResponse>, ServerError> {
    let lib = state.library.lock().await;
    lib.rename_playlist(&id, &req.name)?;
    Ok(Json(StatusResponse {
        ok: true,
        message: "Playlist renamed".into(),
    }))
}

async fn delete_playlist_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<StatusResponse>, ServerError> {
    let lib = state.library.lock().await;
    lib.delete_playlist(&id)?;
    Ok(Json(StatusResponse {
        ok: true,
        message: "Playlist deleted".into(),
    }))
}

async fn get_playlist_tracks_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Track>>, ServerError> {
    let lib = state.library.lock().await;
    let tracks = lib.get_playlist_tracks(&id)?;
    Ok(Json(tracks))
}

async fn add_playlist_tracks_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<AddPlaylistTracksRequest>,
) -> Result<Json<StatusResponse>, ServerError> {
    let lib = state.library.lock().await;
    lib.add_tracks_to_playlist(&id, &req.track_ids)?;
    Ok(Json(StatusResponse {
        ok: true,
        message: "Tracks added to playlist".into(),
    }))
}

async fn remove_playlist_track_handler(
    AxumPath((id, track_id)): AxumPath<(String, String)>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<StatusResponse>, ServerError> {
    let lib = state.library.lock().await;
    lib.remove_track_from_playlist(&id, &track_id)?;
    Ok(Json(StatusResponse {
        ok: true,
        message: "Track removed from playlist".into(),
    }))
}

async fn get_artwork_handler(
    AxumPath(id): AxumPath<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Response, ServerError> {
    {
        let mut cache = state.artwork_cache.write().await;
        if let Some(cached_opt) = cache.get(&id) {
            return match cached_opt {
                Some(art) => {
                    let mut res = Response::new(Body::from(art.data));
                    if let Ok(mime) = art.mime_type.parse() {
                        res.headers_mut().insert(header::CONTENT_TYPE, mime);
                    }
                    if let Ok(cache_control) = "public, max-age=86400, immutable".parse() {
                        res.headers_mut().insert(header::CACHE_CONTROL, cache_control);
                    }
                    if let Ok(etag) = format!("\"{id}\"").parse() {
                        res.headers_mut().insert(header::ETAG, etag);
                    }
                    Ok(res)
                }
                None => Err(ServerError::TrackNotFound(id)),
            };
        }
    }

    let track_path = {
        let lib = state.library.lock().await;
        let track = lib.get_track(&id).ok_or_else(|| ServerError::TrackNotFound(id.clone()))?;
        track.source.path().clone()
    };

    let artwork_opt = state.reader.read_artwork(&track_path).ok().flatten();

    let cached_art = artwork_opt.map(|art| CachedArtwork {
        data: Bytes::from(art.data),
        mime_type: art.mime_type,
    });

    {
        let mut cache = state.artwork_cache.write().await;
        cache.insert(id.clone(), cached_art.clone());
    }

    match cached_art {
        Some(art) => {
            let mut res = Response::new(Body::from(art.data));
            if let Ok(mime) = art.mime_type.parse() {
                res.headers_mut().insert(header::CONTENT_TYPE, mime);
            }
            if let Ok(cache_control) = "public, max-age=86400, immutable".parse() {
                res.headers_mut().insert(header::CACHE_CONTROL, cache_control);
            }
            if let Ok(etag) = format!("\"{id}\"").parse() {
                res.headers_mut().insert(header::ETAG, etag);
            }
            Ok(res)
        }
        None => Err(ServerError::TrackNotFound(id)),
    }
}

/// Streams an audio track supporting HTTP 206 Partial Content (Range requests)
/// with minimal memory buffering and RFC-compliant range headers.
async fn stream_track_handler(
    AxumPath(id): AxumPath<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Result<Response, ServerError> {
    let file_path = {
        let lib = state.library.lock().await;
        let track = lib.get_track(&id).ok_or_else(|| ServerError::TrackNotFound(id.clone()))?;
        track.source.path().clone()
    };

    if !file_path.exists() {
        return Err(ServerError::FileNotFound(file_path));
    }

    let mut file = File::open(&file_path).await?;
    let metadata = file.metadata().await?;
    let file_size = metadata.len();

    let content_type = match file_path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        _ => "application/octet-stream",
    };

    if let Some(range_header) = headers.get(header::RANGE) {
        if let Ok(range_str) = range_header.to_str() {
            match parse_range_header(range_str, file_size) {
                Some((start, end)) => {
                    let chunk_size = end - start + 1;

                    file.seek(SeekFrom::Start(start)).await?;

                    let stream = ReaderStream::with_capacity(file.take(chunk_size), 64 * 1024);
                    let body = Body::from_stream(stream);

                    let content_range = format!("bytes {start}-{end}/{file_size}");
                    return Response::builder()
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::CONTENT_TYPE, content_type)
                        .header(header::ACCEPT_RANGES, "bytes")
                        .header(header::CONTENT_RANGE, content_range)
                        .header(header::CONTENT_LENGTH, chunk_size.to_string())
                        .body(body)
                        .map_err(|e| ServerError::Internal(e.to_string()));
                }
                None => {
                    let content_range = format!("bytes */{file_size}");
                    return Response::builder()
                        .status(StatusCode::RANGE_NOT_SATISFIABLE)
                        .header(header::CONTENT_RANGE, content_range)
                        .header(header::ACCEPT_RANGES, "bytes")
                        .body(Body::empty())
                        .map_err(|e| ServerError::Internal(e.to_string()));
                }
            }
        }
    }

    // Full content response
    let stream = ReaderStream::with_capacity(file, 64 * 1024);
    let body = Body::from_stream(stream);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .body(body)
        .map_err(|e| ServerError::Internal(e.to_string()))
}

/// Parses an RFC 7233 / 9110 HTTP Range header (e.g. `bytes=0-1024`, `bytes=500-`, `bytes=-500`).
fn parse_range_header(range_str: &str, file_size: u64) -> Option<(u64, u64)> {
    if file_size == 0 || !range_str.starts_with("bytes=") {
        return None;
    }
    let range = &range_str["bytes=".len()..];
    let parts: Vec<&str> = range.split('-').collect();
    if parts.len() != 2 {
        return None;
    }

    let max_pos = file_size - 1;

    if parts[0].is_empty() {
        // Suffix range: bytes=-500
        let suffix_len = parts[1].parse::<u64>().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = file_size.saturating_sub(suffix_len);
        Some((start, max_pos))
    } else {
        let start = parts[0].parse::<u64>().ok()?;
        if start > max_pos {
            return None;
        }
        let end = if parts[1].is_empty() {
            max_pos
        } else {
            let parsed_end = parts[1].parse::<u64>().ok()?;
            parsed_end.min(max_pos)
        };

        if start <= end {
            Some((start, end))
        } else {
            None
        }
    }
}

/// Locates the project workspace root directory.
pub fn find_project_root() -> PathBuf {
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

/// Locates the native Tauri desktop executable binary.
pub fn find_native_desktop_executable() -> Option<PathBuf> {
    let root = find_project_root();
    let candidates = [
        root.join("target/debug/wavery-tauri"),
        root.join("target/release/wavery-tauri"),
        root.join("target/debug/wavery"),
        root.join("target/release/wavery"),
    ];

    for p in &candidates {
        if p.is_file() {
            return Some(p.clone());
        }
    }

    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            let candidates = ["wavery-tauri", "wavery", "wavery-tauri.exe", "wavery.exe"];
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

/// Opens a URL in the user's default browser.
pub fn open_browser_url(url: &str) -> Result<(), std::io::Error> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", url])
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if std::process::Command::new("xdg-open").arg(url).spawn().is_err() {
            let _ = std::process::Command::new("gio").args(["open", url]).spawn();
        }
    }
    Ok(())
}

/// Spawns the native Tauri desktop application as a standalone subprocess.
pub fn spawn_native_process() -> Result<(), std::io::Error> {
    let root = find_project_root();
    let mut cmd = if let Some(exe) = find_native_desktop_executable() {
        let mut c = std::process::Command::new(&exe);
        c.current_dir(&root);
        c
    } else {
        let mut c = std::process::Command::new("cargo");
        c.current_dir(&root);
        c.args(["run", "-p", "wavery-tauri"]);
        c
    };

    #[cfg(target_os = "linux")]
    {
        cmd.env("GDK_BACKEND", "x11,wayland");
        cmd.env("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        if let Ok(disp) = std::env::var("DISPLAY") {
            cmd.env("DISPLAY", disp);
        }
        if let Ok(wdisp) = std::env::var("WAYLAND_DISPLAY") {
            cmd.env("WAYLAND_DISPLAY", wdisp);
        }
        if let Ok(xdir) = std::env::var("XDG_RUNTIME_DIR") {
            cmd.env("XDG_RUNTIME_DIR", xdir);
        }
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

async fn get_config_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<wavery_config::Config>, ServerError> {
    if let Ok(loaded) = wavery_config::load_or_create(&state.config_path) {
        let mut guard = state.config.write().await;
        *guard = loaded.clone();
        return Ok(Json(loaded));
    }
    let guard = state.config.read().await;
    Ok(Json(guard.clone()))
}

async fn save_config_handler(
    State(state): State<Arc<AppState>>,
    Json(new_config): Json<wavery_config::Config>,
) -> Result<Json<StatusResponse>, ServerError> {
    wavery_config::save(&state.config_path, &new_config)
        .map_err(|e| ServerError::Internal(format!("Failed to save config: {e}")))?;
    {
        let mut guard = state.config.write().await;
        *guard = new_config;
    }
    Ok(Json(StatusResponse {
        ok: true,
        message: "Configuration saved successfully".to_string(),
    }))
}

async fn export_config_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Response, ServerError> {
    let cfg = if let Ok(loaded) = wavery_config::load_or_create(&state.config_path) {
        let mut guard = state.config.write().await;
        *guard = loaded.clone();
        loaded
    } else {
        let guard = state.config.read().await;
        guard.clone()
    };

    let json_str = serde_json::to_string_pretty(&cfg)
        .map_err(|e| ServerError::Internal(format!("Failed to serialize config: {e}")))?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json_str))
        .map_err(|e| ServerError::Internal(e.to_string()))
}

async fn import_config_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<serde_json::Value>,
) -> Result<Json<wavery_config::Config>, ServerError> {
    let imported_config: wavery_config::Config = if let Some(s) = req.get("json_str").and_then(|v| v.as_str()) {
        serde_json::from_str(s).map_err(|e| ServerError::Internal(format!("Invalid JSON: {e}")))?
    } else {
        serde_json::from_value(req).map_err(|e| ServerError::Internal(format!("Invalid JSON config: {e}")))?
    };

    wavery_config::save(&state.config_path, &imported_config)
        .map_err(|e| ServerError::Internal(format!("Failed to save imported config: {e}")))?;
    {
        let mut guard = state.config.write().await;
        *guard = imported_config.clone();
    }
    Ok(Json(imported_config))
}

async fn get_session_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Option<wavery_core::models::PlaybackSession>>, ServerError> {
    let guard = state.session.read().await;
    Ok(Json(guard.clone()))
}

async fn save_session_handler(
    State(state): State<Arc<AppState>>,
    Json(session): Json<wavery_core::models::PlaybackSession>,
) -> Result<Json<StatusResponse>, ServerError> {
    let mut guard = state.session.write().await;
    *guard = Some(session);
    Ok(Json(StatusResponse {
        ok: true,
        message: "Session saved successfully".to_string(),
    }))
}

#[derive(Deserialize)]
struct ClaimPlaybackRequest {
    client: String, // "native" | "web"
}

async fn claim_playback_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ClaimPlaybackRequest>,
) -> Result<Json<StatusResponse>, ServerError> {
    let mut guard = state.session.write().await;
    if let Some(s) = guard.as_mut() {
        s.active_client = Some(req.client.clone());
    } else {
        *guard = Some(wavery_core::models::PlaybackSession {
            active_client: Some(req.client.clone()),
            ..Default::default()
        });
    }
    Ok(Json(StatusResponse {
        ok: true,
        message: format!("Playback claimed by {}", req.client),
    }))
}

async fn switch_to_native_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StatusResponse>, ServerError> {
    tracing::info!("Switching display from Web to Native Desktop application...");

    {
        let mut guard = state.session.write().await;
        if let Some(s) = guard.as_mut() {
            s.active_client = Some("native".to_string());
        }
    }

    match spawn_native_process() {
        Ok(_) => Ok(Json(StatusResponse {
            ok: true,
            message: "Native desktop display launched successfully.".to_string(),
        })),
        Err(e) => {
            tracing::error!("Failed to launch native desktop display: {}", e);
            Err(ServerError::Internal(format!(
                "Failed to launch native desktop display: {}",
                e
            )))
        }
    }
}

async fn quit_app_handler() -> Result<Json<StatusResponse>, ServerError> {
    tracing::info!("Shutting down Wavery background server...");
    tokio::spawn(async {
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
        std::process::exit(0);
    });
    Ok(Json(StatusResponse {
        ok: true,
        message: "Wavery background server shutting down.".to_string(),
    }))
}

#[cfg(test)]
mod tests;



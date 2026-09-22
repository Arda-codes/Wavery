//! Concrete implementation of LibraryManager.
//!
//! Enforces the Copy vs Move strategy: external files are either duplicated or moved
//! into the internal managed library root directory (`~/.local/share/wavery/library/`).

use crate::db::LibraryDatabase;
use crate::reader::LoftyMetadataReader;
use async_trait::async_trait;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::task::JoinSet;
use walkdir::WalkDir;
use wavery_core::error::LibraryError;
use wavery_core::models::{
    Album, Artist, ImportStrategy, Playlist, ScanProgress, ScanSummary, Track, TrackMetadata,
    TrackSource,
};
use wavery_core::traits::{LibraryManager, MetadataReader};

/// Supported audio extensions for directory discovery.
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "ogg", "opus", "m4a", "wav", "aac", "alac", "aiff", "wma",
];

/// Batch size for chunked parallel processing and database ingestion.
const INGEST_BATCH_SIZE: usize = 250;

/// SQLite and filesystem backed implementation of LibraryManager.
pub struct SqliteLibraryManager {
    library_root: PathBuf,
    db: Arc<LibraryDatabase>,
    reader: LoftyMetadataReader,
    tracks_cache: Vec<Track>,
}

impl SqliteLibraryManager {
    /// Creates and initializes the library manager, loading initial tracks from SQLite.
    pub fn new(library_root: PathBuf, db_path: PathBuf) -> Result<Self, LibraryError> {
        fs::create_dir_all(&library_root)?;
        let db = Arc::new(LibraryDatabase::open(&db_path)?);
        let _ = db.prune_missing_files(&library_root);

        let reader = LoftyMetadataReader::new();
        if let Ok(missing_lyrics) = db.get_tracks_missing_lyrics() {
            for (id, rel_path) in missing_lyrics {
                let full_path = library_root.join(&rel_path);
                if full_path.is_file() {
                    if let Ok(meta) = reader.read_metadata(&full_path) {
                        if let Some(lyrics) = meta.lyrics {
                            let _ = db.set_track_lyrics(&id, &lyrics);
                        }
                    }
                }
            }
        }

        let tracks = db.load_all(&library_root)?;

        Ok(Self {
            library_root,
            db,
            reader,
            tracks_cache: tracks,
        })
    }

    /// Access the underlying `LibraryDatabase` instance.
    #[must_use]
    pub fn db(&self) -> &Arc<LibraryDatabase> {
        &self.db
    }

    /// Query aggregated album summaries directly from SQLite.
    pub fn list_albums(&self) -> Result<Vec<Album>, LibraryError> {
        self.db.list_albums()
    }

    /// Query aggregated artist summaries directly from SQLite.
    pub fn list_artists(&self) -> Result<Vec<Artist>, LibraryError> {
        self.db.list_artists()
    }

    /// Query tracks for a specific album ordered by disc and track number.
    pub fn get_album_tracks(
        &self,
        album: &str,
        artist: Option<&str>,
    ) -> Result<Vec<Track>, LibraryError> {
        self.db.get_album_tracks(album, artist, &self.library_root)
    }

    /// Full-text search across titles, artists, albums, and genres using SQLite FTS5.
    pub fn search_fts(&self, query: &str) -> Result<Vec<Track>, LibraryError> {
        self.db.search_fts(query, &self.library_root)
    }

    /// Creates a new empty playlist.
    pub fn create_playlist(&self, name: &str) -> Result<Playlist, LibraryError> {
        self.db.create_playlist(name)
    }

    /// Fetches a playlist and its ordered tracks by playlist ID.
    pub fn get_playlist(&self, id: &str) -> Result<Option<Playlist>, LibraryError> {
        self.db.get_playlist(id)
    }

    /// Lists all user playlists.
    pub fn list_playlists(&self) -> Result<Vec<Playlist>, LibraryError> {
        self.db.list_playlists()
    }

    /// Saves or updates a playlist definition.
    pub fn save_playlist(&self, playlist: &Playlist) -> Result<(), LibraryError> {
        self.db.save_playlist(playlist)
    }

    /// Renames a playlist.
    pub fn rename_playlist(&self, playlist_id: &str, new_name: &str) -> Result<(), LibraryError> {
        self.db.rename_playlist(playlist_id, new_name)
    }

    /// Deletes a playlist by ID.
    pub fn delete_playlist(&self, id: &str) -> Result<(), LibraryError> {
        self.db.delete_playlist(id)
    }

    /// Appends track IDs to a playlist.
    pub fn add_tracks_to_playlist(
        &self,
        playlist_id: &str,
        track_ids: &[String],
    ) -> Result<(), LibraryError> {
        self.db.add_tracks_to_playlist(playlist_id, track_ids)
    }

    /// Removes a track from a playlist.
    pub fn remove_track_from_playlist(
        &self,
        playlist_id: &str,
        track_id: &str,
    ) -> Result<(), LibraryError> {
        self.db.remove_track_from_playlist(playlist_id, track_id)
    }

    /// Fetches all full Track domain models in a playlist.
    pub fn get_playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>, LibraryError> {
        self.db.get_playlist_tracks(playlist_id, &self.library_root)
    }

    /// Likes a track.
    pub fn like_track(&self, track_id: &str) -> Result<(), LibraryError> {
        self.db.like_track(track_id)
    }

    /// Unlikes a track.
    pub fn unlike_track(&self, track_id: &str) -> Result<(), LibraryError> {
        self.db.unlike_track(track_id)
    }

    /// Toggles the like status of a track.
    pub fn toggle_like(&self, track_id: &str) -> Result<bool, LibraryError> {
        self.db.toggle_like(track_id)
    }

    /// Checks if a track is liked.
    pub fn is_track_liked(&self, track_id: &str) -> Result<bool, LibraryError> {
        self.db.is_track_liked(track_id)
    }

    /// Returns list of all liked track IDs.
    pub fn get_liked_track_ids(&self) -> Result<Vec<String>, LibraryError> {
        self.db.get_liked_track_ids()
    }

    /// Returns all liked Track domain models.
    pub fn get_liked_tracks(&self) -> Result<Vec<Track>, LibraryError> {
        self.db.get_liked_tracks(&self.library_root)
    }

    /// Full rebuild and rescan of the managed library directory from scratch.
    pub async fn rebuild_library(&mut self) -> Result<Vec<Track>, LibraryError> {
        // 1. Clear database tracks and FTS index
        self.db.clear_all_tracks()?;

        // 2. Clear in-memory cache
        self.tracks_cache.clear();

        // 3. Rescan the entire managed root directory
        let root = self.library_root.clone();
        let scanned = self
            .import_directory(&root, ImportStrategy::Copy)
            .await?;

        // 4. Vacuum and optimize SQLite storage
        self.db.vacuum_database()?;

        Ok(scanned)
    }

    /// Vacuum SQLite database
    pub fn vacuum_database(&self) -> Result<(), LibraryError> {
        self.db.vacuum_database()
    }
}

fn get_base_stem_if_legacy_uuid(stem: &str) -> Option<&str> {
    if stem.len() > 9 && stem.as_bytes()[stem.len() - 9] == b'_' {
        let suffix = &stem[stem.len() - 8..];
        if suffix.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(&stem[..stem.len() - 9]);
        }
    }
    None
}

fn process_single_file(
    source_path: &Path,
    strategy: ImportStrategy,
    library_root: &Path,
    reader: &LoftyMetadataReader,
) -> Result<Track, LibraryError> {
    if !source_path.is_file() {
        return Err(LibraryError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Source file not found: {}", source_path.display()),
        )));
    }

    let is_already_managed = source_path.starts_with(library_root);

    // 1. Read metadata from the source file
    let metadata = reader.read_metadata(source_path)?;

    let date_added = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let dest_path = if is_already_managed {
        // If file is already inside the managed library directory, check for legacy UUID duplicates
        let stem = source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        if let Some(base_stem) = get_base_stem_if_legacy_uuid(stem) {
            let ext = source_path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("mp3");
            let sibling_canonical = source_path.with_file_name(format!("{base_stem}.{ext}"));
            let managed_canonical = generate_managed_destination(library_root, source_path, &metadata);

            let canonical = if sibling_canonical.exists() {
                sibling_canonical
            } else if managed_canonical.exists() {
                managed_canonical
            } else {
                sibling_canonical
            };

            if canonical.exists() && canonical != source_path {
                // Remove legacy duplicate file from disk and skip importing
                let _ = fs::remove_file(source_path);
                return Err(LibraryError::DuplicateSkipped(format!(
                    "Cleaned up legacy duplicate: {}",
                    source_path.display()
                )));
            } else if !canonical.exists() {
                // If canonical file does not exist, rename legacy duplicate back to canonical name
                if let Some(parent) = canonical.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if fs::rename(source_path, &canonical).is_ok() {
                    canonical
                } else {
                    source_path.to_path_buf()
                }
            } else {
                source_path.to_path_buf()
            }
        } else {
            source_path.to_path_buf()
        }
    } else {
        // 2. External file: determine target path inside managed store
        let target_dest = generate_managed_destination(library_root, source_path, &metadata);
        if let Some(parent) = target_dest.parent() {
            fs::create_dir_all(parent)?;
        }

        // 3. Execute Copy vs Move
        if target_dest != source_path {
            match strategy {
                ImportStrategy::Copy => {
                    fs::copy(source_path, &target_dest)?;
                }
                ImportStrategy::Move => {
                    if fs::rename(source_path, &target_dest).is_err() {
                        fs::copy(source_path, &target_dest)?;
                        let _ = fs::remove_file(source_path);
                    }
                }
            }
        }
        target_dest
    };

    // 4. Calculate relative path and deterministic ID
    let rel_path = dest_path.strip_prefix(library_root).unwrap_or(&dest_path);
    let id = compute_track_id(rel_path);

    Ok(Track {
        id,
        source: TrackSource::Managed(dest_path),
        metadata,
        date_added,
    })
}

fn generate_managed_destination(
    library_root: &Path,
    source_path: &Path,
    meta: &TrackMetadata,
) -> PathBuf {
    let artist_clean = sanitize_filename(meta.artist.as_deref().unwrap_or("Unknown Artist"));
    let album_clean = sanitize_filename(meta.album.as_deref().unwrap_or("Unknown Album"));

    let raw_stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("track");
    let file_stem = get_base_stem_if_legacy_uuid(raw_stem).unwrap_or(raw_stem);

    let ext = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp3");

    let track_prefix = meta
        .track_number
        .map(|n| format!("{n:02} - "))
        .unwrap_or_default();

    let title_clean = match meta.title.as_deref() {
        Some(t) if t == raw_stem => file_stem,
        Some(t) => {
            if let Some(base) = get_base_stem_if_legacy_uuid(t) {
                base
            } else {
                t
            }
        }
        None => file_stem,
    };

    let filename = format!(
        "{}{}.{}",
        track_prefix,
        sanitize_filename(title_clean),
        ext
    );

    library_root
        .join(artist_clean)
        .join(album_clean)
        .join(filename)
}

fn compute_track_id(rel_path: &Path) -> String {
    let mut hasher = Sha256::new();
    let normalized = rel_path.to_string_lossy().replace('\\', "/");
    hasher.update(normalized.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

fn sanitize_filename(name: &str) -> String {
    let invalid_chars = ['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>', '\0', '\r', '\n', '\t'];
    let mut cleaned: String = name
        .chars()
        .map(|c| if invalid_chars.contains(&c) || c.is_control() { '_' } else { c })
        .collect();
    if cleaned.trim().is_empty() {
        cleaned = "Unknown".into();
    }
    cleaned.trim().to_string()
}

#[async_trait]
impl LibraryManager for SqliteLibraryManager {
    fn library_root(&self) -> &Path {
        &self.library_root
    }

    async fn import_track(
        &mut self,
        source_path: &Path,
        strategy: ImportStrategy,
    ) -> Result<Track, LibraryError> {
        let track = process_single_file(
            source_path,
            strategy,
            &self.library_root,
            &self.reader,
        )?;

        // Persist to DB and update in-memory cache
        self.db.insert_or_update(&track, &self.library_root)?;

        if let Some(pos) = self.tracks_cache.iter().position(|t| t.id == track.id) {
            self.tracks_cache[pos] = track.clone();
        } else {
            self.tracks_cache.push(track.clone());
        }

        Ok(track)
    }

    async fn import_directory(
        &mut self,
        dir_path: &Path,
        strategy: ImportStrategy,
    ) -> Result<Vec<Track>, LibraryError> {
        self.import_directory_with_progress(dir_path, strategy, None)
            .await
    }

    async fn import_directory_with_progress(
        &mut self,
        dir_path: &Path,
        strategy: ImportStrategy,
        progress_tx: Option<mpsc::Sender<ScanProgress>>,
    ) -> Result<Vec<Track>, LibraryError> {
        let start_time = Instant::now();

        // 1. Directory discovery
        let mut candidate_files = Vec::new();
        for entry in WalkDir::new(dir_path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                        candidate_files.push(path.to_path_buf());
                    }
                }
            }
        }

        let total_files = candidate_files.len();
        if let Some(tx) = &progress_tx {
            let _ = tx.send(ScanProgress::DiscoveredFiles(total_files)).await;
        }

        if total_files == 0 {
            let summary = ScanSummary {
                scanned_files: 0,
                imported_tracks: 0,
                failed_files: 0,
                duration_ms: start_time.elapsed().as_millis() as u64,
            };
            if let Some(tx) = &progress_tx {
                let _ = tx.send(ScanProgress::Completed(summary)).await;
            }
            return Ok(Vec::new());
        }

        let mut imported_tracks = Vec::with_capacity(total_files);
        let mut failed_count = 0;
        let mut processed_count = 0;

        // 2. Parallel processing in chunks
        for chunk in candidate_files.chunks(INGEST_BATCH_SIZE) {
            let mut join_set = JoinSet::new();

            for file_path in chunk {
                let path_buf = file_path.clone();
                let lib_root = self.library_root.clone();
                let reader = self.reader.clone();

                join_set.spawn_blocking(move || {
                    process_single_file(&path_buf, strategy, &lib_root, &reader)
                });
            }

            let mut batch_tracks = Vec::with_capacity(chunk.len());
            while let Some(res) = join_set.join_next().await {
                processed_count += 1;
                match res {
                    Ok(Ok(track)) => {
                        if let Some(tx) = &progress_tx {
                            let _ = tx
                                .send(ScanProgress::Processing {
                                    current: processed_count,
                                    total: total_files,
                                    current_file: track.source.path().clone(),
                                })
                                .await;
                        }
                        batch_tracks.push(track);
                    }
                    Ok(Err(LibraryError::DuplicateSkipped(_))) => {
                        // Silently skip cleaned up legacy duplicate
                    }
                    Ok(Err(err)) => {
                        failed_count += 1;
                        eprintln!("Failed to process audio track: {err}");
                    }
                    Err(join_err) => {
                        failed_count += 1;
                        eprintln!("Worker thread join error: {join_err}");
                    }
                }
            }

            // 3. Batched database ingestion per chunk
            if !batch_tracks.is_empty() {
                self.db
                    .insert_or_update_batch(&batch_tracks, &self.library_root)?;

                for track in &batch_tracks {
                    if let Some(pos) = self.tracks_cache.iter().position(|t| t.id == track.id) {
                        self.tracks_cache[pos] = track.clone();
                    } else {
                        self.tracks_cache.push(track.clone());
                    }
                }

                if let Some(tx) = &progress_tx {
                    let _ = tx
                        .send(ScanProgress::BatchIngested {
                            count: batch_tracks.len(),
                            total: total_files,
                        })
                        .await;
                }

                imported_tracks.extend(batch_tracks);
            }
        }

        if dir_path.starts_with(&self.library_root) {
            let _ = self.db.prune_missing_files(&self.library_root);
            self.tracks_cache = self.db.load_all(&self.library_root)?;
        }

        let summary = ScanSummary {
            scanned_files: total_files,
            imported_tracks: imported_tracks.len(),
            failed_files: failed_count,
            duration_ms: start_time.elapsed().as_millis() as u64,
        };

        if let Some(tx) = &progress_tx {
            let _ = tx.send(ScanProgress::Completed(summary)).await;
        }

        Ok(imported_tracks)
    }

    async fn delete_track(
        &mut self,
        track_id: &str,
        remove_file: bool,
    ) -> Result<(), LibraryError> {
        let deleted_rel = self.db.delete(track_id)?;

        if remove_file {
            if let Some(rel) = deleted_rel {
                let full = if rel.is_absolute() {
                    rel
                } else {
                    self.library_root.join(rel)
                };
                if full.exists() {
                    let _ = fs::remove_file(full);
                }
            }
        }

        self.tracks_cache.retain(|t| t.id != track_id);
        Ok(())
    }

    fn get_track(&self, track_id: &str) -> Option<&Track> {
        self.tracks_cache.iter().find(|t| t.id == track_id)
    }

    fn all_tracks(&self) -> &[Track] {
        &self.tracks_cache
    }

    fn search(&self, query: &str) -> Vec<&Track> {
        let q = query.to_lowercase();
        self.tracks_cache
            .iter()
            .filter(|track| {
                let title_match = track
                    .metadata
                    .title
                    .as_deref()
                    .map(|t| t.to_lowercase().contains(&q))
                    .unwrap_or(false);
                let artist_match = track
                    .metadata
                    .artist
                    .as_deref()
                    .map(|a| a.to_lowercase().contains(&q))
                    .unwrap_or(false);
                let album_match = track
                    .metadata
                    .album
                    .as_deref()
                    .map(|al| al.to_lowercase().contains(&q))
                    .unwrap_or(false);

                title_match || artist_match || album_match
            })
            .collect()
    }

    async fn update_track_metadata(
        &mut self,
        track_id: &str,
        metadata: &TrackMetadata,
        write_tags: bool,
    ) -> Result<Track, LibraryError> {
        let pos = self
            .tracks_cache
            .iter()
            .position(|t| t.id == track_id)
            .ok_or_else(|| LibraryError::TrackNotFound(track_id.to_string()))?;

        // 1. Update SQLite database
        self.db.update_track_metadata(track_id, metadata)?;

        // 2. Update physical tags on disk if requested
        if write_tags {
            let relative_path = match &self.tracks_cache[pos].source {
                TrackSource::Managed(p) => PathBuf::from(p),
            };
            let absolute_path = if relative_path.is_absolute() {
                relative_path
            } else {
                self.library_root.join(relative_path)
            };

            if absolute_path.exists() {
                let _ = self.reader.write_metadata(&absolute_path, metadata);
            }
        }

        // 3. Update in-memory cache
        self.tracks_cache[pos].metadata.title = metadata.title.clone();
        self.tracks_cache[pos].metadata.artist = metadata.artist.clone();
        self.tracks_cache[pos].metadata.album = metadata.album.clone();
        self.tracks_cache[pos].metadata.album_artist = metadata.album_artist.clone();
        self.tracks_cache[pos].metadata.track_number = metadata.track_number;
        self.tracks_cache[pos].metadata.disc_number = metadata.disc_number;
        self.tracks_cache[pos].metadata.year = metadata.year;
        self.tracks_cache[pos].metadata.genre = metadata.genre.clone();
        self.tracks_cache[pos].metadata.lyrics = metadata.lyrics.clone();

        Ok(self.tracks_cache[pos].clone())
    }
}

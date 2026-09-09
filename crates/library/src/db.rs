//! SQLite persistence layer for Wavery's music library.

use rusqlite::{params, Connection, Row};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use wavery_core::error::LibraryError;
use wavery_core::models::{Album, Artist, Playlist, Track, TrackMetadata, TrackSource};

/// Database wrapper around a thread-safe Mutex<Connection>.
pub struct LibraryDatabase {
    conn: Mutex<Connection>,
}

impl LibraryDatabase {
    /// Opens or creates SQLite database file and executes PRAGMA tuning and initial schema migrations.
    pub fn open(db_path: &Path) -> Result<Self, LibraryError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)
            .map_err(|e| LibraryError::IndexError(format!("Failed to open DB: {e}")))?;

        // Set high-performance PRAGMAs
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA cache_size = -64000;
             PRAGMA busy_timeout = 5000;
             PRAGMA temp_store = MEMORY;",
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to set SQLite PRAGMAs: {e}")))?;

        conn.busy_timeout(Duration::from_millis(5000))
            .map_err(|e| LibraryError::IndexError(format!("Failed to set busy timeout: {e}")))?;

        // Execute schema migrations, composite indexes, playlist tables, and FTS5 virtual table
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY,
                relative_path TEXT NOT NULL,
                title TEXT,
                artist TEXT,
                album TEXT,
                album_artist TEXT,
                track_number INTEGER,
                disc_number INTEGER,
                year INTEGER,
                genre TEXT,
                duration_secs REAL NOT NULL,
                sample_rate INTEGER,
                bit_depth INTEGER,
                channels INTEGER,
                format TEXT NOT NULL,
                date_added INTEGER NOT NULL,
                lyrics TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
            CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
            CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
            CREATE INDEX IF NOT EXISTS idx_tracks_album_artist ON tracks(album_artist);
            CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(date_added DESC);
            CREATE INDEX IF NOT EXISTS idx_tracks_album_order ON tracks(album, disc_number, track_number);
            CREATE INDEX IF NOT EXISTS idx_tracks_artist_album ON tracks(artist, album);

            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, position),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);

            CREATE TABLE IF NOT EXISTS liked_tracks (
                track_id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_liked_tracks_created ON liked_tracks(created_at DESC);

            CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
                title,
                artist,
                album,
                album_artist,
                genre,
                content='tracks',
                content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 2'
            );

            CREATE TRIGGER IF NOT EXISTS tracks_ai AFTER INSERT ON tracks BEGIN
                INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre)
                VALUES (new.rowid, new.title, new.artist, new.album, new.album_artist, new.genre);
            END;

            CREATE TRIGGER IF NOT EXISTS tracks_ad AFTER DELETE ON tracks BEGIN
                INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, album_artist, genre)
                VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.album_artist, old.genre);
            END;

            CREATE TRIGGER IF NOT EXISTS tracks_au AFTER UPDATE ON tracks BEGIN
                INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, album_artist, genre)
                VALUES ('delete', old.rowid, old.title, old.artist, old.album, old.album_artist, old.genre);
                INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre)
                VALUES (new.rowid, new.title, new.artist, new.album, new.album_artist, new.genre);
            END;

            INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild');
            ",
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed schema migration: {e}")))?;

        // Ensure lyrics column exists for pre-existing databases
        let has_lyrics: bool = conn
            .prepare("PRAGMA table_info(tracks)")
            .and_then(|mut stmt| {
                let mut rows = stmt.query([])?;
                while let Some(row) = rows.next()? {
                    let col_name: String = row.get(1)?;
                    if col_name == "lyrics" {
                        return Ok(true);
                    }
                }
                Ok(false)
            })
            .unwrap_or(false);

        if !has_lyrics {
            conn.execute("ALTER TABLE tracks ADD COLUMN lyrics TEXT;", [])
                .map_err(|e| LibraryError::IndexError(format!("Failed to add lyrics column: {e}")))?;
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Upserts a single track into the database.
    pub fn insert_or_update(&self, track: &Track, managed_root: &Path) -> Result<(), LibraryError> {
        self.insert_or_update_batch(std::slice::from_ref(track), managed_root)
    }

    /// Upserts a batch of tracks into the database using a single transaction and prepared statement.
    pub fn insert_or_update_batch(
        &self,
        tracks: &[Track],
        managed_root: &Path,
    ) -> Result<(), LibraryError> {
        if tracks.is_empty() {
            return Ok(());
        }

        let mut conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let tx = conn
            .transaction()
            .map_err(|e| LibraryError::IndexError(format!("Failed to start transaction: {e}")))?;

        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT INTO tracks (
                        id, relative_path, title, artist, album, album_artist,
                        track_number, disc_number, year, genre, duration_secs,
                        sample_rate, bit_depth, channels, format, date_added, lyrics
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
                    )
                    ON CONFLICT(id) DO UPDATE SET
                        relative_path = excluded.relative_path,
                        title = excluded.title,
                        artist = excluded.artist,
                        album = excluded.album,
                        album_artist = excluded.album_artist,
                        track_number = excluded.track_number,
                        disc_number = excluded.disc_number,
                        year = excluded.year,
                        genre = excluded.genre,
                        duration_secs = excluded.duration_secs,
                        sample_rate = excluded.sample_rate,
                        bit_depth = excluded.bit_depth,
                        channels = excluded.channels,
                        format = excluded.format,
                        date_added = excluded.date_added,
                        lyrics = excluded.lyrics",
                )
                .map_err(|e| LibraryError::IndexError(format!("Failed to prepare cached statement: {e}")))?;

            for track in tracks {
                let full_path = track.source.path();
                let rel_path = full_path
                    .strip_prefix(managed_root)
                    .unwrap_or(full_path)
                    .to_string_lossy()
                    .to_string();

                stmt.execute(params![
                    track.id,
                    rel_path,
                    track.metadata.title,
                    track.metadata.artist,
                    track.metadata.album,
                    track.metadata.album_artist,
                    track.metadata.track_number,
                    track.metadata.disc_number,
                    track.metadata.year,
                    track.metadata.genre,
                    track.metadata.duration.as_secs_f64(),
                    track.metadata.sample_rate,
                    track.metadata.bit_depth,
                    track.metadata.channels,
                    track.metadata.format,
                    track.date_added as i64,
                    track.metadata.lyrics,
                ])
                .map_err(|e| LibraryError::IndexError(format!("Failed to insert track: {e}")))?;
            }
        }

        tx.commit()
            .map_err(|e| LibraryError::IndexError(format!("Failed to commit batch: {e}")))?;

        Ok(())
    }

    /// Deletes a track from the database by ID, returning its relative path if found.
    pub fn delete(&self, track_id: &str) -> Result<Option<PathBuf>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn
            .prepare("SELECT relative_path FROM tracks WHERE id = ?1")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut rows = stmt
            .query(params![track_id])
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let rel_path: Option<String> = if let Some(row) = rows.next().map_err(|e| LibraryError::IndexError(e.to_string()))? {
            Some(row.get(0).map_err(|e| LibraryError::IndexError(e.to_string()))?)
        } else {
            None
        };
        drop(rows);
        drop(stmt);

        conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])
            .map_err(|e| LibraryError::IndexError(format!("Failed delete: {e}")))?;

        Ok(rel_path.map(PathBuf::from))
    }

    /// Clear all tracks from SQLite database and reset FTS5 virtual table.
    pub fn clear_all_tracks(&self) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        conn.execute_batch(
            "DELETE FROM tracks;
             INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild');",
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to clear tracks: {e}")))?;

        Ok(())
    }

    /// Vacuums and checkpoints SQLite database to reclaim disk space.
    pub fn vacuum_database(&self) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        conn.execute_batch(
            "PRAGMA wal_checkpoint(TRUNCATE);
             VACUUM;
             PRAGMA optimize;",
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to vacuum DB: {e}")))?;

        Ok(())
    }

    /// Prunes database rows for tracks whose physical files on disk no longer exist.
    pub fn prune_missing_files(&self, managed_root: &Path) -> Result<usize, LibraryError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn
            .prepare("SELECT id, relative_path FROM tracks")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut missing_ids = Vec::new();
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let rel_path: String = row.get(1)?;
                Ok((id, rel_path))
            })
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        for (id, rel_path) in rows.flatten() {
            let full_path = managed_root.join(&rel_path);
            if !full_path.exists() {
                missing_ids.push(id);
            }
        }
        drop(stmt);

        if missing_ids.is_empty() {
            return Ok(0);
        }

        let tx = conn
            .transaction()
            .map_err(|e| LibraryError::IndexError(format!("Failed to start transaction: {e}")))?;

        {
            let mut del_stmt = tx
                .prepare_cached("DELETE FROM tracks WHERE id = ?1")
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            for id in &missing_ids {
                del_stmt
                    .execute(params![id])
                    .map_err(|e| LibraryError::IndexError(e.to_string()))?;
            }
        }

        tx.commit()
            .map_err(|e| LibraryError::IndexError(format!("Failed to commit prune transaction: {e}")))?;

        Ok(missing_ids.len())
    }

    /// Updates track metadata fields in SQLite.
    pub fn update_track_metadata(
        &self,
        track_id: &str,
        metadata: &TrackMetadata,
    ) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let res = conn.execute(
            "UPDATE tracks SET
                title = ?1,
                artist = ?2,
                album = ?3,
                album_artist = ?4,
                track_number = ?5,
                disc_number = ?6,
                year = ?7,
                genre = ?8,
                lyrics = ?9
             WHERE id = ?10",
            params![
                metadata.title,
                metadata.artist,
                metadata.album,
                metadata.album_artist,
                metadata.track_number,
                metadata.disc_number,
                metadata.year,
                metadata.genre,
                metadata.lyrics,
                track_id,
            ],
        );

        if let Err(e) = res {
            // Rebuild FTS5 virtual table if trigger indexing was desynchronized
            let _ = conn.execute_batch("INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild');");
            conn.execute(
                "UPDATE tracks SET
                    title = ?1,
                    artist = ?2,
                    album = ?3,
                    album_artist = ?4,
                    track_number = ?5,
                    disc_number = ?6,
                    year = ?7,
                    genre = ?8,
                    lyrics = ?9
                 WHERE id = ?10",
                params![
                    metadata.title,
                    metadata.artist,
                    metadata.album,
                    metadata.album_artist,
                    metadata.track_number,
                    metadata.disc_number,
                    metadata.year,
                    metadata.genre,
                    metadata.lyrics,
                    track_id,
                ],
            )
            .map_err(|retry_err| {
                LibraryError::IndexError(format!("Failed to update track metadata: {retry_err} (initial: {e})"))
            })?;
        }

        Ok(())
    }

    /// Returns list of (track_id, relative_path) tuples for all tracks currently missing lyrics.
    pub fn get_tracks_missing_lyrics(&self) -> Result<Vec<(String, String)>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn
            .prepare("SELECT id, relative_path FROM tracks WHERE lyrics IS NULL")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut result = Vec::new();
        for r in rows {
            result.push(r.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(result)
    }

    /// Sets the lyrics text for an existing track.
    pub fn set_track_lyrics(&self, track_id: &str, lyrics: &str) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        conn.execute(
            "UPDATE tracks SET lyrics = ?1 WHERE id = ?2",
            params![lyrics, track_id],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to update track lyrics: {e}")))?;

        Ok(())
    }

    /// Fetches a single track by its ID.
    pub fn get_track(&self, track_id: &str, managed_root: &Path) -> Result<Option<Track>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn.prepare(
            "SELECT id, relative_path, title, artist, album, album_artist,
                    track_number, disc_number, year, genre, duration_secs,
                    sample_rate, bit_depth, channels, format, date_added, lyrics
             FROM tracks WHERE id = ?1",
        ).map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut rows = stmt
            .query(params![track_id])
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        if let Some(row) = rows.next().map_err(|e| LibraryError::IndexError(e.to_string()))? {
            let track = row_to_track(row, managed_root)
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;
            Ok(Some(track))
        } else {
            Ok(None)
        }
    }

    /// Fetches all tracks mapped with the managed root directory.
    pub fn load_all(&self, managed_root: &Path) -> Result<Vec<Track>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let total_count: usize = conn
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .unwrap_or(0);

        let mut stmt = conn.prepare(
            "SELECT id, relative_path, title, artist, album, album_artist,
                    track_number, disc_number, year, genre, duration_secs,
                    sample_rate, bit_depth, channels, format, date_added, lyrics
             FROM tracks ORDER BY artist, album, track_number, title",
        ).map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let track_iter = stmt
            .query_map([], |row| row_to_track(row, managed_root))
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut tracks = Vec::with_capacity(total_count);
        for item in track_iter {
            tracks.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(tracks)
    }

    /// Aggregates all albums directly inside SQLite with release year, track count, total duration, and artwork ID.
    pub fn list_albums(&self) -> Result<Vec<Album>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn.prepare(
            "SELECT 
                 COALESCE(NULLIF(album, ''), 'Unknown Album') AS album_title,
                 COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist') AS artist_name,
                 MIN(year) AS release_year,
                 MIN(id) AS artwork_track_id,
                 COUNT(*) AS track_count,
                 SUM(duration_secs) AS total_duration_secs
             FROM tracks
             GROUP BY LOWER(COALESCE(NULLIF(album, ''), 'Unknown Album')), LOWER(COALESCE(NULLIF(album_artist, ''), NULLIF(artist, ''), 'Unknown Artist'))
             ORDER BY album_title COLLATE NOCASE ASC",
        ).map_err(|e| LibraryError::IndexError(format!("Failed to prepare list_albums: {e}")))?;

        let album_iter = stmt
            .query_map([], |row| {
                let title: String = row.get(0)?;
                let artist: String = row.get(1)?;
                let year: Option<i32> = row.get(2)?;
                let artwork_track_id: Option<String> = row.get(3)?;
                let track_count: usize = row.get(4)?;
                let total_duration_secs: f64 = row.get(5)?;

                Ok(Album {
                    title,
                    artist,
                    year,
                    artwork_track_id,
                    track_count,
                    total_duration: Duration::from_secs_f64(total_duration_secs.max(0.0)),
                })
            })
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut albums = Vec::new();
        for item in album_iter {
            albums.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(albums)
    }

    /// Aggregates all artists directly inside SQLite with distinct album count, track count, and artwork ID.
    pub fn list_artists(&self) -> Result<Vec<Artist>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn.prepare(
            "SELECT 
                 COALESCE(NULLIF(artist, ''), 'Unknown Artist') AS artist_name,
                 COUNT(DISTINCT LOWER(COALESCE(NULLIF(album, ''), 'Unknown Album'))) AS album_count,
                 COUNT(*) AS track_count,
                 MIN(id) AS artwork_track_id
             FROM tracks
             GROUP BY LOWER(COALESCE(NULLIF(artist, ''), 'Unknown Artist'))
             ORDER BY artist_name COLLATE NOCASE ASC",
        ).map_err(|e| LibraryError::IndexError(format!("Failed to prepare list_artists: {e}")))?;

        let artist_iter = stmt
            .query_map([], |row| {
                let name: String = row.get(0)?;
                let album_count: usize = row.get(1)?;
                let track_count: usize = row.get(2)?;
                let artwork_track_id: Option<String> = row.get(3)?;

                Ok(Artist {
                    name,
                    album_count,
                    track_count,
                    artwork_track_id,
                })
            })
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut artists = Vec::new();
        for item in artist_iter {
            artists.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(artists)
    }

    /// Queries tracks for an album ordered by disc number, track number, and title.
    pub fn get_album_tracks(
        &self,
        album: &str,
        artist: Option<&str>,
        managed_root: &Path,
    ) -> Result<Vec<Track>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut tracks = Vec::new();
        if let Some(art) = artist {
            let mut stmt = conn.prepare(
                "SELECT id, relative_path, title, artist, album, album_artist,
                        track_number, disc_number, year, genre, duration_secs,
                        sample_rate, bit_depth, channels, format, date_added, lyrics
                 FROM tracks
                 WHERE album = ?1 AND (artist = ?2 OR album_artist = ?2)
                 ORDER BY COALESCE(disc_number, 1) ASC, COALESCE(track_number, 0) ASC, title ASC",
            ).map_err(|e| LibraryError::IndexError(e.to_string()))?;

            let iter = stmt
                .query_map(params![album, art], |row| row_to_track(row, managed_root))
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            for item in iter {
                tracks.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, relative_path, title, artist, album, album_artist,
                        track_number, disc_number, year, genre, duration_secs,
                        sample_rate, bit_depth, channels, format, date_added, lyrics
                 FROM tracks
                 WHERE album = ?1
                 ORDER BY COALESCE(disc_number, 1) ASC, COALESCE(track_number, 0) ASC, title ASC",
            ).map_err(|e| LibraryError::IndexError(e.to_string()))?;

            let iter = stmt
                .query_map(params![album], |row| row_to_track(row, managed_root))
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            for item in iter {
                tracks.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
            }
        }

        Ok(tracks)
    }

    /// Full-Text Search against `tracks_fts` covering title, artist, album, album_artist, and genre.
    pub fn search_fts(&self, query: &str, managed_root: &Path) -> Result<Vec<Track>, LibraryError> {
        let terms: Vec<String> = query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(|w| format!("\"{}\"*", w))
            .collect();

        if terms.is_empty() {
            return Ok(Vec::new());
        }

        let fts_query = terms.join(" ");

        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn.prepare(
            "SELECT t.id, t.relative_path, t.title, t.artist, t.album, t.album_artist,
                    t.track_number, t.disc_number, t.year, t.genre, t.duration_secs,
                    t.sample_rate, t.bit_depth, t.channels, t.format, t.date_added, t.lyrics
             FROM tracks t
             JOIN tracks_fts fts ON fts.rowid = t.rowid
             WHERE tracks_fts MATCH ?1
             ORDER BY bm25(tracks_fts, 10.0, 5.0, 3.0, 2.0, 1.0) ASC
             LIMIT 100",
        ).map_err(|e| LibraryError::IndexError(format!("Failed to prepare FTS query: {e}")))?;

        let track_iter = stmt
            .query_map(params![fts_query], |row| row_to_track(row, managed_root))
            .map_err(|e| LibraryError::IndexError(format!("Failed to execute FTS query: {e}")))?;

        let mut tracks = Vec::new();
        for item in track_iter {
            tracks.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(tracks)
    }

    /// Creates a new empty playlist.
    pub fn create_playlist(&self, name: &str) -> Result<Playlist, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, now, now],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to create playlist: {e}")))?;

        Ok(Playlist {
            id,
            name: name.to_string(),
            track_ids: Vec::new(),
            created_at: now,
            updated_at: now,
        })
    }

    /// Fetches a playlist and its ordered track IDs by ID.
    pub fn get_playlist(&self, id: &str) -> Result<Option<Playlist>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn
            .prepare("SELECT id, name, created_at, updated_at FROM playlists WHERE id = ?1")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut rows = stmt
            .query(params![id])
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let playlist_opt = if let Some(row) = rows.next().map_err(|e| LibraryError::IndexError(e.to_string()))? {
            let p_id: String = row.get(0).map_err(|e| LibraryError::IndexError(e.to_string()))?;
            let name: String = row.get(1).map_err(|e| LibraryError::IndexError(e.to_string()))?;
            let created_at: i64 = row.get(2).map_err(|e| LibraryError::IndexError(e.to_string()))?;
            let updated_at: i64 = row.get(3).map_err(|e| LibraryError::IndexError(e.to_string()))?;
            Some((p_id, name, created_at, updated_at))
        } else {
            None
        };
        drop(rows);
        drop(stmt);

        if let Some((p_id, name, created_at, updated_at)) = playlist_opt {
            let mut track_stmt = conn
                .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC")
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            let track_iter = track_stmt
                .query_map(params![p_id], |r| r.get::<_, String>(0))
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            let mut track_ids = Vec::new();
            for tid in track_iter {
                track_ids.push(tid.map_err(|e| LibraryError::IndexError(e.to_string()))?);
            }

            Ok(Some(Playlist {
                id: p_id,
                name,
                track_ids,
                created_at,
                updated_at,
            }))
        } else {
            Ok(None)
        }
    }

    /// Lists all playlists without loading all tracks.
    pub fn list_playlists(&self) -> Result<Vec<Playlist>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn
            .prepare("SELECT id, name, created_at, updated_at FROM playlists ORDER BY name COLLATE NOCASE ASC")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let playlist_headers = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let created_at: i64 = row.get(2)?;
                let updated_at: i64 = row.get(3)?;
                Ok((id, name, created_at, updated_at))
            })
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut headers = Vec::new();
        for h in playlist_headers {
            headers.push(h.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }
        drop(stmt);

        let mut playlists = Vec::with_capacity(headers.len());
        let mut track_stmt = conn
            .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        for (p_id, name, created_at, updated_at) in headers {
            let track_iter = track_stmt
                .query_map(params![p_id], |r| r.get::<_, String>(0))
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            let mut track_ids = Vec::new();
            for tid in track_iter {
                track_ids.push(tid.map_err(|e| LibraryError::IndexError(e.to_string()))?);
            }

            playlists.push(Playlist {
                id: p_id,
                name,
                track_ids,
                created_at,
                updated_at,
            });
        }

        Ok(playlists)
    }

    /// Saves or updates a playlist and replaces its track list.
    pub fn save_playlist(&self, playlist: &Playlist) -> Result<(), LibraryError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let tx = conn
            .transaction()
            .map_err(|e| LibraryError::IndexError(format!("Failed to start transaction: {e}")))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        tx.execute(
            "INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at",
            params![playlist.id, playlist.name, playlist.created_at, now],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to upsert playlist: {e}")))?;

        tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist.id],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to clear playlist tracks: {e}")))?;

        {
            let mut stmt = tx
                .prepare_cached("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)")
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            for (pos, track_id) in playlist.track_ids.iter().enumerate() {
                stmt.execute(params![playlist.id, track_id, pos as i64])
                    .map_err(|e| LibraryError::IndexError(format!("Failed to insert playlist track: {e}")))?;
            }
        }

        tx.commit()
            .map_err(|e| LibraryError::IndexError(format!("Failed to commit playlist save: {e}")))?;

        Ok(())
    }

    /// Deletes a playlist by ID (cascades to playlist_tracks via foreign key).
    pub fn delete_playlist(&self, id: &str) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])
            .map_err(|e| LibraryError::IndexError(format!("Failed to delete playlist: {e}")))?;

        Ok(())
    }

    /// Appends track IDs to the end of a playlist.
    pub fn add_tracks_to_playlist(
        &self,
        playlist_id: &str,
        track_ids: &[String],
    ) -> Result<(), LibraryError> {
        if track_ids.is_empty() {
            return Ok(());
        }

        let mut conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let tx = conn
            .transaction()
            .map_err(|e| LibraryError::IndexError(format!("Failed to begin transaction: {e}")))?;

        let max_pos: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        {
            let mut stmt = tx
                .prepare_cached("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)")
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            for (idx, track_id) in track_ids.iter().enumerate() {
                let next_pos = max_pos + 1 + idx as i64;
                stmt.execute(params![playlist_id, track_id, next_pos])
                    .map_err(|e| LibraryError::IndexError(format!("Failed to insert track into playlist: {e}")))?;
            }
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to update playlist timestamp: {e}")))?;

        tx.commit()
            .map_err(|e| LibraryError::IndexError(format!("Failed to commit adding tracks: {e}")))?;

        Ok(())
    }

    /// Fetches all Track objects in a playlist in order.
    pub fn get_playlist_tracks(
        &self,
        playlist_id: &str,
        managed_root: &Path,
    ) -> Result<Vec<Track>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn.prepare(
            "SELECT t.id, t.relative_path, t.title, t.artist, t.album, t.album_artist,
                    t.track_number, t.disc_number, t.year, t.genre, t.duration_secs,
                    t.sample_rate, t.bit_depth, t.channels, t.format, t.date_added, t.lyrics
             FROM tracks t
             JOIN playlist_tracks pt ON pt.track_id = t.id
             WHERE pt.playlist_id = ?1
             ORDER BY pt.position ASC",
        ).map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let track_iter = stmt
            .query_map(params![playlist_id], |row| row_to_track(row, managed_root))
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut tracks = Vec::new();
        for item in track_iter {
            tracks.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(tracks)
    }

    /// Renames an existing playlist.
    pub fn rename_playlist(&self, playlist_id: &str, new_name: &str) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let rows_affected = conn
            .execute(
                "UPDATE playlists SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![new_name, now, playlist_id],
            )
            .map_err(|e| LibraryError::IndexError(format!("Failed to rename playlist: {e}")))?;

        if rows_affected == 0 {
            return Err(LibraryError::IndexError(format!("Playlist with ID '{playlist_id}' not found")));
        }

        Ok(())
    }

    /// Removes a track from a playlist (all positions where it occurs, or shifts positions).
    pub fn remove_track_from_playlist(
        &self,
        playlist_id: &str,
        track_id: &str,
    ) -> Result<(), LibraryError> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let tx = conn
            .transaction()
            .map_err(|e| LibraryError::IndexError(format!("Failed to begin transaction: {e}")))?;

        // 1. Delete matching entries
        tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to remove track from playlist: {e}")))?;

        // 2. Compact remaining positions
        let mut select_stmt = tx
            .prepare("SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let track_ids: Vec<String> = select_stmt
            .query_map(params![playlist_id], |row| row.get(0))
            .map_err(|e| LibraryError::IndexError(e.to_string()))?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        drop(select_stmt);

        tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        {
            let mut insert_stmt = tx
                .prepare_cached("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)")
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            for (pos, tid) in track_ids.iter().enumerate() {
                insert_stmt
                    .execute(params![playlist_id, tid, pos as i64])
                    .map_err(|e| LibraryError::IndexError(e.to_string()))?;
            }
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to update playlist timestamp: {e}")))?;

        tx.commit()
            .map_err(|e| LibraryError::IndexError(format!("Failed to commit remove track: {e}")))?;

        Ok(())
    }

    /// Marks a track as liked.
    pub fn like_track(&self, track_id: &str) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT OR IGNORE INTO liked_tracks (track_id, created_at) VALUES (?1, ?2)",
            params![track_id, now],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to like track: {e}")))?;

        Ok(())
    }

    /// Removes a track from liked tracks.
    pub fn unlike_track(&self, track_id: &str) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        conn.execute(
            "DELETE FROM liked_tracks WHERE track_id = ?1",
            params![track_id],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to unlike track: {e}")))?;

        Ok(())
    }

    /// Toggles the liked status of a track and returns the new liked state (`true` if now liked, `false` otherwise).
    pub fn toggle_like(&self, track_id: &str) -> Result<bool, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let is_liked: bool = conn
            .query_row(
                "SELECT COUNT(1) FROM liked_tracks WHERE track_id = ?1",
                params![track_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|cnt| cnt > 0)
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        if is_liked {
            conn.execute(
                "DELETE FROM liked_tracks WHERE track_id = ?1",
                params![track_id],
            )
            .map_err(|e| LibraryError::IndexError(format!("Failed to unlike track: {e}")))?;
            Ok(false)
        } else {
            conn.execute(
                "INSERT OR REPLACE INTO liked_tracks (track_id, created_at) VALUES (?1, ?2)",
                params![track_id, now],
            )
            .map_err(|e| LibraryError::IndexError(format!("Failed to like track: {e}")))?;
            Ok(true)
        }
    }

    /// Checks whether a specific track is liked.
    pub fn is_track_liked(&self, track_id: &str) -> Result<bool, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let is_liked: bool = conn
            .query_row(
                "SELECT COUNT(1) FROM liked_tracks WHERE track_id = ?1",
                params![track_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|cnt| cnt > 0)
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        Ok(is_liked)
    }

    /// Returns the set of all liked track IDs ordered by date added (newest first).
    pub fn get_liked_track_ids(&self) -> Result<Vec<String>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn
            .prepare("SELECT track_id FROM liked_tracks ORDER BY created_at DESC")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let id_iter = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut ids = Vec::new();
        for id in id_iter {
            ids.push(id.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(ids)
    }

    /// Fetches all full Track domain models for liked tracks ordered by date liked (newest first).
    pub fn get_liked_tracks(&self, managed_root: &Path) -> Result<Vec<Track>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn.prepare(
            "SELECT t.id, t.relative_path, t.title, t.artist, t.album, t.album_artist,
                    t.track_number, t.disc_number, t.year, t.genre, t.duration_secs,
                    t.sample_rate, t.bit_depth, t.channels, t.format, t.date_added, t.lyrics
             FROM tracks t
             JOIN liked_tracks lt ON lt.track_id = t.id
             ORDER BY lt.created_at DESC",
        ).map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let track_iter = stmt
            .query_map([], |row| row_to_track(row, managed_root))
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut tracks = Vec::new();
        for item in track_iter {
            tracks.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(tracks)
    }
}

fn row_to_track(row: &Row, managed_root: &Path) -> rusqlite::Result<Track> {
    let id: String = row.get(0)?;
    let rel_path: String = row.get(1)?;
    let title: Option<String> = row.get(2)?;
    let artist: Option<String> = row.get(3)?;
    let album: Option<String> = row.get(4)?;
    let album_artist: Option<String> = row.get(5)?;
    let track_number: Option<u32> = row.get(6)?;
    let disc_number: Option<u32> = row.get(7)?;
    let year: Option<i32> = row.get(8)?;
    let genre: Option<String> = row.get(9)?;
    let duration_secs: f64 = row.get(10)?;
    let sample_rate: Option<u32> = row.get(11)?;
    let bit_depth: Option<u16> = row.get(12)?;
    let channels: Option<u16> = row.get(13)?;
    let format: String = row.get(14)?;
    let date_added: i64 = row.get(15)?;
    let lyrics: Option<String> = row.get(16)?;

    let full_path = managed_root.join(&rel_path);

    Ok(Track {
        id,
        source: TrackSource::Managed(full_path),
        metadata: TrackMetadata {
            title,
            artist,
            album,
            album_artist,
            track_number,
            disc_number,
            year,
            genre,
            duration: Duration::from_secs_f64(duration_secs.max(0.0)),
            sample_rate,
            bit_depth,
            channels,
            format,
            lyrics,
        },
        date_added: date_added as u64,
    })
}

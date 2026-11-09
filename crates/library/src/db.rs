//! SQLite persistence layer for Wavery's music library.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use wavery_core::error::LibraryError;
use wavery_core::models::{
    Album, Artist, Playlist, Track, TrackMetadata, TrackSource, WaveformData,
};

/// Aggregate row counts, on-disk sizes, and consistency counters for the library database.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStats {
    /// Absolute path of the live SQLite database file.
    pub database_path: String,
    /// Absolute path of the managed music folder.
    pub library_path: String,
    /// Absolute path of the artwork cache folder.
    pub artwork_cache_path: String,
    /// Size of the main database file in bytes.
    pub database_bytes: u64,
    /// Size of the write-ahead log (`-wal`) in bytes.
    pub wal_bytes: u64,
    /// Size of the shared-memory index (`-shm`) in bytes.
    pub shared_memory_bytes: u64,
    /// Recursive size of the managed music folder in bytes.
    pub library_bytes: u64,
    /// Recursive size of the artwork cache folder in bytes.
    pub artwork_cache_bytes: u64,
    /// Number of indexed tracks.
    pub track_count: u64,
    /// Number of distinct albums in the index.
    pub album_count: u64,
    /// Number of distinct album artists in the index.
    pub artist_count: u64,
    /// Number of user playlists.
    pub playlist_count: u64,
    /// Number of liked tracks.
    pub liked_count: u64,
    /// Number of cached waveform envelopes.
    pub waveform_count: u64,
    /// Number of indexed tracks whose audio file is no longer on disk.
    pub missing_file_count: u64,
    /// Unused bytes reserved inside the database file (freelist).
    pub free_bytes: u64,
    /// SQLite page size in bytes.
    pub page_size: u64,
    /// Allocated database pages.
    pub page_count: u64,
    /// Active SQLite journal mode (normally `wal`).
    pub journal_mode: String,
}

/// Result of a read-only integrity sweep of the library database.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseHealth {
    /// `true` when integrity, foreign keys, FTS coverage, and file references all pass.
    pub is_healthy: bool,
    /// Raw `PRAGMA quick_check` output (`ok` when the b-tree is sound).
    pub quick_check: String,
    /// Number of `PRAGMA foreign_key_check` violations.
    pub foreign_key_violations: u64,
    /// Number of rows visible through the FTS5 search index.
    pub fts_indexed_tracks: u64,
    /// Indexed tracks missing from the FTS5 search index.
    pub fts_missing_tracks: u64,
    /// Indexed tracks whose audio file no longer exists on disk.
    pub missing_file_count: u64,
    /// Active SQLite journal mode.
    pub journal_mode: String,
    /// Allocated database pages.
    pub page_count: u64,
    /// Unused bytes reserved inside the database file (freelist).
    pub free_bytes: u64,
    /// Unix timestamp (seconds) when the health sweep ran.
    pub checked_at: u64,
    /// Human-readable issues discovered during the sweep.
    pub issues: Vec<String>,
}

/// Description of a completed database backup.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackup {
    /// Absolute path of the written backup file.
    pub path: String,
    /// Size of the backup file in bytes.
    pub bytes: u64,
    /// Unix timestamp (seconds) when the backup was created.
    pub created_at: u64,
}

/// Database wrapper around a thread-safe `Mutex<Connection>`.
pub struct LibraryDatabase {
    conn: Mutex<Connection>,
    db_path: PathBuf,
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
                lyrics TEXT,
                replaygain_track_gain REAL,
                replaygain_track_peak REAL,
                replaygain_album_gain REAL,
                replaygain_album_peak REAL
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

            CREATE TABLE IF NOT EXISTS track_waveforms (
                track_id TEXT PRIMARY KEY,
                version INTEGER NOT NULL DEFAULT 1,
                peaks_blob BLOB NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

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
            ",
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed schema migration: {e}")))?;

        // Rebuild FTS only if tracks table has rows but tracks_fts is unpopulated (initial migration)
        let needs_fts_rebuild: bool = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM tracks) > 0 AND (SELECT COUNT(*) FROM tracks_fts) == 0",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if needs_fts_rebuild {
            let _ = conn.execute("INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild')", []);
        }

        // Ensure optional columns exist for pre-existing databases
        let existing_columns: Vec<String> = conn
            .prepare("PRAGMA table_info(tracks)")
            .and_then(|mut stmt| {
                let mut rows = stmt.query([])?;
                let mut cols = Vec::new();
                while let Some(row) = rows.next()? {
                    let col_name: String = row.get(1)?;
                    cols.push(col_name);
                }
                Ok(cols)
            })
            .unwrap_or_default();

        let required_migrations = [
            ("lyrics", "TEXT"),
            ("replaygain_track_gain", "REAL"),
            ("replaygain_track_peak", "REAL"),
            ("replaygain_album_gain", "REAL"),
            ("replaygain_album_peak", "REAL"),
        ];

        for (col_name, col_type) in required_migrations {
            if !existing_columns.iter().any(|c| c == col_name) {
                let sql = format!("ALTER TABLE tracks ADD COLUMN {col_name} {col_type};");
                conn.execute(&sql, []).map_err(|e| {
                    LibraryError::IndexError(format!("Failed to add {col_name} column: {e}"))
                })?;
            }
        }

        Ok(Self {
            conn: Mutex::new(conn),
            db_path: db_path.to_path_buf(),
        })
    }

    /// Returns the absolute path of the live SQLite database file.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.db_path
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
                        sample_rate, bit_depth, channels, format, date_added, lyrics,
                        replaygain_track_gain, replaygain_track_peak,
                        replaygain_album_gain, replaygain_album_peak
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                        ?18, ?19, ?20, ?21
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
                        lyrics = excluded.lyrics,
                        replaygain_track_gain = excluded.replaygain_track_gain,
                        replaygain_track_peak = excluded.replaygain_track_peak,
                        replaygain_album_gain = excluded.replaygain_album_gain,
                        replaygain_album_peak = excluded.replaygain_album_peak",
                )
                .map_err(|e| {
                    LibraryError::IndexError(format!("Failed to prepare cached statement: {e}"))
                })?;

            for track in tracks {
                let full_path = track.source.path();
                let rel_path = full_path
                    .strip_prefix(managed_root)
                    .unwrap_or(full_path)
                    .to_string_lossy()
                    .replace('\\', "/");

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
                    track.metadata.replaygain_track_gain.map(f64::from),
                    track.metadata.replaygain_track_peak.map(f64::from),
                    track.metadata.replaygain_album_gain.map(f64::from),
                    track.metadata.replaygain_album_peak.map(f64::from),
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

        let rel_path: Option<String> = if let Some(row) = rows
            .next()
            .map_err(|e| LibraryError::IndexError(e.to_string()))?
        {
            Some(
                row.get(0)
                    .map_err(|e| LibraryError::IndexError(e.to_string()))?,
            )
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
             INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild');
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

        tx.commit().map_err(|e| {
            LibraryError::IndexError(format!("Failed to commit prune transaction: {e}"))
        })?;

        Ok(missing_ids.len())
    }

    /// Collects row counts and on-disk sizes for the database control center.
    ///
    /// `managed_root` is scanned recursively for the music-folder size, and
    /// `artwork_cache_dir` for the artwork cache size. Missing files are counted
    /// against the live file system so the UI can offer a prune action.
    pub fn stats(
        &self,
        managed_root: &Path,
        artwork_cache_dir: &Path,
    ) -> Result<DatabaseStats, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let track_count = query_count(&conn, "SELECT COUNT(*) FROM tracks")?;
        let album_count = query_count(
            &conn,
            "SELECT COUNT(*) FROM (
                SELECT DISTINCT album, COALESCE(NULLIF(album_artist, ''), artist)
                FROM tracks
                WHERE album IS NOT NULL AND album <> ''
            )",
        )?;
        let artist_count = query_count(
            &conn,
            "SELECT COUNT(*) FROM (
                SELECT DISTINCT COALESCE(NULLIF(album_artist, ''), artist)
                FROM tracks
                WHERE COALESCE(NULLIF(album_artist, ''), artist) IS NOT NULL
                  AND COALESCE(NULLIF(album_artist, ''), artist) <> ''
            )",
        )?;
        let playlist_count = query_count(&conn, "SELECT COUNT(*) FROM playlists")?;
        let liked_count = query_count(&conn, "SELECT COUNT(*) FROM liked_tracks")?;
        let waveform_count = query_count(&conn, "SELECT COUNT(*) FROM track_waveforms")?;
        let missing_file_count = count_missing_files(&conn, managed_root)?;

        let page_count = query_u64(&conn, "PRAGMA page_count")?;
        let page_size = query_u64(&conn, "PRAGMA page_size")?;
        let free_pages = query_u64(&conn, "PRAGMA freelist_count")?;
        let journal_mode = query_string(&conn, "PRAGMA journal_mode")?;

        Ok(DatabaseStats {
            database_path: self.db_path.display().to_string(),
            library_path: managed_root.display().to_string(),
            artwork_cache_path: artwork_cache_dir.display().to_string(),
            database_bytes: file_size(&self.db_path),
            wal_bytes: file_size(&sidecar_path(&self.db_path, "-wal")),
            shared_memory_bytes: file_size(&sidecar_path(&self.db_path, "-shm")),
            library_bytes: directory_size(managed_root),
            artwork_cache_bytes: directory_size(artwork_cache_dir),
            track_count,
            album_count,
            artist_count,
            playlist_count,
            liked_count,
            waveform_count,
            missing_file_count,
            free_bytes: free_pages.saturating_mul(page_size),
            page_size,
            page_count,
            journal_mode,
        })
    }

    /// Runs a read-only integrity sweep covering the b-tree, foreign keys,
    /// full-text index coverage, and indexed file references.
    pub fn health(&self, managed_root: &Path) -> Result<DatabaseHealth, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut messages = Vec::new();
        {
            let mut stmt = conn
                .prepare("PRAGMA quick_check")
                .map_err(|e| LibraryError::IndexError(format!("quick_check failed: {e}")))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| LibraryError::IndexError(format!("quick_check failed: {e}")))?;
            for message in rows.filter_map(Result::ok) {
                messages.push(message);
            }
        }
        let quick_check = if messages.is_empty() {
            "no response".to_string()
        } else {
            messages.join("; ")
        };

        let foreign_key_violations =
            query_count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check")?;
        let track_count = query_count(&conn, "SELECT COUNT(*) FROM tracks")?;
        let fts_indexed_tracks = query_count(&conn, "SELECT COUNT(*) FROM tracks_fts")?;
        let fts_missing_tracks = track_count.saturating_sub(fts_indexed_tracks);
        let missing_file_count = count_missing_files(&conn, managed_root)?;
        let page_count = query_u64(&conn, "PRAGMA page_count")?;
        let page_size = query_u64(&conn, "PRAGMA page_size")?;
        let free_pages = query_u64(&conn, "PRAGMA freelist_count")?;
        let journal_mode = query_string(&conn, "PRAGMA journal_mode")?;

        let mut issues = Vec::new();
        if quick_check.to_lowercase() != "ok" {
            issues.push(format!("Integrity check reported: {quick_check}"));
        }
        if foreign_key_violations > 0 {
            issues.push(format!(
                "{foreign_key_violations} foreign-key violation(s) found"
            ));
        }
        if fts_missing_tracks > 0 {
            issues.push(format!(
                "{fts_missing_tracks} track(s) missing from the search index"
            ));
        }
        if missing_file_count > 0 {
            issues.push(format!(
                "{missing_file_count} indexed file(s) no longer exist on disk"
            ));
        }
        if journal_mode.to_lowercase() != "wal" {
            issues.push(format!("Journal mode is {journal_mode}, expected wal"));
        }

        Ok(DatabaseHealth {
            is_healthy: issues.is_empty(),
            quick_check,
            foreign_key_violations,
            fts_indexed_tracks,
            fts_missing_tracks,
            missing_file_count,
            journal_mode,
            page_count,
            free_bytes: free_pages.saturating_mul(page_size),
            checked_at: unix_now(),
            issues,
        })
    }

    /// Writes a consistent snapshot of the database with `VACUUM INTO`.
    ///
    /// The destination file is replaced when it already exists. The live
    /// database path is rejected so a backup can never overwrite the index
    /// that Wavery is actively using.
    pub fn backup_to(&self, destination: &Path) -> Result<DatabaseBackup, LibraryError> {
        if destination == self.db_path {
            return Err(LibraryError::IndexError(
                "Backup destination cannot be the live database file".into(),
            ));
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if destination.exists() {
            std::fs::remove_file(destination)?;
        }

        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;
        let destination_str = destination
            .to_str()
            .ok_or_else(|| LibraryError::IndexError("Backup path is not valid UTF-8".into()))?;
        conn.execute("VACUUM INTO ?1", params![destination_str])
            .map_err(|e| LibraryError::IndexError(format!("Failed to back up database: {e}")))?;

        Ok(DatabaseBackup {
            path: destination.display().to_string(),
            bytes: file_size(destination),
            created_at: unix_now(),
        })
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
                lyrics = ?9,
                replaygain_track_gain = COALESCE(?10, replaygain_track_gain),
                replaygain_track_peak = COALESCE(?11, replaygain_track_peak),
                replaygain_album_gain = COALESCE(?12, replaygain_album_gain),
                replaygain_album_peak = COALESCE(?13, replaygain_album_peak)
             WHERE id = ?14",
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
                metadata.replaygain_track_gain.map(f64::from),
                metadata.replaygain_track_peak.map(f64::from),
                metadata.replaygain_album_gain.map(f64::from),
                metadata.replaygain_album_peak.map(f64::from),
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
                    lyrics = ?9,
                    replaygain_track_gain = COALESCE(?10, replaygain_track_gain),
                    replaygain_track_peak = COALESCE(?11, replaygain_track_peak),
                    replaygain_album_gain = COALESCE(?12, replaygain_album_gain),
                    replaygain_album_peak = COALESCE(?13, replaygain_album_peak)
                 WHERE id = ?14",
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
                    metadata.replaygain_track_gain.map(f64::from),
                    metadata.replaygain_track_peak.map(f64::from),
                    metadata.replaygain_album_gain.map(f64::from),
                    metadata.replaygain_album_peak.map(f64::from),
                    track_id,
                ],
            )
            .map_err(|retry_err| {
                LibraryError::IndexError(format!(
                    "Failed to update track metadata: {retry_err} (initial: {e})"
                ))
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
    pub fn get_track(
        &self,
        track_id: &str,
        managed_root: &Path,
    ) -> Result<Option<Track>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, relative_path, title, artist, album, album_artist,
                    track_number, disc_number, year, genre, duration_secs,
                    sample_rate, bit_depth, channels, format, date_added, lyrics,
                    replaygain_track_gain, replaygain_track_peak,
                    replaygain_album_gain, replaygain_album_peak
             FROM tracks WHERE id = ?1",
            )
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut rows = stmt
            .query(params![track_id])
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        if let Some(row) = rows
            .next()
            .map_err(|e| LibraryError::IndexError(e.to_string()))?
        {
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

        let mut stmt = conn
            .prepare(
                "SELECT id, relative_path, title, artist, album, album_artist,
                    track_number, disc_number, year, genre, duration_secs,
                    sample_rate, bit_depth, channels, format, date_added, lyrics,
                    replaygain_track_gain, replaygain_track_peak,
                    replaygain_album_gain, replaygain_album_peak
             FROM tracks ORDER BY artist, album, track_number, title",
            )
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

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

                let total_duration = if total_duration_secs.is_finite()
                    && total_duration_secs >= 0.0
                    && total_duration_secs <= (u64::MAX as f64)
                {
                    Duration::from_secs_f64(total_duration_secs)
                } else {
                    Duration::ZERO
                };

                let total_duration_secs_u64 = total_duration.as_secs();
                Ok(Album {
                    title,
                    artist,
                    album_artist: None,
                    is_compilation: false,
                    year,
                    artwork_track_id,
                    tracks: Vec::new(),
                    track_count,
                    total_duration,
                    total_duration_secs: total_duration_secs_u64,
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

        let mut stmt = conn
            .prepare(
                "SELECT 
                 COALESCE(NULLIF(artist, ''), 'Unknown Artist') AS artist_name,
                 COUNT(DISTINCT LOWER(COALESCE(NULLIF(album, ''), 'Unknown Album'))) AS album_count,
                 COUNT(*) AS track_count,
                 MIN(id) AS artwork_track_id
             FROM tracks
             GROUP BY LOWER(COALESCE(NULLIF(artist, ''), 'Unknown Artist'))
             ORDER BY artist_name COLLATE NOCASE ASC",
            )
            .map_err(|e| {
                LibraryError::IndexError(format!("Failed to prepare list_artists: {e}"))
            })?;

        let artist_iter = stmt
            .query_map([], |row| {
                let name: String = row.get(0)?;
                let album_count: usize = row.get(1)?;
                let track_count: usize = row.get(2)?;
                let artwork_track_id: Option<String> = row.get(3)?;

                Ok(Artist {
                    name,
                    albums: Vec::new(),
                    appears_on: Vec::new(),
                    tracks: Vec::new(),
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
            let mut stmt = conn
                .prepare(
                    "SELECT id, relative_path, title, artist, album, album_artist,
                        track_number, disc_number, year, genre, duration_secs,
                        sample_rate, bit_depth, channels, format, date_added, lyrics,
                        replaygain_track_gain, replaygain_track_peak,
                        replaygain_album_gain, replaygain_album_peak
                 FROM tracks
                 WHERE album = ?1 AND (artist = ?2 OR album_artist = ?2)
                 ORDER BY COALESCE(disc_number, 1) ASC, COALESCE(track_number, 0) ASC, title ASC",
                )
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            let iter = stmt
                .query_map(params![album, art], |row| row_to_track(row, managed_root))
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

            for item in iter {
                tracks.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT id, relative_path, title, artist, album, album_artist,
                        track_number, disc_number, year, genre, duration_secs,
                        sample_rate, bit_depth, channels, format, date_added, lyrics,
                        replaygain_track_gain, replaygain_track_peak,
                        replaygain_album_gain, replaygain_album_peak
                 FROM tracks
                 WHERE album = ?1
                 ORDER BY COALESCE(disc_number, 1) ASC, COALESCE(track_number, 0) ASC, title ASC",
                )
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;

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

        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.relative_path, t.title, t.artist, t.album, t.album_artist,
                    t.track_number, t.disc_number, t.year, t.genre, t.duration_secs,
                    t.sample_rate, t.bit_depth, t.channels, t.format, t.date_added, t.lyrics,
                    t.replaygain_track_gain, t.replaygain_track_peak,
                    t.replaygain_album_gain, t.replaygain_album_peak
             FROM tracks t
             JOIN tracks_fts fts ON fts.rowid = t.rowid
             WHERE tracks_fts MATCH ?1
             ORDER BY bm25(tracks_fts, 10.0, 5.0, 3.0, 2.0, 1.0) ASC
             LIMIT 100",
            )
            .map_err(|e| LibraryError::IndexError(format!("Failed to prepare FTS query: {e}")))?;

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

        let playlist_opt = if let Some(row) = rows
            .next()
            .map_err(|e| LibraryError::IndexError(e.to_string()))?
        {
            let p_id: String = row
                .get(0)
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;
            let name: String = row
                .get(1)
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;
            let created_at: i64 = row
                .get(2)
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;
            let updated_at: i64 = row
                .get(3)
                .map_err(|e| LibraryError::IndexError(e.to_string()))?;
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
            .prepare(
                "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC",
            )
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
                    .map_err(|e| {
                        LibraryError::IndexError(format!("Failed to insert playlist track: {e}"))
                    })?;
            }
        }

        tx.commit().map_err(|e| {
            LibraryError::IndexError(format!("Failed to commit playlist save: {e}"))
        })?;

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
                    .map_err(|e| {
                        LibraryError::IndexError(format!(
                            "Failed to insert track into playlist: {e}"
                        ))
                    })?;
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
        .map_err(|e| {
            LibraryError::IndexError(format!("Failed to update playlist timestamp: {e}"))
        })?;

        tx.commit().map_err(|e| {
            LibraryError::IndexError(format!("Failed to commit adding tracks: {e}"))
        })?;

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

        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.relative_path, t.title, t.artist, t.album, t.album_artist,
                    t.track_number, t.disc_number, t.year, t.genre, t.duration_secs,
                    t.sample_rate, t.bit_depth, t.channels, t.format, t.date_added, t.lyrics,
                    t.replaygain_track_gain, t.replaygain_track_peak,
                    t.replaygain_album_gain, t.replaygain_album_peak
             FROM tracks t
             JOIN playlist_tracks pt ON pt.track_id = t.id
             WHERE pt.playlist_id = ?1
             ORDER BY pt.position ASC",
            )
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

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
            return Err(LibraryError::IndexError(format!(
                "Playlist with ID '{playlist_id}' not found"
            )));
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
        .map_err(|e| {
            LibraryError::IndexError(format!("Failed to remove track from playlist: {e}"))
        })?;

        // 2. Compact remaining positions
        let mut select_stmt = tx
            .prepare(
                "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC",
            )
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
        .map_err(|e| {
            LibraryError::IndexError(format!("Failed to update playlist timestamp: {e}"))
        })?;

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

        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.relative_path, t.title, t.artist, t.album, t.album_artist,
                    t.track_number, t.disc_number, t.year, t.genre, t.duration_secs,
                    t.sample_rate, t.bit_depth, t.channels, t.format, t.date_added, t.lyrics,
                    t.replaygain_track_gain, t.replaygain_track_peak,
                    t.replaygain_album_gain, t.replaygain_album_peak
             FROM tracks t
             JOIN liked_tracks lt ON lt.track_id = t.id
             ORDER BY lt.created_at DESC",
            )
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let track_iter = stmt
            .query_map([], |row| row_to_track(row, managed_root))
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut tracks = Vec::new();
        for item in track_iter {
            tracks.push(item.map_err(|e| LibraryError::IndexError(e.to_string()))?);
        }

        Ok(tracks)
    }

    /// Queries the persisted 100-point waveform peak envelope for `track_id`.
    ///
    /// Returns `Ok(None)` if no waveform is cached or if the stored BLOB is corrupted.
    pub fn get_waveform(&self, track_id: &str) -> Result<Option<WaveformData>, LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let mut stmt = conn
            .prepare("SELECT version, peaks_blob FROM track_waveforms WHERE track_id = ?1")
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let mut rows = stmt
            .query(params![track_id])
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let Some(row) = rows
            .next()
            .map_err(|e| LibraryError::IndexError(e.to_string()))?
        else {
            return Ok(None);
        };

        let version: i64 = row
            .get(0)
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;
        let blob: Vec<u8> = row
            .get(1)
            .map_err(|e| LibraryError::IndexError(e.to_string()))?;

        let expected_bytes = crate::waveform::WAVEFORM_POINT_COUNT * 4;
        if blob.len() != expected_bytes {
            return Ok(None);
        }

        let mut points = Vec::with_capacity(crate::waveform::WAVEFORM_POINT_COUNT);
        for &chunk in blob.as_chunks::<4>().0 {
            let val = f32::from_le_bytes(chunk);
            if !val.is_finite() {
                return Ok(None);
            }
            points.push(val.clamp(0.0, 1.0));
        }

        Ok(Some(WaveformData {
            track_id: track_id.to_string(),
            version: version.max(1) as u32,
            points,
        }))
    }

    /// Persists or updates a track's 100-point waveform peak envelope as a 400-byte little-endian BLOB.
    pub fn save_waveform(&self, waveform: &WaveformData) -> Result<(), LibraryError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| LibraryError::IndexError("Database mutex poisoned".into()))?;

        let normalized_points: Vec<f32> =
            if waveform.points.len() == crate::waveform::WAVEFORM_POINT_COUNT {
                waveform
                    .points
                    .iter()
                    .map(|&v| if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 })
                    .collect()
            } else {
                crate::waveform::resample_peaks_to_100(&waveform.points)
            };

        let mut blob = Vec::with_capacity(crate::waveform::WAVEFORM_POINT_COUNT * 4);
        for &pt in &normalized_points {
            blob.extend_from_slice(&pt.to_le_bytes());
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let version = waveform.version.max(1) as i64;

        conn.execute(
            "INSERT INTO track_waveforms (track_id, version, peaks_blob, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(track_id) DO UPDATE SET
                 version = excluded.version,
                 peaks_blob = excluded.peaks_blob,
                 updated_at = excluded.updated_at",
            params![waveform.track_id, version, blob, now],
        )
        .map_err(|e| LibraryError::IndexError(format!("Failed to save waveform: {e}")))?;

        Ok(())
    }
}

fn row_to_track(row: &Row, managed_root: &Path) -> rusqlite::Result<Track> {
    let id: String = row.get(0)?;
    let rel_path: String = row.get(1)?;
    let title: Option<String> = row.get(2)?;
    let artist: Option<String> = row.get(3)?;
    let album: Option<String> = row.get(4)?;
    let album_artist: Option<String> = row.get(5)?;
    let track_number: Option<u32> =
        row.get::<_, Option<i64>>(6)?
            .and_then(|n| if n >= 0 { Some(n as u32) } else { None });
    let disc_number: Option<u32> =
        row.get::<_, Option<i64>>(7)?
            .and_then(|n| if n >= 0 { Some(n as u32) } else { None });
    let year: Option<i32> = row.get(8)?;
    let genre: Option<String> = row.get(9)?;
    let duration_secs: f64 = row.get(10)?;
    let sample_rate: Option<u32> = row.get(11)?;
    let bit_depth: Option<u16> = row.get(12)?;
    let channels: Option<u16> = row.get(13)?;
    let format: String = row.get(14)?;
    let date_added: i64 = row.get(15)?;
    let lyrics: Option<String> = row
        .get::<_, Option<String>>(16)?
        .filter(|l| !l.trim().is_empty());
    let replaygain_track_gain: Option<f32> = row
        .get::<_, Option<f64>>(17)?
        .and_then(|v| if v.is_finite() { Some(v as f32) } else { None });
    let replaygain_track_peak: Option<f32> = row
        .get::<_, Option<f64>>(18)?
        .and_then(|v| if v.is_finite() { Some(v as f32) } else { None });
    let replaygain_album_gain: Option<f32> = row
        .get::<_, Option<f64>>(19)?
        .and_then(|v| if v.is_finite() { Some(v as f32) } else { None });
    let replaygain_album_peak: Option<f32> = row
        .get::<_, Option<f64>>(20)?
        .and_then(|v| if v.is_finite() { Some(v as f32) } else { None });

    let full_path = managed_root.join(&rel_path);

    let duration = if duration_secs.is_finite()
        && duration_secs >= 0.0
        && duration_secs <= (u64::MAX as f64)
    {
        Duration::from_secs_f64(duration_secs)
    } else {
        Duration::ZERO
    };

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
            duration,
            sample_rate,
            bit_depth,
            channels,
            format,
            lyrics,
            replaygain_track_gain,
            replaygain_track_peak,
            replaygain_album_gain,
            replaygain_album_peak,
        },
        date_added: date_added as u64,
    })
}

/// Reads a single integer count from `sql`, treating negative or missing values as zero.
fn query_count(conn: &Connection, sql: &str) -> Result<u64, LibraryError> {
    let value: i64 = conn
        .query_row(sql, [], |row| row.get(0))
        .map_err(|e| LibraryError::IndexError(format!("Count query failed: {e}")))?;
    Ok(u64::try_from(value).unwrap_or(0))
}

/// Reads a single unsigned PRAGMA value.
fn query_u64(conn: &Connection, pragma: &str) -> Result<u64, LibraryError> {
    let value: i64 = conn
        .query_row(pragma, [], |row| row.get(0))
        .map_err(|e| LibraryError::IndexError(format!("PRAGMA failed: {e}")))?;
    Ok(u64::try_from(value).unwrap_or(0))
}

/// Reads a single string PRAGMA value.
fn query_string(conn: &Connection, pragma: &str) -> Result<String, LibraryError> {
    conn.query_row(pragma, [], |row| row.get(0))
        .map_err(|e| LibraryError::IndexError(format!("PRAGMA failed: {e}")))
}

/// Counts indexed tracks whose managed file is missing from disk.
fn count_missing_files(conn: &Connection, managed_root: &Path) -> Result<u64, LibraryError> {
    let mut stmt = conn
        .prepare("SELECT relative_path FROM tracks")
        .map_err(|e| LibraryError::IndexError(format!("Failed to read track paths: {e}")))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| LibraryError::IndexError(format!("Failed to read track paths: {e}")))?;

    let mut missing = 0u64;
    for relative_path in rows.filter_map(Result::ok) {
        if !managed_root.join(relative_path).exists() {
            missing += 1;
        }
    }
    Ok(missing)
}

/// Returns the size of a file in bytes, or zero when it does not exist.
fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Builds a SQLite sidecar path such as `library.db-wal`.
fn sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    let mut value = db_path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

/// Recursively sums regular file sizes below `root`, ignoring unreadable entries.
fn directory_size(root: &Path) -> u64 {
    if !root.is_dir() {
        return 0;
    }
    walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|meta| meta.len())
        .sum()
}

/// Current Unix timestamp in seconds.
fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

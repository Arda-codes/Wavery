export type ImportStrategy = "Copy" | "Move";

export type PlaybackState = "Playing" | "Paused" | "Stopped";

export type LoopMode = "Off" | "Track" | "Queue";

export type PlaybackContextType = "album" | "playlist" | "liked" | "tracks" | "artist";

export interface PlaybackContext {
  type: PlaybackContextType;
  name: string;
  id?: string;
  artist?: string;
}

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  album_artist?: string;
  track_number?: number;
  disc_number?: number;
  year?: number;
  genre?: string;
  duration: { secs: number; nanos: number };
  sample_rate?: number;
  bit_depth?: number;
  channels?: number;
  format: string;
  lyrics?: string;
  replaygain_track_gain?: number | null;
  replaygain_track_peak?: number | null;
  replaygain_album_gain?: number | null;
  replaygain_album_peak?: number | null;
}

export interface WaveformData {
  track_id: string;
  version: number;
  points: number[];
}

export interface TrackSource {
  Managed: string;
}

export interface Track {
  id: string;
  source: TrackSource;
  metadata: TrackMetadata;
  date_added: number;
}

export interface PlayerStatus {
  state: PlaybackState;
  volume: number;
  position_secs: number;
  duration_secs?: number;
  current_track?: Track;
  loop_mode: LoopMode;
}

// Navigation & Hierarchy Types
export type ViewMode =
  | "home"
  | "search"
  | "history"
  | "tracks"
  | "artists"
  | "artist_detail"
  | "albums"
  | "album_detail"
  | "liked"
  | "playlists"
  | "playlist_detail"
  | "settings";

export interface Playlist {
  id: string;
  name: string;
  track_ids: string[];
  created_at: number;
  updated_at: number;
}

/**
 * Result of importing a yt-dlp JSON file as a playlist. Entries that do not
 * match a track already in the library are reported, never imported.
 */
export interface PlaylistImportSummary {
  playlist_id: string;
  playlist_name: string;
  total_entries: number;
  matched_tracks: number;
  unmatched_entries: number;
  already_in_playlist: number;
  unmatched_titles: string[];
}

/**
 * Aggregate row counts and on-disk sizes reported by the library database.
 */
export interface DatabaseStats {
  databasePath: string;
  libraryPath: string;
  artworkCachePath: string;
  databaseBytes: number;
  walBytes: number;
  sharedMemoryBytes: number;
  libraryBytes: number;
  artworkCacheBytes: number;
  trackCount: number;
  albumCount: number;
  artistCount: number;
  playlistCount: number;
  likedCount: number;
  waveformCount: number;
  missingFileCount: number;
  freeBytes: number;
  pageSize: number;
  pageCount: number;
  journalMode: string;
}

/**
 * Result of a read-only integrity sweep of the library database.
 */
export interface DatabaseHealth {
  isHealthy: boolean;
  quickCheck: string;
  foreignKeyViolations: number;
  ftsIndexedTracks: number;
  ftsMissingTracks: number;
  missingFileCount: number;
  journalMode: string;
  pageCount: number;
  freeBytes: number;
  checkedAt: number;
  issues: string[];
}

/**
 * Description of a completed database backup.
 */
export interface DatabaseBackup {
  path: string;
  bytes: number;
  createdAt: number;
}

/**
 * Locations the settings UI may reveal in the platform file manager.
 */
export type DatabaseLocation = "database" | "library" | "artwork";

export interface AlbumInfo {
  title: string;
  artist: string;
  albumArtist?: string;
  isCompilation?: boolean;
  year?: number;
  artworkTrackId: string;
  tracks: Track[];
  trackCount: number;
  totalDurationSecs: number;
}

export interface ArtistInfo {
  name: string;
  albums: AlbumInfo[];
  appearsOn: AlbumInfo[];
  tracks: Track[];
  trackCount: number;
  albumCount: number;
  artworkTrackId?: string;
}

export interface GenreInfo {
  name: string;
  tracks: Track[];
  trackCount?: number;
}

export type Album = AlbumInfo;
export type Artist = ArtistInfo;

export interface QueueStateSnapshot {
  currentTrack?: Track | null;
  current_track?: Track | null;
  currentIndex?: number | null;
  current_index?: number | null;
  userQueue: Track[];
  user_queue?: Track[];
  contextQueue: Track[];
  context_queue?: Track[];
  contextIndex?: number | null;
  context_index?: number | null;
  queue: Track[];
  isShuffle: boolean;
  is_shuffle?: boolean;
  loopMode: LoopMode;
  loop_mode?: LoopMode;
  isAutoplay: boolean;
  is_autoplay?: boolean;
  history: Track[];
  shuffleIndices?: number[];
  shuffle_indices?: number[];
  shuffled_indices?: number[];
  shufflePos?: number;
  shuffle_pos?: number;
}

// Sorting Types
export type TrackSortKey =
  | "track_number"
  | "title"
  | "artist"
  | "album"
  | "duration"
  | "date_added"
  | "year";

export type SortDirection = "asc" | "desc";

export type AlbumSortKey = "title" | "artist" | "year" | "track_count";
export type ArtistSortKey = "name" | "album_count" | "track_count";
export type PlaylistSortKey = "name" | "tracks" | "date";

export interface PlayHistoryEntry {
  trackId: string;
  playedAt: number;
}

export interface UpdateTrackMetadataPayload {
  track_id: string;
  title?: string;
  artist?: string;
  album?: string;
  album_artist?: string;
  track_number?: number;
  disc_number?: number;
  year?: number;
  genre?: string;
  lyrics?: string;
  write_tags?: boolean;
}

export interface UpdateArtistMetadataPayload {
  original_name: string;
  new_name: string;
  update_album_artist?: boolean;
  write_tags?: boolean;
}

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

export interface PlayHistoryEntry {
  trackId: string;
  playedAt: number;
}

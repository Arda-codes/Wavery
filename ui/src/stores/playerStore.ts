/**
 * Zustand-based player state store.
 *
 * Isolates the high-frequency 500ms polling (playback position, volume, state)
 * from the rest of the application. Provides fine-grained selectors and complete
 * queue management state.
 *
 * Session persistence: queue, current track, position, shuffle, loop mode, and
 * playback context are saved to localStorage so the player can resume after a
 * page refresh. Controlled by the `autoResumePlayback` user setting.
 */

import { create } from "zustand";
import { PlayerStatus, Track, PlaybackContext, PlayHistoryEntry } from "../types";
import { playerAdapter } from "../services/adapter";
import { useSettingsStore } from "./settingsStore";
import { showTrackNotification } from "../utils/notifications";
import {
  updateMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
  clearMediaSession,
  registerMediaSessionHandlers,
} from "../utils/mediaSession";
import { updateDiscordPresence, clearDiscordPresence } from "../utils/discordRpc";
import { fetchLyrics } from "../services/lyrics";

function notifyIfEnabled(track?: Track) {
  if (!track) return;
  try {
    const settings = useSettingsStore.getState();
    if (settings.notificationsEnabled) {
      showTrackNotification(track);
    }
  } catch {
    // Ignore notification errors in test or headless envs
  }
}

// ---------------------------------------------------------------------------
// Library tracks connector for Autoplay (circular-dependency safe)
// ---------------------------------------------------------------------------

export function registerLibraryTracksGetter(getter: () => Track[]) {
  if (typeof globalThis !== "undefined") {
    (globalThis as unknown as { __waveryLibraryTracksGetter?: () => Track[] }).__waveryLibraryTracksGetter = getter;
  }
}

export function getLibraryTracks(): Track[] {
  if (typeof globalThis !== "undefined") {
    const fn = (globalThis as unknown as { __waveryLibraryTracksGetter?: () => Track[] }).__waveryLibraryTracksGetter;
    if (fn) {
      try {
        return fn() || [];
      } catch {
        return [];
      }
    }
  }
  return [];
}

/**
 * Selects the next track for continuous Autoplay when reaching the end of the queue.
 *
 * Prioritizes:
 * 1. Unplayed tracks from the same artist.
 * 2. Unplayed tracks from the same genre or album.
 * 3. Any unplayed track from the user's library.
 * 4. Fallback: Loop back to beginning of queue or library.
 */
export function getAutoplayNextTrack(
  currentTrack: Track | null,
  currentQueue: Track[],
  libraryTracks: Track[]
): Track | null {
  if (!libraryTracks || libraryTracks.length === 0) {
    if (currentQueue && currentQueue.length > 0) {
      return currentQueue[0];
    }
    return null;
  }

  const queuedIds = new Set(currentQueue.map((t) => t.id));
  let unqueued = libraryTracks.filter((t) => !queuedIds.has(t.id));

  // If every track in the library is already in the queue, allow any track except current
  if (unqueued.length === 0) {
    unqueued = libraryTracks.filter((t) => t.id !== currentTrack?.id);
  }
  if (unqueued.length === 0) {
    unqueued = libraryTracks;
  }

  if (currentTrack) {
    const artist = currentTrack.metadata?.artist?.trim().toLowerCase();
    const genre = currentTrack.metadata?.genre?.trim().toLowerCase();

    // 1. Same artist candidate pool
    if (artist && artist !== "unknown artist") {
      const sameArtist = unqueued.filter(
        (t) => t.metadata?.artist?.trim().toLowerCase() === artist
      );
      if (sameArtist.length > 0 && Math.random() < 0.5) {
        return sameArtist[Math.floor(Math.random() * sameArtist.length)];
      }
    }

    // 2. Same genre candidate pool
    if (genre) {
      const sameGenre = unqueued.filter(
        (t) => t.metadata?.genre?.trim().toLowerCase() === genre
      );
      if (sameGenre.length > 0 && Math.random() < 0.6) {
        return sameGenre[Math.floor(Math.random() * sameGenre.length)];
      }
    }
  }

  // 3. Random candidate from remaining library pool
  return unqueued[Math.floor(Math.random() * unqueued.length)];
}

// ---------------------------------------------------------------------------
// Session persistence helpers
// ---------------------------------------------------------------------------

const PLAYER_SESSION_KEY = "wavery_player_session";

interface PlayerSession {
  queue: Track[];
  queueIndex: number;
  currentTrackId: string | undefined;
  playbackContext: PlaybackContext | null;
  isShuffle: boolean;
  isAutoplay: boolean;
  loopMode: string;
  positionSecs: number;
  userQueue?: Track[];
  contextQueue?: Track[];
  contextIndex?: number;
  sessionHistory?: Track[];
}

interface BackendSessionPayload {
  current_track_id?: string;
  queue: Track[];
  queue_index?: number;
  position_secs?: number;
  is_playing?: boolean;
  is_shuffle?: boolean;
  is_autoplay?: boolean;
  loop_mode?: string;
  active_client?: string;
  user_queue?: Track[];
  context_queue?: Track[];
  context_index?: number;
}

/**
 * Computes deterministic Fisher-Yates shuffle permutation of length,
 * pinning currentIdx at position 0 if valid.
 */
export function generateShuffleIndices(length: number, currentIdx: number): number[] {
  if (length <= 0) return [];
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = indices[i];
    indices[i] = indices[j];
    indices[j] = temp;
  }
  if (currentIdx >= 0 && currentIdx < length) {
    const pos = indices.indexOf(currentIdx);
    if (pos !== -1) {
      indices[pos] = indices[0];
      indices[0] = currentIdx;
    }
  }
  return indices;
}

/**
 * Computes the unified flattened queue and queueIndex for UI components and backward compatibility.
 * Slices userQueue directly after the active playing track / context index.
 */
export function computeQueueState(
  contextQueue: Track[],
  contextIndex: number,
  userQueue: Track[],
  currentTrack: Track | undefined,
  isShuffle: boolean = false,
  shuffleIndices: number[] = [],
  shufflePos: number = 0
): { queue: Track[]; queueIndex: number } {
  if (contextQueue.length === 0 && userQueue.length === 0) {
    if (currentTrack) {
      return { queue: [currentTrack], queueIndex: 0 };
    }
    return { queue: [], queueIndex: -1 };
  }

  // When shuffle is enabled and permutation is available, order upcoming context tracks by shuffleIndices
  if (isShuffle && shuffleIndices.length > 0) {
    const playing = currentTrack || (contextIndex >= 0 ? contextQueue[contextIndex] : undefined);
    const pastShuffled = shuffleIndices
      .slice(0, shufflePos)
      .map((idx) => contextQueue[idx])
      .filter((t): t is Track => Boolean(t));
    const upcomingShuffled = shuffleIndices
      .slice(shufflePos + 1)
      .map((idx) => contextQueue[idx])
      .filter((t): t is Track => Boolean(t));

    const combined = playing
      ? [...pastShuffled, playing, ...userQueue, ...upcomingShuffled]
      : [...pastShuffled, ...userQueue, ...upcomingShuffled];
    const queueIndex = playing ? pastShuffled.length : 0;
    return { queue: combined, queueIndex };
  }

  if (contextIndex >= 0 && contextIndex < contextQueue.length) {
    const beforeCurrent = contextQueue.slice(0, contextIndex + 1);
    const afterCurrent = contextQueue.slice(contextIndex + 1);
    const combined = [...beforeCurrent, ...userQueue, ...afterCurrent];
    return { queue: combined, queueIndex: contextIndex };
  }

  if (currentTrack) {
    const currentIdx = contextIndex >= 0 ? contextIndex : 0;
    const before = contextQueue.slice(0, currentIdx);
    const after = contextQueue.slice(currentIdx);
    const combined = [...before, currentTrack, ...userQueue, ...after];
    return { queue: combined, queueIndex: currentIdx };
  }

  return { queue: [...userQueue, ...contextQueue], queueIndex: 0 };
}

function syncWithBackend(state: PlayerStoreState): void {
  if (playerAdapter.syncQueue) {
    playerAdapter.syncQueue({
      user_queue: state.userQueue,
      context_queue: state.contextQueue,
      current_track_id: state.currentTrackId,
      is_shuffle: state.isShuffle,
      loop_mode: state.loopMode || state.status.loop_mode,
    }).catch(() => {});
  }
}

function saveSession(session: PlayerSession): void {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(session));
    } catch {
      // Ignore quota or security errors
    }
  }
  // Synchronize session to backend/disk so Web client and Tauri client share the exact same state
  try {
    const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
    const payload: BackendSessionPayload = {
      current_track_id: session.currentTrackId,
      queue: session.queue,
      queue_index: session.queueIndex,
      position_secs: session.positionSecs,
      is_playing: false,
      is_shuffle: session.isShuffle,
      is_autoplay: session.isAutoplay,
      loop_mode: session.loopMode,
      active_client: isTauri ? "native" : "web",
      user_queue: session.userQueue,
      context_queue: session.contextQueue,
      context_index: session.contextIndex,
    };
    if (isTauri) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("save_session_state", { session: payload }).catch(() => {});
      }).catch(() => {});
    } else {
      fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  } catch {
    // Ignore fetch/IPC errors
  }
}

function loadSession(): PlayerSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PLAYER_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlayerSession;
  } catch {
    return null;
  }
}

const PLAY_HISTORY_KEY = "wavery_play_history";

export type { PlayHistoryEntry };

function loadPlayHistory(): PlayHistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PLAY_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "string") {
          return { trackId: item, playedAt: Date.now() };
        }
        if (item && typeof item.trackId === "string") {
          return {
            trackId: item.trackId,
            playedAt: typeof item.playedAt === "number" ? item.playedAt : Date.now(),
          };
        }
        return null;
      })
      .filter((item): item is PlayHistoryEntry => item !== null)
      .slice(0, 150);
  } catch {
    return [];
  }
}

function savePlayHistory(history: PlayHistoryEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PLAY_HISTORY_KEY, JSON.stringify(history.slice(0, 150)));
  } catch {
    // Ignore quota errors
  }
}

interface PlayerStoreState {
  /** Current playback status from the backend. */
  status: PlayerStatus;
  /** Currently playing track (full object for PlayerBar display). */
  currentTrack: Track | undefined;
  /** Just the track ID for cheap equality checks in table rows. */
  currentTrackId: string | undefined;
  /** Context / container where current playback originated (album, playlist, etc.). */
  playbackContext: PlaybackContext | null;

  /** User priority queue for explicit 'Play Next' & 'Play Later' additions. */
  userQueue: Track[];
  /** Active playback context tracks (album, playlist, or library view). */
  contextQueue: Track[];
  /** Index in contextQueue. */
  contextIndex: number;
  /** Session history of played tracks for accurate back-navigation. */
  sessionHistory: Track[];
  /** Shuffled permutation of context indices. */
  shuffleIndices: number[];
  /** Current position within shuffleIndices. */
  shufflePos: number;

  /** Active playback queue (unified view for components). */
  queue: Track[];
  /** Index of currently playing track in queue. */
  queueIndex: number;
  /** Whether shuffle is enabled. */
  isShuffle: boolean;
  /** Loop mode (Off, Queue, Track). */
  loopMode: "Off" | "Queue" | "Track";
  /** Whether autoplay is enabled (continuous playback when playing from all songs / queue completion). */
  isAutoplay: boolean;
  /** Set of favorite track IDs. */
  favoriteTrackIds: Set<string>;
  /** Whether the playback was explicitly stopped by the user. */
  isManualStop: boolean;
  /** Chronological history of recently played track entries with timestamps. */
  playHistory: PlayHistoryEntry[];
  /** Record a track ID into recent playback history. */
  recordTrackPlay: (trackId: string) => void;
  /** Clear all playback history. */
  clearPlayHistory: () => void;
  /** Remove a track entry from playback history. */
  removePlayHistoryItem: (trackId: string, timestamp?: number) => void;

  /** Start the 500ms polling loop. Call once on app mount. */
  startPolling: () => () => void;
  /** Play a specific track (and update or initialize queue). */
  playTrack: (track: Track, context?: PlaybackContext) => Promise<void>;
  /** Set a new queue and start playback at startIndex. */
  setQueue: (tracks: Track[], startIndex?: number, context?: PlaybackContext) => Promise<void>;
  /** Set or update the active playback context. */
  setPlaybackContext: (context: PlaybackContext | null) => void;
  /** Append one or more tracks to the current user priority queue. */
  addToQueue: (track: Track | Track[]) => void;
  /** Insert one or more tracks at the top of the user priority queue. */
  insertAfterCurrent: (track: Track | Track[]) => void;
  /** Insert tracks to play next in user priority queue. */
  playNextInUserQueue: (track: Track | Track[]) => void;
  /** Add tracks to back of user priority queue. */
  addToUserQueue: (track: Track | Track[]) => void;
  /** Remove a track from user queue by index. */
  removeFromUserQueue: (index: number) => void;
  /** Reorder a track in user queue. */
  reorderUserQueue: (fromIndex: number, toIndex: number) => void;
  /** Clear all user-queued tracks. */
  clearUserQueue: () => void;
  /** Jump directly to a track in user queue. */
  jumpToUserQueueItem: (index: number) => Promise<void>;
  /** Jump directly to a track in context queue. */
  jumpToContextTrack: (contextIndex: number) => Promise<void>;
  /** Jump directly to a track at index in queue. */
  jumpToQueueIndex: (index: number) => Promise<void>;
  /** Remove a track from queue by index. */
  removeFromQueue: (index: number) => void;
  /** Handle cleanup when a track is deleted from the library. */
  handleTrackDeleted: (trackId: string) => Promise<void>;
  /** Clear the active queue. */
  clearQueue: () => void;
  /** Toggle shuffle mode on/off. */
  toggleShuffle: () => void;
  /** Toggle autoplay mode on/off. */
  toggleAutoplay: () => void;
  /** Explicitly set autoplay mode. */
  setAutoplay: (enabled: boolean) => void;
  /** Cycle loop mode: Off -> Queue -> Track -> Off. */
  cycleLoopMode: () => void;
  /** Explicitly set loop mode. */
  setLoopMode: (mode: "Off" | "Queue" | "Track") => void;
  /** Toggle favorite status of a track. */
  toggleFavorite: (trackId: string) => void;
  /** Skip to next track in queue. */
  playNext: () => Promise<void>;
  /** Skip to previous track in queue or restart current track if >3s. */
  playPrevious: () => Promise<void>;
  /** Resume playback. */
  resume: () => Promise<void>;
  /** Pause playback. */
  pause: () => void;
  /** Stop playback. */
  stop: () => void;
  /** Seek to a position in seconds. */
  seek: (seconds: number) => void;
  /** Set volume (0–1). */
  setVolume: (volume: number) => void;
  /** Switch to the web client: pauses local playback, saves session, and launches browser. */
  switchToWeb: () => Promise<void>;
  /**
   * Restore the last session from localStorage.
   * Loads queue + track + position back into state, seeks to saved position,
   * and resumes playback only when `autoResumePlayback` is enabled.
   * Safe to call on every mount — no-ops if no session exists.
   */
  restoreSession: () => Promise<void>;
}

const DEFAULT_STATUS: PlayerStatus = {
  state: "Stopped",
  volume: 0.8,
  position_secs: 0,
  loop_mode: "Off",
};

// Hardware-accelerated, coalesced volume dispatch mechanism
let volumeRafId: number | null = null;
let pendingVolume: number | null = null;
let lastDispatchedVolume: number | null = null;
let lastUserVolumeChangeTime = 0;

function flushVolumeDispatcher() {
  volumeRafId = null;
  if (pendingVolume !== null && pendingVolume !== lastDispatchedVolume) {
    const vol = pendingVolume;
    lastDispatchedVolume = vol;
    playerAdapter.setVolume(vol).catch((err) => {
      console.warn("Adapter setVolume error:", err);
    });
  }
  if (pendingVolume !== null && pendingVolume !== lastDispatchedVolume) {
    volumeRafId = typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(flushVolumeDispatcher)
      : null;
  }
}

function dispatchThrottledVolume(volume: number) {
  pendingVolume = volume;
  if (volumeRafId === null) {
    volumeRafId = typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(flushVolumeDispatcher)
      : (flushVolumeDispatcher(), null);
  }
}

export const usePlayerStore = create<PlayerStoreState>((set, get) => ({
  status: DEFAULT_STATUS,
  currentTrack: undefined,
  currentTrackId: undefined,
  playbackContext: null,
  userQueue: [],
  contextQueue: [],
  contextIndex: -1,
  sessionHistory: [],
  shuffleIndices: [],
  shufflePos: 0,
  queue: [],
  queueIndex: -1,
  isShuffle: false,
  loopMode: "Off",
  isAutoplay: true,
  favoriteTrackIds: new Set<string>(),
  isManualStop: false,
  playHistory: loadPlayHistory(),

  recordTrackPlay: (trackId: string) => {
    if (!trackId) return;
    const now = Date.now();
    const current = get().playHistory;
    // Debounce duplicate plays within 10 seconds, and place most recent at top
    const filtered = current.filter(
      (entry) => !(entry.trackId === trackId && now - entry.playedAt < 10000)
    );
    const updated = [{ trackId, playedAt: now }, ...filtered].slice(0, 150);
    set({ playHistory: updated });
    savePlayHistory(updated);
  },

  clearPlayHistory: () => {
    set({ playHistory: [] });
    savePlayHistory([]);
  },

  removePlayHistoryItem: (trackId: string, timestamp?: number) => {
    const current = get().playHistory;
    const updated = current.filter((entry) => {
      if (timestamp !== undefined) {
        return !(entry.trackId === trackId && entry.playedAt === timestamp);
      }
      return entry.trackId !== trackId;
    });
    set({ playHistory: updated });
    savePlayHistory(updated);
  },

  startPolling: () => {
    let autoCrossfadeTriggered = false;
    let currentPollingTrackId: string | undefined = undefined;

    const unsubEnded = playerAdapter.onTrackEnded
      ? playerAdapter.onTrackEnded(() => {
          if (!autoCrossfadeTriggered) {
            get().playNext();
          }
        })
      : () => {};

    let unsubExternalPause = () => {};
    let unsubTrackChanged = () => {};
    if (playerAdapter.isTauri()) {
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          const u1 = listen("external-pause", () => {
            set((state) => ({
              isManualStop: true,
              status: { ...state.status, state: "Paused" },
            }));
          });
          const u2 = listen("queue-track-changed", (event: { payload?: Track }) => {
            const track = event?.payload;
            if (!track) return;
            const s = get();
            if (s.currentTrackId === track.id) return;
            if (s.userQueue.length > 0 && s.userQueue[0].id === track.id) {
              const nextUser = s.userQueue.slice(1);
              const nextHist = s.currentTrack ? [...s.sessionHistory, s.currentTrack].slice(-50) : s.sessionHistory;
              const { queue, queueIndex } = computeQueueState(
                s.contextQueue,
                s.contextIndex,
                nextUser,
                track,
                s.isShuffle,
                s.shuffleIndices,
                s.shufflePos
              );
              set({
                userQueue: nextUser,
                currentTrack: track,
                currentTrackId: track.id,
                sessionHistory: nextHist,
                queue,
                queueIndex,
                status: { ...s.status, state: "Playing", current_track: track },
              });
            } else {
              const idx = s.contextQueue.findIndex((t) => t.id === track.id);
              const nextHist = s.currentTrack ? [...s.sessionHistory, s.currentTrack].slice(-50) : s.sessionHistory;
              const nextContextIdx = idx >= 0 ? idx : s.contextIndex;
              let nextShufflePos = s.shufflePos;
              if (s.isShuffle && s.shuffleIndices.length > 0 && idx >= 0) {
                const sPos = s.shuffleIndices.indexOf(idx);
                if (sPos >= 0) nextShufflePos = sPos;
              }
              const { queue, queueIndex } = computeQueueState(
                s.contextQueue,
                nextContextIdx,
                s.userQueue,
                track,
                s.isShuffle,
                s.shuffleIndices,
                nextShufflePos
              );
              set({
                contextIndex: nextContextIdx,
                shufflePos: nextShufflePos,
                currentTrack: track,
                currentTrackId: track.id,
                sessionHistory: nextHist,
                queue,
                queueIndex,
                status: { ...s.status, state: "Playing", current_track: track },
              });
            }
          });
          return Promise.all([u1, u2]);
        })
        .then((unlisteners) => {
          if (unlisteners && unlisteners[0]) unsubExternalPause = unlisteners[0];
          if (unlisteners && unlisteners[1]) unsubTrackChanged = unlisteners[1];
        })
        .catch(() => {});
    }

    // Register media session hardware key handlers once at polling start.
    // These route OS media key events back into the player store actions.
    const unsubMediaSession = registerMediaSessionHandlers({
      onPlay: () => get().resume(),
      onPause: () => get().pause(),
      onStop: () => get().stop(),
      onNextTrack: () => get().playNext(),
      onPreviousTrack: () => get().playPrevious(),
      onSeekTo: (positionSecs) => get().seek(positionSecs),
      onSeekBackward: () => {
        const pos = get().status.position_secs;
        get().seek(Math.max(0, pos - 10));
      },
      onSeekForward: () => {
        const pos = get().status.position_secs;
        const dur = get().status.duration_secs ?? pos + 30;
        get().seek(Math.min(dur, pos + 10));
      },
    });

    // Throttle position saves: write at most every 5 seconds
    let lastSaveTime = 0;

    const interval = setInterval(async () => {
      try {
        const s = await playerAdapter.getStatus();
        const prev = get();

        const wasPlaying = prev.status.state === "Playing";
        const isNowStopped = s.state === "Stopped";

        const newTrackId = s.current_track?.id;
        const trackChanged = prev.currentTrackId !== newTrackId;

        if (trackChanged || currentPollingTrackId !== newTrackId) {
          currentPollingTrackId = newTrackId;
          if (newTrackId && s.state === "Playing") {
            get().recordTrackPlay(newTrackId);
          }
          // Only reset autoCrossfadeTriggered once the incoming track is playing or not in transient stopped state
          if (s.position_secs > 0 || s.state === "Playing") {
            autoCrossfadeTriggered = false;
          }
        }

        // Check if any status field changed (preserving client-side loop_mode)
        const stateChanged = prev.status.state !== s.state;
        const posChanged = prev.status.position_secs !== s.position_secs;
        const isRecentUserVolume = Date.now() - lastUserVolumeChangeTime < 1500;
        const volChanged = !isRecentUserVolume && Math.abs(prev.status.volume - s.volume) > 0.001;
        const durChanged = prev.status.duration_secs !== s.duration_secs;
        const statusChanged = stateChanged || posChanged || volChanged || durChanged;

        if (statusChanged || trackChanged) {
          set({
            status: {
              ...s,
              volume: isRecentUserVolume ? prev.status.volume : s.volume,
              loop_mode: get().loopMode,
            },
            ...(trackChanged
              ? {
                  currentTrack: s.current_track,
                  currentTrackId: newTrackId,
                }
              : {}),
          });

          if (trackChanged && s.current_track && s.state === "Playing") {
            notifyIfEnabled(s.current_track);
          }
        }

        // ---------------------------------------------------------------
        // Integration updates: Media Session API + Discord Rich Presence
        // ---------------------------------------------------------------
        const integrationSettings = useSettingsStore.getState();

        if (s.state === "Stopped") {
          // Clear all integrations on stop
          if (integrationSettings.enableMediaSession) {
            clearMediaSession();
          }
          if (integrationSettings.enableDiscordRpc) {
            clearDiscordPresence();
          }
        } else if (s.current_track) {
          const track = s.current_track;
          const positionSecs = s.position_secs;
          const durationSecs = s.duration_secs ?? track.metadata.duration.secs;
          const isPlaying = s.state === "Playing";

          // Media Session API — works on all browsers/OSes, zero dependencies
          if (integrationSettings.enableMediaSession) {
            // Get artwork URL from the adapter (prebuilt URL, no extra fetch needed)
            const artworkUrl = playerAdapter.getArtworkUrl(track.id);
            updateMediaSessionMetadata(track, artworkUrl);
            setMediaSessionPlaybackState(isPlaying ? "playing" : "paused");
            if (durationSecs > 0) {
              setMediaSessionPositionState(positionSecs, durationSecs);
            }
          }

          // Discord Rich Presence — debounced, posted to local server bridge
          const seeked = Math.abs(prev.status.position_secs - s.position_secs) > 2.0;
          if (integrationSettings.enableDiscordRpc && (trackChanged || stateChanged || seeked)) {
            updateDiscordPresence({
              title: track.metadata.title ?? "Unknown Title",
              artist: track.metadata.artist ?? "Unknown Artist",
              album: track.metadata.album ?? "",
              position_secs: positionSecs,
              duration_secs: durationSecs,
              is_playing: isPlaying,
            });
          }

          // Auto-fetch missing lyrics from LRCLIB in background on track change
          if (trackChanged && (!track.metadata.lyrics || !track.metadata.lyrics.trim())) {
            fetchLyrics(
              track.metadata.artist || "",
              track.metadata.title || "",
              track.metadata.album,
              durationSecs
            ).then((lyricsRes) => {
              if (lyricsRes?.bestLyrics) {
                const current = usePlayerStore.getState().currentTrack;
                if (current && current.id === track.id) {
                  usePlayerStore.setState({
                    currentTrack: {
                      ...current,
                      metadata: {
                        ...current.metadata,
                        lyrics: lyricsRes.bestLyrics,
                      },
                    },
                  });
                }
              }
            }).catch(() => {});
          }
        }
        // ---------------------------------------------------------------

        // Auto-crossfade check:
        // When a track is playing and approaches its end within the crossfade window,
        // automatically trigger playback of the next track so that outgoing audio fades out
        // while incoming audio simultaneously fades in without gaps or silence.
        if (s.state === "Playing" && !prev.isManualStop) {
          const settings = useSettingsStore.getState();
          const crossfadeMs = settings?.crossfadeDurationMs || 0;
          const crossfadeSecs = crossfadeMs / 1000;

          if (
            crossfadeSecs > 0 &&
            s.duration_secs &&
            s.duration_secs > crossfadeSecs * 1.5 &&
            s.position_secs > 0
          ) {
            const remainingSecs = s.duration_secs - s.position_secs;

            // Reset trigger flag if the user seeks backwards out of the crossfade window
            if (remainingSecs > crossfadeSecs + 2) {
              autoCrossfadeTriggered = false;
            } else if (remainingSecs <= crossfadeSecs && remainingSecs > 0 && !autoCrossfadeTriggered) {
              const currentLoop = (prev.loopMode !== "Off" ? prev.loopMode : prev.status.loop_mode) ?? "Off";
              const hasNext =
                currentLoop === "Track" ||
                currentLoop === "Queue" ||
                (prev.queueIndex >= 0 && prev.queueIndex < prev.queue.length - 1) ||
                prev.isAutoplay;

              if (hasNext) {
                autoCrossfadeTriggered = true;
                get().playNext();
              }
            }
          }
        }

        // Throttle-save session (position + queue) every 5 seconds while something is active
        const now = Date.now();
        if (now - lastSaveTime >= 5000 && prev.queue.length > 0) {
          lastSaveTime = now;
          const state = get();
          saveSession({
            queue: state.queue,
            queueIndex: state.queueIndex,
            currentTrackId: state.currentTrackId,
            playbackContext: state.playbackContext,
            isShuffle: state.isShuffle,
            isAutoplay: state.isAutoplay,
            loopMode: state.loopMode,
            positionSecs: s.position_secs,
            userQueue: state.userQueue,
            contextQueue: state.contextQueue,
            contextIndex: state.contextIndex,
            sessionHistory: state.sessionHistory,
          });
        }

        // If playback naturally transitioned from Playing to Stopped and wasn't manually stopped or crossfaded
        if (wasPlaying && isNowStopped && !prev.isManualStop && !autoCrossfadeTriggered) {
          get().playNext();
        }
      } catch (_) {
        // Quiet poll failure
      }
    }, 500);

    return () => {
      unsubEnded();
      unsubExternalPause();
      unsubTrackChanged();
      unsubMediaSession();
      clearInterval(interval);
      // Ensure integrations are cleaned up when the player is destroyed
      clearMediaSession();
      clearDiscordPresence();
    };
  },


  setPlaybackContext: (context: PlaybackContext | null) => {
    set({ playbackContext: context });
  },

  playTrack: async (track: Track, context?: PlaybackContext) => {
    const { contextQueue, userQueue, isShuffle, playbackContext: existingContext } = get();
    const effectiveContext =
      context ||
      existingContext ||
      (track.metadata.album
        ? {
            type: "album" as const,
            name: track.metadata.album,
            artist: track.metadata.artist,
          }
        : {
            type: "tracks" as const,
            name: "All Tracks",
          });

    let nextContext = contextQueue;
    let nextContextIdx = contextQueue.findIndex((t) => t.id === track.id);
    if (nextContextIdx === -1) {
      nextContext = [track];
      nextContextIdx = 0;
    }

    const shuffleIndices = isShuffle ? generateShuffleIndices(nextContext.length, nextContextIdx) : [];
    const shufflePos = 0;
    const { queue, queueIndex } = computeQueueState(
      nextContext,
      nextContextIdx,
      userQueue,
      track,
      isShuffle,
      shuffleIndices,
      shufflePos
    );

    set({
      contextQueue: nextContext,
      contextIndex: nextContextIdx,
      shuffleIndices,
      shufflePos,
      queue,
      queueIndex,
      currentTrack: track,
      currentTrackId: track.id,
      playbackContext: effectiveContext,
      isManualStop: false,
    });

    try {
      get().recordTrackPlay(track.id);
      await playerAdapter.playTrack(track);
      notifyIfEnabled(track);
      const s = get();
      syncWithBackend(s);
      saveSession({
        queue: s.queue,
        queueIndex: s.queueIndex,
        currentTrackId: s.currentTrackId,
        playbackContext: s.playbackContext,
        isShuffle: s.isShuffle,
        isAutoplay: s.isAutoplay,
        loopMode: s.loopMode,
        positionSecs: 0,
        userQueue: s.userQueue,
        contextQueue: s.contextQueue,
        contextIndex: s.contextIndex,
        sessionHistory: s.sessionHistory,
      });
    } catch (e) {
      console.error("Failed to play track:", e);
    }
  },

  setQueue: async (tracks: Track[], startIndex: number = 0, context?: PlaybackContext) => {
    if (tracks.length === 0) return;
    const validIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const targetTrack = tracks[validIndex];
    get().recordTrackPlay(targetTrack.id);

    const effectiveContext =
      context ||
      (targetTrack.metadata.album
        ? {
            type: "album" as const,
            name: targetTrack.metadata.album,
            artist: targetTrack.metadata.artist,
          }
        : {
            type: "tracks" as const,
            name: "All Tracks",
          });

    const isShuffle = get().isShuffle;
    const shuffleIndices = isShuffle ? generateShuffleIndices(tracks.length, validIndex) : [];
    const shufflePos = 0;

    // If context was explicitly provided (e.g. user selected album/playlist), preserve userQueue.
    // If raw setQueue without context (e.g. test runner or linear queue replace), start fresh userQueue.
    const userQueue = context ? get().userQueue : [];
    const { queue, queueIndex } = computeQueueState(
      tracks,
      validIndex,
      userQueue,
      targetTrack,
      isShuffle,
      shuffleIndices,
      shufflePos
    );

    set({
      status: { ...get().status, state: "Playing", position_secs: 0 },
      contextQueue: tracks,
      contextIndex: validIndex,
      userQueue,
      shuffleIndices,
      shufflePos,
      queue,
      queueIndex,
      currentTrack: targetTrack,
      currentTrackId: targetTrack.id,
      playbackContext: effectiveContext,
      isManualStop: false,
    });

    try {
      await playerAdapter.playTrack(targetTrack);
      notifyIfEnabled(targetTrack);
      const s = get();
      syncWithBackend(s);
      saveSession({
        queue: s.queue,
        queueIndex: s.queueIndex,
        currentTrackId: s.currentTrackId,
        playbackContext: s.playbackContext,
        isShuffle: s.isShuffle,
        isAutoplay: s.isAutoplay,
        loopMode: s.loopMode,
        positionSecs: 0,
        userQueue: s.userQueue,
        contextQueue: s.contextQueue,
        contextIndex: s.contextIndex,
        sessionHistory: s.sessionHistory,
      });
    } catch (e) {
      console.error("Failed to play track from queue:", e);
    }
  },

  playNextInUserQueue: (track: Track | Track[]) => {
    const toAdd = Array.isArray(track) ? track : [track];
    if (toAdd.length === 0) return;
    set((state) => {
      const nextUser = [...toAdd, ...state.userQueue];
      const { queue, queueIndex } = computeQueueState(
        state.contextQueue,
        state.contextIndex,
        nextUser,
        state.currentTrack,
        state.isShuffle,
        state.shuffleIndices,
        state.shufflePos
      );
      const nextState = { ...state, userQueue: nextUser, queue, queueIndex };
      syncWithBackend(nextState);
      saveSession({
        queue,
        queueIndex,
        currentTrackId: state.currentTrackId,
        playbackContext: state.playbackContext,
        isShuffle: state.isShuffle,
        isAutoplay: state.isAutoplay,
        loopMode: state.loopMode,
        positionSecs: state.status.position_secs,
        userQueue: nextUser,
        contextQueue: state.contextQueue,
        contextIndex: state.contextIndex,
        sessionHistory: state.sessionHistory,
      });
      return { userQueue: nextUser, queue, queueIndex };
    });
  },

  addToUserQueue: (track: Track | Track[]) => {
    const toAdd = Array.isArray(track) ? track : [track];
    if (toAdd.length === 0) return;
    set((state) => {
      const nextUser = [...state.userQueue, ...toAdd];
      const { queue, queueIndex } = computeQueueState(
        state.contextQueue,
        state.contextIndex,
        nextUser,
        state.currentTrack,
        state.isShuffle,
        state.shuffleIndices,
        state.shufflePos
      );
      const nextState = { ...state, userQueue: nextUser, queue, queueIndex };
      syncWithBackend(nextState);
      saveSession({
        queue,
        queueIndex,
        currentTrackId: state.currentTrackId,
        playbackContext: state.playbackContext,
        isShuffle: state.isShuffle,
        isAutoplay: state.isAutoplay,
        loopMode: state.loopMode,
        positionSecs: state.status.position_secs,
        userQueue: nextUser,
        contextQueue: state.contextQueue,
        contextIndex: state.contextIndex,
        sessionHistory: state.sessionHistory,
      });
      return { userQueue: nextUser, queue, queueIndex };
    });
  },

  insertAfterCurrent: (track: Track | Track[]) => {
    get().playNextInUserQueue(track);
  },

  addToQueue: (track: Track | Track[]) => {
    const toAdd = Array.isArray(track) ? track : [track];
    if (toAdd.length === 0) return;
    set((state) => {
      const nextContext = [...state.contextQueue, ...toAdd];
      const { queue, queueIndex } = computeQueueState(
        nextContext,
        state.contextIndex,
        state.userQueue,
        state.currentTrack,
        state.isShuffle,
        state.shuffleIndices,
        state.shufflePos
      );
      const nextState = { ...state, contextQueue: nextContext, queue, queueIndex };
      syncWithBackend(nextState);
      saveSession({
        queue,
        queueIndex,
        currentTrackId: state.currentTrackId,
        playbackContext: state.playbackContext,
        isShuffle: state.isShuffle,
        isAutoplay: state.isAutoplay,
        loopMode: state.loopMode,
        positionSecs: state.status.position_secs,
        userQueue: state.userQueue,
        contextQueue: nextContext,
        contextIndex: state.contextIndex,
        sessionHistory: state.sessionHistory,
      });
      return { contextQueue: nextContext, queue, queueIndex };
    });
  },

  removeFromUserQueue: (index: number) => {
    set((state) => {
      if (index < 0 || index >= state.userQueue.length) return state;
      const nextUser = state.userQueue.filter((_, i) => i !== index);
      const { queue, queueIndex } = computeQueueState(
        state.contextQueue,
        state.contextIndex,
        nextUser,
        state.currentTrack,
        state.isShuffle,
        state.shuffleIndices,
        state.shufflePos
      );
      const nextState = { ...state, userQueue: nextUser, queue, queueIndex };
      syncWithBackend(nextState);
      saveSession({
        queue,
        queueIndex,
        currentTrackId: state.currentTrackId,
        playbackContext: state.playbackContext,
        isShuffle: state.isShuffle,
        isAutoplay: state.isAutoplay,
        loopMode: state.loopMode,
        positionSecs: state.status.position_secs,
        userQueue: nextUser,
        contextQueue: state.contextQueue,
        contextIndex: state.contextIndex,
        sessionHistory: state.sessionHistory,
      });
      return { userQueue: nextUser, queue, queueIndex };
    });
  },

  reorderUserQueue: (fromIndex: number, toIndex: number) => {
    set((state) => {
      if (
        fromIndex < 0 ||
        fromIndex >= state.userQueue.length ||
        toIndex < 0 ||
        toIndex >= state.userQueue.length ||
        fromIndex === toIndex
      ) {
        return state;
      }
      const nextUser = [...state.userQueue];
      const [moved] = nextUser.splice(fromIndex, 1);
      nextUser.splice(toIndex, 0, moved);
      const { queue, queueIndex } = computeQueueState(
        state.contextQueue,
        state.contextIndex,
        nextUser,
        state.currentTrack,
        state.isShuffle,
        state.shuffleIndices,
        state.shufflePos
      );
      const nextState = { ...state, userQueue: nextUser, queue, queueIndex };
      syncWithBackend(nextState);
      saveSession({
        queue,
        queueIndex,
        currentTrackId: state.currentTrackId,
        playbackContext: state.playbackContext,
        isShuffle: state.isShuffle,
        isAutoplay: state.isAutoplay,
        loopMode: state.loopMode,
        positionSecs: state.status.position_secs,
        userQueue: nextUser,
        contextQueue: state.contextQueue,
        contextIndex: state.contextIndex,
        sessionHistory: state.sessionHistory,
      });
      return { userQueue: nextUser, queue, queueIndex };
    });
  },

  clearUserQueue: () => {
    set((state) => {
      const { queue, queueIndex } = computeQueueState(
        state.contextQueue,
        state.contextIndex,
        [],
        state.currentTrack,
        state.isShuffle,
        state.shuffleIndices,
        state.shufflePos
      );
      const nextState = { ...state, userQueue: [], queue, queueIndex };
      syncWithBackend(nextState);
      saveSession({
        queue,
        queueIndex,
        currentTrackId: state.currentTrackId,
        playbackContext: state.playbackContext,
        isShuffle: state.isShuffle,
        isAutoplay: state.isAutoplay,
        loopMode: state.loopMode,
        positionSecs: state.status.position_secs,
        userQueue: [],
        contextQueue: state.contextQueue,
        contextIndex: state.contextIndex,
        sessionHistory: state.sessionHistory,
      });
      return { userQueue: [], queue, queueIndex };
    });
  },

  jumpToUserQueueItem: async (index: number) => {
    const { userQueue, currentTrack, sessionHistory, contextQueue, contextIndex, isShuffle, shuffleIndices, shufflePos } = get();
    if (index < 0 || index >= userQueue.length) return;
    const targetTrack = userQueue[index];
    const nextUser = userQueue.filter((_, i) => i !== index);
    const nextHist = currentTrack ? [...sessionHistory, currentTrack].slice(-50) : sessionHistory;
    const { queue, queueIndex } = computeQueueState(
      contextQueue,
      contextIndex,
      nextUser,
      targetTrack,
      isShuffle,
      shuffleIndices,
      shufflePos
    );

    set({
      userQueue: nextUser,
      currentTrack: targetTrack,
      currentTrackId: targetTrack.id,
      sessionHistory: nextHist,
      queue,
      queueIndex,
      isManualStop: false,
    });

    try {
      get().recordTrackPlay(targetTrack.id);
      await playerAdapter.playTrack(targetTrack);
      notifyIfEnabled(targetTrack);
      const s = get();
      syncWithBackend(s);
      saveSession({
        queue: s.queue,
        queueIndex: s.queueIndex,
        currentTrackId: s.currentTrackId,
        playbackContext: s.playbackContext,
        isShuffle: s.isShuffle,
        isAutoplay: s.isAutoplay,
        loopMode: s.loopMode,
        positionSecs: 0,
        userQueue: s.userQueue,
        contextQueue: s.contextQueue,
        contextIndex: s.contextIndex,
        sessionHistory: s.sessionHistory,
      });
    } catch (e) {
      console.error("Failed to jump to user queue track:", e);
    }
  },

  jumpToContextTrack: async (index: number) => {
    const { contextQueue, currentTrack, sessionHistory, isShuffle, shuffleIndices, userQueue } = get();
    if (index < 0 || index >= contextQueue.length) return;
    const targetTrack = contextQueue[index];
    const nextHist = currentTrack ? [...sessionHistory, currentTrack].slice(-50) : sessionHistory;
    let nextShufflePos = 0;
    if (isShuffle && shuffleIndices.length > 0) {
      const sPos = shuffleIndices.indexOf(index);
      if (sPos >= 0) nextShufflePos = sPos;
    }
    const { queue, queueIndex } = computeQueueState(
      contextQueue,
      index,
      userQueue,
      targetTrack,
      isShuffle,
      shuffleIndices,
      nextShufflePos
    );

    set({
      contextIndex: index,
      shufflePos: nextShufflePos,
      currentTrack: targetTrack,
      currentTrackId: targetTrack.id,
      sessionHistory: nextHist,
      queue,
      queueIndex,
      isManualStop: false,
    });

    try {
      get().recordTrackPlay(targetTrack.id);
      await playerAdapter.playTrack(targetTrack);
      notifyIfEnabled(targetTrack);
      const s = get();
      syncWithBackend(s);
      saveSession({
        queue: s.queue,
        queueIndex: s.queueIndex,
        currentTrackId: s.currentTrackId,
        playbackContext: s.playbackContext,
        isShuffle: s.isShuffle,
        isAutoplay: s.isAutoplay,
        loopMode: s.loopMode,
        positionSecs: 0,
        userQueue: s.userQueue,
        contextQueue: s.contextQueue,
        contextIndex: s.contextIndex,
        sessionHistory: s.sessionHistory,
      });
    } catch (e) {
      console.error("Failed to jump to context track:", e);
    }
  },

  jumpToQueueIndex: async (index: number) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    const targetTrack = queue[index];

    // If targetTrack is in userQueue
    const uIdx = get().userQueue.findIndex((t) => t.id === targetTrack.id);
    if (uIdx !== -1) {
      await get().jumpToUserQueueItem(uIdx);
      return;
    }

    // If in contextQueue
    const cIdx = get().contextQueue.findIndex((t) => t.id === targetTrack.id);
    if (cIdx !== -1) {
      await get().jumpToContextTrack(cIdx);
      return;
    }

    await get().playTrack(targetTrack);
  },

  removeFromQueue: (index: number) => {
    const { queue, userQueue, contextQueue, contextIndex, currentTrack } = get();
    if (index < 0 || index >= queue.length) return;
    const targetTrack = queue[index];

    const uIdx = userQueue.findIndex((t) => t.id === targetTrack.id);
    if (uIdx !== -1) {
      get().removeFromUserQueue(uIdx);
      return;
    }

    const cIdx = contextQueue.findIndex((t) => t.id === targetTrack.id);
    if (cIdx !== -1) {
      const nextContext = contextQueue.filter((_, i) => i !== cIdx);
      let nextContextIdx = contextIndex;
      if (cIdx < contextIndex) {
        nextContextIdx = Math.max(0, contextIndex - 1);
      } else if (cIdx === contextIndex) {
        nextContextIdx = Math.min(contextIndex, nextContext.length - 1);
      }
      const s = get();
      const { queue: nextQ, queueIndex: nextQIdx } = computeQueueState(
        nextContext,
        nextContextIdx,
        userQueue,
        currentTrack,
        s.isShuffle,
        s.shuffleIndices,
        s.shufflePos
      );
      set({
        contextQueue: nextContext,
        contextIndex: nextContextIdx,
        queue: nextQ,
        queueIndex: nextQIdx,
      });
      syncWithBackend(get());
    }
  },

  handleTrackDeleted: async (trackId: string) => {
    const state = get();
    const isCurrentPlaying = state.currentTrackId === trackId;
    if (isCurrentPlaying) {
      try {
        await playerAdapter.stop();
      } catch (err) {
        console.debug("Error stopping playback for deleted track:", err);
      }
    }

    const nextQueue = state.queue.filter((t) => t.id !== trackId);
    const nextUser = state.userQueue.filter((t) => t.id !== trackId);
    const nextContext = state.contextQueue.filter((t) => t.id !== trackId);
    let nextIndex = state.queueIndex;
    let nextCurrentTrackId = state.currentTrackId;

    if (isCurrentPlaying) {
      if (nextQueue.length > 0) {
        nextIndex = Math.min(state.queueIndex, nextQueue.length - 1);
        nextCurrentTrackId = nextQueue[nextIndex]?.id;
      } else {
        nextIndex = -1;
        nextCurrentTrackId = undefined;
      }
    } else {
      const removedIndices = state.queue
        .map((t, idx) => (t.id === trackId ? idx : -1))
        .filter((idx) => idx !== -1);
      const removedBeforeCurrent = removedIndices.filter((idx) => idx < state.queueIndex).length;
      nextIndex = Math.max(0, state.queueIndex - removedBeforeCurrent);
    }

    const nextCurrentTrack = nextCurrentTrackId
      ? nextQueue.find((t) => t.id === nextCurrentTrackId)
      : undefined;

    set({
      userQueue: nextUser,
      contextQueue: nextContext,
      contextIndex: Math.max(0, Math.min(nextIndex, nextContext.length - 1)),
      currentTrack: nextCurrentTrack,
      currentTrackId: nextCurrentTrackId,
      queue: nextQueue,
      queueIndex: nextIndex,
      status: {
        ...state.status,
        state: isCurrentPlaying ? "Stopped" : state.status.state,
        position_secs: isCurrentPlaying ? 0 : state.status.position_secs,
        duration_secs: isCurrentPlaying ? 0 : state.status.duration_secs,
        current_track: isCurrentPlaying ? nextCurrentTrack : state.status.current_track,
      },
    });

    const s = get();
    syncWithBackend(s);
    saveSession({
      queue: s.queue,
      queueIndex: s.queueIndex,
      currentTrackId: s.currentTrackId,
      playbackContext: s.playbackContext,
      isShuffle: s.isShuffle,
      isAutoplay: s.isAutoplay,
      loopMode: s.loopMode,
      positionSecs: s.status.position_secs,
      userQueue: s.userQueue,
      contextQueue: s.contextQueue,
      contextIndex: s.contextIndex,
      sessionHistory: s.sessionHistory,
    });
  },

  clearQueue: () => {
    set({
      userQueue: [],
      contextQueue: [],
      contextIndex: -1,
      queue: [],
      queueIndex: -1,
    });
    syncWithBackend(get());
  },

  toggleShuffle: () => {
    set((state) => {
      const nextShuffle = !state.isShuffle;
      const contextPool = state.contextQueue.length > 0 ? state.contextQueue : state.queue;
      const activeIdx = state.contextIndex >= 0 ? state.contextIndex : Math.max(0, state.queueIndex);
      let shuffleIndices: number[] = [];
      let shufflePos = 0;

      if (nextShuffle && contextPool.length > 0) {
        shuffleIndices = generateShuffleIndices(contextPool.length, activeIdx);
        shufflePos = 0;
      }

      const { queue, queueIndex } = computeQueueState(
        contextPool,
        activeIdx,
        state.userQueue,
        state.currentTrack,
        nextShuffle,
        shuffleIndices,
        shufflePos
      );

      const nextState = {
        ...state,
        isShuffle: nextShuffle,
        shuffleIndices,
        shufflePos,
        contextQueue: contextPool,
        contextIndex: activeIdx,
        queue,
        queueIndex,
      };

      syncWithBackend(nextState);
      saveSession({
        queue,
        queueIndex,
        currentTrackId: state.currentTrackId,
        playbackContext: state.playbackContext,
        isShuffle: nextShuffle,
        isAutoplay: state.isAutoplay,
        loopMode: state.loopMode,
        positionSecs: state.status.position_secs,
        userQueue: state.userQueue,
        contextQueue: contextPool,
        contextIndex: activeIdx,
        sessionHistory: state.sessionHistory,
      });

      return nextState;
    });
  },

  toggleAutoplay: () => {
    set((state) => ({ isAutoplay: !state.isAutoplay }));
    const s = get();
    saveSession({
      queue: s.queue,
      queueIndex: s.queueIndex,
      currentTrackId: s.currentTrackId,
      playbackContext: s.playbackContext,
      isShuffle: s.isShuffle,
      isAutoplay: s.isAutoplay,
      loopMode: s.loopMode,
      positionSecs: s.status.position_secs,
      userQueue: s.userQueue,
      contextQueue: s.contextQueue,
      contextIndex: s.contextIndex,
      sessionHistory: s.sessionHistory,
    });
  },

  setAutoplay: (enabled: boolean) => {
    set({ isAutoplay: enabled });
    const s = get();
    saveSession({
      queue: s.queue,
      queueIndex: s.queueIndex,
      currentTrackId: s.currentTrackId,
      playbackContext: s.playbackContext,
      isShuffle: s.isShuffle,
      isAutoplay: s.isAutoplay,
      loopMode: s.loopMode,
      positionSecs: s.status.position_secs,
      userQueue: s.userQueue,
      contextQueue: s.contextQueue,
      contextIndex: s.contextIndex,
      sessionHistory: s.sessionHistory,
    });
  },

  cycleLoopMode: () => {
    set((state) => {
      const nextMode: "Off" | "Queue" | "Track" =
        state.loopMode === "Off"
          ? "Queue"
          : state.loopMode === "Queue"
          ? "Track"
          : "Off";
      return {
        loopMode: nextMode,
        status: { ...state.status, loop_mode: nextMode },
      };
    });
    const s = get();
    syncWithBackend(s);
    saveSession({
      queue: s.queue,
      queueIndex: s.queueIndex,
      currentTrackId: s.currentTrackId,
      playbackContext: s.playbackContext,
      isShuffle: s.isShuffle,
      isAutoplay: s.isAutoplay,
      loopMode: s.loopMode,
      positionSecs: s.status.position_secs,
      userQueue: s.userQueue,
      contextQueue: s.contextQueue,
      contextIndex: s.contextIndex,
      sessionHistory: s.sessionHistory,
    });
  },

  setLoopMode: (mode: "Off" | "Queue" | "Track") => {
    set((state) => ({
      loopMode: mode,
      status: { ...state.status, loop_mode: mode },
    }));
    const s = get();
    syncWithBackend(s);
    saveSession({
      queue: s.queue,
      queueIndex: s.queueIndex,
      currentTrackId: s.currentTrackId,
      playbackContext: s.playbackContext,
      isShuffle: s.isShuffle,
      isAutoplay: s.isAutoplay,
      loopMode: s.loopMode,
      positionSecs: s.status.position_secs,
      userQueue: s.userQueue,
      contextQueue: s.contextQueue,
      contextIndex: s.contextIndex,
      sessionHistory: s.sessionHistory,
    });
  },

  toggleFavorite: (trackId: string) => {
    set((state) => {
      const nextFavs = new Set(state.favoriteTrackIds);
      if (nextFavs.has(trackId)) {
        nextFavs.delete(trackId);
      } else {
        nextFavs.add(trackId);
      }
      return { favoriteTrackIds: nextFavs };
    });
  },

  playNext: async () => {
    const {
      userQueue,
      contextQueue,
      contextIndex,
      queue,
      currentTrack,
      sessionHistory,
      status,
      isShuffle,
      shuffleIndices,
      shufflePos,
      isAutoplay,
      playbackContext,
    } = get();

    const loopMode = (get().loopMode !== "Off" ? get().loopMode : status.loop_mode) ?? "Off";

    // 1. LoopMode::Track
    if (loopMode === "Track" && currentTrack) {
      set({
        status: { ...status, state: "Playing", position_secs: 0 },
        isManualStop: false,
      });
      try {
        await playerAdapter.seek(0);
        await playerAdapter.playTrack(currentTrack);
      } catch (e) {
        console.error("Failed to replay track in Loop Track:", e);
      }
      return;
    }

    const nextHist = currentTrack ? [...sessionHistory, currentTrack].slice(-50) : sessionHistory;

    // 2. User priority queue takes immediate precedence
    if (userQueue.length > 0) {
      const nextTrack = userQueue[0];
      const nextUser = userQueue.slice(1);
      const activeContext = contextQueue.length > 0 ? contextQueue : get().queue;
      const activeIndex = contextIndex >= 0 ? contextIndex : get().queueIndex;
      const { queue, queueIndex } = computeQueueState(
        activeContext,
        activeIndex,
        nextUser,
        nextTrack,
        isShuffle,
        shuffleIndices,
        shufflePos
      );

      set({
        status: { ...status, state: "Playing" },
        userQueue: nextUser,
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
        sessionHistory: nextHist,
        queue,
        queueIndex,
        isManualStop: false,
      });

      try {
        get().recordTrackPlay(nextTrack.id);
        await playerAdapter.playTrack(nextTrack);
        notifyIfEnabled(nextTrack);
        const s = get();
        syncWithBackend(s);
        saveSession({
          queue: s.queue,
          queueIndex: s.queueIndex,
          currentTrackId: s.currentTrackId,
          playbackContext: s.playbackContext,
          isShuffle: s.isShuffle,
          isAutoplay: s.isAutoplay,
          loopMode: s.loopMode,
          positionSecs: 0,
          userQueue: s.userQueue,
          contextQueue: s.contextQueue,
          contextIndex: s.contextIndex,
          sessionHistory: s.sessionHistory,
        });
      } catch (e) {
        console.error("Failed to play next user-queued track:", e);
      }
      return;
    }

    // 3. Context queue traversal
    const activeContext =
      contextQueue.length > 0 && queue.length === contextQueue.length + userQueue.length
        ? contextQueue
        : get().queue;
    if (activeContext.length === 0) return;

    let activeIndex = -1;
    if (contextIndex >= 0 && contextIndex < activeContext.length && activeContext[contextIndex]?.id === currentTrack?.id) {
      activeIndex = contextIndex;
    } else if (currentTrack) {
      activeIndex = activeContext.findIndex((t) => t.id === currentTrack.id);
    }
    if (activeIndex === -1) {
      activeIndex = get().queueIndex;
    }

    if (isShuffle && activeContext.length > 1) {
      const currentIndices =
        shuffleIndices.length === activeContext.length
          ? shuffleIndices
          : generateShuffleIndices(activeContext.length, activeIndex);

      if (shufflePos + 1 < currentIndices.length) {
        const nextPos = shufflePos + 1;
        const nextContextIdx = currentIndices[nextPos];
        const nextTrack = activeContext[nextContextIdx];
        const { queue, queueIndex } = computeQueueState(
          activeContext,
          nextContextIdx,
          userQueue,
          nextTrack,
          true,
          currentIndices,
          nextPos
        );

        set({
          status: { ...status, state: "Playing" },
          contextQueue: activeContext,
          contextIndex: nextContextIdx,
          shuffleIndices: currentIndices,
          shufflePos: nextPos,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
          sessionHistory: nextHist,
          queue,
          queueIndex,
          isManualStop: false,
        });

        try {
          get().recordTrackPlay(nextTrack.id);
          await playerAdapter.playTrack(nextTrack);
          notifyIfEnabled(nextTrack);
          const s = get();
          syncWithBackend(s);
          saveSession({
            queue: s.queue,
            queueIndex: s.queueIndex,
            currentTrackId: s.currentTrackId,
            playbackContext: s.playbackContext,
            isShuffle: s.isShuffle,
            isAutoplay: s.isAutoplay,
            loopMode: s.loopMode,
            positionSecs: 0,
            userQueue: s.userQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            sessionHistory: s.sessionHistory,
          });
        } catch (e) {
          console.error("Failed to play shuffled context track:", e);
        }
        return;
      } else if (loopMode === "Queue") {
        const newIndices = generateShuffleIndices(activeContext.length, -1);
        const nextContextIdx = newIndices[0];
        const nextTrack = activeContext[nextContextIdx];
        const { queue, queueIndex } = computeQueueState(
          activeContext,
          nextContextIdx,
          userQueue,
          nextTrack,
          true,
          newIndices,
          0
        );

        set({
          status: { ...status, state: "Playing" },
          contextQueue: activeContext,
          contextIndex: nextContextIdx,
          shuffleIndices: newIndices,
          shufflePos: 0,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
          sessionHistory: nextHist,
          queue,
          queueIndex,
          isManualStop: false,
        });

        try {
          get().recordTrackPlay(nextTrack.id);
          await playerAdapter.playTrack(nextTrack);
          notifyIfEnabled(nextTrack);
          const s = get();
          syncWithBackend(s);
          saveSession({
            queue: s.queue,
            queueIndex: s.queueIndex,
            currentTrackId: s.currentTrackId,
            playbackContext: s.playbackContext,
            isShuffle: s.isShuffle,
            isAutoplay: s.isAutoplay,
            loopMode: s.loopMode,
            positionSecs: 0,
            userQueue: s.userQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            sessionHistory: s.sessionHistory,
          });
        } catch (e) {
          console.error("Failed to loop shuffled queue:", e);
        }
        return;
      }
    } else {
      if (activeIndex < activeContext.length - 1) {
        const nextContextIdx = activeIndex + 1;
        const nextTrack = activeContext[nextContextIdx];
        const { queue, queueIndex } = computeQueueState(
          activeContext,
          nextContextIdx,
          userQueue,
          nextTrack,
          false
        );

        set({
          status: { ...status, state: "Playing" },
          contextQueue: activeContext,
          contextIndex: nextContextIdx,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
          sessionHistory: nextHist,
          queue,
          queueIndex,
          isManualStop: false,
        });

        try {
          get().recordTrackPlay(nextTrack.id);
          await playerAdapter.playTrack(nextTrack);
          notifyIfEnabled(nextTrack);
          const s = get();
          syncWithBackend(s);
          saveSession({
            queue: s.queue,
            queueIndex: s.queueIndex,
            currentTrackId: s.currentTrackId,
            playbackContext: s.playbackContext,
            isShuffle: s.isShuffle,
            isAutoplay: s.isAutoplay,
            loopMode: s.loopMode,
            positionSecs: 0,
            userQueue: s.userQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            sessionHistory: s.sessionHistory,
          });
        } catch (e) {
          console.error("Failed to play next track:", e);
        }
        return;
      } else if (loopMode === "Queue") {
        const nextTrack = activeContext[0];
        const { queue, queueIndex } = computeQueueState(
          activeContext,
          0,
          userQueue,
          nextTrack,
          false
        );

        set({
          status: { ...status, state: "Playing" },
          contextQueue: activeContext,
          contextIndex: 0,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
          sessionHistory: nextHist,
          queue,
          queueIndex,
          isManualStop: false,
        });

        try {
          get().recordTrackPlay(nextTrack.id);
          await playerAdapter.playTrack(nextTrack);
          notifyIfEnabled(nextTrack);
          const s = get();
          syncWithBackend(s);
          saveSession({
            queue: s.queue,
            queueIndex: s.queueIndex,
            currentTrackId: s.currentTrackId,
            playbackContext: s.playbackContext,
            isShuffle: s.isShuffle,
            isAutoplay: s.isAutoplay,
            loopMode: s.loopMode,
            positionSecs: 0,
            userQueue: s.userQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            sessionHistory: s.sessionHistory,
          });
        } catch (e) {
          console.error("Failed to loop sequential queue:", e);
        }
        return;
      }
    }

    // 4. Autoplay candidate check
    if (isAutoplay && activeContext.length > 0 && playbackContext) {
      const libraryTracks = getLibraryTracks();
      if (libraryTracks.length === 0 && playbackContext?.type === "tracks") {
        const nextTrack = activeContext[0];
        const { queue, queueIndex } = computeQueueState(activeContext, 0, userQueue, nextTrack);
        set({
          status: { ...status, state: "Playing" },
          contextQueue: activeContext,
          contextIndex: 0,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
          sessionHistory: nextHist,
          queue,
          queueIndex,
          isManualStop: false,
        });
        try {
          get().recordTrackPlay(nextTrack.id);
          await playerAdapter.playTrack(nextTrack);
          notifyIfEnabled(nextTrack);
          const s = get();
          syncWithBackend(s);
          saveSession({
            queue: s.queue,
            queueIndex: s.queueIndex,
            currentTrackId: s.currentTrackId,
            playbackContext: s.playbackContext,
            isShuffle: s.isShuffle,
            isAutoplay: s.isAutoplay,
            loopMode: s.loopMode,
            positionSecs: 0,
            userQueue: s.userQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            sessionHistory: s.sessionHistory,
          });
        } catch (e) {
          console.error("Failed to autoplay loop:", e);
        }
        return;
      }

      const current = activeContext[activeIndex] || null;
      const autoplayTrack = getAutoplayNextTrack(current, activeContext, libraryTracks);

      if (autoplayTrack) {
        const nextContext = [...activeContext, autoplayTrack];
        const nextContextIdx = nextContext.length - 1;
        const { queue, queueIndex } = computeQueueState(nextContext, nextContextIdx, userQueue, autoplayTrack);

        set({
          status: { ...status, state: "Playing" },
          contextQueue: nextContext,
          contextIndex: nextContextIdx,
          currentTrack: autoplayTrack,
          currentTrackId: autoplayTrack.id,
          sessionHistory: nextHist,
          queue,
          queueIndex,
          isManualStop: false,
        });

        try {
          get().recordTrackPlay(autoplayTrack.id);
          await playerAdapter.playTrack(autoplayTrack);
          notifyIfEnabled(autoplayTrack);
          const s = get();
          syncWithBackend(s);
          saveSession({
            queue: s.queue,
            queueIndex: s.queueIndex,
            currentTrackId: s.currentTrackId,
            playbackContext: s.playbackContext,
            isShuffle: s.isShuffle,
            isAutoplay: s.isAutoplay,
            loopMode: s.loopMode,
            positionSecs: 0,
            userQueue: s.userQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            sessionHistory: s.sessionHistory,
          });
        } catch (e) {
          console.error("Failed to play autoplay track:", e);
        }
        return;
      }
    }

    // 5. Finished entire queue
    set({
      status: { ...status, state: "Stopped", position_secs: 0 },
      isManualStop: true,
    });
    try {
      await playerAdapter.stop();
    } catch (e) {
      console.error("Failed to stop at end of queue:", e);
    }
  },

  playPrevious: async () => {
    const {
      status,
      userQueue,
      contextQueue,
      contextIndex,
      queue,
      isShuffle,
      shuffleIndices,
      shufflePos,
      sessionHistory,
      currentTrack,
    } = get();

    const activeContext =
      contextQueue.length > 0 && queue.length === contextQueue.length + userQueue.length
        ? contextQueue
        : get().queue;
    if (activeContext.length === 0 && userQueue.length === 0 && !currentTrack) return;

    // 1. If played > 3 seconds, restart current track
    if (status.position_secs > 3) {
      playerAdapter.seek(0);
      return;
    }

    let activeIndex = -1;
    if (contextIndex >= 0 && contextIndex < activeContext.length && activeContext[contextIndex]?.id === currentTrack?.id) {
      activeIndex = contextIndex;
    } else if (currentTrack) {
      activeIndex = activeContext.findIndex((t) => t.id === currentTrack.id);
    }
    if (activeIndex === -1) {
      activeIndex = get().queueIndex;
    }

    // 2. If in shuffle mode: step backward in shuffle order
    if (isShuffle) {
      if (shufflePos > 0) {
        const nextPos = shufflePos - 1;
        const nextContextIdx = shuffleIndices[nextPos];
        const prevTrack = activeContext[nextContextIdx];
        const { queue, queueIndex } = computeQueueState(
          activeContext,
          nextContextIdx,
          userQueue,
          prevTrack,
          true,
          shuffleIndices,
          nextPos
        );

        set({
          status: { ...status, state: "Playing" },
          contextQueue: activeContext,
          contextIndex: nextContextIdx,
          shufflePos: nextPos,
          currentTrack: prevTrack,
          currentTrackId: prevTrack.id,
          queue,
          queueIndex,
          isManualStop: false,
        });

        try {
          get().recordTrackPlay(prevTrack.id);
          await playerAdapter.playTrack(prevTrack);
          notifyIfEnabled(prevTrack);
          const s = get();
          syncWithBackend(s);
          saveSession({
            queue: s.queue,
            queueIndex: s.queueIndex,
            currentTrackId: s.currentTrackId,
            playbackContext: s.playbackContext,
            isShuffle: s.isShuffle,
            isAutoplay: s.isAutoplay,
            loopMode: s.loopMode,
            positionSecs: 0,
            userQueue: s.userQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            sessionHistory: s.sessionHistory,
          });
        } catch (e) {
          console.error("Failed to play previous shuffled track:", e);
        }
        return;
      } else {
        playerAdapter.seek(0);
        return;
      }
    }

    // 3. Linear / sequential playback: decrement activeIndex
    if (activeIndex > 0) {
      const nextContextIdx = activeIndex - 1;
      const prevTrack = activeContext[nextContextIdx];
      if (prevTrack) {
        const { queue, queueIndex } = computeQueueState(
          activeContext,
          nextContextIdx,
          userQueue,
          prevTrack,
          false
        );

        set({
          status: { ...status, state: "Playing" },
          contextQueue: activeContext,
          contextIndex: nextContextIdx,
          currentTrack: prevTrack,
          currentTrackId: prevTrack.id,
          queue,
          queueIndex,
          isManualStop: false,
        });

        try {
          get().recordTrackPlay(prevTrack.id);
          await playerAdapter.playTrack(prevTrack);
          notifyIfEnabled(prevTrack);
          const s = get();
          syncWithBackend(s);
          saveSession({
            queue: s.queue,
            queueIndex: s.queueIndex,
            currentTrackId: s.currentTrackId,
            playbackContext: s.playbackContext,
            isShuffle: s.isShuffle,
            isAutoplay: s.isAutoplay,
            loopMode: s.loopMode,
            positionSecs: 0,
            userQueue: s.userQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            sessionHistory: s.sessionHistory,
          });
        } catch (e) {
          console.error("Failed to play previous sequential track:", e);
        }
        return;
      }
    }

    // 4. Fallback: if session history has items and we're at start
    if (sessionHistory.length > 0) {
      const prevTrack = sessionHistory[sessionHistory.length - 1];
      const nextHist = sessionHistory.slice(0, -1);
      const cIdx = activeContext.findIndex((t) => t.id === prevTrack.id);
      const nextContextIdx = cIdx >= 0 ? cIdx : 0;
      const { queue, queueIndex } = computeQueueState(
        activeContext,
        nextContextIdx,
        userQueue,
        prevTrack,
        isShuffle,
        shuffleIndices,
        shufflePos
      );

      set({
        status: { ...status, state: "Playing" },
        contextQueue: activeContext,
        contextIndex: nextContextIdx,
        sessionHistory: nextHist,
        currentTrack: prevTrack,
        currentTrackId: prevTrack.id,
        queue,
        queueIndex,
        isManualStop: false,
      });

      try {
        get().recordTrackPlay(prevTrack.id);
        await playerAdapter.playTrack(prevTrack);
        notifyIfEnabled(prevTrack);
        const s = get();
        syncWithBackend(s);
      } catch (e) {
        console.error("Failed to play previous track from history:", e);
      }
      return;
    }

    // 5. At beginning: restart
    playerAdapter.seek(0);
  },


  resume: async () => {
    const { currentTrack, status } = get();
    set({ isManualStop: false });

    try {
      await playerAdapter.resume();
      set((s) => ({ status: { ...s.status, state: "Playing" } }));
    } catch {
      if (currentTrack) {
        try {
          await playerAdapter.playTrack(currentTrack);
          if (status.position_secs > 0) {
            await playerAdapter.seek(status.position_secs);
          }
        } catch (err) {
          console.error("Failed to load and play track on resume:", err);
        }
      }
    }
  },

  pause: () => {
    set((state) => ({
      isManualStop: true,
      status: { ...state.status, state: "Paused" },
    }));
    playerAdapter.pause();
  },

  stop: () => {
    set((state) => ({
      isManualStop: true,
      status: { ...state.status, state: "Stopped", position_secs: 0 },
    }));
    playerAdapter.stop();
  },

  seek: (seconds: number) => {
    set((s) => ({
      status: { ...s.status, position_secs: seconds },
    }));
    playerAdapter.seek(seconds).catch((err) => {
      console.warn("Seek error in player adapter:", err);
    });
  },

  setVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    lastUserVolumeChangeTime = Date.now();
    set((state) => ({
      status: { ...state.status, volume: clamped },
    }));
    dispatchThrottledVolume(clamped);
  },

  switchToWeb: async () => {
    // 1. Immediately flag manual stop and pause status so the polling loop will never auto-advance
    set((state) => ({
      isManualStop: true,
      status: { ...state.status, state: "Paused" },
    }));

    // 2. Pause audio playback engine
    try {
      await playerAdapter.pause();
    } catch {
      // Ignore audio pause errors
    }

    // 3. Persist and synchronize the current playback session for the browser
    const s = get();
    saveSession({
      queue: s.queue,
      queueIndex: s.queueIndex,
      currentTrackId: s.currentTrackId,
      playbackContext: s.playbackContext,
      isShuffle: s.isShuffle,
      isAutoplay: s.isAutoplay,
      loopMode: s.loopMode,
      positionSecs: s.status.position_secs,
    });

    // 4. Delegate to the platform adapter to launch the browser and switch mode
    try {
      await playerAdapter.switchToWeb();
    } catch (err) {
      console.error("Failed to switch to web client:", err);
      throw err;
    }
  },

  restoreSession: async () => {
    let session = loadSession();
    try {
      const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
      let backendSession: BackendSessionPayload | null = null;
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        backendSession = await invoke<BackendSessionPayload | null>("get_saved_session");
      } else {
        const res = await fetch("/api/session");
        if (res.ok) {
          backendSession = (await res.json()) as BackendSessionPayload;
        }
      }

      if (backendSession && backendSession.queue && backendSession.queue.length > 0) {
        session = {
          queue: backendSession.queue,
          queueIndex: backendSession.queue_index ?? 0,
          currentTrackId: backendSession.current_track_id,
          playbackContext: null,
          isShuffle: backendSession.is_shuffle ?? false,
          isAutoplay: backendSession.is_autoplay ?? true,
          loopMode: backendSession.loop_mode ?? "Off",
          positionSecs: backendSession.position_secs ?? 0,
          userQueue: backendSession.user_queue,
          contextQueue: backendSession.context_queue,
          contextIndex: backendSession.context_index,
        };
      }
    } catch {
      // Fall back to localStorage session
    }

    if (!session || session.queue.length === 0) return;

    // Find the track object that matches the saved track ID
    const trackIndex =
      session.queueIndex >= 0 && session.queueIndex < session.queue.length
        ? session.queueIndex
        : 0;
    const restoredTrack = session.queue[trackIndex];
    if (!restoredTrack) return;

    const { autoResumePlayback } = useSettingsStore.getState();

    const userQueue = session.userQueue ?? [];
    const contextQueue = session.contextQueue ?? session.queue;
    const contextIndex = session.contextIndex ?? trackIndex;
    const sessionHistory = session.sessionHistory ?? [];
    const isShuffle = session.isShuffle ?? false;
    const loopMode: "Off" | "Queue" | "Track" = (session.loopMode as "Off" | "Queue" | "Track") ?? "Off";
    const shuffleIndices = isShuffle && contextQueue.length > 0 ? generateShuffleIndices(contextQueue.length, contextIndex) : [];
    const shufflePos = 0;
    const { queue, queueIndex } = computeQueueState(
      contextQueue,
      contextIndex,
      userQueue,
      restoredTrack,
      isShuffle,
      shuffleIndices,
      shufflePos
    );

    // Re-hydrate the store with saved state (paused by default, not playing)
    set({
      userQueue,
      contextQueue,
      contextIndex,
      sessionHistory,
      shuffleIndices,
      shufflePos,
      queue,
      queueIndex,
      currentTrack: restoredTrack,
      currentTrackId: restoredTrack.id,
      playbackContext: session.playbackContext,
      isShuffle,
      loopMode,
      isAutoplay: session.isAutoplay ?? true,
      isManualStop: !autoResumePlayback,
      status: {
        ...DEFAULT_STATUS,
        state: autoResumePlayback ? "Playing" : "Paused",
        position_secs: session.positionSecs ?? 0,
        duration_secs: restoredTrack.metadata.duration?.secs ?? 0,
        current_track: restoredTrack,
        loop_mode: loopMode,
      },
    });

    // Only start playback automatically if the user explicitly enabled autoResumePlayback in Settings.
    // By default, the session is restored in a Paused state with zero audio playback.
    if (autoResumePlayback) {
      try {
        await playerAdapter.playTrack(restoredTrack);
        if (session.positionSecs > 0) {
          await playerAdapter.seek(session.positionSecs);
        }
      } catch (e) {
        console.error("Failed to auto-resume player session:", e);
      }
    }
  },
}));

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
import { PlayerStatus, Track, PlaybackContext, PlayHistoryEntry, QueueStateSnapshot } from "../types";
import { playerAdapter } from "../services/adapter";
import { useSettingsStore } from "./settingsStore";
import { useLibraryStore } from "./libraryStore";
import { showTrackNotification } from "../utils/notifications";
import {
  updateMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
  clearMediaSession,
  registerMediaSessionHandlers,
} from "../utils/mediaSession";
import {
  updateDiscordPresence,
  clearDiscordPresence,
  scheduleClearDiscordPresence,
} from "../utils/discordRpc";
import { fetchLyrics } from "../services/lyrics";
import { hasLrcTimestamps } from "../utils/lyrics";

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
    return currentQueue && currentQueue.length > 0 ? currentQueue[0] : null;
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
      if (sameArtist.length > 0) {
        return sameArtist[Math.floor(Math.random() * sameArtist.length)];
      }
    }

    // 2. Same genre candidate pool
    if (genre) {
      const sameGenre = unqueued.filter(
        (t) => t.metadata?.genre?.trim().toLowerCase() === genre
      );
      if (sameGenre.length > 0) {
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

/**
 * Canonical helper to atomically apply backend QueueStateSnapshot to reactive store state.
 * Supports both camelCase (Tauri serde) and snake_case (legacy/internal) properties.
 */
export function applyQueueSnapshot(
  set: (partial: Partial<PlayerStoreState> | ((state: PlayerStoreState) => Partial<PlayerStoreState>)) => void,
  snapshot: QueueStateSnapshot
): void {
  const currentTrack = (snapshot.currentTrack ?? snapshot.current_track);
  const currentTrackId = currentTrack?.id;
  const queue = snapshot.queue ?? [];
  const rawIdx = snapshot.currentIndex ?? snapshot.current_index;
  const queueIndex = typeof rawIdx === "number" ? rawIdx : -1;
  const userQueue = snapshot.userQueue ?? snapshot.user_queue ?? [];
  const contextQueue = snapshot.contextQueue ?? snapshot.context_queue ?? [];
  const rawCtxIdx = snapshot.contextIndex ?? snapshot.context_index;
  const contextIndex = typeof rawCtxIdx === "number" ? rawCtxIdx : -1;
  const isShuffle = snapshot.isShuffle ?? snapshot.is_shuffle ?? false;
  const loopMode = (snapshot.loopMode ?? snapshot.loop_mode ?? "Off") as "Off" | "Queue" | "Track";
  const isAutoplay = snapshot.isAutoplay ?? snapshot.is_autoplay ?? true;
  const sessionHistory = snapshot.history ?? [];
  const rawShuffleIndices =
    snapshot.shuffleIndices ?? snapshot.shuffled_indices ?? snapshot.shuffle_indices;
  const rawShufflePos = snapshot.shufflePos ?? snapshot.shuffle_pos;

  set((state) => {
    let shuffleIndices: number[] = [];
    let shufflePos = 0;

    if (isShuffle && queue.length > 0) {
      if (Array.isArray(rawShuffleIndices) && rawShuffleIndices.length === queue.length) {
        shuffleIndices = rawShuffleIndices;
        shufflePos = typeof rawShufflePos === "number" ? rawShufflePos : 0;
      } else if (state.shuffleIndices.length === queue.length) {
        shuffleIndices = state.shuffleIndices;
        const pos = queueIndex >= 0 ? shuffleIndices.indexOf(queueIndex) : -1;
        shufflePos = pos !== -1 ? pos : state.shufflePos;
      } else {
        shuffleIndices = generateShuffleIndices(queue.length, queueIndex >= 0 ? queueIndex : 0);
        shufflePos = 0;
      }
    }

    return {
      currentTrack: currentTrack !== undefined && currentTrack !== null ? currentTrack : state.currentTrack,
      currentTrackId: currentTrackId ?? (currentTrack === null ? state.currentTrackId : undefined),
      queue,
      queueIndex,
      userQueue,
      contextQueue,
      contextIndex,
      isShuffle,
      shuffleIndices,
      shufflePos,
      loopMode,
      isAutoplay,
      sessionHistory: sessionHistory.length > 0 ? sessionHistory : state.sessionHistory,
      status: {
        ...state.status,
        loop_mode: loopMode,
        ...(currentTrack ? { current_track: currentTrack } : {}),
        ...(state.status.state === "Stopped" && currentTrack ? { state: "Playing" } : {}),
      },
    };
  });
}

/**
 * Deduplicated session saver that captures the full reactive queue state.
 */
function saveSessionFromStore(state: PlayerStoreState): void {
  saveSession({
    queue: state.queue,
    queueIndex: state.queueIndex,
    currentTrackId: state.currentTrackId,
    playbackContext: state.playbackContext,
    isShuffle: state.isShuffle,
    isAutoplay: state.isAutoplay,
    loopMode: state.loopMode,
    positionSecs: state.status.position_secs,
    userQueue: state.userQueue,
    contextQueue: state.contextQueue,
    contextIndex: state.contextIndex,
    sessionHistory: state.sessionHistory,
  });
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
let pendingSeekTarget: number | null = null;
let pendingSeekTime = 0;

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
    // True after another client (web/phone) claimed playback. While set, this client
    // must not clear the shared Discord presence that the new client now owns.
    let handedOffToOtherClient = false;
    if (playerAdapter.isTauri()) {
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          const u1 = listen("external-pause", () => {
            handedOffToOtherClient = true;
            set((state) => ({
              isManualStop: true,
              status: { ...state.status, state: "Paused" },
            }));
          });
          const u2 = listen("queue-track-changed", async (event: { payload?: Track }) => {
            const track = event?.payload;
            if (!track) return;
            const s = get();
            if (s.currentTrackId === track.id) return;

            // Fetch authoritative state snapshot from backend
            if (playerAdapter.queueGetState) {
              try {
                const snapshot = await playerAdapter.queueGetState();
                applyQueueSnapshot(set, snapshot);
                set((prev) => ({
                  status: { ...prev.status, state: "Playing", current_track: track },
                }));
                notifyIfEnabled(track);
                get().recordTrackPlay(track.id);
                saveSessionFromStore(get());
                return;
              } catch (err) {
                console.warn("queueGetState error on queue-track-changed:", err);
              }
            }

            // Fallback for minimal/offline harness
            set((prev) => ({
              currentTrack: track,
              currentTrackId: track.id,
              status: { ...prev.status, state: "Playing", current_track: track },
            }));
            notifyIfEnabled(track);
            get().recordTrackPlay(track.id);
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

        const incomingTrackId = s.current_track?.id;
        // Don't wipe existing loaded/restored track if backend is simply idle on startup
        const trackChanged = incomingTrackId
          ? prev.currentTrackId !== incomingTrackId
          : (wasPlaying && prev.currentTrackId !== undefined);

        if (trackChanged || currentPollingTrackId !== incomingTrackId) {
          currentPollingTrackId = incomingTrackId;
          if (incomingTrackId && s.state === "Playing") {
            get().recordTrackPlay(incomingTrackId);
          }
          // Only reset autoCrossfadeTriggered once the incoming track is playing or not in transient stopped state
          if (s.position_secs > 0 || s.state === "Playing") {
            autoCrossfadeTriggered = false;
          }
        }

        // Check if any status field changed (preserving client-side loop_mode)
        const stateChanged = prev.status.state !== s.state;
        let effectivePositionSecs = s.position_secs;
        if (pendingSeekTarget !== null) {
          const elapsed = (Date.now() - pendingSeekTime) / 1000;
          const target = pendingSeekTarget;
          const hasSettled =
            Math.abs(s.position_secs - target) < 1.5 ||
            Math.abs(s.position_secs - (target + elapsed)) < 1.5;

          if (hasSettled || elapsed > 1.2) {
            pendingSeekTarget = null;
            effectivePositionSecs = s.position_secs;
          } else {
            // Still in flight; smoothly extrapolate from target position so it never snaps back
            effectivePositionSecs = target + (s.state === "Playing" ? elapsed : 0);
          }
        }
        const posChanged = Math.abs(prev.status.position_secs - effectivePositionSecs) > 0.05;
        const isRecentUserVolume = Date.now() - lastUserVolumeChangeTime < 1500;
        const volChanged = !isRecentUserVolume && Math.abs(prev.status.volume - s.volume) > 0.001;
        const durChanged = prev.status.duration_secs !== s.duration_secs;
        const statusChanged = stateChanged || posChanged || volChanged || durChanged;

        if (statusChanged || trackChanged) {
          const effectiveTrack = s.current_track ?? (isNowStopped && !wasPlaying ? prev.currentTrack : undefined);
          set({
            status: {
              ...s,
              position_secs: effectivePositionSecs,
              volume: isRecentUserVolume ? prev.status.volume : s.volume,
              loop_mode: get().loopMode,
              current_track: effectiveTrack,
            },
            ...(trackChanged
              ? {
                  currentTrack: effectiveTrack,
                  currentTrackId: effectiveTrack?.id,
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

        // This client is active again, so it owns the Discord presence once more.
        if (s.state === "Playing") {
          handedOffToOtherClient = false;
        }

        if (s.state === "Stopped") {
          // Clear integrations only on the transition into Stopped. The Discord
          // connection is shared by every client (desktop + web/phone), so clearing
          // on every idle poll would wipe the presence set by whichever client is playing.
          if (stateChanged) {
            if (integrationSettings.enableMediaSession) {
              clearMediaSession();
            }
            if (integrationSettings.enableDiscordRpc && !handedOffToOtherClient) {
              // Deferred: a track that just ended is followed by the next one
              // within a poll or two, and clearing at once makes the Discord
              // card blink between tracks.
              scheduleClearDiscordPresence();
            }
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

          // Discord Rich Presence — posted to the local bridge.
          //
          // Offered on every poll rather than only on transitions: the helper
          // deduplicates linear playback and coalesces bursts, and polling is
          // what lets it notice a cold start (restored session, app launched
          // mid-track) and a scrub. The engine's own position is passed, and
          // it is the only clock the Discord timestamps may trust.
          if (integrationSettings.enableDiscordRpc && !handedOffToOtherClient) {
            if (isPlaying) {
              updateDiscordPresence({
                title: track.metadata.title ?? "Unknown Title",
                artist: track.metadata.artist ?? "Unknown Artist",
                album: track.metadata.album ?? "",
                position_secs: positionSecs,
                duration_secs: durationSecs,
                is_playing: true,
              });
            } else {
              scheduleClearDiscordPresence(1000);
            }
          }

          // Auto-fetch missing lyrics or upgrade unsynced plain lyrics from LRCLIB in background on track change
          const rawLyrics = track.metadata.lyrics;
          const isMissingLyrics = !rawLyrics || !rawLyrics.trim();
          const isPlainOnly = rawLyrics && !hasLrcTimestamps(rawLyrics);

          if (trackChanged && (isMissingLyrics || isPlainOnly)) {
            fetchLyrics(
              track.metadata.artist || "",
              track.metadata.title || "",
              track.metadata.album,
              durationSecs,
              Boolean(isPlainOnly) // force refresh if looking to upgrade from plain text
            ).then(async (lyricsRes) => {
              if (lyricsRes?.bestLyrics && (isMissingLyrics || lyricsRes.syncedLyrics)) {
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

                  // If we got synced lyrics, persist them to the database
                  if (lyricsRes.syncedLyrics) {
                    playerAdapter.updateTrackMetadata({
                      track_id: track.id,
                      lyrics: lyricsRes.syncedLyrics,
                      write_tags: false,
                    }).catch(() => {});
                  }
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
                prev.userQueue.length > 0 ||
                (prev.isShuffle
                  ? (prev.shuffleIndices.length > 0
                      ? prev.shufflePos < prev.shuffleIndices.length - 1
                      : prev.queue.length > 1)
                  : prev.queueIndex >= 0 && prev.queueIndex < prev.queue.length - 1) ||
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
    const { contextQueue, playbackContext: existingContext } = get();
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

    set({ playbackContext: effectiveContext, isManualStop: false });

    const cIdx = contextQueue.findIndex((t) => t.id === track.id);
    if (cIdx !== -1 && playerAdapter.queueJumpToContextTrack) {
      const snapshot = await playerAdapter.queueJumpToContextTrack(cIdx);
      applyQueueSnapshot(set, snapshot);
    } else if (playerAdapter.queueSetContext) {
      const snapshot = await playerAdapter.queueSetContext([track], 0);
      applyQueueSnapshot(set, snapshot);
    } else {
      await playerAdapter.playTrack(track);
      set({ currentTrack: track, currentTrackId: track.id });
    }

    get().recordTrackPlay(track.id);
    notifyIfEnabled(track);
    saveSessionFromStore(get());
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

    set({ playbackContext: effectiveContext, isManualStop: false });

    if (playerAdapter.queueSetContext) {
      const snapshot = await playerAdapter.queueSetContext(tracks, validIndex);
      applyQueueSnapshot(set, snapshot);
      notifyIfEnabled(targetTrack);
      saveSessionFromStore(get());
      return;
    }

    // Local fallback for bare test mock
    const isShuffle = get().isShuffle;
    const shuffleIndices = isShuffle ? generateShuffleIndices(tracks.length, validIndex) : [];
    const userQueue = context ? get().userQueue : [];
    const { queue, queueIndex } = computeQueueState(tracks, validIndex, userQueue, targetTrack, isShuffle, shuffleIndices, 0);
    set({
      contextQueue: tracks,
      contextIndex: validIndex,
      userQueue,
      queue,
      queueIndex,
      currentTrack: targetTrack,
      currentTrackId: targetTrack.id,
      status: { ...get().status, state: "Playing", position_secs: 0 },
    });
    await playerAdapter.playTrack(targetTrack);
    notifyIfEnabled(targetTrack);
    saveSessionFromStore(get());
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
      return { userQueue: nextUser, queue, queueIndex };
    });
    if (playerAdapter.queuePlayNext) {
      playerAdapter.queuePlayNext(toAdd).then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
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
      return { userQueue: nextUser, queue, queueIndex };
    });
    if (playerAdapter.queueAddUser) {
      playerAdapter.queueAddUser(toAdd).then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
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
      const nextShuffleIndices =
        state.isShuffle && queue.length > state.shuffleIndices.length
          ? [
              ...state.shuffleIndices,
              ...Array.from(
                { length: queue.length - state.shuffleIndices.length },
                (_, i) => state.shuffleIndices.length + i
              ),
            ]
          : state.shuffleIndices;
      return { contextQueue: nextContext, queue, queueIndex, shuffleIndices: nextShuffleIndices };
    });
    syncWithBackend(get());
    saveSessionFromStore(get());
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
      return { userQueue: nextUser, queue, queueIndex };
    });
    if (playerAdapter.queueRemoveUserTrack) {
      playerAdapter.queueRemoveUserTrack(index).then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
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
      return { userQueue: nextUser, queue, queueIndex };
    });
    if (playerAdapter.queueReorderUser) {
      playerAdapter.queueReorderUser(fromIndex, toIndex).then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
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
      return { userQueue: [], queue, queueIndex };
    });
    if (playerAdapter.queueClearUser) {
      playerAdapter.queueClearUser().then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
  },

  jumpToUserQueueItem: async (index: number) => {
    if (playerAdapter.queueJumpToUserTrack) {
      const snapshot = await playerAdapter.queueJumpToUserTrack(index);
      applyQueueSnapshot(set, snapshot);
      const track = snapshot.currentTrack ?? snapshot.current_track;
      if (track) {
        get().recordTrackPlay(track.id);
        notifyIfEnabled(track);
      }
      saveSessionFromStore(get());
      return;
    }
    const { userQueue } = get();
    if (index >= 0 && index < userQueue.length) {
      await get().playTrack(userQueue[index]);
    }
  },

  jumpToContextTrack: async (index: number) => {
    if (playerAdapter.queueJumpToContextTrack) {
      const snapshot = await playerAdapter.queueJumpToContextTrack(index);
      applyQueueSnapshot(set, snapshot);
      const track = snapshot.currentTrack ?? snapshot.current_track;
      if (track) {
        get().recordTrackPlay(track.id);
        notifyIfEnabled(track);
      }
      saveSessionFromStore(get());
      return;
    }
    const { contextQueue } = get();
    if (index >= 0 && index < contextQueue.length) {
      await get().playTrack(contextQueue[index]);
    }
  },

  jumpToQueueIndex: async (index: number) => {
    if (playerAdapter.queueJumpToIndex) {
      const snapshot = await playerAdapter.queueJumpToIndex(index);
      applyQueueSnapshot(set, snapshot);
      const track = snapshot.currentTrack ?? snapshot.current_track;
      if (track) {
        get().recordTrackPlay(track.id);
        notifyIfEnabled(track);
      }
      saveSessionFromStore(get());
      return;
    }
    const { queue } = get();
    if (index >= 0 && index < queue.length) {
      await get().playTrack(queue[index]);
    }
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
      currentTrack: undefined,
      currentTrackId: undefined,
      status: { ...get().status, state: "Stopped", position_secs: 0 },
      isManualStop: true,
    });
    if (playerAdapter.queueClear) {
      playerAdapter.queueClear().then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
    if (playerAdapter.stop) {
      playerAdapter.stop().catch(() => {});
    }
  },

  toggleShuffle: () => {
    const state = get();
    const nextShuffle = !state.isShuffle;
    const optimisticIndices =
      nextShuffle && state.queue.length > 0
        ? generateShuffleIndices(state.queue.length, state.queueIndex >= 0 ? state.queueIndex : 0)
        : [];
    set({
      isShuffle: nextShuffle,
      shuffleIndices: optimisticIndices,
      shufflePos: 0,
    });
    if (playerAdapter.queueSetShuffle) {
      playerAdapter.queueSetShuffle(nextShuffle).then((snapshot) => {
        const current = get();
        const snapQueue = snapshot.queue ?? [];
        if (snapQueue.length === 0 && current.queue.length > 0) {
          syncWithBackend(current);
        } else {
          applyQueueSnapshot(set, snapshot);
        }
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
  },

  toggleAutoplay: () => {
    const nextAutoplay = !get().isAutoplay;
    set({ isAutoplay: nextAutoplay });
    if (playerAdapter.queueSetAutoplay) {
      playerAdapter.queueSetAutoplay(nextAutoplay).then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
  },

  setAutoplay: (enabled: boolean) => {
    set({ isAutoplay: enabled });
    if (playerAdapter.queueSetAutoplay) {
      playerAdapter.queueSetAutoplay(enabled).then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
  },

  cycleLoopMode: () => {
    const current = get().loopMode;
    const nextMode: "Off" | "Queue" | "Track" =
      current === "Off" ? "Queue" : current === "Queue" ? "Track" : "Off";
    set((s) => ({ loopMode: nextMode, status: { ...s.status, loop_mode: nextMode } }));
    if (playerAdapter.queueSetLoopMode) {
      playerAdapter.queueSetLoopMode(nextMode).then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
  },

  setLoopMode: (mode: "Off" | "Queue" | "Track") => {
    set((s) => ({ loopMode: mode, status: { ...s.status, loop_mode: mode } }));
    if (playerAdapter.queueSetLoopMode) {
      playerAdapter.queueSetLoopMode(mode).then((snapshot) => {
        applyQueueSnapshot(set, snapshot);
        saveSessionFromStore(get());
      }).catch(() => {});
    } else {
      saveSessionFromStore(get());
    }
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
    if (playerAdapter.queueNext) {
      if (!playerAdapter.isTauri() && playerAdapter.syncFromStore) {
        const state = get();
        const effectiveLoop = (state.status?.loop_mode ?? state.loopMode) || "Off";
        playerAdapter.syncFromStore({
          queue: state.queue,
          queueIndex: state.queueIndex,
          currentTrack: state.currentTrack,
          status: state.status,
          isShuffle: state.isShuffle,
          loopMode: effectiveLoop as "Off" | "Queue" | "Track",
          isAutoplay: state.isAutoplay,
          userQueue: state.userQueue,
          contextQueue: state.contextQueue,
          contextIndex: state.contextIndex,
          shuffleIndices: state.shuffleIndices,
          shufflePos: state.shufflePos,
        });
      }
      const snapshot = await playerAdapter.queueNext();
      applyQueueSnapshot(set, snapshot);
      const track = snapshot.currentTrack ?? snapshot.current_track;
      if (track) {
        notifyIfEnabled(track);
        get().recordTrackPlay(track.id);
        set((s) => ({
          status: { ...s.status, state: "Playing" },
          isManualStop: false,
        }));
      } else {
        set((s) => ({
          status: { ...s.status, state: "Stopped", position_secs: 0 },
          isManualStop: true,
        }));
        if (playerAdapter.stop) {
          playerAdapter.stop().catch(() => {});
        }
      }
      saveSessionFromStore(get());
      return;
    }
  },

  playPrevious: async () => {
    const currentPos = get().status.position_secs || 0;
    if (currentPos > 3) {
      await playerAdapter.seek(0);
      return;
    }
    if (playerAdapter.queuePrevious) {
      if (!playerAdapter.isTauri() && playerAdapter.syncFromStore) {
        const state = get();
        const effectiveLoop = (state.status?.loop_mode ?? state.loopMode) || "Off";
        playerAdapter.syncFromStore({
          queue: state.queue,
          queueIndex: state.queueIndex,
          currentTrack: state.currentTrack,
          status: state.status,
          isShuffle: state.isShuffle,
          loopMode: effectiveLoop as "Off" | "Queue" | "Track",
          isAutoplay: state.isAutoplay,
          userQueue: state.userQueue,
          contextQueue: state.contextQueue,
          contextIndex: state.contextIndex,
          shuffleIndices: state.shuffleIndices,
          shufflePos: state.shufflePos,
        });
      }
      const snapshot = await playerAdapter.queuePrevious(currentPos);
      applyQueueSnapshot(set, snapshot);
      const track = snapshot.currentTrack ?? snapshot.current_track;
      if (track) {
        notifyIfEnabled(track);
        get().recordTrackPlay(track.id);
        set((s) => ({
          status: { ...s.status, state: "Playing" },
          isManualStop: false,
        }));
      }
      saveSessionFromStore(get());
      return;
    }
  },


  resume: async () => {
    const { currentTrack, status } = get();
    set({ isManualStop: false });

    // If no current track is set in store, pick first track from queue or library
    let trackToPlay = currentTrack;
    if (!trackToPlay) {
      const q = get().queue;
      if (q.length > 0) {
        trackToPlay = q[0];
      } else {
        const libTracks = useLibraryStore.getState().tracks;
        if (libTracks.length > 0) {
          trackToPlay = libTracks[0];
        }
      }
    }

    if (!trackToPlay) return;

    // Resuming a session that was never loaded into the engine (app restart
    // without auto-resume, or a track that already reached its end) is a
    // no-op in the audio thread. The adapter reports that, and we reload the
    // track at the last known position instead of showing a scrubber that
    // moves while the speakers stay silent.
    try {
      await playerAdapter.resume();
      set((s) => ({ status: { ...s.status, state: "Playing" } }));
      return;
    } catch {
      // Fall through to a full reload.
    }

    const durationSecs =
      status.duration_secs ?? trackToPlay.metadata.duration?.secs ?? 0;
    const savedPos = status.position_secs ?? 0;
    // A track that already finished restarts from the top, not from its
    // final second (which would immediately end again).
    const resumeAt =
      durationSecs > 0 && savedPos >= durationSecs - 1 ? 0 : savedPos;

    try {
      await playerAdapter.playTrack(trackToPlay);
      if (resumeAt > 0) {
        await playerAdapter.seek(resumeAt);
      }
      set((s) => ({
        currentTrack: trackToPlay,
        currentTrackId: trackToPlay.id,
        status: { ...s.status, state: "Playing", position_secs: resumeAt, current_track: trackToPlay },
      }));
    } catch (err) {
      console.error("Failed to load and play track on resume:", err);
      set((s) => ({ status: { ...s.status, state: "Paused" } }));
    }
  },

  pause: () => {
    set((state) => ({
      isManualStop: true,
      status: { ...state.status, state: "Paused" },
    }));
    playerAdapter.pause();
    scheduleClearDiscordPresence(1000);
  },

  stop: () => {
    set((state) => ({
      isManualStop: true,
      status: { ...state.status, state: "Stopped", position_secs: 0 },
    }));
    playerAdapter.stop();
    clearDiscordPresence();
  },

  seek: (seconds: number) => {
    pendingSeekTarget = seconds;
    pendingSeekTime = Date.now();
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

    syncWithBackend(get());

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

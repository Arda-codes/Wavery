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
import { PlayerStatus, Track, PlaybackContext } from "../types";
import { playerAdapter } from "../services/adapter";
import { useSettingsStore } from "./settingsStore";
import { showTrackNotification } from "../utils/notifications";

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
}

function saveSession(session: PlayerSession): void {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(session));
    } catch {
      // Ignore quota or security errors
    }
  }
  // Synchronize session to backend so Web client and Tauri client share the exact same state
  try {
    const payload = {
      current_track_id: session.currentTrackId,
      queue: session.queue,
      queue_index: session.queueIndex,
      position_secs: session.positionSecs,
      is_playing: false,
      is_shuffle: session.isShuffle,
      is_autoplay: session.isAutoplay,
      loop_mode: session.loopMode,
      active_client: typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ? "native" : "web",
    };
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // Ignore fetch errors
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

export interface PlayerStoreState {
  /** Current playback status from the backend. */
  status: PlayerStatus;
  /** Currently playing track (full object for PlayerBar display). */
  currentTrack: Track | undefined;
  /** Just the track ID for cheap equality checks in table rows. */
  currentTrackId: string | undefined;
  /** Context / container where current playback originated (album, playlist, etc.). */
  playbackContext: PlaybackContext | null;

  /** Active playback queue. */
  queue: Track[];
  /** Index of currently playing track in queue. */
  queueIndex: number;
  /** Whether shuffle is enabled. */
  isShuffle: boolean;
  /** Whether autoplay is enabled (continuous playback when playing from all songs / queue completion). */
  isAutoplay: boolean;
  /** Set of favorite track IDs. */
  favoriteTrackIds: Set<string>;
  /** Whether the playback was explicitly stopped by the user. */
  isManualStop: boolean;

  /** Start the 500ms polling loop. Call once on app mount. */
  startPolling: () => () => void;
  /** Play a specific track (and update or initialize queue). */
  playTrack: (track: Track, context?: PlaybackContext) => Promise<void>;
  /** Set a new queue and start playback at startIndex. */
  setQueue: (tracks: Track[], startIndex?: number, context?: PlaybackContext) => Promise<void>;
  /** Set or update the active playback context. */
  setPlaybackContext: (context: PlaybackContext | null) => void;
  /** Append one or more tracks to the current queue. */
  addToQueue: (track: Track | Track[]) => void;
  /** Insert one or more tracks immediately after the currently playing track in queue. */
  insertAfterCurrent: (track: Track | Track[]) => void;
  /** Jump directly to a track at index in queue. */
  jumpToQueueIndex: (index: number) => Promise<void>;
  /** Remove a track from queue by index. */
  removeFromQueue: (index: number) => void;
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
  /** Toggle favorite status of a track. */
  toggleFavorite: (trackId: string) => void;
  /** Skip to next track in queue. */
  playNext: () => Promise<void>;
  /** Skip to previous track in queue or restart current track if >3s. */
  playPrevious: () => Promise<void>;
  /** Resume playback. */
  resume: () => void;
  /** Pause playback. */
  pause: () => void;
  /** Stop playback. */
  stop: () => void;
  /** Seek to a position in seconds. */
  seek: (seconds: number) => void;
  /** Set volume (0–1). */
  setVolume: (volume: number) => void;
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

export const usePlayerStore = create<PlayerStoreState>((set, get) => ({
  status: DEFAULT_STATUS,
  currentTrack: undefined,
  currentTrackId: undefined,
  playbackContext: null,
  queue: [],
  queueIndex: -1,
  isShuffle: false,
  isAutoplay: true,
  favoriteTrackIds: new Set<string>(),
  isManualStop: false,

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
          autoCrossfadeTriggered = false;
          currentPollingTrackId = newTrackId;
        }

        // Check if any status field changed (preserving client-side loop_mode)
        const stateChanged = prev.status.state !== s.state;
        const posChanged = prev.status.position_secs !== s.position_secs;
        const volChanged = prev.status.volume !== s.volume;
        const durChanged = prev.status.duration_secs !== s.duration_secs;
        const statusChanged = stateChanged || posChanged || volChanged || durChanged;

        if (statusChanged || trackChanged) {
          set({
            status: {
              ...s,
              loop_mode: prev.status.loop_mode,
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
              const hasNext =
                prev.status.loop_mode === "Track" ||
                prev.status.loop_mode === "Queue" ||
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
            loopMode: state.status.loop_mode,
            positionSecs: s.position_secs,
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
      clearInterval(interval);
    };
  },


  setPlaybackContext: (context: PlaybackContext | null) => {
    set({ playbackContext: context });
  },

  playTrack: async (track: Track, context?: PlaybackContext) => {
    const { queue, playbackContext: existingContext } = get();
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

    const existingIndex = queue.findIndex((t) => t.id === track.id);
    if (existingIndex !== -1) {
      set({
        queueIndex: existingIndex,
        currentTrack: track,
        currentTrackId: track.id,
        playbackContext: effectiveContext,
        isManualStop: false,
      });
    } else {
      set({
        queue: [track],
        queueIndex: 0,
        currentTrack: track,
        currentTrackId: track.id,
        playbackContext: effectiveContext,
        isManualStop: false,
      });
    }

    try {
      await playerAdapter.playTrack(track);
      notifyIfEnabled(track);
      // Immediately persist so a refresh always knows the current track
      const s = get();
      saveSession({
        queue: s.queue,
        queueIndex: s.queueIndex,
        currentTrackId: s.currentTrackId,
        playbackContext: s.playbackContext,
        isShuffle: s.isShuffle,
        isAutoplay: s.isAutoplay,
        loopMode: s.status.loop_mode,
        positionSecs: 0,
      });
    } catch (e) {
      console.error("Failed to play track:", e);
    }
  },

  setQueue: async (tracks: Track[], startIndex: number = 0, context?: PlaybackContext) => {
    if (tracks.length === 0) return;
    const validIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const targetTrack = tracks[validIndex];

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

    set({
      queue: tracks,
      queueIndex: validIndex,
      currentTrack: targetTrack,
      currentTrackId: targetTrack.id,
      playbackContext: effectiveContext,
      isManualStop: false,
    });

    try {
      await playerAdapter.playTrack(targetTrack);
      notifyIfEnabled(targetTrack);
      const s = get();
      saveSession({
        queue: s.queue,
        queueIndex: s.queueIndex,
        currentTrackId: s.currentTrackId,
        playbackContext: s.playbackContext,
        isShuffle: s.isShuffle,
        isAutoplay: s.isAutoplay,
        loopMode: s.status.loop_mode,
        positionSecs: 0,
      });
    } catch (e) {
      console.error("Failed to play track from queue:", e);
    }
  },

  addToQueue: (track: Track | Track[]) => {
    const toAdd = Array.isArray(track) ? track : [track];
    set((state) => ({
      queue: [...state.queue, ...toAdd],
    }));
  },

  insertAfterCurrent: (track: Track | Track[]) => {
    const toAdd = Array.isArray(track) ? track : [track];
    set((state) => {
      if (state.queue.length === 0 || state.queueIndex < 0) {
        return {
          queue: [...state.queue, ...toAdd],
        };
      }
      const nextQueue = [...state.queue];
      nextQueue.splice(state.queueIndex + 1, 0, ...toAdd);
      return {
        queue: nextQueue,
      };
    });
  },

  jumpToQueueIndex: async (index: number) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    const targetTrack = queue[index];

    set({
      queueIndex: index,
      currentTrack: targetTrack,
      currentTrackId: targetTrack.id,
      isManualStop: false,
    });

    try {
      await playerAdapter.playTrack(targetTrack);
      notifyIfEnabled(targetTrack);
      const s = get();
      saveSession({
        queue: s.queue,
        queueIndex: s.queueIndex,
        currentTrackId: s.currentTrackId,
        playbackContext: s.playbackContext,
        isShuffle: s.isShuffle,
        isAutoplay: s.isAutoplay,
        loopMode: s.status.loop_mode,
        positionSecs: 0,
      });
    } catch (e) {
      console.error("Failed to jump to queue index:", e);
    }
  },


  removeFromQueue: (index: number) => {
    set((state) => {
      if (index < 0 || index >= state.queue.length) return state;
      const nextQueue = state.queue.filter((_, i) => i !== index);
      let nextIndex = state.queueIndex;
      if (index < state.queueIndex) {
        nextIndex = Math.max(0, state.queueIndex - 1);
      } else if (index === state.queueIndex) {
        nextIndex = Math.min(state.queueIndex, nextQueue.length - 1);
      }
      return {
        queue: nextQueue,
        queueIndex: nextIndex,
      };
    });
  },

  clearQueue: () => {
    set({ queue: [], queueIndex: -1 });
  },

  toggleShuffle: () => {
    set((state) => ({ isShuffle: !state.isShuffle }));
    const s = get();
    saveSession({
      queue: s.queue,
      queueIndex: s.queueIndex,
      currentTrackId: s.currentTrackId,
      playbackContext: s.playbackContext,
      isShuffle: s.isShuffle,
      isAutoplay: s.isAutoplay,
      loopMode: s.status.loop_mode,
      positionSecs: s.status.position_secs,
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
      loopMode: s.status.loop_mode,
      positionSecs: s.status.position_secs,
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
      loopMode: s.status.loop_mode,
      positionSecs: s.status.position_secs,
    });
  },

  cycleLoopMode: () => {
    set((state) => {
      const nextMode =
        state.status.loop_mode === "Off"
          ? "Queue"
          : state.status.loop_mode === "Queue"
          ? "Track"
          : "Off";
      return {
        status: { ...state.status, loop_mode: nextMode },
      };
    });
    const s = get();
    saveSession({
      queue: s.queue,
      queueIndex: s.queueIndex,
      currentTrackId: s.currentTrackId,
      playbackContext: s.playbackContext,
      isShuffle: s.isShuffle,
      isAutoplay: s.isAutoplay,
      loopMode: s.status.loop_mode,
      positionSecs: s.status.position_secs,
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
    const { queue, queueIndex, status, isShuffle, isAutoplay, playbackContext } = get();
    if (queue.length === 0) return;

    if (status.loop_mode === "Track" && queueIndex >= 0) {
      const currentTrack = queue[queueIndex];
      if (currentTrack) {
        set({ isManualStop: false });
        try {
          await playerAdapter.playTrack(currentTrack);
        } catch (e) {
          console.error("Failed to replay track:", e);
        }
      }
      return;
    }

    if (isShuffle && queue.length > 1) {
      let nextIndex = queueIndex;
      while (nextIndex === queueIndex) {
        nextIndex = Math.floor(Math.random() * queue.length);
      }
      const nextTrack = queue[nextIndex];
      set({
        queueIndex: nextIndex,
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
        isManualStop: false,
      });
      try {
        await playerAdapter.playTrack(nextTrack);
        notifyIfEnabled(nextTrack);
      } catch (e) {
        console.error("Failed to play shuffled next track:", e);
      }
      return;
    }

    if (queueIndex < queue.length - 1) {
      const nextIndex = queueIndex + 1;
      const nextTrack = queue[nextIndex];
      set({
        queueIndex: nextIndex,
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
        isManualStop: false,
      });
      try {
        await playerAdapter.playTrack(nextTrack);
        notifyIfEnabled(nextTrack);
      } catch (e) {
        console.error("Failed to play next track:", e);
      }
    } else if (status.loop_mode === "Queue") {
      const nextTrack = queue[0];
      set({
        queueIndex: 0,
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
        isManualStop: false,
      });
      try {
        await playerAdapter.playTrack(nextTrack);
        notifyIfEnabled(nextTrack);
      } catch (e) {
        console.error("Failed to loop queue:", e);
      }
    } else if (isAutoplay && playbackContext?.type === "tracks" && queue.length > 0) {
      // Autoplay: Loop back to beginning for continuous All Songs playback
      const nextTrack = queue[0];
      set({
        queueIndex: 0,
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
        isManualStop: false,
      });
      try {
        await playerAdapter.playTrack(nextTrack);
        notifyIfEnabled(nextTrack);
      } catch (e) {
        console.error("Failed to autoplay next track from All Songs:", e);
      }
    } else {
      set({
        status: { ...status, state: "Stopped", position_secs: 0 },
        isManualStop: true,
      });
      try {
        await playerAdapter.stop();
      } catch (e) {
        console.error("Failed to stop at end of queue:", e);
      }
    }
  },

  playPrevious: async () => {
    const { queue, queueIndex, status } = get();
    if (queue.length === 0) return;

    // If more than 3 seconds in, restart the current track
    if (status.position_secs > 3) {
      playerAdapter.seek(0);
      return;
    }

    if (queueIndex > 0) {
      const prevIndex = queueIndex - 1;
      const prevTrack = queue[prevIndex];
      set({
        queueIndex: prevIndex,
        currentTrack: prevTrack,
        currentTrackId: prevTrack.id,
        isManualStop: false,
      });
      try {
        await playerAdapter.playTrack(prevTrack);
        notifyIfEnabled(prevTrack);
      } catch (e) {
        console.error("Failed to play previous track:", e);
      }
    } else {
      playerAdapter.seek(0);
    }
  },


  resume: () => {
    set({ isManualStop: false });
    playerAdapter.resume();
  },

  pause: () => {
    playerAdapter.pause();
  },

  stop: () => {
    set({ isManualStop: true });
    playerAdapter.stop();
  },

  seek: (seconds: number) => {
    playerAdapter.seek(seconds);
  },

  setVolume: (volume: number) => {
    playerAdapter.setVolume(volume);
  },

  restoreSession: async () => {
    let session = loadSession();
    try {
      const res = await fetch("/api/session");
      if (res.ok) {
        const backendSession = await res.json();
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
          };
        }
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

    // Re-hydrate the store with saved state (paused, not manual-stopped)
    set({
      queue: session.queue,
      queueIndex: trackIndex,
      currentTrack: restoredTrack,
      currentTrackId: restoredTrack.id,
      playbackContext: session.playbackContext,
      isShuffle: session.isShuffle,
      isAutoplay: session.isAutoplay ?? true,
      isManualStop: false,
      status: {
        ...DEFAULT_STATUS,
        loop_mode: (session.loopMode as "Off" | "Queue" | "Track") ?? "Off",
      },
    });

    const { autoResumePlayback } = useSettingsStore.getState();

    try {
      // Load the track into the backend (starts playing)
      await playerAdapter.playTrack(restoredTrack);

      // Seek to the saved position
      if (session.positionSecs > 0) {
        await playerAdapter.seek(session.positionSecs);
      }

      // If the user hasn't opted into auto-resume, pause immediately after seek
      if (!autoResumePlayback) {
        await playerAdapter.pause();
      }
    } catch (e) {
      console.error("Failed to restore player session:", e);
    }
  },
}));

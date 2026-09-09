/**
 * navigator.mediaSession integration for Wavery.
 *
 * Exposes the current playing track to the browser's built-in media UI,
 * OS lock screen widgets, system notification shade (Android/iOS), and
 * hardware media keys (play, pause, next, previous, seek).
 *
 * Feature-guarded: all exports silently no-op when `navigator.mediaSession`
 * is absent (e.g., Firefox ≤ 81, older WebKit builds).
 *
 * Supported environments (as of 2024):
 *   Chrome 73+ · Firefox 82+ · Safari 15+ · Edge 79+
 *   Windows · macOS · Linux · Android · iOS
 */

import { Track } from "../types";

/** True when the browser implements the Media Session API. */
export const isMediaSessionSupported = (): boolean =>
  typeof navigator !== "undefined" && "mediaSession" in navigator;

/**
 * Updates the Media Session metadata with the current track info and
 * optional pre-resolved artwork URL (data URI or absolute HTTP URL).
 *
 * Safe to call on every poll tick — the browser caches identical metadata.
 */
export function updateMediaSessionMetadata(
  track: Track,
  artworkUrl?: string | null,
): void {
  if (!isMediaSessionSupported()) return;

  const title = track.metadata.title ?? "Unknown Title";
  const artist = track.metadata.artist ?? "Unknown Artist";
  const album = track.metadata.album ?? "";

  const artwork: MediaImage[] = artworkUrl
    ? [
        { src: artworkUrl, sizes: "512x512", type: "image/jpeg" },
        { src: artworkUrl, sizes: "256x256", type: "image/jpeg" },
        { src: artworkUrl, sizes: "128x128", type: "image/jpeg" },
      ]
    : [];

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork,
    });
  } catch {
    // Silently ignore — some older Firefox builds throw on new MediaMetadata()
  }
}

/**
 * Updates the Media Session playback state.
 * Use "playing", "paused", or "none" (when stopped/idle).
 */
export function setMediaSessionPlaybackState(
  state: "playing" | "paused" | "none",
): void {
  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // Ignore
  }
}

/**
 * Updates the seek position state so the browser displays accurate
 * scrubber position in the OS media widget.
 *
 * @param positionSecs  Current playback position in seconds.
 * @param durationSecs  Total track duration in seconds.
 */
export function setMediaSessionPositionState(
  positionSecs: number,
  durationSecs: number,
): void {
  if (!isMediaSessionSupported()) return;
  if (!("setPositionState" in navigator.mediaSession)) return;
  if (durationSecs <= 0 || positionSecs < 0) return;
  // Guard: position must not exceed duration (browser rejects invalid state)
  const safePosition = Math.min(positionSecs, durationSecs);
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSecs,
      playbackRate: 1.0,
      position: safePosition,
    });
  } catch {
    // Ignore — some browsers throw when called before media loads
  }
}

/**
 * Clears all Media Session metadata and resets playback state to "none".
 * Call this when playback is fully stopped.
 */
export function clearMediaSession(): void {
  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch {
    // Ignore
  }
}

/** Typed action handler map for registerMediaSessionHandlers. */
export interface MediaSessionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  onSeekTo?: (positionSecs: number) => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
}

/**
 * Registers all navigator.mediaSession action handlers.
 * Returns an unsubscribe function that removes all handlers.
 *
 * Call once on first play; the handlers are idempotent (re-registering
 * overwrites the previous handler cleanly).
 */
export function registerMediaSessionHandlers(
  handlers: MediaSessionHandlers,
): () => void {
  if (!isMediaSessionSupported()) return () => {};

  const ms = navigator.mediaSession;

  const trySet = (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null,
  ) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      // Action not supported in this browser — ignore
    }
  };

  trySet("play", handlers.onPlay);
  trySet("pause", handlers.onPause);
  trySet("stop", handlers.onStop);
  trySet("nexttrack", handlers.onNextTrack);
  trySet("previoustrack", handlers.onPreviousTrack);

  if (handlers.onSeekTo) {
    const seekToHandler = handlers.onSeekTo;
    trySet("seekto", (details) => {
      if (details?.seekTime !== undefined) {
        seekToHandler(details.seekTime);
      }
    });
  }

  if (handlers.onSeekBackward) {
    const seekBackHandler = handlers.onSeekBackward;
    trySet("seekbackward", () => seekBackHandler());
  }

  if (handlers.onSeekForward) {
    const seekFwdHandler = handlers.onSeekForward;
    trySet("seekforward", () => seekFwdHandler());
  }

  // Return cleanup function
  return () => {
    const actions: MediaSessionAction[] = [
      "play",
      "pause",
      "stop",
      "nexttrack",
      "previoustrack",
      "seekto",
      "seekbackward",
      "seekforward",
    ];
    for (const action of actions) {
      trySet(action, null);
    }
  };
}

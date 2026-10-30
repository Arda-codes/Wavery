/**
 * Discord Rich Presence client-side bridge for Wavery.
 *
 * Discord's Rich Presence uses local IPC (Unix domain socket on Linux/macOS,
 * named pipe on Windows). Web pages cannot access this socket directly.
 *
 * This module seamlessly bridges both modes:
 *   - Tauri Desktop mode: Directly invokes native Tauri IPC commands
 *     (`update_discord_presence`, `clear_discord_presence`, `get_discord_status`).
 *   - Browser mode: Communicates via HTTP endpoints on `wavery-server`
 *     (`/api/discord/presence`, `/api/discord/status`).
 *
 * Requirements:
 *   - Discord desktop must be running on the same machine.
 *   - The user must enable "Discord Rich Presence" in Settings → Integrations.
 *
 * Behavior:
 *   - All errors are swallowed silently so missing Discord clients never produce error toasts.
 *   - Updates are debounced at 500 ms to avoid flooding during scrubber seek.
 *   - Presence is automatically cleared when playback stops.
 */

import { useSettingsStore } from "../stores/settingsStore";

/** Payload sent to Discord RPC. */
export interface DiscordPresencePayload {
  title: string;
  artist: string;
  album: string;
  position_secs: number;
  duration_secs: number;
  is_playing: boolean;
  app_id?: string;
  artwork_url?: string;
}

/** Response from `/api/discord/status` or `get_discord_status` command. */
export interface DiscordStatusResponse {
  connected: boolean;
  discord_running: boolean;
}

// In-memory cache for resolved online artwork URLs (Discord requires public HTTPS URLs)
const _artworkCache = new Map<string, string>();
const _pendingLookups = new Map<string, Promise<string | null>>();

/**
 * Resolves a high-resolution public artwork URL for Discord RPC using Apple Music / iTunes CDN.
 * Discord RPC requires public HTTP/HTTPS URLs (or uploaded asset keys) to render album covers.
 */
export async function resolveOnlineArtwork(
  artist: string,
  album: string,
  title: string
): Promise<string | null> {
  const cleanArtist = artist.trim();
  const cleanAlbum = album.trim();
  const cleanTitle = title.trim();

  if (!cleanArtist || cleanArtist === "Unknown Artist") {
    return null;
  }

  const queryKey = `${cleanArtist} - ${cleanAlbum || cleanTitle}`.toLowerCase();
  if (_artworkCache.has(queryKey)) {
    return _artworkCache.get(queryKey) || null;
  }

  if (_pendingLookups.has(queryKey)) {
    return _pendingLookups.get(queryKey)!;
  }

  const promise = (async () => {
    try {
      const searchTerm = encodeURIComponent(`${cleanArtist} ${cleanAlbum || cleanTitle}`);
      const res = await fetch(
        `https://itunes.apple.com/search?term=${searchTerm}&entity=song&limit=1`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.results?.[0]?.artworkUrl100) {
        // Upgrade from 100x100 to 512x512 for crisp display on Discord
        const highResUrl = data.results[0].artworkUrl100.replace(
          /\/100x100bb\./,
          "/512x512bb."
        );
        _artworkCache.set(queryKey, highResUrl);
        return highResUrl;
      }
      _artworkCache.set(queryKey, "");
      return null;
    } catch {
      return null;
    } finally {
      _pendingLookups.delete(queryKey);
    }
  })();

  _pendingLookups.set(queryKey, promise);
  return promise;
}

// Debounce timer handle
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingDispatchPayload: DiscordPresencePayload | null = null;

// Track last dispatched properties to avoid redundant network/IPC chatter
let _lastSentTrackKey = "";
let _lastSentIsPlaying = false;
let _lastSentPosition = -1;
let _lastSentTime = 0;
let _lastSentArtwork = "";
let _lastSentAppId: string | undefined = undefined;

/** Detects if the frontend is running inside the Tauri native desktop shell. */
function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    (Boolean((window as unknown as { isTauri?: boolean }).isTauri) ||
      "__TAURI_INTERNALS__" in window)
  );
}

/** Resolves the base URL for the local Wavery API in browser mode. */
function getApiBase(): string {
  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    if (protocol === "http:" || protocol === "https:") {
      return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    }
  }
  return "";
}

/**
 * Dispatches the enriched payload to Discord via native Tauri IPC or local server REST bridge.
 */
function executeDispatch(payload: DiscordPresencePayload): void {
  const cleanTitle = payload.title?.trim() || "";
  const cleanArtist = payload.artist?.trim() || "";
  const cleanAlbum = payload.album?.trim() || "";

  _lastSentTrackKey = `${cleanTitle}::${cleanArtist}::${cleanAlbum}`;
  _lastSentIsPlaying = payload.is_playing;
  _lastSentPosition = payload.position_secs;
  _lastSentTime = Date.now();
  _lastSentArtwork = payload.artwork_url || "";
  _lastSentAppId = payload.app_id;

  if (isTauri()) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("update_discord_presence", { payload }).catch(() => {
          // Discord not running — ignore silently
        });
      })
      .catch(() => {});
  } else {
    const apiBase = getApiBase();
    fetch(`${apiBase}/api/discord/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Discord not running or server not reachable — ignore silently
    });
  }
}

/**
 * Posts a presence update to Discord via Tauri IPC or local server bridge.
 * Dispatches immediately on track or play-state changes. Debounces bursts (such as scrubbing).
 *
 * @param payload The presence data to send.
 */
export function updateDiscordPresence(payload: DiscordPresencePayload): void {
  const customAppId = useSettingsStore.getState().discordAppId;
  const cleanArtist = payload.artist?.trim() || "";
  const cleanAlbum = payload.album?.trim() || "";
  const cleanTitle = payload.title?.trim() || "";
  const queryKey = `${cleanArtist} - ${cleanAlbum || cleanTitle}`.toLowerCase();

  let artworkUrl = payload.artwork_url;
  if (!artworkUrl && _artworkCache.has(queryKey)) {
    artworkUrl = _artworkCache.get(queryKey) || undefined;
  }

  const enrichedPayload: DiscordPresencePayload = {
    ...payload,
    artwork_url: artworkUrl,
    app_id: customAppId ? customAppId.trim() : undefined,
  };

  // If artwork is not cached yet, proactively resolve it and re-dispatch when ready
  if (!artworkUrl && cleanArtist && cleanArtist !== "Unknown Artist") {
    resolveOnlineArtwork(cleanArtist, cleanAlbum, cleanTitle).then((resolvedUrl) => {
      if (resolvedUrl) {
        updateDiscordPresence({
          ...payload,
          artwork_url: resolvedUrl,
        });
      }
    }).catch(() => {});
  }

  const trackKey = `${cleanTitle}::${cleanArtist}::${cleanAlbum}`;
  const isSameTrack = trackKey === _lastSentTrackKey;
  const isSamePlayState = payload.is_playing === _lastSentIsPlaying;
  const isSameArtwork = (artworkUrl || "") === (_lastSentArtwork || "");
  const isSameAppId = enrichedPayload.app_id === _lastSentAppId;

  // If playback is advancing normally, Discord's desktop client natively updates the progress bar
  // using timestamps.start and timestamps.end. Resending on linear 500ms intervals causes rate-limiting
  // or restarts the progress bar.
  if (isSameTrack && isSamePlayState && isSameArtwork && isSameAppId && _lastSentTime > 0) {
    const elapsedSecs = (Date.now() - _lastSentTime) / 1000;
    const expectedPos = _lastSentPosition + elapsedSecs;
    const positionDelta = Math.abs(payload.position_secs - expectedPos);
    if (positionDelta < 2.5) {
      // Normal linear time advancement — no RPC update needed
      return;
    }
  }

  const isTrackOrStateChange = !isSameTrack || !isSamePlayState || !isSameArtwork || !isSameAppId;
  const timeSinceLastDispatch = Date.now() - _lastSentTime;

  // Immediate dispatch for track changes or play/pause; debounce rapid seek bursts
  if (isTrackOrStateChange || timeSinceLastDispatch > 500) {
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    _pendingDispatchPayload = null;
    executeDispatch(enrichedPayload);
  } else {
    _pendingDispatchPayload = enrichedPayload;
    if (_debounceTimer === null) {
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        if (_pendingDispatchPayload) {
          executeDispatch(_pendingDispatchPayload);
          _pendingDispatchPayload = null;
        }
      }, 250);
    }
  }
}

/**
 * Clears the Discord Rich Presence status immediately (no debounce).
 * Call this when playback stops.
 */
export function clearDiscordPresence(): void {
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _pendingDispatchPayload = null;
  _lastSentTrackKey = "";
  _lastSentIsPlaying = false;
  _lastSentPosition = -1;
  _lastSentTime = 0;
  _lastSentArtwork = "";
  _lastSentAppId = undefined;

  if (isTauri()) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("clear_discord_presence").catch(() => {});
      })
      .catch(() => {});
  } else {
    const apiBase = getApiBase();
    fetch(`${apiBase}/api/discord/presence`, {
      method: "DELETE",
    }).catch(() => {});
  }
}

/**
 * Queries the current Discord IPC connection status.
 * Returns null if the host environment is unreachable.
 *
 * @param customAppId Optional custom Discord application ID to test.
 */
export async function getDiscordStatus(customAppId?: string): Promise<DiscordStatusResponse | null> {
  const effectiveAppId =
    customAppId !== undefined
      ? customAppId.trim() || undefined
      : useSettingsStore.getState().discordAppId?.trim() || undefined;

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DiscordStatusResponse>("get_discord_status", {
        customAppId: effectiveAppId || null,
      });
    } catch (e) {
      console.warn("Failed to get Discord status via Tauri IPC:", e);
      return null;
    }
  }

  try {
    const query = effectiveAppId ? `?app_id=${encodeURIComponent(effectiveAppId)}` : "";
    const res = await fetch(`${getApiBase()}/api/discord/status${query}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as DiscordStatusResponse;
  } catch {
    return null;
  }
}

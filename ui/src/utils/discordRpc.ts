/**
 * Discord Rich Presence client-side bridge for Wavery.
 *
 * Discord's Rich Presence is a desktop IPC protocol (Unix socket on Linux/macOS,
 * named pipe on Windows). Web pages have no direct access to it. This module
 * bridges the gap by POSTing presence updates to the local Wavery server
 * (`/api/discord/presence`), which maintains an IPC connection to Discord desktop.
 *
 * Requirements:
 *   - Discord desktop must be running on the same machine.
 *   - wavery-server must be running (it always is in both web and Tauri modes).
 *   - The user must enable "Discord Rich Presence" in Settings → Integrations.
 *
 * Behavior:
 *   - All fetch errors are swallowed silently (Discord may not be installed).
 *   - Updates are debounced at 500 ms to avoid flooding the endpoint during seek.
 *   - Presence is automatically cleared on stop.
 */

/** Payload sent to `/api/discord/presence`. */
export interface DiscordPresencePayload {
  title: string;
  artist: string;
  album: string;
  position_secs: number;
  duration_secs: number;
  is_playing: boolean;
}

/** Response from `/api/discord/status`. */
export interface DiscordStatusResponse {
  connected: boolean;
  discord_running: boolean;
}

// Debounce timer handle
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Track the last payload to avoid redundant identical POSTs
let _lastPayloadHash = "";

/** Resolves the base URL for the local Wavery API. */
function getApiBase(): string {
  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    // In Tauri mode the page is served from tauri://localhost — use the HTTP server directly
    if (protocol === "tauri:" || hostname === "tauri.localhost") {
      return "http://localhost:7272";
    }
    // In browser mode, use the same origin (server handles CORS)
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  }
  return "http://localhost:7272";
}

/**
 * Posts a presence update to the local Wavery server.
 * Debounced at 500 ms; identical consecutive payloads are suppressed.
 *
 * @param payload  The presence data to send.
 */
export function updateDiscordPresence(payload: DiscordPresencePayload): void {
  const hash = JSON.stringify(payload);
  if (hash === _lastPayloadHash) return;

  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
  }

  _debounceTimer = setTimeout(() => {
    _lastPayloadHash = hash;
    _debounceTimer = null;
    fetch(`${getApiBase()}/api/discord/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: hash,
    }).catch(() => {
      // Discord not running or server not reachable — ignore silently
    });
  }, 500);
}

/**
 * Clears the Discord Rich Presence status immediately (no debounce).
 * Call this when playback stops.
 */
export function clearDiscordPresence(): void {
  // Cancel any pending debounced update
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _lastPayloadHash = "";

  fetch(`${getApiBase()}/api/discord/presence`, {
    method: "DELETE",
  }).catch(() => {
    // Ignore silently
  });
}

/**
 * Queries the server for the current Discord IPC connection status.
 * Returns null if the server is unreachable or Discord is not installed.
 */
export async function getDiscordStatus(): Promise<DiscordStatusResponse | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/discord/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as DiscordStatusResponse;
  } catch {
    return null;
  }
}

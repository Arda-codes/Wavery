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
}

/** Response from `/api/discord/status` or `get_discord_status` command. */
export interface DiscordStatusResponse {
  connected: boolean;
  discord_running: boolean;
}

// Debounce timer handle
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Track the last payload to avoid redundant identical dispatches
let _lastPayloadHash = "";

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
 * Posts a presence update to Discord via Tauri IPC or local server bridge.
 * Debounced at 500 ms; identical consecutive payloads are suppressed.
 *
 * @param payload The presence data to send.
 */
export function updateDiscordPresence(payload: DiscordPresencePayload): void {
  const customAppId = useSettingsStore.getState().discordAppId;
  const enrichedPayload: DiscordPresencePayload = {
    ...payload,
    app_id: customAppId ? customAppId.trim() : undefined,
  };

  const hash = JSON.stringify(enrichedPayload);
  if (hash === _lastPayloadHash) return;

  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
  }

  _debounceTimer = setTimeout(() => {
    _lastPayloadHash = hash;
    _debounceTimer = null;

    if (isTauri()) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => {
          invoke("update_discord_presence", { payload: enrichedPayload }).catch(() => {
            // Discord not running — ignore silently
          });
        })
        .catch(() => {});
    } else {
      fetch(`${getApiBase()}/api/discord/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: hash,
      }).catch(() => {
        // Discord not running or server not reachable — ignore silently
      });
    }
  }, 500);
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
  _lastPayloadHash = "";

  if (isTauri()) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("clear_discord_presence").catch(() => {});
      })
      .catch(() => {});
  } else {
    fetch(`${getApiBase()}/api/discord/presence`, {
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

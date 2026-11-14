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
 * Normalizes a title/artist/album for fuzzy comparison: lowercase, strip
 * diacritics, drop bracketed suffixes ("(Remastered 2011)", "[Deluxe]"),
 * collapse punctuation to spaces, and remove noise words that make two
 * different releases look distinct.
 */
export function normalizeForMatch(value: string): string {
  const base = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stripped = base
    .replace(/\b(feat|ft|featuring|with|remaster|remastered|deluxe|edition|version|ep|single)\b/gu, " ")
    .replace(/\bthe\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return stripped || base;
}

/** Token overlap in [0, 1]; 1 means the two normalized strings match exactly. */
export function tokenScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1;
  }
  return shared / Math.max(aTokens.size, bTokens.size);
}

/** Minimal shape of an iTunes Search API song/album result. */
interface ITunesResult {
  artistName?: string;
  collectionName?: string;
  trackName?: string;
  artworkUrl100?: string;
}

/** Fetches iTunes search results, returning `null` (not empty) on a transport error. */
async function searchItunes(
  term: string,
  entity: "song" | "album",
  country?: string
): Promise<ITunesResult[] | null> {
  try {
    const countryParam = country ? `&country=${encodeURIComponent(country)}` : "";
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=12${countryParam}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: ITunesResult[] };
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return null;
  }
}

/**
 * Apple Music storefronts to try, in priority order. The bare entry is the
 * API default (United States). Local releases — Japanese city pop, Turkish
 * singles, European editions — often exist only in their regional store, so
 * a US-only lookup silently drops the cover.
 */
const STOREFRONTS: ReadonlyArray<string | undefined> = [
  undefined,
  "jp",
  "gb",
  "de",
  "fr",
  "tr",
  "kr",
];

/** Score high enough to stop querying further storefronts. */
const CONFIDENT_MATCH_SCORE = 0.68;

/**
 * Effective score for a strong album match whose artist name is written in a
 * different script (e.g. the file says "Anri" while the JP store lists "杏里").
 * The album cover is the same asset, so the missing artist overlap must not
 * veto an otherwise exact album match.
 */

/** True when the string contains characters outside the Latin script. */
function hasNonLatinScript(value: string): boolean {
  return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(value);
}


/** Discord renders the cover at roughly 512px, so ask for a 600px asset. */
export function upscaleArtwork(url: string): string {
  return url.replace(/\/\d+x\d+bb\./, "/600x600bb.");
}

/**
 * Picks the best artwork from a result list using artist/album/title overlap
 * instead of trusting the first hit. Returns `null` when nothing clears the
 * confidence bar, which is much better than painting the wrong cover.
 */
export function bestArtworkScore(
  results: ITunesResult[],
  normArtist: string,
  normAlbum: string,
  normTitle: string
): { url: string; score: number } | null {
  let best: { url: string; score: number } | null = null;
  for (const result of results) {
    if (!result.artworkUrl100) continue;
    const rawArtist = result.artistName ?? "";
    const artistScore = tokenScore(normalizeForMatch(rawArtist), normArtist);
    const albumScore = normAlbum
      ? tokenScore(normalizeForMatch(result.collectionName ?? ""), normAlbum)
      : 0;
    const titleScore = normTitle
      ? tokenScore(normalizeForMatch(result.trackName ?? ""), normTitle)
      : 0;
    // Artist identity dominates; album and title break ties between releases.
    const baseScore = normAlbum
      ? artistScore * 0.5 + albumScore * 0.35 + titleScore * 0.15
      : artistScore * 0.6 + titleScore * 0.4;

    // Localized storefronts romanize differently ("Anri" vs "杏里"), which
    // zeroes the artist overlap even for the exact release. Trust an exact
    // album (or title when the album tag is missing) instead of dropping the
    // cover; a Latin-script cover band is still rejected by the threshold.
    const artistLooksLocalized =
      artistScore === 0 &&
      (hasNonLatinScript(rawArtist) || hasNonLatinScript(normArtist) || normArtist === "");
    const localizedMatch =
      artistLooksLocalized &&
      (albumScore >= 0.9 || (normAlbum === "" && titleScore >= 0.9));
    const score = localizedMatch
      ? Math.max(baseScore, CONFIDENT_MATCH_SCORE)
      : baseScore;

    if (!best || score > best.score) {
      best = { url: upscaleArtwork(result.artworkUrl100), score };
    }
  }
  return best;
}

/**
 * Searches every storefront until a confident match is found. Returns the
 * best-scoring candidate across all stores and whether at least one store
 * answered (so transport failures can avoid poisoning the negative cache).
 */
async function searchStorefronts(
  term: string,
  entity: "song" | "album",
  normArtist: string,
  normAlbum: string,
  normTitle: string
): Promise<{ best: { url: string; score: number } | null; anyResponse: boolean }> {
  let best: { url: string; score: number } | null = null;
  let anyResponse = false;

  for (const country of STOREFRONTS) {
    const results = await searchItunes(term, entity, country);
    if (results === null) continue;
    anyResponse = true;

    const candidate = bestArtworkScore(results, normArtist, normAlbum, normTitle);
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
    if (best && best.score >= CONFIDENT_MATCH_SCORE) break;
  }

  return { best, anyResponse };
}

/**
 * Resolves a high-resolution public artwork URL for Discord RPC using the
 * iTunes Search API. Discord RPC requires public HTTP/HTTPS URLs (or uploaded
 * asset keys) to render album covers.
 *
 * Matches are scored rather than first-hit so an artist's live album or a
 * compilation never replaces the studio cover. Regional storefronts are
 * searched because releases that are absent from the US catalog (Japanese
 * city pop, Turkish singles, local editions) still have a valid cover there.
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

  const normArtist = normalizeForMatch(cleanArtist);
  const normAlbum = normalizeForMatch(cleanAlbum);
  const normTitle = normalizeForMatch(cleanTitle);

  const promise = (async () => {
    try {
      // 1. Track search scoped by artist + album (or title when no album).
      const songSearch = await searchStorefronts(
        `${cleanArtist} ${cleanAlbum || cleanTitle}`,
        "song",
        normArtist,
        normAlbum,
        normTitle
      );
      if (!songSearch.anyResponse) {
        // Every storefront failed (offline/unreachable): do not poison the
        // cache with a false negative.
        return null;
      }
      if (songSearch.best && songSearch.best.score >= 0.55) {
        _artworkCache.set(queryKey, songSearch.best.url);
        return songSearch.best.url;
      }

      // 2. Fall back to an album search, which is more forgiving when the
      //    track is credited to a featured artist or titled differently.
      if (normAlbum) {
        const albumSearch = await searchStorefronts(
          `${cleanArtist} ${cleanAlbum}`,
          "album",
          normArtist,
          normAlbum,
          ""
        );
        if (albumSearch.best && albumSearch.best.score >= 0.6) {
          _artworkCache.set(queryKey, albumSearch.best.url);
          return albumSearch.best.url;
        }
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

/**
 * Minimum spacing between presence writes. Discord tolerates roughly five
 * updates per twenty seconds and each write restarts the progress bar, so a
 * slightly delayed update is always better than a burst.
 */
const MIN_DISPATCH_GAP_MS = 600;

/**
 * Pending "clear presence" timer. Track transitions pass through a transient
 * Stopped state before the next track loads, so a clear is deferred briefly
 * and cancelled by any presence that arrives first.
 */
let _clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Clears the Discord Rich Presence after a short grace period.
 *
 * Use this for playback that has stopped, rather than clearing immediately:
 * auto-advance and crossfades briefly report Stopped, and an immediate clear
 * makes the Discord card flicker between tracks.
 *
 * @param delayMs Grace period in milliseconds (default 1200).
 */
export function scheduleClearDiscordPresence(delayMs = 1200): void {
  if (_clearTimer !== null) clearTimeout(_clearTimer);
  _clearTimer = setTimeout(() => {
    _clearTimer = null;
    clearDiscordPresence();
  }, delayMs);
}

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
  // A queued clear means playback had stopped; this new presence supersedes
  // it, so consecutive tracks do not blink out of the Discord profile.
  if (_clearTimer !== null) {
    clearTimeout(_clearTimer);
    _clearTimer = null;
  }

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

  // If artwork is not cached yet, proactively resolve it and re-dispatch when ready.
  // A cached miss (empty string) is not retried, so polling the presence
  // never re-hits the network for an artist iTunes does not know.
  if (!artworkUrl && !_artworkCache.has(queryKey) && cleanArtist && cleanArtist !== "Unknown Artist") {
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

  // While playing, Discord's desktop client advances the progress bar itself
  // from timestamps.start/end, so resending on a linear clock would only
  // restart it. A position that drifts more than 2.5s from the expected clock
  // is a real seek and must be forwarded. While paused there is no clock to
  // outrun, so an unchanged track is left alone entirely.
  if (isSameTrack && isSamePlayState && isSameArtwork && isSameAppId && _lastSentTime > 0) {
    if (!payload.is_playing) return;
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

  // Discord rate-limits presence updates (about five per twenty seconds) and
  // restarts the progress bar on every write, so bursts must be coalesced:
  // a track change goes out almost immediately, play/pause and seeks settle
  // on a short trailing edge, and only the newest payload is ever sent.
  const minGap = isTrackOrStateChange ? MIN_DISPATCH_GAP_MS : 500;
  const delay = Math.max(0, minGap - timeSinceLastDispatch);

  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  if (delay === 0 && (isTrackOrStateChange || timeSinceLastDispatch > 500)) {
    _pendingDispatchPayload = null;
    executeDispatch(enrichedPayload);
    return;
  }

  _pendingDispatchPayload = enrichedPayload;
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    if (_pendingDispatchPayload) {
      executeDispatch(_pendingDispatchPayload);
      _pendingDispatchPayload = null;
    }
  }, delay > 0 ? delay : 250);
}

/**
 * Clears the Discord Rich Presence status immediately (no debounce).
 * Call this when playback stops.
 */
export function clearDiscordPresence(): void {
  if (_clearTimer !== null) {
    clearTimeout(_clearTimer);
    _clearTimer = null;
  }
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

/**
 * LRCLIB Public Lyrics Service for Wavery.
 *
 * Connects to LRCLIB (https://lrclib.net), the premier open-source synchronized lyrics repository.
 * Provides both time-synchronized (.lrc format with timestamps) and plain text lyrics.
 *
 * Features:
 *   - 100% Free, zero authentication, no API keys required.
 *   - Auto-fallback from exact `/api/get` match to fuzzy `/api/search`.
 *   - In-memory caching to eliminate duplicate requests during playback and re-renders.
 */

export interface LyricsResult {
  id?: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  syncedLyrics?: string;
  plainLyrics?: string;
  isInstrumental: boolean;
  bestLyrics: string; // Returns syncedLyrics if available, else plainLyrics
}

interface RawLrclibResponse {
  id?: number;
  name?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

const _lyricsCache = new Map<string, LyricsResult | null>();

/** Normalizes artist/title query for matching. */
function normalizeQuery(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, "") // remove [FLAC], [HQ]
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetches lyrics from LRCLIB for a track.
 *
 * @param artist Track artist
 * @param title Track title
 * @param album Optional album name for higher precision
 * @param durationSecs Optional duration in seconds for matching
 */
export async function fetchLyrics(
  artist: string,
  title: string,
  album?: string,
  durationSecs?: number
): Promise<LyricsResult | null> {
  const cleanArtist = normalizeQuery(artist);
  const cleanTitle = normalizeQuery(title);

  if (!cleanTitle && !cleanArtist) return null;

  const cacheKey = `${cleanArtist}__${cleanTitle}`.toLowerCase();
  if (_lyricsCache.has(cacheKey)) {
    return _lyricsCache.get(cacheKey) ?? null;
  }

  try {
    // 1. Try exact match endpoint first
    const params = new URLSearchParams({
      artist_name: cleanArtist,
      track_name: cleanTitle,
    });
    if (album && album.trim()) {
      params.append("album_name", normalizeQuery(album));
    }
    if (durationSecs && durationSecs > 0) {
      params.append("duration", Math.round(durationSecs).toString());
    }

    const exactRes = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": "Wavery/0.2.1 (https://github.com/Arda-codes/Wavery)",
      },
    });

    if (exactRes.ok) {
      const data: RawLrclibResponse = await exactRes.json();
      const result = formatLyricsResult(data, cleanTitle, cleanArtist);
      if (result) {
        _lyricsCache.set(cacheKey, result);
        return result;
      }
    }

    // 2. Fall back to search endpoint if exact match wasn't found
    const searchRes = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`)}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent": "Wavery/0.2.1 (https://github.com/Arda-codes/Wavery)",
        },
      }
    );

    if (searchRes.ok) {
      const results: RawLrclibResponse[] = await searchRes.json();
      if (Array.isArray(results) && results.length > 0) {
        // Prefer one that has synced lyrics
        const withSynced = results.find((r) => r.syncedLyrics && r.syncedLyrics.trim().length > 0);
        const best = withSynced || results[0];
        const result = formatLyricsResult(best, cleanTitle, cleanArtist);
        if (result) {
          _lyricsCache.set(cacheKey, result);
          return result;
        }
      }
    }

    _lyricsCache.set(cacheKey, null);
    return null;
  } catch (err) {
    console.warn("LRCLIB lyrics fetch error:", err);
    return null;
  }
}

function formatLyricsResult(
  data: RawLrclibResponse,
  fallbackTitle: string,
  fallbackArtist: string
): LyricsResult | null {
  const synced = data.syncedLyrics?.trim() || undefined;
  const plain = data.plainLyrics?.trim() || undefined;
  const isInstrumental = Boolean(data.instrumental);

  if (!synced && !plain && !isInstrumental) {
    return null;
  }

  const bestLyrics = synced || plain || (isInstrumental ? "[00:00.00] ♪ Instrumental ♪" : "");

  return {
    id: data.id,
    trackName: data.trackName || data.name || fallbackTitle,
    artistName: data.artistName || fallbackArtist,
    albumName: data.albumName,
    syncedLyrics: synced,
    plainLyrics: plain,
    isInstrumental,
    bestLyrics,
  };
}

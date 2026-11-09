/**
 * High-Performance LRCLIB Synced Lyrics Service for Wavery.
 *
 * Connects to LRCLIB (https://lrclib.net) to find high-precision time-synchronized LRC lyrics.
 *
 * Features:
 *   - LRCLIB search-first architecture: Uses `/api/search` with candidate scoring to find
 *     the best time-synced lyrics even when album titles or track duration vary slightly.
 *   - Candidate Scoring Engine: Prefers synced lyrics over plain, matches track duration within
 *     ±4 seconds, and prioritizes matching albums.
 *   - Parenthesis & Sanitization Resilience: Gracefully handles enclosed song titles like "(Nice Dream)",
 *     compound artist tags ("Radiohead; RADIOHEAD"), and track number prefixes ("01 - ").
 *   - CORS & WebKit Compatibility: Uses `Lrclib-Client` header (allowed by LRCLIB's Access-Control-Allow-Headers)
 *     and simple GET fallback, never setting forbidden `User-Agent`.
 *   - Zero Fake Timestamps: Never degrades or synthesizes fake 4-second intervals for plain lyrics.
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
export function normalizeQuery(text: string): string {
  return text
    .replace(/^(\d{1,3}[\s.\-_]+)/, "") // strip leading track numbers: "01 - " or "01. "
    .replace(/\s*[\(\[].*?(remaster|live|version|edit|deluxe|mix|anniversary|re-recorded|bonus|feat\.|ft\.).*?[\)\]]/gi, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts the primary artist name for metadata matching. */
export function extractCleanArtist(artist: string): string {
  // Split on semicolon, slash, or "feat." / "ft."
  const split = artist.split(/[,;\/&]|\sfeat\.\s|\sft\.\s/i);
  return split[0].trim();
}

/**
 * Strips outer enclosing parentheses/brackets if the entire title is enclosed, e.g. "(Nice Dream)" -> "Nice Dream".
 */
export function stripEnclosingParentheses(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Scores an LRCLIB candidate based on whether it has synced lyrics,
 * duration proximity, and album match.
 */
function scoreCandidate(
  c: RawLrclibResponse,
  targetDurationSecs?: number,
  targetAlbum?: string
): number {
  let score = 0;

  // Synced lyrics are the top priority in Wavery
  if (c.syncedLyrics && c.syncedLyrics.trim().length > 0) {
    score += 1000;
  } else if (c.instrumental) {
    score += 800;
  } else if (c.plainLyrics && c.plainLyrics.trim().length > 0) {
    score += 100;
  }

  // Duration proximity (within ±4 seconds)
  if (targetDurationSecs && targetDurationSecs > 0 && c.duration && c.duration > 0) {
    const diff = Math.abs(c.duration - targetDurationSecs);
    if (diff <= 2) {
      score += 300;
    } else if (diff <= 5) {
      score += 150;
    } else if (diff <= 10) {
      score += 50;
    }
  }

  // Album proximity
  if (targetAlbum && targetAlbum.trim() && c.albumName && c.albumName.trim()) {
    const a1 = targetAlbum.toLowerCase().trim();
    const a2 = c.albumName.toLowerCase().trim();
    if (a1 === a2 || a1.includes(a2) || a2.includes(a1)) {
      score += 200;
    }
  }

  return score;
}

/**
 * Executes a resilient fetch with retry on 429/503.
 * Fully CORS and WebKit compliant: never uses forbidden `User-Agent`.
 */
async function resilientFetch(url: string, timeoutMs: number = 4000): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // LRCLIB officially allows 'Lrclib-Client' in Access-Control-Allow-Headers
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "Lrclib-Client": "Wavery (https://github.com/Arda-codes/Wavery)" },
      });

      if (res.ok) {
        return res;
      }

      if (res.status === 429 || res.status === 503) {
        const retryHeader = res.headers.get("retry-after");
        const delay = retryHeader ? Math.min(parseInt(retryHeader, 10) * 1000, 1500) : 350 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // If 404 or other 4xx, don't retry
      return null;
    } catch {
      // Fallback: simple GET with no custom headers to avoid any client header filtering
      try {
        const simpleRes = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (simpleRes.ok) {
          return simpleRes;
        }
      } catch {}

      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
  return null;
}

/**
 * Fetches lyrics for a track using LRCLIB's multi-stage search and scoring engine.
 *
 * @param artist Track artist
 * @param title Track title
 * @param album Optional album name for higher precision
 * @param durationSecs Optional duration in seconds for matching
 * @param forceRefresh Optional flag to bypass in-memory cache
 */
export async function fetchLyrics(
  artist: string,
  title: string,
  album?: string,
  durationSecs?: number,
  forceRefresh: boolean = false
): Promise<LyricsResult | null> {
  const cleanTitle = normalizeQuery(title) || title.trim();
  const rawArtist = artist.trim();
  const cleanArtist = extractCleanArtist(rawArtist) || rawArtist;

  if (!cleanTitle && !cleanArtist) return null;

  const cacheKey = `${cleanArtist}__${cleanTitle}`.toLowerCase();
  if (!forceRefresh && _lyricsCache.has(cacheKey)) {
    const cached = _lyricsCache.get(cacheKey);
    if (cached?.syncedLyrics || cached?.isInstrumental) {
      return cached;
    }
    if (cached?.plainLyrics) {
      return cached;
    }
  }

  // Helper to query LRCLIB search with specific params
  const querySearch = async (params: Record<string, string>): Promise<RawLrclibResponse[]> => {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await resilientFetch(`https://lrclib.net/api/search?${qs}`);
      if (res && res.ok) {
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      }
    } catch {}
    return [];
  };

  try {
    let candidates: RawLrclibResponse[] = [];

    // Stage 1: Search by track_name & artist_name (fastest & most accurate)
    candidates = await querySearch({
      track_name: cleanTitle,
      artist_name: cleanArtist,
    });

    // Stage 1b: If title was parenthesized like "(Nice Dream)", try stripped variant "Nice Dream"
    const strippedTitle = stripEnclosingParentheses(cleanTitle);
    if (candidates.length === 0 && strippedTitle !== cleanTitle) {
      candidates = await querySearch({
        track_name: strippedTitle,
        artist_name: cleanArtist,
      });
    }

    // Stage 2: Full text query `q=artist title` if parameter search found nothing
    if (candidates.length === 0) {
      candidates = await querySearch({
        q: `${cleanArtist} ${cleanTitle}`,
      });
    }

    // Stage 2b: Full text with stripped title
    if (candidates.length === 0 && strippedTitle !== cleanTitle) {
      candidates = await querySearch({
        q: `${cleanArtist} ${strippedTitle}`,
      });
    }

    // Stage 3: Direct exact lookup via `/api/get` without strict parameters
    if (candidates.length === 0) {
      try {
        const getParams = new URLSearchParams({
          artist_name: cleanArtist,
          track_name: cleanTitle,
        });
        const res = await resilientFetch(`https://lrclib.net/api/get?${getParams.toString()}`);
        if (res && res.ok) {
          const single = await res.json();
          if (single && (single.syncedLyrics || single.plainLyrics || single.instrumental)) {
            candidates = [single];
          }
        }
      } catch {}
    }

    if (candidates.length > 0) {
      // Sort candidates by score descending
      candidates.sort((a, b) => {
        return scoreCandidate(b, durationSecs, album) - scoreCandidate(a, durationSecs, album);
      });

      const best = candidates[0];
      const result = formatLyricsResult(best, cleanTitle, cleanArtist);
      if (result) {
        _lyricsCache.set(cacheKey, result);
        return result;
      }
    }

    // Stage 4: Secondary fallback to lyrics.ovh for plain lyrics if LRCLIB has zero results
    try {
      const ovhRes = await fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (ovhRes.ok) {
        const ovhData = await ovhRes.json();
        const plain = ovhData.lyrics?.trim();
        if (plain && plain.length > 0) {
          const result: LyricsResult = {
            trackName: cleanTitle,
            artistName: cleanArtist,
            albumName: album,
            plainLyrics: plain,
            isInstrumental: false,
            bestLyrics: plain,
          };
          _lyricsCache.set(cacheKey, result);
          return result;
        }
      }
    } catch {}

    _lyricsCache.set(cacheKey, null);
    return null;
  } catch (err) {
    console.warn("Lyrics service error:", err);
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

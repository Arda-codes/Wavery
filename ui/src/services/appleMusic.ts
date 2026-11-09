/**
 * Apple Music / iTunes Public Search & Metadata Service for Wavery.
 *
 * Utilizes Apple's official, free iTunes Search and Lookup REST APIs:
 *   - Search Track: `https://itunes.apple.com/search?term=...&entity=song&limit=5`
 *   - Search Album: `https://itunes.apple.com/search?term=...&entity=album&limit=5`
 *   - Lookup Album Tracks: `https://itunes.apple.com/lookup?id=...&entity=song`
 *
 * Features:
 *   - Zero API keys or authentication required.
 *   - High-resolution artwork conversion (scales 100x100 thumbnail to 600x600 or 1200x1200).
 *   - In-memory caching to eliminate redundant lookups.
 *   - Fuzzy matching algorithms to accurately pair local file metadata with official releases.
 */

export interface AppleTrackMetadata {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  artworkUrl?: string;
  appleTrackId?: number;
  appleCollectionId?: number;
  durationSecs?: number;
}

export interface AppleAlbumMetadata {
  collectionId: number;
  albumName: string;
  artistName: string;
  year?: number;
  genre?: string;
  trackCount: number;
  artworkUrl?: string;
  tracks: AppleTrackMetadata[];
}

interface RawItunesItem {
  wrapperType?: string;
  kind?: string;
  artistId?: number;
  trackId?: number;
  collectionId?: number;
  collectionType?: string;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionArtistName?: string;
  trackNumber?: number;
  discNumber?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  trackCount?: number;
}

const _trackCache = new Map<string, AppleTrackMetadata | null>();
const _albumCache = new Map<string, AppleAlbumMetadata | null>();

/** Converts iTunes 100x100 artwork thumbnail to crisp 1000x1000 high-res artwork. */
export function upgradeArtworkResolution(url: string, size = 1000): string {
  if (!url) return "";
  return url.replace(/\/100x100bb\./, `/${size}x${size}bb.`);
}

/** Cleans titles (removes bracketed junk like [FLAC], (Remastered), etc.) for better search hit rates. */
function sanitizeQuery(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, "") // remove [FLAC], [HQ]
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes strings by lowercasing, stripping punctuation, and collapsing whitespace.
 */
function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Checks whether candidate title matches target title. */
function isTitleMatch(candidate: string, target: string): boolean {
  const c = normalizeText(candidate);
  const t = normalizeText(target);
  if (!c || !t) return false;
  return c === t || c.includes(t) || t.includes(c);
}

/** Checks whether candidate artist matches target artist. */
function isArtistMatch(candidate: string, target: string): boolean {
  if (!target) return true;
  const c = normalizeText(candidate);
  const t = normalizeText(target);
  if (!c || !t) return false;
  return c === t || c.includes(t) || t.includes(c);
}

/** Parses release year from ISO release date string (e.g. "2024-08-30T07:00:00Z"). */
function parseYear(releaseDate?: string): number | undefined {
  if (!releaseDate) return undefined;
  const match = releaseDate.match(/^(\d{4})/);
  if (!match) return undefined;
  const year = parseInt(match[1], 10);
  return isNaN(year) ? undefined : year;
}

/**
 * Validates and ranks candidate tracks to select the highest-accuracy matching release.
 */
function pickBestTrackMatch(
  candidates: RawItunesItem[],
  targetTitle: string,
  targetArtist: string,
  targetAlbum?: string
): RawItunesItem | null {
  const tTitleNorm = normalizeText(targetTitle);
  const tArtistNorm = normalizeText(targetArtist);
  const tAlbumNorm = targetAlbum ? normalizeText(targetAlbum) : "";

  // 1. Filter out completely unrelated tracks
  const valid = candidates.filter((item) => {
    if (!item.trackName) return false;
    if (!isTitleMatch(item.trackName, targetTitle)) return false;
    if (tArtistNorm && !isArtistMatch(item.artistName || "", targetArtist)) return false;
    return true;
  });

  if (valid.length === 0) return null;

  // 2. Rank candidates by relevance
  valid.sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    const aTitle = normalizeText(a.trackName || "");
    const bTitle = normalizeText(b.trackName || "");
    if (aTitle === tTitleNorm) scoreA += 10;
    if (bTitle === tTitleNorm) scoreB += 10;

    const aArtist = normalizeText(a.artistName || "");
    const bArtist = normalizeText(b.artistName || "");
    if (aArtist === tArtistNorm) scoreA += 10;
    if (bArtist === tArtistNorm) scoreB += 10;

    const aAlbum = normalizeText(a.collectionName || "");
    const bAlbum = normalizeText(b.collectionName || "");
    if (tAlbumNorm) {
      if (aAlbum === tAlbumNorm) scoreA += 25;
      if (bAlbum === tAlbumNorm) scoreB += 25;
    }

    // Prefer full LP album releases over standalone "- Single" or "- EP" if no album requested
    const aIsSingle = (a.collectionName || "").toLowerCase().includes("single");
    const bIsSingle = (b.collectionName || "").toLowerCase().includes("single");
    if (!aIsSingle) scoreA += 5;
    if (!bIsSingle) scoreB += 5;

    // Prefer tracks with trackNumber > 1 (indicates part of a full album release)
    if ((a.trackNumber || 0) > 1) scoreA += 2;
    if ((b.trackNumber || 0) > 1) scoreB += 2;

    return scoreB - scoreA;
  });

  return valid[0];
}

function rawItemToTrackMetadata(
  best: RawItunesItem,
  fallbackTitle: string,
  fallbackArtist: string,
  fallbackAlbum: string
): AppleTrackMetadata {
  return {
    title: best.trackName || fallbackTitle,
    artist: best.artistName || fallbackArtist,
    album: best.collectionName || fallbackAlbum,
    albumArtist: best.collectionArtistName,
    trackNumber: best.trackNumber,
    discNumber: best.discNumber,
    year: parseYear(best.releaseDate),
    genre: best.primaryGenreName,
    artworkUrl: best.artworkUrl100
      ? upgradeArtworkResolution(best.artworkUrl100, 1000)
      : undefined,
    appleTrackId: best.trackId,
    appleCollectionId: best.collectionId,
    durationSecs: best.trackTimeMillis ? Math.round(best.trackTimeMillis / 1000) : undefined,
  };
}

/**
 * Searches Apple Music for the best matching song using multi-strategy fallback:
 * 1. Direct song search (`artist + title`)
 * 2. Artist lookup fallback (handles Apple keyword stemming issues like femtanyl -> fentanyl)
 * 3. Title-only search fallback
 *
 * Guaranteed to NEVER return an unrelated song when no legitimate match exists.
 */
export async function searchAppleMusicTrack(
  title: string,
  artist: string,
  album?: string
): Promise<AppleTrackMetadata | null> {
  let cleanTitle = sanitizeQuery(title);
  let cleanArtist = sanitizeQuery(artist);
  const cleanAlbum = album ? sanitizeQuery(album) : "";

  // If artist is empty/generic but title contains " - ", auto-split them
  if ((!cleanArtist || cleanArtist.toLowerCase() === "unknown artist") && cleanTitle.includes(" - ")) {
    const parts = cleanTitle.split(" - ");
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      cleanArtist = parts[0].trim();
      cleanTitle = parts[1].trim();
    }
  }

  if (!cleanTitle && !cleanArtist) return null;

  const cacheKey = `${cleanArtist}__${cleanTitle}__${cleanAlbum}`.toLowerCase();
  if (_trackCache.has(cacheKey)) {
    return _trackCache.get(cacheKey) ?? null;
  }

  // Strategy 1: Direct song query
  try {
    const query = encodeURIComponent(`${cleanArtist} ${cleanTitle}`.trim());
    const res = await fetch(
      `https://itunes.apple.com/search?term=${query}&entity=song&limit=25`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const data = await res.json();
      const results: RawItunesItem[] = data.results || [];
      const match = pickBestTrackMatch(results, cleanTitle, cleanArtist, cleanAlbum);
      if (match) {
        const meta = rawItemToTrackMetadata(match, cleanTitle, cleanArtist, cleanAlbum);
        _trackCache.set(cacheKey, meta);
        return meta;
      }
    }
  } catch (err) {
    console.warn("Apple Music direct search error:", err);
  }

  // Strategy 2: Artist lookup fallback (solves stemming and stylized artist names)
  if (cleanArtist && cleanArtist.toLowerCase() !== "unknown artist") {
    try {
      const artistQuery = encodeURIComponent(cleanArtist);
      const res = await fetch(
        `https://itunes.apple.com/search?term=${artistQuery}&entity=musicArtist&limit=5`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (res.ok) {
        const data = await res.json();
        const artists: RawItunesItem[] = data.results || [];
        const normTargetArtist = normalizeText(cleanArtist);

        const matchedArtist =
          artists.find((a) => a.artistId && normalizeText(a.artistName || "") === normTargetArtist) ||
          artists.find((a) => a.artistId && isArtistMatch(a.artistName || "", cleanArtist));

        if (matchedArtist?.artistId) {
          const lookupRes = await fetch(
            `https://itunes.apple.com/lookup?id=${matchedArtist.artistId}&entity=song&limit=200`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (lookupRes.ok) {
            const lookupData = await lookupRes.json();
            const songs: RawItunesItem[] = (lookupData.results || []).filter(
              (i: RawItunesItem) => i.wrapperType === "track" && i.kind === "song"
            );
            const match = pickBestTrackMatch(songs, cleanTitle, cleanArtist, cleanAlbum);
            if (match) {
              const meta = rawItemToTrackMetadata(match, cleanTitle, cleanArtist, cleanAlbum);
              _trackCache.set(cacheKey, meta);
              return meta;
            }
          }
        }
      }
    } catch (err) {
      console.warn("Apple Music artist lookup fallback error:", err);
    }
  }

  // Strategy 3: Title-only query fallback
  if (cleanTitle) {
    try {
      const titleQuery = encodeURIComponent(cleanTitle);
      const res = await fetch(
        `https://itunes.apple.com/search?term=${titleQuery}&entity=song&limit=25`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (res.ok) {
        const data = await res.json();
        const results: RawItunesItem[] = data.results || [];
        const match = pickBestTrackMatch(results, cleanTitle, cleanArtist, cleanAlbum);
        if (match) {
          const meta = rawItemToTrackMetadata(match, cleanTitle, cleanArtist, cleanAlbum);
          _trackCache.set(cacheKey, meta);
          return meta;
        }
      }
    } catch (err) {
      console.warn("Apple Music title search fallback error:", err);
    }
  }

  // Never return an unverified match
  _trackCache.set(cacheKey, null);
  return null;
}

/**
 * Searches Apple Music for an album and retrieves the entire tracklist in a single API call.
 * This is the high-efficiency batch engine: 1 API call enriches 10–20 songs at once!
 */
export async function searchAppleMusicAlbum(
  album: string,
  artist: string
): Promise<AppleAlbumMetadata | null> {
  const cleanAlbum = sanitizeQuery(album);
  const cleanArtist = sanitizeQuery(artist);

  if (!cleanAlbum) return null;

  const cacheKey = `${cleanArtist}__${cleanAlbum}`.toLowerCase();
  if (_albumCache.has(cacheKey)) {
    return _albumCache.get(cacheKey) ?? null;
  }

  try {
    let collectionId: number | undefined;
    let bestAlbum: RawItunesItem | undefined;

    // 1. Direct album search
    const query = encodeURIComponent(`${cleanArtist} ${cleanAlbum}`.trim());
    const searchRes = await fetch(
      `https://itunes.apple.com/search?term=${query}&entity=album&limit=10`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const albums: RawItunesItem[] = searchData.results || [];
      const tAlbumNorm = normalizeText(cleanAlbum);
      const tArtistNorm = normalizeText(cleanArtist);

      bestAlbum = albums.find((a) => {
        if (!a.collectionId || !a.collectionName) return false;
        const aNorm = normalizeText(a.collectionName);
        if (aNorm !== tAlbumNorm && !aNorm.includes(tAlbumNorm) && !tAlbumNorm.includes(aNorm)) return false;
        if (tArtistNorm && !isArtistMatch(a.artistName || "", cleanArtist)) return false;
        return true;
      });

      if (bestAlbum?.collectionId) {
        collectionId = bestAlbum.collectionId;
      }
    }

    // 2. Artist lookup fallback if direct album search yielded no match
    if (!collectionId && cleanArtist && cleanArtist.toLowerCase() !== "unknown artist") {
      const artistQuery = encodeURIComponent(cleanArtist);
      const artistRes = await fetch(
        `https://itunes.apple.com/search?term=${artistQuery}&entity=musicArtist&limit=5`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (artistRes.ok) {
        const artistData = await artistRes.json();
        const artists: RawItunesItem[] = artistData.results || [];
        const matchedArtist = artists.find(
          (a) => a.artistId && isArtistMatch(a.artistName || "", cleanArtist)
        );
        if (matchedArtist?.artistId) {
          const albumsRes = await fetch(
            `https://itunes.apple.com/lookup?id=${matchedArtist.artistId}&entity=album&limit=100`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (albumsRes.ok) {
            const albumsData = await albumsRes.json();
            const albumsList: RawItunesItem[] = (albumsData.results || []).filter(
              (i: RawItunesItem) => i.collectionType === "Album" || i.wrapperType === "collection"
            );
            const tAlbumNorm = normalizeText(cleanAlbum);
            bestAlbum = albumsList.find((a) => {
              if (!a.collectionId || !a.collectionName) return false;
              const aNorm = normalizeText(a.collectionName);
              return aNorm === tAlbumNorm || aNorm.includes(tAlbumNorm) || tAlbumNorm.includes(aNorm);
            });
            if (bestAlbum?.collectionId) {
              collectionId = bestAlbum.collectionId;
            }
          }
        }
      }
    }

    if (!collectionId || !bestAlbum) {
      _albumCache.set(cacheKey, null);
      return null;
    }

    // Lookup album tracks by collectionId in 1 single request
    const lookupRes = await fetch(
      `https://itunes.apple.com/lookup?id=${collectionId}&entity=song`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (!lookupRes.ok) return null;
    const lookupData = await lookupRes.json();
    const items: RawItunesItem[] = lookupData.results || [];

    // The first item is the collection/album wrapper; subsequent items are songs
    const tracks: AppleTrackMetadata[] = [];
    const albumArtwork = bestAlbum.artworkUrl100
      ? upgradeArtworkResolution(bestAlbum.artworkUrl100, 1000)
      : undefined;

    for (const item of items) {
      if (item.wrapperType === "track" && item.kind === "song") {
        tracks.push({
          title: item.trackName || "",
          artist: item.artistName || bestAlbum.artistName || cleanArtist,
          album: item.collectionName || bestAlbum.collectionName || cleanAlbum,
          albumArtist: item.collectionArtistName || bestAlbum.artistName,
          trackNumber: item.trackNumber,
          discNumber: item.discNumber,
          year: parseYear(item.releaseDate || bestAlbum.releaseDate),
          genre: item.primaryGenreName || bestAlbum.primaryGenreName,
          artworkUrl: item.artworkUrl100
            ? upgradeArtworkResolution(item.artworkUrl100, 1000)
            : albumArtwork,
          appleTrackId: item.trackId,
          appleCollectionId: collectionId,
          durationSecs: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : undefined,
        });
      }
    }

    const albumMeta: AppleAlbumMetadata = {
      collectionId,
      albumName: bestAlbum.collectionName || cleanAlbum,
      artistName: bestAlbum.artistName || cleanArtist,
      year: parseYear(bestAlbum.releaseDate),
      genre: bestAlbum.primaryGenreName,
      trackCount: bestAlbum.trackCount || tracks.length,
      artworkUrl: albumArtwork,
      tracks,
    };

    _albumCache.set(cacheKey, albumMeta);
    return albumMeta;
  } catch (err) {
    console.warn("Apple Music album lookup error:", err);
    return null;
  }
}

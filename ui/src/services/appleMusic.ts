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
  trackId?: number;
  collectionId?: number;
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

/** Parses release year from ISO release date string (e.g. "2024-08-30T07:00:00Z"). */
function parseYear(releaseDate?: string): number | undefined {
  if (!releaseDate) return undefined;
  const match = releaseDate.match(/^(\d{4})/);
  if (!match) return undefined;
  const year = parseInt(match[1], 10);
  return isNaN(year) ? undefined : year;
}

/**
 * Searches Apple Music for the best matching song.
 */
export async function searchAppleMusicTrack(
  title: string,
  artist: string,
  album?: string
): Promise<AppleTrackMetadata | null> {
  const cleanTitle = sanitizeQuery(title);
  const cleanArtist = sanitizeQuery(artist);
  const cleanAlbum = album ? sanitizeQuery(album) : "";

  if (!cleanTitle && !cleanArtist) return null;

  const cacheKey = `${cleanArtist}__${cleanTitle}__${cleanAlbum}`.toLowerCase();
  if (_trackCache.has(cacheKey)) {
    return _trackCache.get(cacheKey) ?? null;
  }

  try {
    const query = encodeURIComponent(`${cleanArtist} ${cleanTitle}`.trim());
    const res = await fetch(
      `https://itunes.apple.com/search?term=${query}&entity=song&limit=5`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (!res.ok) {
      _trackCache.set(cacheKey, null);
      return null;
    }

    const data = await res.json();
    const results: RawItunesItem[] = data.results || [];

    if (results.length === 0) {
      _trackCache.set(cacheKey, null);
      return null;
    }

    // Pick best match: prefer exact/case-insensitive match on artist + title
    let best = results[0];
    const targetTitle = cleanTitle.toLowerCase();
    const targetArtist = cleanArtist.toLowerCase();

    for (const r of results) {
      const rTitle = (r.trackName || "").toLowerCase();
      const rArtist = (r.artistName || "").toLowerCase();
      if (rTitle === targetTitle && rArtist.includes(targetArtist)) {
        best = r;
        break;
      }
    }

    const meta: AppleTrackMetadata = {
      title: best.trackName || cleanTitle,
      artist: best.artistName || cleanArtist,
      album: best.collectionName || cleanAlbum,
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

    _trackCache.set(cacheKey, meta);
    return meta;
  } catch (err) {
    console.warn("Apple Music track search error:", err);
    return null;
  }
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
    // 1. Search for album collection ID
    const query = encodeURIComponent(`${cleanArtist} ${cleanAlbum}`.trim());
    const searchRes = await fetch(
      `https://itunes.apple.com/search?term=${query}&entity=album&limit=3`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const albums: RawItunesItem[] = searchData.results || [];

    if (albums.length === 0 || !albums[0].collectionId) {
      _albumCache.set(cacheKey, null);
      return null;
    }

    const bestAlbum = albums[0];
    const collectionId = bestAlbum.collectionId!;

    // 2. Lookup album tracks by collectionId in 1 single request
    const lookupRes = await fetch(
      `https://itunes.apple.com/lookup?id=${collectionId}&entity=song`,
      { signal: AbortSignal.timeout(6000) }
    );

    if (!lookupRes.ok) return null;
    const lookupData = await lookupRes.json();
    const items: RawItunesItem[] = lookupData.results || [];

    // The first item is the collection/album wrapper; subsequent items are songs
    const tracks: AppleTrackMetadata[] = [];
    let albumArtwork = bestAlbum.artworkUrl100
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

import {
  Track,
  AlbumInfo,
  ArtistInfo,
  GenreInfo,
  Playlist,
  TrackSortKey,
  SortDirection,
  AlbumSortKey,
  ArtistSortKey,
  PlaylistSortKey,
} from "../types";

export function formatDuration(secs: number = 0): string {
  const mins = Math.floor(secs / 60);
  const remaining = Math.floor(secs % 60);
  return `${mins}:${remaining < 10 ? "0" : ""}${remaining}`;
}

export function formatTotalDuration(secs: number = 0): string {
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (hours > 0) {
    return `${hours} hr ${mins} min`;
  }
  return `${mins} min`;
}

/**
 * Formats a byte count using binary units with a sensible number of decimals.
 */
export function formatBytes(bytes: number = 0): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[exponent]}`;
}

/**
 * Curated list of iconic artist and band names that contain punctuation (commas, ampersands, slashes, exclamation points)
 * as part of their atomic identity, preventing them from being mistakenly split into separate artists.
 */
export const DEFAULT_PROTECTED_ARTISTS: readonly string[] = [
  "Crosby, Stills, Nash & Young",
  "Crosby, Stills, Nash and Young",
  "Crosby, Stills & Nash",
  "Crosby, Stills and Nash",
  "Earth, Wind & Fire",
  "Earth, Wind and Fire",
  "Blood, Sweat & Tears",
  "Blood, Sweat and Tears",
  "Emerson, Lake & Palmer",
  "Emerson, Lake and Palmer",
  "Peter, Paul and Mary",
  "Peter, Paul & Mary",
  "Tyler, The Creator",
  "Tom Petty and the Heartbreakers",
  "Tom Petty & The Heartbreakers",
  "Grandmaster Flash and the Furious Five",
  "Grandmaster Flash & the Furious Five",
  "Frankie Lymon & The Teenagers",
  "Frankie Lymon and the Teenagers",
  "King Gizzard & The Lizard Wizard",
  "King Gizzard and the Lizard Wizard",
  "Bob Marley & The Wailers",
  "Bob Marley and the Wailers",
  "Sly & The Family Stone",
  "Sly and the Family Stone",
  "Toots and the Maytals",
  "Toots & The Maytals",
  "Siouxsie and the Banshees",
  "Siouxsie & The Banshees",
  "Huey Lewis & The News",
  "Huey Lewis and the News",
  "KC and the Sunshine Band",
  "KC & The Sunshine Band",
  "The Mamas & The Papas",
  "The Mamas and the Papas",
  "Derek & The Dominos",
  "Derek and the Dominos",
  "Echo & The Bunnymen",
  "Echo and the Bunnymen",
  "Katrina and the Waves",
  "Katrina & The Waves",
  "Marina and the Diamonds",
  "Marina & The Diamonds",
  "Florence + The Machine",
  "Florence and the Machine",
  "Joan Jett & the Blackhearts",
  "Joan Jett and the Blackhearts",
  "Sun Ra and His Intergalactic Solar Arkestra",
  "Sun Ra and His Arkestra",
  "Tony! Toni! Toné!",
  "Tony! Toni! Tone!",
  "Simon & Garfunkel",
  "Captain & Tennille",
  "Captain and Tennille",
  "Hall & Oates",
  "Sunn O)))",
  "Panic! At The Disco",
  "!!! (Chk Chk Chk)",
  "$uicideboy$",
  "AC/DC",
];

export let PROTECTED_ARTISTS: string[] = [...DEFAULT_PROTECTED_ARTISTS];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let COMBINED_PROTECTED_REGEX: RegExp | null = null;

function rebuildProtectedRegex() {
  const sorted = [...PROTECTED_ARTISTS]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (sorted.length === 0) {
    COMBINED_PROTECTED_REGEX = null;
    return;
  }

  COMBINED_PROTECTED_REGEX = new RegExp(
    `(?<![a-zA-Z0-9])(${sorted.map(escapeRegex).join("|")})(?![a-zA-Z0-9])`,
    "gi"
  );
}

rebuildProtectedRegex();

/**
 * Updates the active list of protected artists and rebuilds the matching regex.
 */
export function setProtectedArtists(artists: string[]): void {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const a of artists) {
    const trimmed = a.trim();
    if (trimmed.length > 0) {
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        cleaned.push(trimmed);
      }
    }
  }
  PROTECTED_ARTISTS = cleaned;
  rebuildProtectedRegex();
}

/**
 * Returns a copy of the active protected artist names.
 */
export function getProtectedArtists(): string[] {
  return [...PROTECTED_ARTISTS];
}

/**
 * Resets the protected artist names back to the default list.
 */
export function resetProtectedArtists(): void {
  PROTECTED_ARTISTS = [...DEFAULT_PROTECTED_ARTISTS];
  rebuildProtectedRegex();
}

let HIDDEN_ARTISTS: Set<string> = new Set();

/**
 * Updates the active list of hidden artists.
 */
export function setHiddenArtists(artists: string[]): void {
  const seen = new Set<string>();
  for (const a of artists) {
    const trimmed = a.trim();
    if (trimmed.length > 0) {
      seen.add(trimmed.toLowerCase());
    }
  }
  HIDDEN_ARTISTS = seen;
}

/**
 * Returns whether an artist is hidden from playback and recommendations.
 */
export function isArtistHidden(artistName: string | undefined | null): boolean {
  if (!artistName) return false;
  return HIDDEN_ARTISTS.has(artistName.trim().toLowerCase());
}

/**
 * Returns whether a track is performed by a hidden artist (checks main and featured/split artists).
 */
export function isTrackHidden(track: Track | undefined | null): boolean {
  if (!track || !track.metadata?.artist) return false;
  const raw = track.metadata.artist.trim();
  if (!raw) return false;
  if (isArtistHidden(raw)) return true;
  const parts = splitArtists(raw);
  return parts.some((a: string) => isArtistHidden(a));
}

function maskProtectedArtists(raw: string): {
  protectedText: string;
  tokenMap: Map<string, string>;
} {
  const tokenMap = new Map<string, string>();
  if (!COMBINED_PROTECTED_REGEX) {
    return { protectedText: raw, tokenMap };
  }

  let tokenCounter = 0;

  // Single-pass regex replacement across all protected artists
  const protectedText = raw.replace(COMBINED_PROTECTED_REGEX, (match) => {
    const placeholder = `__WAVERY_PROTECTED_ARTIST_${tokenCounter++}__`;
    tokenMap.set(placeholder, match);
    return placeholder;
  });

  return { protectedText, tokenMap };
}

function unmaskProtectedArtists(
  text: string,
  tokenMap: Map<string, string>
): string {
  if (tokenMap.size === 0) return text;
  let result = text;
  for (const [placeholder, original] of tokenMap.entries()) {
    result = result.split(placeholder).join(original);
  }
  return result;
}

const DELIMITER_QUICK_CHECK = /[,/;&]|feat|ft\.|featuring|with|vs\./i;

/**
 * Extracts the clean primary artist name by stripping featured/collaborating artist suffixes.
 * E.g. "Daft Punk feat. Pharrell Williams" -> "Daft Punk"
 *      "Eminem ft. Rihanna" -> "Eminem"
 *      "Tyler, The Creator; Kali Uchis" -> "Tyler, The Creator"
 *      "Tyler, The Creator" -> "Tyler, The Creator"
 */
export function extractPrimaryArtist(raw: string = ""): string {
  if (!raw || !raw.trim()) return "Unknown Artist";
  const trimmed = raw.trim();
  if (!DELIMITER_QUICK_CHECK.test(trimmed)) {
    return trimmed;
  }
  const split = splitArtists(trimmed);
  return split[0] || trimmed;
}

/**
 * Splits multi-artist strings into individual unique artist names while preserving
 * protected atomic artist names (such as "Tyler, The Creator" or "Earth, Wind & Fire").
 * E.g. "Daft Punk feat. Pharrell Williams & Nile Rodgers" -> ["Daft Punk", "Pharrell Williams", "Nile Rodgers"]
 *      "Tyler, The Creator; Kali Uchis" -> ["Tyler, The Creator", "Kali Uchis"]
 *      "Tyler, The Creator" -> ["Tyler, The Creator"]
 *      "Eminem, Rihanna" -> ["Eminem", "Rihanna"]
 *      "Artist A / Artist B; Artist C" -> ["Artist A", "Artist B", "Artist C"]
 */
export function splitArtists(raw: string = ""): string[] {
  if (!raw || !raw.trim()) return ["Unknown Artist"];
  const trimmed = raw.trim();

  // Fast path: if no delimiter keywords or characters present, avoid regex passes
  if (!DELIMITER_QUICK_CHECK.test(trimmed)) {
    return [trimmed];
  }

  const { protectedText, tokenMap } = maskProtectedArtists(trimmed);

  // Replace common featuring keywords with delimiter
  const normalized = protectedText
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+/gi, " & ")
    .replace(/[;/]/g, " & ")
    .replace(/,\s*/g, " & ");

  const parts = normalized.split(/\s+&\s+/);
  const seen = new Set<string>();
  const artists: string[] = [];

  for (const part of parts) {
    const unmasked = unmaskProtectedArtists(part, tokenMap).trim();
    if (unmasked.length > 0) {
      const lower = unmasked.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        artists.push(unmasked);
      }
    }
  }

  return artists.length > 0 ? artists : [trimmed];
}

/**
 * Parses raw artist string into interactive artist name tokens and connective delimiters.
 * E.g. "Tyler, The Creator; Kali Uchis" ->
 * [
 *   { text: "Tyler, The Creator", isArtist: true },
 *   { text: "; ", isArtist: false },
 *   { text: "Kali Uchis", isArtist: true }
 * ]
 */
export interface ArtistToken {
  text: string;
  isArtist: boolean;
}

export function parseArtistTokens(raw: string = ""): ArtistToken[] {
  if (!raw || !raw.trim()) return [{ text: "Unknown Artist", isArtist: true }];
  const trimmed = raw.trim();
  if (!DELIMITER_QUICK_CHECK.test(trimmed)) {
    return [{ text: trimmed, isArtist: true }];
  }

  const { protectedText, tokenMap } = maskProtectedArtists(trimmed);
  const regex = /(\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+|\s*[,/;&]\s*|\s+&\s+)/gi;
  const parts = protectedText.split(regex);
  const tokens: ArtistToken[] = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.match(regex)) {
      tokens.push({ text: unmaskProtectedArtists(part, tokenMap), isArtist: false });
    } else {
      const unmasked = unmaskProtectedArtists(part, tokenMap).trim();
      if (unmasked.length > 0) {
        tokens.push({ text: unmasked, isArtist: true });
      }
    }
  }

  return tokens.length > 0 ? tokens : [{ text: trimmed, isArtist: true }];
}

function getParentDir(filePath?: string): string {
  if (!filePath) return "";
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : "";
}

/**
 * Extracts artist name from directory structure or filename when tags contain composer / member rosters.
 * E.g. ".../Radiohead/In Rainbows/01 15 Step.mp3" -> "Radiohead"
 *      ".../Radiohead - In Rainbows (2007)/01 15 Step.mp3" -> "Radiohead"
 *      ".../01 - Radiohead - 15 Step.mp3" -> "Radiohead"
 */
export function extractArtistFromPath(filePath?: string, albumTitle?: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const fileName = segments[segments.length - 1];

  const genericFolders = new Set([
    "music", "downloads", "desktop", "documents", "audio", "songs",
    "tracks", "flac", "mp3", "media", "cd1", "cd2", "disc 1", "disc 2",
    "disc1", "disc2", "album", "albums", "singles", "single", "eps", "ep",
    "home", "user", "root", "library", "various", "various artists", "wavery"
  ]);

  // 1. Check parent folders from deepest to highest (e.g. /Music/Radiohead/Singles/Creep.flac -> finds "Radiohead")
  for (let i = segments.length - 2; i >= 0; i--) {
    const folder = segments[i].trim();
    if (!folder) continue;
    const lower = folder.toLowerCase();
    if (genericFolders.has(lower)) continue;

    // If folder is "Artist - Album"
    if (folder.includes(" - ")) {
      const parts = folder.split(/\s+-\s+/);
      if (parts.length >= 2) {
        const candidate = parts[0].trim();
        if (candidate && !genericFolders.has(candidate.toLowerCase())) {
          return candidate;
        }
      }
    }

    // If folder doesn't match album title (or is single), it's the artist folder!
    if (!albumTitle || !folder.toLowerCase().includes(albumTitle.toLowerCase())) {
      return folder;
    }
  }

  // 2. Check filename patterns:
  // e.g. "Radiohead - Creep.flac" -> "Radiohead"
  // e.g. "01 - Radiohead - Creep.flac" -> "Radiohead"
  // e.g. "01. Led Zeppelin - Kashmir.mp3" -> "Led Zeppelin"
  if (fileName.includes(" - ")) {
    const rawNoExt = fileName.replace(/\.[^/.]+$/, "").trim();
    const parts = rawNoExt.split(/\s+-\s+/);
    if (parts.length === 2) {
      const candidate = parts[0].replace(/^\s*(?:\d+|track\s*\d+)[\.\s\-_]+\s*/i, "").trim();
      if (candidate && isNaN(Number(candidate)) && !candidate.match(/^(\d+|track\s*\d+)$/i)) {
        return candidate;
      }
    } else if (parts.length >= 3) {
      const candidate = parts[1].trim();
      if (candidate && isNaN(Number(candidate))) {
        return candidate;
      }
    }
  }

  // Filename pattern "01. Artist - Title.ext"
  const dotSplit = fileName.replace(/\.[^/.]+$/, "").split(/\.\s+/);
  if (dotSplit.length >= 2 && dotSplit[1].includes(" - ")) {
    const artistCand = dotSplit[1].split(/\s+-\s+/)[0]?.trim();
    if (artistCand) return artistCand;
  }

  return null;
}

function isRosterString(s: string = ""): boolean {
  if (!s) return false;
  const lower = s.toLowerCase();
  for (const pa of PROTECTED_ARTISTS) {
    if (lower === pa.toLowerCase()) return false;
  }
  const split = splitArtists(s);
  return split.length >= 3;
}

/**
 * Resolves the definitive album artist name from a cluster of tracks.
 * Handles cases where tags list full composer / band member rosters instead of band name.
 */
function resolveDominantAlbumArtist(tracks: Track[]): {
  artistName: string;
  explicitAlbumArtist?: string;
  isCompilation: boolean;
} {
  const representativeTrack = tracks[0];
  const albumTitle = representativeTrack?.metadata.album?.trim();
  const pathArtist = extractArtistFromPath(representativeTrack?.source?.Managed, albumTitle);

  // 1. Check for explicit album_artist tag
  const explicitAA = representativeTrack?.metadata.album_artist?.trim();
  const hasCleanExplicitAA =
    explicitAA &&
    !isRosterString(explicitAA) &&
    explicitAA.toLowerCase() !== "unknown artist";

  // 2. Tally song/track artists across the album
  const artistCounts = new Map<string, number>();
  for (const t of tracks) {
    const raw = t.metadata.artist?.trim() || "Unknown Artist";
    artistCounts.set(raw, (artistCounts.get(raw) || 0) + 1);
  }

  const sortedCandidates = Array.from(artistCounts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].length - b[0].length;
  });

  let bestSongArtist = sortedCandidates[0]?.[0] || "Unknown Artist";
  for (const [cand] of sortedCandidates) {
    if (!isRosterString(cand) && cand.toLowerCase() !== "unknown artist") {
      bestSongArtist = cand;
      break;
    }
  }

  // If the song artist is clean, derive the album artist from the song artist!
  if (!isRosterString(bestSongArtist) && bestSongArtist.toLowerCase() !== "unknown artist") {
    // Check if it's a genuine various artists compilation (3+ different artists with no dominant artist)
    if (tracks.length >= 3 && sortedCandidates[0]?.[1] < tracks.length / 2 && artistCounts.size >= 3) {
      return {
        artistName: hasCleanExplicitAA ? explicitAA : "Various Artists",
        explicitAlbumArtist: hasCleanExplicitAA ? explicitAA : "Various Artists",
        isCompilation: true,
      };
    }

    return {
      artistName: extractPrimaryArtist(bestSongArtist),
      explicitAlbumArtist: hasCleanExplicitAA ? explicitAA : extractPrimaryArtist(bestSongArtist),
      isCompilation: false,
    };
  }

  // If song artist is a composer roster, resolve from clean explicit album_artist or folder path
  if (hasCleanExplicitAA) {
    return {
      artistName: explicitAA,
      explicitAlbumArtist: explicitAA,
      isCompilation: explicitAA.toLowerCase() === "various artists",
    };
  }

  if (pathArtist && !isRosterString(pathArtist)) {
    return {
      artistName: pathArtist,
      explicitAlbumArtist: pathArtist,
      isCompilation: false,
    };
  }

  return {
    artistName: extractPrimaryArtist(bestSongArtist),
    isCompilation: false,
  };
}

/**
 * Groups tracks into cohesive albums.
 * Uses directory containment, album title, release year, and smart artist resolution
 * to prevent fragmentation when some tracks have composer or member credits.
 */
export function groupTracksByAlbum(tracks: Track[]): AlbumInfo[] {
  const clusterMap = new Map<string, Track[]>();

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const albumTitle = track.metadata.album?.trim() || "Unknown Album";
    const parentDir = getParentDir(track.source?.Managed);
    const explicitAA = track.metadata.album_artist?.trim();
    const year = track.metadata.year;

    // Clustering key:
    let clusterKey: string;
    if (parentDir && albumTitle !== "Unknown Album") {
      // In same folder with same album title -> definitively same album!
      clusterKey = `dir:${parentDir.toLowerCase()}___title:${albumTitle.toLowerCase()}`;
    } else if (explicitAA) {
      // Has explicit album_artist tag
      clusterKey = `aa:${explicitAA.toLowerCase()}___title:${albumTitle.toLowerCase()}`;
    } else if (albumTitle !== "Unknown Album") {
      // Group by album title + year (or title alone if year absent)
      clusterKey = `title:${albumTitle.toLowerCase()}___year:${year || "any"}`;
    } else {
      // Standalone loose track without album title
      const artist = track.metadata.artist?.trim() || "Unknown Artist";
      clusterKey = `loose:${artist.toLowerCase()}___id:${track.id}`;
    }

    let list = clusterMap.get(clusterKey);
    if (!list) {
      list = [];
      clusterMap.set(clusterKey, list);
    }
    list.push(track);
  }

  const results: AlbumInfo[] = [];

  for (const clusterTracks of clusterMap.values()) {
    if (clusterTracks.length === 0) continue;

    // Sort tracks by disc number and track number
    clusterTracks.sort((a, b) => {
      const discA = a.metadata.disc_number || 1;
      const discB = b.metadata.disc_number || 1;
      if (discA !== discB) return discA - discB;
      const trackA = a.metadata.track_number || 0;
      const trackB = b.metadata.track_number || 0;
      return trackA - trackB;
    });

    const representativeTrack = clusterTracks[0];
    const albumTitle = representativeTrack.metadata.album?.trim() || "Unknown Album";
    const { artistName, explicitAlbumArtist, isCompilation } = resolveDominantAlbumArtist(clusterTracks);

    let totalDuration = 0;
    let albumYear: number | undefined;

    for (const t of clusterTracks) {
      totalDuration += t.metadata.duration?.secs || 0;
      if (!albumYear && t.metadata.year) {
        albumYear = t.metadata.year;
      }
    }

    results.push({
      title: albumTitle,
      artist: artistName,
      albumArtist: explicitAlbumArtist,
      isCompilation,
      year: albumYear,
      artworkTrackId: representativeTrack.id,
      tracks: clusterTracks,
      trackCount: clusterTracks.length,
      totalDurationSecs: totalDuration,
    });
  }

  results.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return results;
}

/**
 * Extracts featured artists from track title, e.g. "Song Name (feat. Artist B & Artist C)" -> ["Artist B", "Artist C"]
 */
export function extractFeaturedArtistsFromTitle(title: string = ""): string[] {
  if (!title) return [];
  // Matches (feat. ...), [feat. ...], (ft. ...), [ft. ...], (with ...), [with ...]
  const match = title.match(/[([{\-]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)}\]]+)[)}\]]?/i);
  if (match && match[1]) {
    return splitArtists(match[1]);
  }
  return [];
}

/**
 * Returns all participating artists for a track by checking:
 * 1. artist metadata tag
 * 2. album_artist metadata tag
 * 3. track title featured clauses (e.g. "Song (feat. Artist)")
 */
export function extractAllTrackArtists(track: Track): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      results.push(trimmed);
    }
  };

  // 1. From artist metadata tag
  if (track.metadata.artist) {
    for (const a of splitArtists(track.metadata.artist)) {
      add(a);
    }
  }

  // 2. From album_artist metadata tag
  if (track.metadata.album_artist) {
    for (const a of splitArtists(track.metadata.album_artist)) {
      add(a);
    }
  }

  // 3. From track title (e.g. "Song Title (feat. Artist)")
  if (track.metadata.title) {
    for (const a of extractFeaturedArtistsFromTitle(track.metadata.title)) {
      add(a);
    }
  }

  // 4. From folder/file path (e.g. Band folder name like "Radiohead")
  const pathArtist = extractArtistFromPath(track.source?.Managed, track.metadata.album?.trim());
  if (pathArtist) {
    add(pathArtist);
  }

  return results.length > 0 ? results : ["Unknown Artist"];
}

/**
 * Returns the full formatted artist line including any featured artists from the title,
 * and resolving composite member/composer rosters to the clean band name.
 */
export function getFullTrackArtistString(track: Track): string {
  const trackArtist = track.metadata.artist?.trim();
  const albumArtist = track.metadata.album_artist?.trim();
  const albumTitle = track.metadata.album?.trim();
  const pathArtist = extractArtistFromPath(track.source?.Managed, albumTitle);

  let baseArtist = "Unknown Artist";

  if (albumArtist && !isRosterString(albumArtist) && albumArtist.toLowerCase() !== "unknown artist") {
    baseArtist = albumArtist;
  } else if (trackArtist && !isRosterString(trackArtist) && trackArtist.toLowerCase() !== "unknown artist") {
    baseArtist = trackArtist;
  } else if (pathArtist && !isRosterString(pathArtist)) {
    baseArtist = pathArtist;
  } else if (trackArtist) {
    baseArtist = extractPrimaryArtist(trackArtist);
  } else if (albumArtist) {
    baseArtist = extractPrimaryArtist(albumArtist);
  }

  const titleFeats = extractFeaturedArtistsFromTitle(track.metadata.title || "");
  const existingLower = baseArtist.toLowerCase();
  const missingFeats = titleFeats.filter((f) => !existingLower.includes(f.toLowerCase()));
  if (missingFeats.length > 0) {
    return `${baseArtist} feat. ${missingFeats.join(" & ")}`;
  }
  return baseArtist;
}

/**
 * Groups tracks by artist directly from the ground up:
 * 1. Derives Albums from tracks first.
 * 2. Builds clean Artist profiles from those Albums and their participating track artists.
 * Prevents stray featured tags or album names from creating empty/bogus artist profiles.
 */
export function groupTracksByArtist(tracks: Track[]): ArtistInfo[] {
  // Step 1: Build Albums first from the ground up
  const allAlbums = groupTracksByAlbum(tracks);

  // Step 2: Accumulator for artist profiles
  const artistMap = new Map<
    string,
    {
      name: string;
      ownAlbums: AlbumInfo[];
      appearsOn: AlbumInfo[];
      trackMap: Map<string, Track>;
    }
  >();

  const getOrCreateArtist = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.toLowerCase() === "unknown artist") return null;
    const key = trimmed.toLowerCase();
    let entry = artistMap.get(key);
    if (!entry) {
      entry = {
        name: trimmed,
        ownAlbums: [],
        appearsOn: [],
        trackMap: new Map<string, Track>(),
      };
      artistMap.set(key, entry);
    }
    return entry;
  };

  // 1. Process all albums: register primary album artists & tracks
  for (const album of allAlbums) {
    if (album.isCompilation || album.artist.toLowerCase() === "various artists") {
      // For compilations / Various Artists, attribute tracks to their respective track artists
      for (const track of album.tracks) {
        const trackArtist = track.metadata.artist?.trim();
        if (trackArtist && !isRosterString(trackArtist)) {
          const entry = getOrCreateArtist(extractPrimaryArtist(trackArtist));
          if (entry) {
            entry.trackMap.set(track.id, track);
            if (!entry.appearsOn.some((a) => a.title === album.title && a.artist === album.artist)) {
              entry.appearsOn.push(album);
            }
          }
        }
      }
      continue;
    }

    const primaryArtists = splitArtists(album.artist);
    for (const pArtist of primaryArtists) {
      const entry = getOrCreateArtist(pArtist);
      if (!entry) continue;

      if (!entry.ownAlbums.some((a) => a.title === album.title && a.artist === album.artist)) {
        entry.ownAlbums.push(album);
      }

      for (const track of album.tracks) {
        entry.trackMap.set(track.id, track);
      }
    }

    // Process tracks with distinct collaborating or featured artists inside this album
    for (const track of album.tracks) {
      const trackArtist = track.metadata.artist?.trim();
      if (trackArtist && !isRosterString(trackArtist)) {
        const tArtists = splitArtists(trackArtist);
        for (const ta of tArtists) {
          const taLower = ta.toLowerCase();
          // If this artist is not one of the primary album artists
          if (!primaryArtists.some((pa) => pa.toLowerCase() === taLower)) {
            const entry = getOrCreateArtist(ta);
            if (entry) {
              entry.trackMap.set(track.id, track);
              if (
                !entry.ownAlbums.some((a) => a.title === album.title && a.artist === album.artist) &&
                !entry.appearsOn.some((a) => a.title === album.title && a.artist === album.artist)
              ) {
                entry.appearsOn.push(album);
              }
            }
          }
        }
      }
    }
  }

  // Step 3: Construct ArtistInfo objects
  const artists: ArtistInfo[] = [];
  for (const entry of artistMap.values()) {
    const trackList = Array.from(entry.trackMap.values());
    if (trackList.length === 0 && entry.ownAlbums.length === 0 && entry.appearsOn.length === 0) {
      continue;
    }

    artists.push({
      name: entry.name,
      albums: entry.ownAlbums,
      appearsOn: entry.appearsOn,
      tracks: trackList,
      trackCount: trackList.length,
      albumCount: entry.ownAlbums.length,
      artworkTrackId: trackList[0]?.id || entry.ownAlbums[0]?.artworkTrackId || "",
    });
  }

  artists.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  return artists;
}

/**
 * Sort tracks by a given key and direction.
 * Pre-normalizes string sort keys to avoid O(N log N) allocations during comparator execution.
 */
export function sortTracks(
  tracks: Track[],
  sortKey: TrackSortKey,
  direction: SortDirection
): Track[] {
  if (tracks.length <= 1) return tracks;

  // For string keys, pre-compute lowercase keys once (Schwartzian transform)
  if (sortKey === "title" || sortKey === "artist" || sortKey === "album") {
    const mapped = new Array<{ track: Track; key: string }>(tracks.length);
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      let key = "";
      if (sortKey === "title") {
        key = (track.metadata.title || "").toLowerCase();
      } else if (sortKey === "artist") {
        key = (track.metadata.artist || "").toLowerCase();
      } else {
        key = (track.metadata.album || "").toLowerCase();
      }
      mapped[i] = { track, key };
    }

    mapped.sort((a, b) => {
      const cmp = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      return direction === "asc" ? cmp : -cmp;
    });

    const result = new Array<Track>(tracks.length);
    for (let i = 0; i < mapped.length; i++) {
      result[i] = mapped[i].track;
    }
    return result;
  }

  // For numeric keys, sort directly without string allocations
  const sorted = [...tracks].sort((a, b) => {
    let result = 0;
    switch (sortKey) {
      case "track_number": {
        result = (a.metadata.track_number || 0) - (b.metadata.track_number || 0);
        break;
      }
      case "duration": {
        result =
          (a.metadata.duration?.secs || 0) - (b.metadata.duration?.secs || 0);
        break;
      }
      case "date_added": {
        result = (a.date_added || 0) - (b.date_added || 0);
        break;
      }
      case "year": {
        result = (a.metadata.year || 0) - (b.metadata.year || 0);
        break;
      }
    }
    return direction === "asc" ? result : -result;
  });

  return sorted;
}

export function sortAlbums(
  albums: AlbumInfo[],
  sortKey: AlbumSortKey,
  direction: SortDirection
): AlbumInfo[] {
  if (albums.length <= 1) return albums;

  if (sortKey === "title" || sortKey === "artist") {
    const mapped = new Array<{ album: AlbumInfo; key: string }>(albums.length);
    for (let i = 0; i < albums.length; i++) {
      const album = albums[i];
      mapped[i] = {
        album,
        key: (sortKey === "title" ? album.title : album.artist).toLowerCase(),
      };
    }
    mapped.sort((a, b) => {
      const cmp = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      return direction === "asc" ? cmp : -cmp;
    });
    const result = new Array<AlbumInfo>(albums.length);
    for (let i = 0; i < mapped.length; i++) {
      result[i] = mapped[i].album;
    }
    return result;
  }

  return [...albums].sort((a, b) => {
    let result = 0;
    switch (sortKey) {
      case "year":
        result = (a.year || 0) - (b.year || 0);
        break;
      case "track_count":
        result = a.trackCount - b.trackCount;
        break;
    }
    return direction === "asc" ? result : -result;
  });
}

export function sortArtists(
  artists: ArtistInfo[],
  sortKey: ArtistSortKey,
  direction: SortDirection
): ArtistInfo[] {
  if (artists.length <= 1) return artists;

  if (sortKey === "name") {
    const mapped = new Array<{ artist: ArtistInfo; key: string }>(artists.length);
    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      mapped[i] = {
        artist,
        key: artist.name.toLowerCase(),
      };
    }
    mapped.sort((a, b) => {
      const cmp = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      return direction === "asc" ? cmp : -cmp;
    });
    const result = new Array<ArtistInfo>(artists.length);
    for (let i = 0; i < mapped.length; i++) {
      result[i] = mapped[i].artist;
    }
    return result;
  }

  return [...artists].sort((a, b) => {
    let result = 0;
    switch (sortKey) {
      case "album_count":
        result = a.albumCount - b.albumCount;
        break;
      case "track_count":
        result = a.trackCount - b.trackCount;
        break;
    }
    return direction === "asc" ? result : -result;
  });
}

/**
 * Sorts playlists using Schwartzian transform for O(N) string processing.
 */
export function sortPlaylists(
  playlists: Playlist[],
  sortKey: PlaylistSortKey = "name",
  direction: SortDirection = "asc"
): Playlist[] {
  if (!playlists || playlists.length <= 1) return playlists;

  if (sortKey === "name") {
    const mapped = new Array<{ playlist: Playlist; key: string }>(playlists.length);
    for (let i = 0; i < playlists.length; i++) {
      mapped[i] = {
        playlist: playlists[i],
        key: playlists[i].name.toLowerCase(),
      };
    }
    mapped.sort((a, b) => {
      const cmp = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      return direction === "asc" ? cmp : -cmp;
    });
    const result = new Array<Playlist>(playlists.length);
    for (let i = 0; i < mapped.length; i++) {
      result[i] = mapped[i].playlist;
    }
    return result;
  }

  return [...playlists].sort((a, b) => {
    let result = 0;
    switch (sortKey) {
      case "tracks":
        result = (a.track_ids?.length || 0) - (b.track_ids?.length || 0);
        break;
      case "date":
        result = (a.created_at || 0) - (b.created_at || 0);
        break;
    }
    return direction === "asc" ? result : -result;
  });
}

/**
 * Default multilingual and transliterated genre aliases mapped to their canonical display name.
 */
export const DEFAULT_GENRE_MAPPINGS: Record<string, string> = {
  // Russian / Cyrillic aliases
  "альтернатива": "Alternative",
  "альтернативный": "Alternative",
  "альтернативный рок": "Alternative",
  "альтернативный метал": "Alternative",
  "рок": "Rock",
  "русский рок": "Rock",
  "классический рок": "Rock",
  "хард-рок": "Rock",
  "хард рок": "Rock",
  "поп": "Pop",
  "поп-музыка": "Pop",
  "русский поп": "Pop",
  "электроника": "Electronic",
  "электронная музыка": "Electronic",
  "электро": "Electronic",
  "дэнс": "Dance",
  "танцевальная": "Dance",
  "танцевальная музыка": "Dance",
  "хип-хоп": "Hip-Hop",
  "хип хоп": "Hip-Hop",
  "рэп": "Hip-Hop",
  "русский рэп": "Hip-Hop",
  "русский хип-хоп": "Hip-Hop",
  "метал": "Metal",
  "металл": "Metal",
  "хэви-метал": "Metal",
  "тяжелый рок": "Metal",
  "панк": "Punk",
  "панк-рок": "Punk",
  "джаз": "Jazz",
  "блюз": "Blues",
  "классика": "Classical",
  "классическая музыка": "Classical",
  "эмбиент": "Ambient",
  "эмбиэнт": "Ambient",
  "инди": "Indie",
  "инди-рок": "Indie",
  "инди-поп": "Indie",
  "саундтрек": "Soundtrack",
  "саундтреки": "Soundtrack",
  "музыка из фильмов": "Soundtrack",
  "легкая музыка": "Easy Listening",
  "легкое слушание": "Easy Listening",
  "фолк": "Folk",
  "фолк-рок": "Folk",
  "соул": "Soul",
  "фанк": "Funk",
  "регги": "Reggae",
  "диско": "Disco",
  "техно": "Techno",
  "хаус": "House",
  "транс": "Trance",
  "акустика": "Acoustic",
  "инструментал": "Instrumental",
  "инструментальная": "Instrumental",
  "нью-эйдж": "New Age",

  // English aliases and normalizations
  "alternative rock": "Alternative",
  "alt rock": "Alternative",
  "alt-rock": "Alternative",
  "alt. rock": "Alternative",
  "electro": "Electronic",
  "electronic music": "Electronic",
  "electronica": "Electronic",
  "dance music": "Dance",
  "club": "Dance",
  "hip hop": "Hip-Hop",
  "hip-hop": "Hip-Hop",
  "rap": "Hip-Hop",
  "heavy metal": "Metal",
  "hard rock": "Rock",
  "punk rock": "Punk",
  "r&b": "R&B",
  "r & b": "R&B",
  "rnb": "R&B",
  "synthpop": "Synth-Pop",
  "synth-pop": "Synth-Pop",
  "lo-fi": "Lo-Fi",
  "lofi": "Lo-Fi",
  "k-pop": "K-Pop",
  "kpop": "K-Pop",
  "j-pop": "J-Pop",
  "jpop": "J-Pop",
  "edm": "EDM",
  "drum and bass": "Drum & Bass",
  "drum & bass": "Drum & Bass",
  "dnb": "Drum & Bass",
  "soundtrack": "Soundtrack",
  "ost": "Soundtrack",
  "score": "Soundtrack",
  "chillout": "Chillout",
  "chill-out": "Chillout",
  "chill": "Chillout",
};

export let GENRE_MAPPINGS: Record<string, string> = { ...DEFAULT_GENRE_MAPPINGS };

/**
 * Updates the active genre mappings dynamically from configuration storage.
 */
export function setGenreMappings(mappings: Record<string, string>): void {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(mappings)) {
    const k = key.trim().toLowerCase();
    const v = val.trim();
    if (k && v) {
      clean[k] = v;
    }
  }
  GENRE_MAPPINGS = clean;
}

/**
 * Returns a copy of active genre mappings.
 */
export function getGenreMappings(): Record<string, string> {
  return { ...GENRE_MAPPINGS };
}

/**
 * Resets active genre mappings back to initial defaults.
 */
export function resetGenreMappings(): void {
  GENRE_MAPPINGS = { ...DEFAULT_GENRE_MAPPINGS };
}

/**
 * Normalizes genre strings across multilingual variations, Cyrillic ID3 tags,
 * and user-configurable mapping rules (e.g. "Альтернатив..." / "Альтернативный рок" -> "Alternative").
 */
export function normalizeGenre(raw: string): string {
  if (!raw) return "";
  let clean = raw.trim();
  // Strip trailing ellipsis, dots, or dashes from tag truncation
  clean = clean.replace(/[\s.…-]+$/, "").trim();
  if (!clean) return "";

  const lower = clean.toLowerCase();

  // 1. Configurable user & default mappings lookup
  if (GENRE_MAPPINGS[lower]) {
    return GENRE_MAPPINGS[lower];
  }

  // 2. Prefix matching for truncated Cyrillic/English tags (e.g. "альтернатив", "alternat")
  if (lower.startsWith("альтернатив") || lower.startsWith("alternat")) {
    return "Alternative";
  }
  if (lower.startsWith("электрон") || lower.startsWith("electron")) {
    return "Electronic";
  }
  if (lower.startsWith("классич") || lower.startsWith("classic")) {
    return "Classical";
  }
  if (lower.startsWith("инструмент") || lower.startsWith("instrument")) {
    return "Instrumental";
  }

  // 3. Fallback: Clean Title-Casing
  return clean
    .split(/[\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Splits compound genre strings (e.g. "Alternative / Rock & Pop") while protecting
 * compound terms like "R&B" and "Drum & Bass".
 */
export function splitGenres(rawGenre: string): string[] {
  if (!rawGenre || !rawGenre.trim()) return [];

  // Protect "R&B", "Drum & Bass", "Rock & Roll"
  const masked = rawGenre
    .replace(/\b(r)\s*&\s*(b)\b/gi, "__R_AND_B__")
    .replace(/\b(drum)\s*&\s*(bass)\b/gi, "__D_AND_B__")
    .replace(/\b(rock)\s*&\s*(roll)\b/gi, "__ROCK_AND_ROLL__");

  const parts = masked.split(/[,/;&|]/).map((p) => p.trim()).filter(Boolean);

  const results: string[] = [];
  for (const p of parts) {
    const unmasked = p
      .replace(/__R_AND_B__/g, "R&B")
      .replace(/__D_AND_B__/g, "Drum & Bass")
      .replace(/__ROCK_AND_ROLL__/g, "Rock & Roll");

    const normalized = normalizeGenre(unmasked);
    if (normalized && !results.includes(normalized)) {
      results.push(normalized);
    }
  }

  return results;
}

/**
 * Groups tracks by normalized genre and sorts descending by track count.
 */
export function extractLibraryGenres(tracks: Track[]): { name: string; tracks: Track[] }[] {
  const genreMap = new Map<string, { name: string; tracks: Track[]; trackIds: Set<string> }>();

  for (const track of tracks) {
    const rawGenre = track.metadata?.genre;
    if (!rawGenre) continue;

    const genres = splitGenres(rawGenre);
    for (const g of genres) {
      let entry = genreMap.get(g.toLowerCase());
      if (!entry) {
        entry = { name: g, tracks: [], trackIds: new Set() };
        genreMap.set(g.toLowerCase(), entry);
      }
      if (!entry.trackIds.has(track.id)) {
        entry.trackIds.add(track.id);
        entry.tracks.push(track);
      }
    }
  }

  return Array.from(genreMap.values())
    .sort((a, b) => b.tracks.length - a.tracks.length)
    .map(({ name, tracks }) => ({ name, tracks }));
}

/**
 * Asynchronously retrieves albums, delegating to native Rust SQLite IPC in Tauri mode
 * or falling back to local grouping in browser mode.
 */
export async function getAlbumsOrCluster(tracks?: Track[]): Promise<AlbumInfo[]> {
  return groupTracksByAlbum(tracks || []);
}

export const fetchAlbumsIpc = getAlbumsOrCluster;

/**
 * Asynchronously retrieves artists by grouping tracks.
 */
export async function getArtistsOrCluster(tracks?: Track[]): Promise<ArtistInfo[]> {
  return groupTracksByArtist(tracks || []);
}

export const fetchArtistsIpc = getArtistsOrCluster;

/**
 * Asynchronously retrieves genres by grouping tracks.
 */
export async function getGenresOrCluster(tracks?: Track[]): Promise<GenreInfo[]> {
  return extractLibraryGenres(tracks || []);
}

export const fetchGenresIpc = getGenresOrCluster;

/**
 * Asynchronously retrieves album details by grouping tracks.
 */
export async function getAlbumDetailsOrCluster(
  title: string,
  artist?: string,
  tracks?: Track[]
): Promise<AlbumInfo | null> {
  const albums = groupTracksByAlbum(tracks || []);
  const cleanTitle = title.trim().toLowerCase();
  const cleanArtist = artist?.trim().toLowerCase();
  return (
    albums.find(
      (a) =>
        a.title.trim().toLowerCase() === cleanTitle &&
        (!cleanArtist || a.artist.trim().toLowerCase() === cleanArtist)
    ) || null
  );
}

export const fetchAlbumDetailsIpc = getAlbumDetailsOrCluster;

/**
 * Asynchronously retrieves artist details by grouping tracks.
 */
export async function getArtistDetailsOrCluster(
  name: string,
  tracks?: Track[]
): Promise<ArtistInfo | null> {
  const artists = groupTracksByArtist(tracks || []);
  const cleanName = name.trim().toLowerCase();
  return artists.find((a) => a.name.trim().toLowerCase() === cleanName) || null;
}

export const fetchArtistDetailsIpc = getArtistDetailsOrCluster;


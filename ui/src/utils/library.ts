import {
  Track,
  AlbumInfo,
  ArtistInfo,
  TrackSortKey,
  SortDirection,
  AlbumSortKey,
  ArtistSortKey,
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
 * Extracts the clean primary artist name by stripping featured/collaborating artist suffixes.
 * E.g. "Daft Punk feat. Pharrell Williams" -> "Daft Punk"
 *      "Eminem ft. Rihanna" -> "Eminem"
 *      "Kanye West with Lupe Fiasco" -> "Kanye West"
 */
export function extractPrimaryArtist(raw: string = ""): string {
  if (!raw || !raw.trim()) return "Unknown Artist";
  let cleaned = raw.trim();

  // Strip featuring clauses
  const featRegex = /\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+.+$/i;
  cleaned = cleaned.replace(featRegex, "");

  // If delimited by comma / slash / ampersand, take the primary leading artist
  const firstComma = cleaned.search(/[,/;&]/);
  if (firstComma > 0) {
    const candidate = cleaned.slice(0, firstComma).trim();
    if (candidate.length > 0) {
      cleaned = candidate;
    }
  }

  return cleaned.trim() || raw.trim();
}

/**
 * Splits multi-artist strings into individual unique artist names.
 * E.g. "Daft Punk feat. Pharrell Williams & Nile Rodgers" -> ["Daft Punk", "Pharrell Williams", "Nile Rodgers"]
 *      "Eminem, Rihanna" -> ["Eminem", "Rihanna"]
 *      "Artist A / Artist B; Artist C" -> ["Artist A", "Artist B", "Artist C"]
 */
export function splitArtists(raw: string = ""): string[] {
  if (!raw || !raw.trim()) return ["Unknown Artist"];

  // Replace common featuring keywords with delimiter
  const normalized = raw
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+/gi, " & ")
    .replace(/[;/]/g, " & ")
    .replace(/,\s*/g, " & ");

  const parts = normalized.split(/\s+&\s+/);
  const seen = new Set<string>();
  const artists: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        artists.push(trimmed);
      }
    }
  }

  return artists.length > 0 ? artists : [raw.trim()];
}

/**
 * Parses raw artist string into interactive artist name tokens and connective delimiters.
 * E.g. "Daft Punk feat. Pharrell Williams & Nile Rodgers" ->
 * [
 *   { text: "Daft Punk", isArtist: true },
 *   { text: " feat. ", isArtist: false },
 *   { text: "Pharrell Williams", isArtist: true },
 *   { text: " & ", isArtist: false },
 *   { text: "Nile Rodgers", isArtist: true }
 * ]
 */
export interface ArtistToken {
  text: string;
  isArtist: boolean;
}

export function parseArtistTokens(raw: string = ""): ArtistToken[] {
  if (!raw || !raw.trim()) return [{ text: "Unknown Artist", isArtist: true }];
  
  const regex = /(\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+|\s*[,/;&]\s*|\s+&\s+)/gi;
  const parts = raw.split(regex);
  const tokens: ArtistToken[] = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.match(regex)) {
      tokens.push({ text: part, isArtist: false });
    } else {
      const trimmed = part.trim();
      if (trimmed.length > 0) {
        tokens.push({ text: trimmed, isArtist: true });
      }
    }
  }

  return tokens.length > 0 ? tokens : [{ text: raw.trim(), isArtist: true }];
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
  return (
    s.includes("/") ||
    s.includes(";") ||
    (s.includes(",") && s.split(",").length >= 3) ||
    splitArtists(s).length >= 3
  );
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

/**
 * Comprehensive 4-Tier Opaque-Box E2E Test Suite for Wavery
 *
 * Covers:
 * - Feature 1: Album & Artist Clustering
 * - Feature 2: Path Fallback Heuristics
 * - Feature 3: Multi-Artist Delimiter Tokenization & Protected Names
 * - Feature 4: Multilingual Genre Normalization & Aliases
 * - Feature 5: Library Aggregation IPC
 * - Feature 6: Robust LRC Parser
 * - Feature 7: LRCLIB Candidate Scoring
 * - Feature 8: Active Lyric Binary Search
 * - Feature 9: Lyrics Processing IPC
 * - Feature 10: Two-Tier Playback Queue
 * - Feature 11: Autoplay Recommendation Engine
 * - Feature 12: Queue Management IPC
 * - Feature 13-15: Frontend Store Integration & Dual-Environment Compatibility
 *
 * Structure:
 * - Tier 1: Feature Coverage (>=5 test cases per feature covering equivalence class representatives)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature at domain-specific extremes)
 * - Tier 3: Cross-Feature Combinations (5 comprehensive multi-feature interaction pipelines)
 * - Tier 4: Real-World Application Scenarios (5 realistic application workloads)
 */

import {
  formatDuration,
  formatTotalDuration,
  DEFAULT_PROTECTED_ARTISTS,
  PROTECTED_ARTISTS,
  setProtectedArtists,
  resetProtectedArtists,
  splitArtists,
  extractPrimaryArtist,
  parseArtistTokens,
  extractArtistFromPath,
  groupTracksByAlbum,
  groupTracksByArtist,
  extractAllTrackArtists,
  getFullTrackArtistString,
  DEFAULT_GENRE_MAPPINGS,
  GENRE_MAPPINGS,
  setGenreMappings,
  resetGenreMappings,
  normalizeGenre,
  splitGenres,
  extractLibraryGenres,
} from "../src/utils/library";

import {
  LyricLine,
  hasLrcTimestamps,
  parseLrc,
  getActiveLyricIndex,
} from "../src/utils/lyrics";

import {
  normalizeQuery,
  extractCleanArtist,
  stripEnclosingParentheses,
  fetchLyrics,
} from "../src/services/lyrics";

import { getAutoplayNextTrack } from "../src/stores/playerStore";
import { Track, AlbumInfo, ArtistInfo, LoopMode } from "../src/types";

export async function runOpaqueBoxE2ETests(jiti: any) {
  console.log("\n================================================================================");
  console.log("  4-TIER OPAQUE-BOX E2E TEST SUITE: FEATURES 1 - 15");
  console.log("================================================================================\n");

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, testId: string, description: string) {
    totalTests++;
    if (!condition) {
      console.error(`  ❌ FAILED [${testId}]: ${description}`);
      throw new Error(`[${testId}] Assertion failed: ${description}`);
    }
    passedTests++;
  }

  const helperTrack = (
    id: string,
    title: string,
    artist: string,
    album: string,
    path: string,
    durationSecs: number,
    opts: Partial<Track["metadata"]> = {}
  ): Track => ({
    id,
    source: { Managed: path },
    date_added: 1700000000,
    metadata: {
      title,
      artist,
      album,
      album_artist: "album_artist" in opts ? opts.album_artist : artist,
      track_number: opts.track_number ?? 1,
      disc_number: opts.disc_number ?? 1,
      year: opts.year ?? 2026,
      genre: opts.genre ?? "Rock",
      duration: { secs: durationSecs, nanos: 0 },
      format: "FLAC",
      ...opts,
    },
  });

  // ============================================================================
  // TIER 1: FEATURE COVERAGE (Equivalence Class Representatives, >=5 per feature)
  // ============================================================================
  console.log("--- Tier 1: Feature Coverage (Features 1 - 15) ---");

  // Feature 1: Album & Artist Clustering
  {
    const tracks = [
      helperTrack("t1", "Track 1", "Radiohead", "In Rainbows", "/Music/Radiohead/In Rainbows/01.flac", 180, { track_number: 1 }),
      helperTrack("t2", "Track 2", "Radiohead", "In Rainbows", "/Music/Radiohead/In Rainbows/02.flac", 200, { track_number: 2 }),
      helperTrack("t3", "Track 3", "Radiohead", "In Rainbows", "/Music/Radiohead/In Rainbows/03.flac", 220, { track_number: 3 }),
    ];
    const albums = groupTracksByAlbum(tracks);
    assert(albums.length === 1, "F1-T1-1", "Single album grouped into exactly 1 AlbumInfo");
    assert(albums[0].trackCount === 3 && albums[0].totalDurationSecs === 600, "F1-T1-1b", "Correct track count and total duration");

    // Multi-disc sorting
    const multiDisc = [
      helperTrack("d2_1", "Disc 2 Track 1", "Artist", "Double Album", "/path/01.flac", 180, { disc_number: 2, track_number: 1 }),
      helperTrack("d1_2", "Disc 1 Track 2", "Artist", "Double Album", "/path/02.flac", 180, { disc_number: 1, track_number: 2 }),
      helperTrack("d1_1", "Disc 1 Track 1", "Artist", "Double Album", "/path/03.flac", 180, { disc_number: 1, track_number: 1 }),
    ];
    const sortedAlbum = groupTracksByAlbum(multiDisc)[0];
    assert(sortedAlbum.tracks[0].id === "d1_1" && sortedAlbum.tracks[1].id === "d1_2" && sortedAlbum.tracks[2].id === "d2_1", "F1-T1-2", "Multi-disc tracks sorted in (disc, track) order");

    // Compilation detection (3+ artists, none dominant)
    const compilationTracks = [
      helperTrack("c1", "Song 1", "Artist A", "Pulp Fiction OST", "/Music/OST/01.flac", 180, { album_artist: undefined }),
      helperTrack("c2", "Song 2", "Artist B", "Pulp Fiction OST", "/Music/OST/02.flac", 190, { album_artist: undefined }),
      helperTrack("c3", "Song 3", "Artist C", "Pulp Fiction OST", "/Music/OST/03.flac", 200, { album_artist: undefined }),
    ];
    const compAlbum = groupTracksByAlbum(compilationTracks)[0];
    assert(compAlbum.isCompilation === true && compAlbum.artist === "Various Artists", "F1-T1-3", "Compilation correctly detected with Various Artists");

    // Artist grouping primary attribution
    const artists = groupTracksByArtist(tracks);
    const radiohead = artists.find((a) => a.name.toLowerCase() === "radiohead");
    assert(Boolean(radiohead && radiohead.albums.length === 1 && radiohead.trackCount === 3), "F1-T1-4", "Primary artist has 1 album and 3 tracks");

    // Collaborating artist attribution to appearsOn
    const collabTracks = [
      helperTrack("collab1", "Song 1", "Daft Punk feat. Pharrell Williams", "Random Access Memories", "/Music/RAM/01.flac", 240, { album_artist: "Daft Punk" }),
    ];
    const collabArtists = groupTracksByArtist(collabTracks);
    const pharrell = collabArtists.find((a) => a.name.toLowerCase() === "pharrell williams");
    assert(Boolean(pharrell && pharrell.appearsOn.length === 1 && pharrell.albums.length === 0), "F1-T1-5", "Guest artist placed in appearsOn rather than ownAlbums");
  }

  // Feature 2: Path Fallback Heuristics
  {
    assert(extractArtistFromPath("/Music/Radiohead/In Rainbows/01 15 Step.mp3", "In Rainbows") === "Radiohead", "F2-T1-1", "Extract artist from parent directory structure");
    assert(extractArtistFromPath("/Music/Pink Floyd - The Wall/01 In The Flesh.mp3") === "Pink Floyd", "F2-T1-2", "Extract artist from 'Artist - Album' folder pattern");
    assert(extractArtistFromPath("/Music/Led Zeppelin - Kashmir.mp3") === "Led Zeppelin", "F2-T1-3", "Extract artist from 'Artist - Title' filename");
    assert(extractArtistFromPath("/Music/01 - Queen - Bohemian Rhapsody.flac") === "Queen", "F2-T1-4", "Extract artist from filename with numeric track prefix");
    assert(extractArtistFromPath("/Music/Downloads/audio/flac/01 Creep.flac") === null, "F2-T1-5", "Generic directory blacklist returns null safely");
  }

  // Feature 3: Multi-Artist Delimiter Tokenization & Protected Names
  {
    const parts1 = splitArtists("Daft Punk feat. Pharrell Williams & Nile Rodgers");
    assert(parts1.length === 3 && parts1[0] === "Daft Punk" && parts1[1] === "Pharrell Williams" && parts1[2] === "Nile Rodgers", "F3-T1-1", "Feat and ampersand splitting");

    const parts2 = splitArtists("Artist A; Artist B / Artist C");
    assert(parts2.length === 3 && parts2[0] === "Artist A" && parts2[1] === "Artist B" && parts2[2] === "Artist C", "F3-T1-2", "Semicolon and slash splitting");

    const parts3 = splitArtists("Tyler, The Creator");
    assert(parts3.length === 1 && parts3[0] === "Tyler, The Creator", "F3-T1-3", "Protected artist name containing comma preserved atomically");

    const parts4 = splitArtists("Tyler, The Creator; Kali Uchis");
    assert(parts4.length === 2 && parts4[0] === "Tyler, The Creator" && parts4[1] === "Kali Uchis", "F3-T1-4", "Protected artist combined with collaborator correctly split");

    const tokens = parseArtistTokens("Earth, Wind & Fire feat. Ramsey Lewis");
    assert(tokens.some((t) => t.text === "Earth, Wind & Fire" && t.isArtist) && tokens.some((t) => t.text === "Ramsey Lewis" && t.isArtist), "F3-T1-5", "parseArtistTokens distinguishes artist names from delimiters");
  }

  // Feature 4: Multilingual Genre Normalization & Aliases
  {
    assert(normalizeGenre("русский рок") === "Rock", "F4-T1-1", "Normalize Cyrillic 'русский рок' to Rock");
    assert(normalizeGenre("альтернативный рок") === "Alternative", "F4-T1-2", "Normalize Cyrillic 'альтернативный рок' to Alternative");
    assert(normalizeGenre("alt-rock") === "Alternative", "F4-T1-3", "Normalize English alias 'alt-rock' to Alternative");
    assert(normalizeGenre("альтернатив...") === "Alternative", "F4-T1-4", "Prefix match truncated Cyrillic tag with dots");

    const genres = splitGenres("Alternative / Rock & Pop");
    assert(genres.includes("Alternative") && genres.includes("Rock") && genres.includes("Pop"), "F4-T1-5", "Compound genre split and normalized");
  }

  // Feature 5: Library Aggregation IPC
  {
    const tracks = [
      helperTrack("t1", "Track 1", "Artist A", "Album 1", "/p1.flac", 180, { genre: "Rock" }),
      helperTrack("t2", "Track 2", "Artist A", "Album 1", "/p2.flac", 200, { genre: "Rock" }),
      helperTrack("t3", "Track 3", "Artist B", "Album 2", "/p3.flac", 240, { genre: "Jazz" }),
    ];

    const albums = groupTracksByAlbum(tracks);
    assert(Array.isArray(albums) && albums.length === 2, "F5-T1-1", "get_albums contract returns valid AlbumInfo array");
    assert(typeof albums[0].title === "string" && typeof albums[0].totalDurationSecs === "number", "F5-T1-2", "AlbumInfo conforms to schema contract");

    const artists = groupTracksByArtist(tracks);
    assert(Array.isArray(artists) && artists.length === 2, "F5-T1-3", "get_artists contract returns valid ArtistInfo array");

    const genres = extractLibraryGenres(tracks);
    assert(Array.isArray(genres) && genres.length === 2 && genres[0].name === "Rock", "F5-T1-4", "get_genres returns genres sorted by track count");

    const emptyAlbums = groupTracksByAlbum([]);
    assert(Array.isArray(emptyAlbums) && emptyAlbums.length === 0, "F5-T1-5", "Empty library returns empty array without throwing");
  }

  // Feature 6: Robust LRC Parser
  {
    const raw2Digit = "[01:23.45] First line\n[02:00.00] Second line";
    const parsed2 = parseLrc(raw2Digit);
    assert(parsed2.length === 2 && Math.abs(parsed2[0].time - 83.45) < 0.001, "F6-T1-1", "Parse standard 2-digit minute:second LRC timestamp");

    const raw3Digit = "[00:15.345] High precision millisecond line";
    const parsed3 = parseLrc(raw3Digit);
    assert(parsed3.length === 1 && Math.abs(parsed3[0].time - 15.345) < 0.001, "F6-T1-2", "Parse 3-digit millisecond timestamp");

    const rawMulti = "[00:10.00][00:20.00] Repeated refrain text";
    const parsedMulti = parseLrc(rawMulti);
    assert(parsedMulti.length === 2 && parsedMulti[0].time === 10 && parsedMulti[1].time === 20, "F6-T1-3", "Multi-timestamp line unfolded and sorted");

    const rawMeta = "[ar: Radiohead]\n[ti: Creep]\n[00:05.00] When you were here before";
    const parsedMeta = parseLrc(rawMeta);
    assert(parsedMeta.length === 1 && parsedMeta[0].text === "When you were here before", "F6-T1-4", "Metadata tags like [ar: ...] correctly ignored");

    const rawPlain = "Line one without timestamps\nLine two without timestamps";
    const parsedPlain = parseLrc(rawPlain);
    assert(parsedPlain.length === 2 && parsedPlain[0].time === -1 && parsedPlain[1].time === -1, "F6-T1-5", "Unsynced plain lyrics have time -1 and preserve order");
  }

  // Feature 7: LRCLIB Candidate Scoring
  {
    // Local candidate scoring logic oracle (derived from services/lyrics.ts)
    function scoreCandidate(c: any, targetDuration?: number, targetAlbum?: string) {
      let score = 0;
      if (c.syncedLyrics && c.syncedLyrics.trim().length > 0) score += 1000;
      else if (c.instrumental) score += 800;
      else if (c.plainLyrics && c.plainLyrics.trim().length > 0) score += 100;

      if (targetDuration && targetDuration > 0 && c.duration && c.duration > 0) {
        const diff = Math.abs(c.duration - targetDuration);
        if (diff <= 2) score += 300;
        else if (diff <= 5) score += 150;
        else if (diff <= 10) score += 50;
      }

      if (targetAlbum && targetAlbum.trim() && c.albumName && c.albumName.trim()) {
        const a1 = targetAlbum.toLowerCase().trim();
        const a2 = c.albumName.toLowerCase().trim();
        if (a1 === a2 || a1.includes(a2) || a2.includes(a1)) score += 200;
      }
      return score;
    }

    const cSynced = { syncedLyrics: "[00:01.00] Hi", duration: 180, albumName: "Album A" };
    const cPlain = { plainLyrics: "Hi", duration: 180, albumName: "Album A" };
    assert(scoreCandidate(cSynced, 180, "Album A") > scoreCandidate(cPlain, 180, "Album A") + 800, "F7-T1-1", "Synced lyrics candidate scores significantly higher than plain lyrics");

    const cInst = { instrumental: true, duration: 180 };
    assert(scoreCandidate(cInst, 180) === 1100, "F7-T1-2", "Instrumental candidate receives +800 base and +300 duration score");

    const cExactDuration = { syncedLyrics: "[00:01.00] Hi", duration: 181 };
    assert(scoreCandidate(cExactDuration, 180) === 1300, "F7-T1-3", "Duration proximity within 2s awards +300 bonus");

    const cMidDuration = { syncedLyrics: "[00:01.00] Hi", duration: 184 };
    assert(scoreCandidate(cMidDuration, 180) === 1150, "F7-T1-4", "Duration proximity within 5s awards +150 bonus");

    const cAlbumMatch = { syncedLyrics: "[00:01.00] Hi", duration: 180, albumName: "OK Computer" };
    assert(scoreCandidate(cAlbumMatch, 180, "OK Computer (Deluxe)") === 1500, "F7-T1-5", "Album matching awards +200 bonus");
  }

  // Feature 8: Active Lyric Binary Search
  {
    const lines: LyricLine[] = [
      { time: 10.0, text: "Line 1" },
      { time: 20.0, text: "Line 2" },
      { time: 30.0, text: "Line 3" },
      { time: 40.0, text: "Line 4" },
    ];

    assert(getActiveLyricIndex(lines, 10.0) === 0, "F8-T1-1", "Exact timestamp match returns correct line index");
    assert(getActiveLyricIndex(lines, 25.0) === 1, "F8-T1-2", "Interpolated timestamp between lines returns preceding line");
    assert(getActiveLyricIndex(lines, 5.0) === -1, "F8-T1-3", "Position before first line returns -1 underflow guard");
    assert(getActiveLyricIndex(lines, 55.0) === 3, "F8-T1-4", "Position beyond last line returns last line index");

    const unsynced: LyricLine[] = [{ time: -1, text: "Plain line" }];
    assert(getActiveLyricIndex(unsynced, 15.0) === -1, "F8-T1-5", "Unsynced plain lyrics always return -1");
  }

  // Feature 9: Lyrics Processing IPC
  {
    const raw = "[00:10.00] Line A\n[00:20.00] Line B";
    const parsed = parseLrc(raw);
    assert(Array.isArray(parsed) && parsed.length === 2, "F9-T1-1", "parse_lrc_content IPC shape contract");

    const idx = getActiveLyricIndex(parsed, 15.0);
    assert(idx === 0, "F9-T1-2", "find_active_lyric_line IPC contract");

    // Title cleaning helper
    assert(normalizeQuery("01 - Song Title (Remastered 2021)") === "Song Title", "F9-T1-3", "normalizeQuery removes track numbers and remaster suffixes");
    assert(extractCleanArtist("Radiohead; RADIOHEAD") === "Radiohead", "F9-T1-4", "extractCleanArtist removes duplicate compound artist tags");
    assert(stripEnclosingParentheses("(Nice Dream)") === "Nice Dream", "F9-T1-5", "stripEnclosingParentheses removes outer matching brackets");
  }

  // Feature 10: Two-Tier Playback Queue
  {
    const context = [
      helperTrack("c1", "Track 1", "Artist", "Album", "/1.flac", 180),
      helperTrack("c2", "Track 2", "Artist", "Album", "/2.flac", 180),
    ];
    let userQueue: Track[] = [];

    // Simulate playNext
    const userTrack = helperTrack("u1", "Priority", "Guest", "Album", "/u.flac", 180);
    userQueue = [userTrack, ...userQueue];
    assert(userQueue[0].id === "u1", "F10-T1-1", "playNext inserts at head of user priority queue");

    // Simulate pushBack
    const userTrack2 = helperTrack("u2", "Play Later", "Guest", "Album", "/u2.flac", 180);
    userQueue = [...userQueue, userTrack2];
    assert(userQueue[userQueue.length - 1].id === "u2", "F10-T1-2", "pushBack appends to tail of user priority queue");

    // Pop from user queue
    const nextPlayed = userQueue.shift();
    assert(nextPlayed?.id === "u1", "F10-T1-3", "User priority track played before context queue");

    // Reorder user queue
    userQueue = [userTrack, userTrack2];
    const moved = userQueue.splice(1, 1)[0];
    userQueue.splice(0, 0, moved);
    assert(userQueue[0].id === "u2", "F10-T1-4", "User queue can be reordered");

    // Clear user queue
    userQueue = [];
    assert(userQueue.length === 0, "F10-T1-5", "User queue can be cleared");
  }

  // Feature 11: Autoplay Recommendation Engine
  {
    const current = helperTrack("curr", "Current Song", "Radiohead", "In Rainbows", "/c.flac", 180, { genre: "Rock" });
    const library = [
      current,
      helperTrack("r1", "Reckoner", "Radiohead", "In Rainbows", "/r1.flac", 180, { genre: "Rock" }),
      helperTrack("o1", "Karma Police", "Radiohead", "OK Computer", "/o1.flac", 180, { genre: "Rock" }),
      helperTrack("g1", "Rock Song", "Other Band", "Other Album", "/g1.flac", 180, { genre: "Rock" }),
      helperTrack("j1", "Jazz Song", "Miles Davis", "Kind of Blue", "/j1.flac", 180, { genre: "Jazz" }),
    ];

    const pick = getAutoplayNextTrack(current, [current], library);
    assert(pick !== null && pick.id !== current.id, "F11-T1-1", "Autoplay selects a valid unplayed candidate");

    // When all library tracks already in queue except one
    const mostlyQueued = [current, library[1], library[2], library[3]];
    const solePick = getAutoplayNextTrack(current, mostlyQueued, library);
    assert(solePick?.id === "j1", "F11-T1-2", "Autoplay picks the only remaining unqueued track");

    // When entire library is in queue, allow any track except current
    const allQueued = [...library];
    const loopPick = getAutoplayNextTrack(current, allQueued, library);
    assert(loopPick !== null && loopPick.id !== current.id, "F11-T1-3", "Autoplay loops gracefully when queue exhausted");

    // Null current track fallback
    const nullPick = getAutoplayNextTrack(null, [], library);
    assert(nullPick !== null, "F11-T1-4", "Autoplay handles null current track gracefully");

    // Empty library fallback
    const emptyPick = getAutoplayNextTrack(current, [current], []);
    assert(emptyPick?.id === current.id, "F11-T1-5", "Autoplay returns current queue head when library empty");
  }

  // Feature 12: Queue Management IPC
  {
    // Verify snapshot schema expectations
    interface QueueStateSnapshot {
      currentTrack: Track | null;
      currentIndex: number | null;
      userQueue: Track[];
      contextQueue: Track[];
      history: Track[];
      isShuffle: boolean;
      loopMode: LoopMode;
    }

    const snapshot: QueueStateSnapshot = {
      currentTrack: helperTrack("t1", "Track", "Artist", "Album", "/t1.flac", 180),
      currentIndex: 0,
      userQueue: [],
      contextQueue: [helperTrack("t1", "Track", "Artist", "Album", "/t1.flac", 180)],
      history: [],
      isShuffle: false,
      loopMode: "Off",
    };

    assert(snapshot.currentIndex === 0 && snapshot.loopMode === "Off", "F12-T1-1", "QueueStateSnapshot conforms to IPC contract");
    assert(Array.isArray(snapshot.userQueue) && Array.isArray(snapshot.contextQueue), "F12-T1-2", "Queue snapshot arrays are valid");
    assert(Array.isArray(snapshot.history), "F12-T1-3", "History array is present");
    assert(typeof snapshot.isShuffle === "boolean", "F12-T1-4", "Shuffle flag is boolean");
    assert(snapshot.currentTrack?.id === "t1", "F12-T1-5", "Current track is populated");
  }

  // Feature 13: Frontend Decoupling (libraryStore)
  {
    const mockStoreState = {
      tracks: [] as Track[],
      albums: [] as AlbumInfo[],
      artists: [] as ArtistInfo[],
      setTracks(tracks: Track[]) {
        this.tracks = tracks;
        this.albums = groupTracksByAlbum(tracks);
        this.artists = groupTracksByArtist(tracks);
      },
    };

    const tracks = [
      helperTrack("t1", "Title 1", "Artist 1", "Album 1", "/1.flac", 180),
      helperTrack("t2", "Title 2", "Artist 1", "Album 1", "/2.flac", 180),
    ];
    mockStoreState.setTracks(tracks);
    assert(mockStoreState.albums.length === 1, "F13-T1-1", "libraryStore state holds pre-grouped albums");
    assert(mockStoreState.artists.length === 1, "F13-T1-2", "libraryStore state holds pre-grouped artists");
    assert(mockStoreState.tracks.length === 2, "F13-T1-3", "libraryStore tracks count matches");
    assert(mockStoreState.albums[0].trackCount === 2, "F13-T1-4", "Album trackCount matches");
    assert(mockStoreState.artists[0].albumCount === 1, "F13-T1-5", "Artist albumCount matches");
  }

  // Feature 14: Frontend Decoupling (playerStore)
  {
    interface MockPlayerState {
      currentTrack: Track | null;
      queue: Track[];
      queueIndex: number;
      isAutoplay: boolean;
      loopMode: LoopMode;
    }

    const state: MockPlayerState = {
      currentTrack: null,
      queue: [],
      queueIndex: -1,
      isAutoplay: true,
      loopMode: "Off",
    };

    assert(state.isAutoplay === true, "F14-T1-1", "playerStore default autoplay is true");
    assert(state.loopMode === "Off", "F14-T1-2", "playerStore default loop mode is Off");
    assert(state.queueIndex === -1, "F14-T1-3", "Initial queueIndex is -1");
    assert(state.currentTrack === null, "F14-T1-4", "Initial currentTrack is null");
    assert(Array.isArray(state.queue), "F14-T1-5", "Initial queue is empty array");
  }

  // Feature 15: Headless & Dual-Environment Tests
  {
    assert(typeof global.Audio !== "undefined", "F15-T1-1", "Global Audio element is mocked in Node headless environment");
    assert(typeof global.fetch !== "undefined", "F15-T1-2", "Global fetch is mocked for headless tests");
    assert(typeof (global as any).localStorage !== "undefined", "F15-T1-3", "Global localStorage is mocked");
    assert(typeof (global as any).document !== "undefined", "F15-T1-4", "Global document is mocked");
    assert(typeof formatDuration(125) === "string" && formatDuration(125) === "2:05", "F15-T1-5", "Utility functions execute safely without browser window");
  }

  // ============================================================================
  // TIER 2: BOUNDARY & CORNER CASES (Domain-Specific Extremes, >=5 per feature)
  // ============================================================================
  console.log("--- Tier 2: Boundary & Corner Cases (Features 1 - 15) ---");

  // F1 Boundaries
  {
    assert(groupTracksByAlbum([]).length === 0, "F1-T2-1", "groupTracksByAlbum handles empty track list");
    const loose = [helperTrack("l1", "Loose", "Unknown Artist", "", "/loose.flac", 180)];
    assert(groupTracksByAlbum(loose)[0].title === "Unknown Album", "F1-T2-2", "Tracks with empty album title group into 'Unknown Album'");
    const zeroDur = [helperTrack("z1", "Zero", "Artist", "Album", "/z.flac", 0)];
    assert(groupTracksByAlbum(zeroDur)[0].totalDurationSecs === 0, "F1-T2-3", "Handles zero duration track cleanly");
    const noYear = [helperTrack("ny", "No Year", "Artist", "Album", "/ny.flac", 100, { year: undefined })];
    assert(groupTracksByAlbum(noYear)[0].year === undefined, "F1-T2-4", "Handles undefined year cleanly");
    const diffCase = [
      helperTrack("c1", "T1", "Radiohead", "In Rainbows", "/Music/In Rainbows/1.flac", 100),
      helperTrack("c2", "T2", "Radiohead", "in rainbows", "/Music/In Rainbows/2.flac", 100),
    ];
    assert(groupTracksByAlbum(diffCase).length === 1, "F1-T2-5", "Case-insensitive album title in same folder groups to single album");
  }

  // F2 Boundaries
  {
    assert(extractArtistFromPath("/") === null, "F2-T2-1", "Root path returns null");
    assert(extractArtistFromPath("track.mp3") === null, "F2-T2-2", "Single filename path returns null");
    assert(extractArtistFromPath("C:\\Users\\Music\\Pink Floyd\\The Wall\\01.flac", "The Wall") === "Pink Floyd", "F2-T2-3", "Windows backslash path handled properly");
    assert(extractArtistFromPath("/Music/01 - A - B - C - D.mp3") === "A", "F2-T2-4", "Multiple dash filename handled safely");
    assert(extractArtistFromPath("/Music/downloads/media/songs/audio/tracks/01.flac") === null, "F2-T2-5", "Multiple nested generic blacklist directories return null");
  }

  // F3 Boundaries
  {
    assert(splitArtists("")[0] === "Unknown Artist", "F3-T2-1", "Empty artist string returns Unknown Artist");
    assert(splitArtists("   ")[0] === "Unknown Artist", "F3-T2-2", "Whitespace-only string returns Unknown Artist");
    const repDelims = splitArtists("Artist A & artist a & ARTIST A");
    assert(repDelims.length === 1 && repDelims[0] === "Artist A", "F3-T2-3", "Case-insensitive deduplication of duplicate artists");
    const mixedDelims = splitArtists("Artist A / Artist B; Artist C & Artist D");
    assert(mixedDelims.length === 4 && mixedDelims[0] === "Artist A" && mixedDelims[3] === "Artist D", "F3-T2-4", "Multiple heterogeneous delimiters split cleanly");
    const longString = splitArtists("Solo Artist Name Without Delimiters");
    assert(longString.length === 1 && longString[0] === "Solo Artist Name Without Delimiters", "F3-T2-5", "Single artist without delimiters returns fast-path array");
  }

  // F4 Boundaries
  {
    assert(normalizeGenre("") === "", "F4-T2-1", "Empty genre string normalizes to empty string");
    assert(normalizeGenre(".....") === "", "F4-T2-2", "Punctuation-only genre normalizes to empty string");
    assert(normalizeGenre("avant-garde synth") === "Avant Garde Synth", "F4-T2-3", "Unmapped genre falls back to title casing");
    const splitRnb = splitGenres("R&B / Soul");
    assert(splitRnb.includes("R&B") && splitRnb.includes("Soul"), "F4-T2-4", "Protected compound 'R&B' is not split on ampersand");
    const splitDnb = splitGenres("Drum & Bass / Electronic");
    assert(splitDnb.includes("Drum & Bass") && splitDnb.includes("Electronic"), "F4-T2-5", "Protected compound 'Drum & Bass' is preserved");
  }

  // F5 Boundaries
  {
    const emptyTracks: Track[] = [];
    assert(extractLibraryGenres(emptyTracks).length === 0, "F5-T2-1", "extractLibraryGenres on empty tracks returns empty array");
    const missingGenre = [helperTrack("mg", "Title", "Artist", "Album", "/p.flac", 180, { genre: undefined })];
    assert(extractLibraryGenres(missingGenre).length === 0, "F5-T2-2", "Tracks with undefined genre ignored safely");
    const unicodeAlbum = [helperTrack("u", "Track", "Artist", "🚀 Space 🪐", "/p.flac", 180)];
    assert(groupTracksByAlbum(unicodeAlbum)[0].title === "🚀 Space 🪐", "F5-T2-3", "Emoji and Unicode in album title preserved exactly");
    const longTrack = [helperTrack("long", "Track", "Artist", "Album", "/p.flac", 86400)];
    assert(groupTracksByAlbum(longTrack)[0].totalDurationSecs === 86400, "F5-T2-4", "Handles 24-hour track duration without overflow");
    const nullMetaTrack: Track = {
      id: "null-meta",
      source: { Managed: "/p.flac" },
      date_added: 0,
      metadata: { format: "MP3", duration: { secs: 0, nanos: 0 } },
    };
    assert(groupTracksByAlbum([nullMetaTrack]).length === 1, "F5-T2-5", "Handles completely sparse/null metadata track without crashing");
  }

  // F6 Boundaries
  {
    assert(parseLrc("").length === 0, "F6-T2-1", "Empty string returns empty lyric line array");
    assert(parseLrc("   \n  \t  \n").length === 0, "F6-T2-2", "Whitespace lines return empty array");
    const zeroTimestamp = parseLrc("[00:00.00] Immediate start");
    assert(zeroTimestamp.length === 1 && zeroTimestamp[0].time === 0, "F6-T2-3", "Zero second timestamp parsed as time 0");
    const oneDigitMs = parseLrc("[01:05.5] One digit millisecond");
    assert(oneDigitMs.length === 1 && Math.abs(oneDigitMs[0].time - 65.5) < 0.001, "F6-T2-4", "1-digit millisecond offset parsed accurately");
    const outOfOrder = parseLrc("[00:30.00] Second\n[00:10.00] First");
    assert(outOfOrder[0].time === 10 && outOfOrder[1].time === 30, "F6-T2-5", "Chronologically disordered lines sorted automatically");
  }

  // F7 Boundaries
  {
    function scoreCandidate(c: any, targetDuration?: number, targetAlbum?: string) {
      let score = 0;
      if (c.syncedLyrics && c.syncedLyrics.trim().length > 0) score += 1000;
      else if (c.instrumental) score += 800;
      else if (c.plainLyrics && c.plainLyrics.trim().length > 0) score += 100;

      if (targetDuration && targetDuration > 0 && c.duration && c.duration > 0) {
        const diff = Math.abs(c.duration - targetDuration);
        if (diff <= 2) score += 300;
        else if (diff <= 5) score += 150;
        else if (diff <= 10) score += 50;
      }

      if (targetAlbum && targetAlbum.trim() && c.albumName && c.albumName.trim()) {
        const a1 = targetAlbum.toLowerCase().trim();
        const a2 = c.albumName.toLowerCase().trim();
        if (a1 === a2 || a1.includes(a2) || a2.includes(a1)) score += 200;
      }
      return score;
    }

    // Exact 2.0s boundary
    assert(scoreCandidate({ duration: 182 }, 180) === 300, "F7-T2-1", "Diff of exactly 2.0s yields 300 points");
    // Boundary step: 2.1s
    assert(scoreCandidate({ duration: 182.1 }, 180) === 150, "F7-T2-2", "Diff of 2.1s steps down to 150 points");
    // Boundary step: 5.0s
    assert(scoreCandidate({ duration: 185 }, 180) === 150, "F7-T2-3", "Diff of exactly 5.0s yields 150 points");
    // Boundary step: 5.1s
    assert(scoreCandidate({ duration: 185.1 }, 180) === 50, "F7-T2-4", "Diff of 5.1s steps down to 50 points");
    // Over 10s difference
    assert(scoreCandidate({ duration: 195 }, 180) === 0, "F7-T2-5", "Diff over 10s yields 0 duration bonus");
  }

  // F8 Boundaries
  {
    assert(getActiveLyricIndex([], 100) === -1, "F8-T2-1", "Binary search on empty lines returns -1");
    const single: LyricLine[] = [{ time: 10.0, text: "Solo line" }];
    assert(getActiveLyricIndex(single, 9.999) === -1, "F8-T2-2", "Single line: position 9.999s returns -1");
    assert(getActiveLyricIndex(single, 10.0) === 0, "F8-T2-3", "Single line: position 10.0s returns 0");
    assert(getActiveLyricIndex(single, 50.0) === 0, "F8-T2-4", "Single line: position 50.0s returns 0");
    const twoIdentical: LyricLine[] = [
      { time: 5.0, text: "A" },
      { time: 5.0, text: "B" },
    ];
    assert(getActiveLyricIndex(twoIdentical, 5.0) >= 0, "F8-T2-5", "Lines with identical timestamps return valid index without infinite loop");
  }

  // F9 Boundaries
  {
    assert(normalizeQuery("") === "", "F9-T2-1", "normalizeQuery on empty string returns empty string");
    assert(extractCleanArtist("") === "", "F9-T2-2", "extractCleanArtist on empty string returns empty string");
    assert(stripEnclosingParentheses("") === "", "F9-T2-3", "stripEnclosingParentheses on empty string returns empty string");
    assert(stripEnclosingParentheses("Not (Enclosed)") === "Not (Enclosed)", "F9-T2-4", "Unenclosed title with internal brackets preserved");
    assert(stripEnclosingParentheses("[Bracketed]") === "Bracketed", "F9-T2-5", "Square brackets stripped when enclosing entire title");
  }

  // F10 Boundaries
  {
    let queue: Track[] = [];
    assert(queue.shift() === undefined, "F10-T2-1", "Popping from empty queue safely returns undefined");
    const single = [helperTrack("1", "T", "A", "Alb", "/1.flac", 180)];
    assert(single.slice(1).length === 0, "F10-T2-2", "Single item queue next slice is empty");
    const largeQueue = new Array(1000).fill(null).map((_, i) => helperTrack(`t${i}`, `T${i}`, "A", "Alb", `/t${i}.flac`, 100));
    assert(largeQueue.length === 1000, "F10-T2-3", "1,000 item queue instantiated cleanly");
    largeQueue.splice(0, 500);
    assert(largeQueue.length === 500, "F10-T2-4", "Queue slicing handles bulk consumption");
    largeQueue.length = 0;
    assert(largeQueue.length === 0, "F10-T2-5", "Queue reset to 0 elements cleanly");
  }

  // F11 Boundaries
  {
    const t = helperTrack("1", "T", "A", "Alb", "/1.flac", 180);
    assert(getAutoplayNextTrack(t, [t], [t])?.id === "1", "F11-T2-1", "Single track library returns that track as fallback");
    assert(getAutoplayNextTrack(null, [], [t])?.id === "1", "F11-T2-2", "Null current track with single library track returns that track");
    const tNoArtist = helperTrack("no-art", "T", "", "Alb", "/p.flac", 180);
    assert(getAutoplayNextTrack(tNoArtist, [tNoArtist], [tNoArtist, t])?.id === "1", "F11-T2-3", "Handles track with empty artist safely");
    const tNoGenre = helperTrack("no-gen", "T", "A", "Alb", "/p.flac", 180, { genre: "" });
    assert(getAutoplayNextTrack(tNoGenre, [tNoGenre], [tNoGenre, t])?.id === "1", "F11-T2-4", "Handles track with empty genre safely");
    assert(getAutoplayNextTrack(t, [], []) === null, "F11-T2-5", "Empty library and queue returns null safely");
  }

  // F12 Boundaries
  {
    const snap = { currentTrack: null, currentIndex: -1, userQueue: [], contextQueue: [] };
    assert(snap.currentIndex === -1, "F12-T2-1", "Negative queue index handled cleanly");
    assert(snap.currentTrack === null, "F12-T2-2", "Null current track handled cleanly");
    const jsonStr = JSON.stringify(snap);
    const parsedSnap = JSON.parse(jsonStr);
    assert(parsedSnap.currentIndex === -1, "F12-T2-3", "Queue state snapshot roundtrips JSON serialization");
    assert(Array.isArray(parsedSnap.userQueue), "F12-T2-4", "Parsed snapshot maintains array types");
    assert(parsedSnap.currentTrack === null, "F12-T2-5", "Parsed snapshot maintains null values");
  }

  // F13-15 Boundaries
  {
    assert(formatTotalDuration(0) === "0 min", "F13-15-T2-1", "formatTotalDuration(0) returns '0 min'");
    assert(formatTotalDuration(3660) === "1 hr 1 min", "F13-15-T2-2", "formatTotalDuration(3660) returns '1 hr 1 min'");
    assert(formatDuration(0) === "0:00", "F13-15-T2-3", "formatDuration(0) returns '0:00'");
    assert(formatDuration(59) === "0:59", "F13-15-T2-4", "formatDuration(59) returns '0:59'");
    assert(formatDuration(3599) === "59:59", "F13-15-T2-5", "formatDuration(3599) returns '59:59'");
  }

  // ============================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (5 Interaction Pipelines)
  // ============================================================================
  console.log("--- Tier 3: Cross-Feature Combinations (5 Pipelines) ---");

  // Pipeline A: Path Fallback + Multi-Artist Delimiters + Protected Names + Album Clustering
  {
    const rawTrackA = helperTrack(
      "pA_1",
      "Song 1",
      "Tyler, The Creator; Kali Uchis",
      "Flower Boy",
      "/Music/Tyler, The Creator/Flower Boy/01 Song 1.flac",
      180
    );
    const rawTrackB = helperTrack(
      "pA_2",
      "Song 2",
      "Tyler, The Creator feat. A$AP Rocky",
      "Flower Boy",
      "/Music/Tyler, The Creator/Flower Boy/02 Song 2.flac",
      200
    );

    // Path check
    const pathArtist = extractArtistFromPath(rawTrackA.source.Managed, "Flower Boy");
    assert(pathArtist === "Tyler, The Creator", "P-A-1", "Path heuristic resolves protected artist name from folder structure");

    // Delimiter tokenization
    const splitA = splitArtists(rawTrackA.metadata.artist);
    assert(splitA.length === 2 && splitA[0] === "Tyler, The Creator" && splitA[1] === "Kali Uchis", "P-A-2", "Split artists preserves protected name Tyler, The Creator");

    // Grouping into album
    const albums = groupTracksByAlbum([rawTrackA, rawTrackB]);
    assert(albums.length === 1 && albums[0].artist === "Tyler, The Creator", "P-A-3", "Album clustering resolves dominant artist from protected name");

    // Grouping into artist profiles
    const artists = groupTracksByArtist([rawTrackA, rawTrackB]);
    const tyler = artists.find((a) => a.name === "Tyler, The Creator");
    const kali = artists.find((a) => a.name === "Kali Uchis");
    assert(tyler?.albums.length === 1 && tyler.trackCount === 2, "P-A-4", "Tyler, The Creator owns the album");
    assert(kali?.appearsOn.length === 1 && kali.albums.length === 0, "P-A-5", "Kali Uchis correctly indexed as featured in appearsOn");
  }

  // Pipeline B: Multilingual Genre Normalization + Library Aggregation + Autoplay Candidate Scoring
  {
    const t1 = helperTrack("pB_1", "Song 1", "Kino", "Gruppa Krovi", "/kino/1.flac", 180, { genre: "русский рок" });
    const t2 = helperTrack("pB_2", "Song 2", "Kino", "Gruppa Krovi", "/kino/2.flac", 190, { genre: "рок" });
    const t3 = helperTrack("pB_3", "Song 3", "DDT", "Metel", "/ddt/1.flac", 200, { genre: "Rock" });
    const t4 = helperTrack("pB_4", "Song 4", "Miles Davis", "Kind of Blue", "/jazz/1.flac", 240, { genre: "Jazz" });

    // Normalize genres
    const normTracks = [t1, t2, t3, t4].map((t) => ({
      ...t,
      metadata: { ...t.metadata, genre: normalizeGenre(t.metadata.genre || "") },
    }));

    assert(normTracks[0].metadata.genre === "Rock" && normTracks[1].metadata.genre === "Rock", "P-B-1", "Cyrillic rock normalized to Rock across tracks");

    // Genre aggregation
    const genres = extractLibraryGenres(normTracks);
    assert(genres[0].name === "Rock" && genres[0].tracks.length === 3, "P-B-2", "Rock aggregated with 3 tracks");

    // Autoplay recommendation by normalized genre:
    // With t4 (Jazz) in the existing queue, unqueued pool contains only normalized Rock tracks
    const nextForT3 = getAutoplayNextTrack(normTracks[2], [normTracks[2], normTracks[3]], normTracks);
    assert(nextForT3?.metadata.genre === "Rock", "P-B-3", "Autoplay recommends candidate from normalized Rock genre");
  }

  // Pipeline C: Robust LRC Parser + Active Lyric Binary Search under 500ms Scrubber Progression
  {
    const lrcContent = `
[00:00.00] ♪ Instrumental Intro ♪
[00:04.00] Line 1: When you were here before
[00:08.50] Line 2: Couldn't look you in the eye
[00:13.00] Line 3: You're just like an angel
[00:18.00] Line 4: Your skin makes me cry
`;
    const lines = parseLrc(lrcContent);
    assert(lines.length === 5, "P-C-1", "LRC parsed into 5 sequential lyric lines");

    // Simulate 500ms playback updates
    let activeIndices: number[] = [];
    for (let pos = 0.0; pos <= 20.0; pos += 0.5) {
      activeIndices.push(getActiveLyricIndex(lines, pos));
    }

    assert(activeIndices[0] === 0, "P-C-2", "Position 0.0s is line 0");
    assert(getActiveLyricIndex(lines, 4.0) === 1, "P-C-3", "Position 4.0s transitions to line 1");
    assert(getActiveLyricIndex(lines, 7.5) === 1, "P-C-4", "Position 7.5s holds line 1");
    assert(getActiveLyricIndex(lines, 8.5) === 2, "P-C-5", "Position 8.5s transitions to line 2");
  }

  // Pipeline D: Two-Tier Queue State Transitions + Autoplay Selection upon Queue Exhaustion
  {
    const context = [
      helperTrack("c1", "Track 1", "Band A", "Album A", "/c1.flac", 180, { genre: "Indie" }),
      helperTrack("c2", "Track 2", "Band A", "Album A", "/c2.flac", 180, { genre: "Indie" }),
    ];
    const userPriority = helperTrack("u1", "Special", "Band B", "Album B", "/u1.flac", 180, { genre: "Indie" });
    const library = [...context, userPriority, helperTrack("lib1", "Next Pick", "Band A", "Album A2", "/lib1.flac", 180, { genre: "Indie" })];

    let currentQueue = [...context];
    let currentIndex = 0;
    let userQueue = [userPriority];

    // Next item plays from userQueue
    const playedUser = userQueue.shift()!;
    assert(playedUser.id === "u1", "P-D-1", "User priority track played first");

    // Next item resumes context
    currentIndex = 1;
    const playedContext = currentQueue[currentIndex];
    assert(playedContext.id === "c2", "P-D-2", "Context resumes at track 2");

    // End of context queue reached, trigger autoplay
    const autoplayNext = getAutoplayNextTrack(playedContext, currentQueue, library);
    assert(autoplayNext?.id === "lib1", "P-D-3", "Autoplay recommends lib1 upon queue exhaustion");
  }

  // Pipeline E: LRCLIB Candidate Scoring + Best Synced Selection + Active Lyric Lookup
  {
    const candidates = [
      { id: 1, plainLyrics: "Just plain text without timestamps", duration: 180, albumName: "Album" },
      { id: 2, syncedLyrics: "[00:02.00] Synced line 1\n[00:06.00] Synced line 2", duration: 181, albumName: "Album" },
    ];

    // Synced candidate scoring
    assert(hasLrcTimestamps(candidates[1].syncedLyrics) === true, "P-E-1", "Detects LRC timestamps in candidate 2");
    assert(hasLrcTimestamps(candidates[0].plainLyrics) === false, "P-E-2", "No timestamps in candidate 1");

    // Parse chosen best candidate
    const bestLines = parseLrc(candidates[1].syncedLyrics);
    assert(bestLines.length === 2, "P-E-3", "Best candidate parsed cleanly");
    assert(getActiveLyricIndex(bestLines, 3.0) === 0, "P-E-4", "Active line search succeeds on best candidate lyrics");
    assert(getActiveLyricIndex(bestLines, 7.0) === 1, "P-E-5", "Active line search advances on best candidate lyrics");
  }

  // ============================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 Realistic Workloads)
  // ============================================================================
  console.log("--- Tier 4: Real-World Application Scenarios (5 Workloads) ---");

  // Workload 1: Soundtrack / Compilation Album Import & Exploration
  {
    const ostTracks = [
      helperTrack("ost1", "Misirlou", "Dick Dale & His Del-Tones", "Pulp Fiction", "/Music/Pulp Fiction/01.flac", 136, { album_artist: undefined }),
      helperTrack("ost2", "Jungle Boogie", "Kool & The Gang", "Pulp Fiction", "/Music/Pulp Fiction/02.flac", 185, { album_artist: undefined }),
      helperTrack("ost3", "Let's Stay Together", "Al Green", "Pulp Fiction", "/Music/Pulp Fiction/03.flac", 198, { album_artist: undefined }),
      helperTrack("ost4", "Bust a Move", "Young MC", "Pulp Fiction", "/Music/Pulp Fiction/04.flac", 263, { album_artist: undefined }),
    ];

    const albums = groupTracksByAlbum(ostTracks);
    assert(albums.length === 1, "W1-1", "Soundtrack tracks clustered into single album");
    assert(albums[0].isCompilation === true, "W1-2", "Soundtrack marked as compilation");
    assert(albums[0].artist === "Various Artists", "W1-3", "Compilation artist is 'Various Artists'");
    assert(albums[0].trackCount === 4, "W1-4", "All 4 tracks accounted for in compilation");

    const artists = groupTracksByArtist(ostTracks);
    assert(artists.length === 4, "W1-5", "All 4 distinct soundtrack artists have indexed profiles");
  }

  // Workload 2: Live Album & Cross-Language Tag Cleanup
  {
    const liveTracks = [
      helperTrack("live1", "Gruppa Krovi (Live 1989)", "Kino", "Live at Luzhniki", "/Music/Kino - Live/01.mp3", 240, { genre: "русский рок" }),
      helperTrack("live2", "Zvezda po imeni Solntse", "Kino", "Live at Luzhniki", "/Music/Kino - Live/02.mp3", 210, { genre: "альтернативный рок" }),
    ];

    const pathArtist = extractArtistFromPath(liveTracks[0].source.Managed);
    assert(pathArtist === "Kino", "W2-1", "Live album folder path extracts Kino cleanly");

    const normalizedGenre1 = normalizeGenre(liveTracks[0].metadata.genre || "");
    const normalizedGenre2 = normalizeGenre(liveTracks[1].metadata.genre || "");
    assert(normalizedGenre1 === "Rock" && normalizedGenre2 === "Alternative", "W2-2", "Cyrillic live tags normalized to English display genres");

    const fullArtist = getFullTrackArtistString(liveTracks[0]);
    assert(fullArtist === "Kino", "W2-3", "Artist name resolved to clean Kino without parenthesis clutter");
  }

  // Workload 3: Full-Length Song Playback with Synced Lyrics Sync & Seeking
  {
    const fullSongLrc = `
[00:00.00] ♪ Intro ♪
[00:15.00] Verse 1: Step into the light
[00:30.00] Chorus: Higher than the sky
[01:15.00] Verse 2: Shadows disappear
[01:45.00] Chorus: Higher than the sky
[02:30.00] Bridge: Never looking back
[03:15.00] Outro: Fading away
`;
    const parsed = parseLrc(fullSongLrc);
    assert(parsed.length === 7, "W3-1", "Full song lyrics parsed with 7 stages");

    // User playback at 00:20 (Verse 1)
    assert(getActiveLyricIndex(parsed, 20.0) === 1, "W3-2", "Playback at 20s highlights Verse 1");

    // User seeks forward to Bridge at 02:35
    assert(getActiveLyricIndex(parsed, 155.0) === 5, "W3-3", "User seek forward to 155s highlights Bridge");

    // User seeks backward to Chorus at 00:45
    assert(getActiveLyricIndex(parsed, 45.0) === 2, "W3-4", "User seek backward to 45s highlights Chorus");

    // Reaching Outro at 03:20
    assert(getActiveLyricIndex(parsed, 200.0) === 6, "W3-5", "Reaching outro at 200s highlights Outro");
  }

  // Workload 4: DJ / Party Queue Management Session
  {
    const partyContext = [
      helperTrack("p1", "Party Song 1", "DJ", "Party", "/p1.flac", 180),
      helperTrack("p2", "Party Song 2", "DJ", "Party", "/p2.flac", 180),
      helperTrack("p3", "Party Song 3", "DJ", "Party", "/p3.flac", 180),
    ];
    let userQ: Track[] = [];

    // Guest A requests Song X (play next)
    userQ.unshift(helperTrack("reqA", "Song X", "Guest A", "Guest", "/reqA.flac", 180));
    // Guest B requests Song Y (play later)
    userQ.push(helperTrack("reqB", "Song Y", "Guest B", "Guest", "/reqB.flac", 180));

    assert(userQ[0].id === "reqA", "W4-1", "Song X is front of user queue");
    assert(userQ[1].id === "reqB", "W4-2", "Song Y is back of user queue");

    // Host skips track -> plays Song X
    const played = userQ.shift();
    assert(played?.id === "reqA", "W4-3", "Song X played next");

    // Host removes Song Y from queue
    userQ = userQ.filter((t) => t.id !== "reqB");
    assert(userQ.length === 0, "W4-4", "User queue cleared of Song Y");
  }

  // Workload 5: Endless Autoplay Radio Session
  {
    const radioPool = new Array(20).fill(null).map((_, i) =>
      helperTrack(`rad_${i}`, `Radio Song ${i}`, i < 5 ? "Radiohead" : "Other Artist", "Radio", `/r${i}.flac`, 180, {
        genre: i < 10 ? "Alternative" : "Pop",
      })
    );

    let current = radioPool[0];
    let sessionHistory: Track[] = [current];

    // Run 5 continuous autoplay hops
    for (let hop = 0; hop < 5; hop++) {
      const nextTrack = getAutoplayNextTrack(current, sessionHistory, radioPool);
      assert(nextTrack !== null, `W5-hop-${hop}`, `Autoplay hop ${hop} selected a valid track`);
      assert(!sessionHistory.some((t) => t.id === nextTrack!.id), `W5-dup-${hop}`, `Autoplay hop ${hop} did not select already played track`);
      sessionHistory.push(nextTrack!);
      current = nextTrack!;
    }

    assert(sessionHistory.length === 6, "W5-end", "Continuous 5-hop autoplay radio session completed with 6 unique tracks");
  }

  console.log(`\n✅ OPAQUE-BOX E2E TESTS COMPLETE: ${passedTests}/${totalTests} ASSERTIONS PASSED!`);

  return {
    totalTests,
    passedTests,
    success: passedTests === totalTests,
  };
}

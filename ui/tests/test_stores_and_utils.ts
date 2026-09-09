/**
 * Comprehensive Unit & Integration Test Suite for:
 * 1. Pinia/Zustand Stores: useNavigationStore, useSettingsStore, useLibraryStore
 * 2. Library Utilities: string tokenizers, artist extractors, formatters, sorters
 * 3. Hard Architectural Boundary Verification across crates & frontend
 */

import * as fs from "fs";
import * as path from "path";
import { generateSyntheticTracks, Track } from "./generator";

export async function runStoresAndUtilsTests(jiti: any) {
  console.log("\n=======================================================");
  console.log("  EMPIRICAL TESTS: STORES, UTILITIES & ARCH BOUNDARIES");
  console.log("=======================================================\n");

  let totalAssertions = 0;
  let passedAssertions = 0;

  function assert(condition: boolean, description: string) {
    totalAssertions++;
    if (!condition) {
      console.error(`  ❌ FAILED: ${description}`);
      throw new Error(`Assertion failed: ${description}`);
    }
    passedAssertions++;
    console.log(`  ✓ ${description}`);
  }

  // Ensure mock DOM & localStorage for Node test environment
  const storageMap = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, String(value)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  };
  (global as any).localStorage = localStorageMock;

  const classSet = new Set<string>();
  const documentElementMock = {
    classList: {
      add: (cls: string) => classSet.add(cls),
      remove: (cls: string) => classSet.delete(cls),
      toggle: (cls: string) => {
        if (classSet.has(cls)) {
          classSet.delete(cls);
          return false;
        } else {
          classSet.add(cls);
          return true;
        }
      },
      contains: (cls: string) => classSet.has(cls),
    },
  };
  (global as any).document = (global as any).document || {};
  (global as any).document.documentElement = documentElementMock;

  // Load modules via jiti
  const navigationStoreModule = jiti("../src/stores/navigationStore.ts");
  const settingsStoreModule = jiti("../src/stores/settingsStore.ts");
  const libraryStoreModule = jiti("../src/stores/libraryStore.ts");
  const playerStoreModule = jiti("../src/stores/playerStore.ts");
  const adapterModule = jiti("../src/services/adapter.ts");
  const libUtils = jiti("../src/utils/library.ts");

  // =========================================================================
  // SECTION 1: useNavigationStore Unit & State Transitions
  // =========================================================================
  console.log("--- 1. Testing useNavigationStore State Transitions ---");

  const { useNavigationStore } = navigationStoreModule;

  // Initial State Check
  let navState = useNavigationStore.getState();
  assert(navState.viewMode === "home", "Initial viewMode is 'home'");
  assert(navState.selectedArtistName === null, "Initial selectedArtistName is null");
  assert(navState.selectedAlbumKey === null, "Initial selectedAlbumKey is null");
  assert(navState.globalSearch === "", "Initial globalSearch is empty string");

  // 1a. navigate() across views: tracks, albums, artists, playlists, settings, home, search
  console.log("  Testing navigate() view switching...");
  useNavigationStore.getState().navigate("albums");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "albums", "navigate('albums') switched viewMode to 'albums'");
  assert(navState.selectedArtistName === null && navState.selectedAlbumKey === null, "navigate('albums') reset entity selections");

  useNavigationStore.getState().navigate("artists");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "artists", "navigate('artists') switched viewMode to 'artists'");

  useNavigationStore.getState().navigate("settings");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "settings", "navigate('settings') switched viewMode to 'settings'");

  useNavigationStore.getState().navigate("playlists" as any);
  navState = useNavigationStore.getState();
  assert((navState.viewMode as any) === "playlists", "navigate('playlists') switched viewMode to 'playlists'");

  useNavigationStore.getState().navigate("search");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "search", "navigate('search') switched viewMode to 'search'");

  useNavigationStore.getState().navigate("home");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "home", "navigate('home') switched viewMode to 'home'");

  useNavigationStore.getState().navigate("tracks");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "tracks", "navigate('tracks') switched viewMode to 'tracks'");

  // 1b. selectArtist()
  console.log("  Testing selectArtist()...");
  useNavigationStore.getState().selectArtist("Daft Punk");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "artist_detail", "selectArtist navigates viewMode to 'artist_detail'");
  assert(navState.selectedArtistName === "Daft Punk", "selectArtist sets selectedArtistName to 'Daft Punk'");
  assert(navState.selectedAlbumKey === null, "selectArtist resets selectedAlbumKey");

  // 1c. selectAlbum()
  console.log("  Testing selectAlbum()...");
  // From artist context (currently in artist_detail with selectedArtistName = 'Daft Punk')
  useNavigationStore.getState().selectAlbum("Discovery", "Daft Punk");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "album_detail", "selectAlbum navigates viewMode to 'album_detail'");
  assert(
    navState.selectedAlbumKey?.title === "Discovery" && navState.selectedAlbumKey?.artist === "Daft Punk",
    "selectAlbum sets selectedAlbumKey to { title: 'Discovery', artist: 'Daft Punk' }"
  );
  assert(navState.navSource === "artists", "selectAlbum from artist context sets navSource to 'artists'");

  // Direct selectAlbum from albums view (without artist context)
  useNavigationStore.getState().navigate("albums");
  useNavigationStore.getState().selectAlbum("The Dark Side of the Moon", "Pink Floyd", false);
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "album_detail", "selectAlbum navigates to 'album_detail'");
  assert(navState.navSource === "albums", "selectAlbum with fromArtist=false sets navSource to 'albums'");

  // Explicit fromArtist = true
  useNavigationStore.getState().selectAlbum("OK Computer", "Radiohead", true);
  navState = useNavigationStore.getState();
  assert(navState.navSource === "artists", "selectAlbum with explicit fromArtist=true sets navSource to 'artists'");

  // 1d. breadcrumbNavigate()
  console.log("  Testing breadcrumbNavigate()...");
  // Set up artist detail context
  useNavigationStore.getState().selectArtist("Radiohead");
  useNavigationStore.getState().selectAlbum("In Rainbows", "Radiohead");

  // Breadcrumb back to artist_detail
  useNavigationStore.getState().breadcrumbNavigate("artist_detail");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "artist_detail", "breadcrumbNavigate('artist_detail') navigates back to 'artist_detail'");
  assert(navState.selectedArtistName === "Radiohead", "breadcrumbNavigate('artist_detail') preserves selectedArtistName");
  assert(navState.selectedAlbumKey === null, "breadcrumbNavigate('artist_detail') clears selectedAlbumKey");

  // Breadcrumb back to artists list
  useNavigationStore.getState().breadcrumbNavigate("artists");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "artists", "breadcrumbNavigate('artists') navigates back to 'artists'");
  assert(navState.selectedArtistName === null && navState.selectedAlbumKey === null, "breadcrumbNavigate('artists') resets selections");

  // Breadcrumb to albums
  useNavigationStore.getState().selectAlbum("Aja", "Steely Dan");
  useNavigationStore.getState().breadcrumbNavigate("albums");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "albums", "breadcrumbNavigate('albums') navigates to 'albums'");
  assert(navState.selectedArtistName === null && navState.selectedAlbumKey === null, "breadcrumbNavigate('albums') resets selections");

  // Breadcrumb to tracks
  useNavigationStore.getState().breadcrumbNavigate("tracks");
  navState = useNavigationStore.getState();
  assert(navState.viewMode === "tracks", "breadcrumbNavigate('tracks') navigates to 'tracks'");

  // 1e. setGlobalSearch()
  console.log("  Testing setGlobalSearch()...");
  useNavigationStore.getState().setGlobalSearch("Paranoid Android");
  navState = useNavigationStore.getState();
  assert(navState.globalSearch === "Paranoid Android", "setGlobalSearch sets global search query");
  useNavigationStore.getState().setGlobalSearch("");
  navState = useNavigationStore.getState();
  assert(navState.globalSearch === "", "setGlobalSearch clears global search query");

  // =========================================================================
  // SECTION 2: useSettingsStore, LocalStorage Persistence & DOM Class
  // =========================================================================
  console.log("\n--- 2. Testing useSettingsStore, Persistence & DOM Manipulation ---");

  const { useSettingsStore } = settingsStoreModule;

  // Clear storage and classes before test
  storageMap.clear();
  classSet.clear();

  // Test toggleSimplifyMode
  let settingsState = useSettingsStore.getState();
  const initialSimplify = settingsState.simplifyMode;
  useSettingsStore.getState().toggleSimplifyMode();
  settingsState = useSettingsStore.getState();
  assert(settingsState.simplifyMode === !initialSimplify, "toggleSimplifyMode flipped boolean flag");
  assert(
    localStorageMock.getItem("wavery_simplify_mode") === String(!initialSimplify),
    `localStorage 'wavery_simplify_mode' persisted as '${!initialSimplify}'`
  );
  assert(
    classSet.has("simplify-mode") === !initialSimplify,
    `DOM documentElement classList contains 'simplify-mode': ${classSet.has("simplify-mode")}`
  );

  // Toggle back
  useSettingsStore.getState().toggleSimplifyMode();
  settingsState = useSettingsStore.getState();
  assert(settingsState.simplifyMode === initialSimplify, "toggleSimplifyMode flipped boolean flag back");
  assert(
    localStorageMock.getItem("wavery_simplify_mode") === String(initialSimplify),
    `localStorage 'wavery_simplify_mode' persisted as '${initialSimplify}'`
  );
  assert(
    classSet.has("simplify-mode") === initialSimplify,
    `DOM documentElement classList contains 'simplify-mode': ${classSet.has("simplify-mode")}`
  );

  // Test setSimplifyMode directly
  useSettingsStore.getState().setSimplifyMode(true);
  settingsState = useSettingsStore.getState();
  assert(settingsState.simplifyMode === true, "setSimplifyMode(true) set simplifyMode to true");
  assert(localStorageMock.getItem("wavery_simplify_mode") === "true", "localStorage persisted 'true'");
  assert(classSet.has("simplify-mode") === true, "DOM classList added 'simplify-mode'");

  useSettingsStore.getState().setSimplifyMode(false);
  settingsState = useSettingsStore.getState();
  assert(settingsState.simplifyMode === false, "setSimplifyMode(false) set simplifyMode to false");
  assert(localStorageMock.getItem("wavery_simplify_mode") === "false", "localStorage persisted 'false'");
  assert(classSet.has("simplify-mode") === false, "DOM classList removed 'simplify-mode'");

  // Test Linux Banner Dismissal
  assert(settingsState.isLinuxBannerDismissed === false, "isLinuxBannerDismissed starts false");
  useSettingsStore.getState().dismissLinuxBanner();
  settingsState = useSettingsStore.getState();
  assert(settingsState.isLinuxBannerDismissed === true, "dismissLinuxBanner set isLinuxBannerDismissed to true");
  assert(
    localStorageMock.getItem("wavery_linux_banner_dismissed") === "true",
    "localStorage 'wavery_linux_banner_dismissed' persisted as 'true'"
  );

  // Test setLinuxBannerDismissed directly
  useSettingsStore.getState().setLinuxBannerDismissed(false);
  settingsState = useSettingsStore.getState();
  assert(settingsState.isLinuxBannerDismissed === false, "setLinuxBannerDismissed(false) set isLinuxBannerDismissed to false");
  assert(
    localStorageMock.getItem("wavery_linux_banner_dismissed") === "false",
    "localStorage 'wavery_linux_banner_dismissed' persisted as 'false'"
  );

  useSettingsStore.getState().setLinuxBannerDismissed(true);
  settingsState = useSettingsStore.getState();
  assert(settingsState.isLinuxBannerDismissed === true, "setLinuxBannerDismissed(true) set isLinuxBannerDismissed to true");
  assert(
    localStorageMock.getItem("wavery_linux_banner_dismissed") === "true",
    "localStorage 'wavery_linux_banner_dismissed' persisted as 'true'"
  );

  // Test Comprehensive Settings Updates & Persistence
  console.log("  Testing setSetting() for audio, general, appearance, and theme preferences...");
  useSettingsStore.getState().setSetting("defaultVolume", 0.65);
  useSettingsStore.getState().setSetting("volumeStep", 0.02);
  useSettingsStore.getState().setSetting("crossfadeDurationMs", 2500);
  useSettingsStore.getState().setSetting("gaplessPlayback", true);
  useSettingsStore.getState().setSetting("replayGainMode", "album");
  useSettingsStore.getState().setSetting("themeMode", "oled");
  useSettingsStore.getState().setSetting("accentColor", "#00D2D3");
  useSettingsStore.getState().setSetting("albumGridSize", "spacious");
  useSettingsStore.getState().setSetting("rowDensity", "compact");
  useSettingsStore.getState().setSetting("showVisualizer", false);
  useSettingsStore.getState().setSetting("showLyricsSmoothScroll", true);
  useSettingsStore.getState().setSetting("autoScanOnStartup", false);
  useSettingsStore.getState().setSetting("notificationsEnabled", false);
  useSettingsStore.getState().setSetting("minimizeToTray", true);
  useSettingsStore.getState().setSetting("enableMpris", false);
  useSettingsStore.getState().setSetting("autoResumePlayback", true);

  settingsState = useSettingsStore.getState();
  assert(settingsState.defaultVolume === 0.65, "defaultVolume updated to 0.65");
  assert(settingsState.volumeStep === 0.02, "volumeStep updated to 0.02");
  assert(settingsState.crossfadeDurationMs === 2500, "crossfadeDurationMs updated to 2500");
  assert(settingsState.replayGainMode === "album", "replayGainMode updated to 'album'");
  assert(settingsState.themeMode === "oled", "themeMode updated to 'oled'");
  assert(settingsState.accentColor === "#00D2D3", "accentColor updated to '#00D2D3'");
  assert(settingsState.albumGridSize === "spacious", "albumGridSize updated to 'spacious'");
  assert(settingsState.rowDensity === "compact", "rowDensity updated to 'compact'");
  assert(settingsState.showVisualizer === false, "showVisualizer updated to false");
  assert(settingsState.autoScanOnStartup === false, "autoScanOnStartup updated to false");
  assert(settingsState.minimizeToTray === true, "minimizeToTray updated to true");
  assert(settingsState.autoResumePlayback === true, "autoResumePlayback updated to true");

  // Test Export & Import Config JSON
  console.log("  Testing exportConfigJson() and importConfigJson()...");
  const exportedJson = useSettingsStore.getState().exportConfigJson();
  assert(typeof exportedJson === "string" && exportedJson.includes("defaultVolume"), "exportConfigJson generated valid JSON string");

  // Reset to defaults
  useSettingsStore.getState().resetToDefaults();
  settingsState = useSettingsStore.getState();
  assert(settingsState.defaultVolume === 0.8, "resetToDefaults restored defaultVolume to 0.8");
  assert(settingsState.accentColor === "#FA586A", "resetToDefaults restored accentColor to '#FA586A'");
  assert(settingsState.themeMode === "dark", "resetToDefaults restored themeMode to 'dark'");

  // Re-import the exported configuration
  const importResult = useSettingsStore.getState().importConfigJson(exportedJson);
  assert(importResult === true, "importConfigJson successfully imported configuration");
  settingsState = useSettingsStore.getState();
  assert(settingsState.defaultVolume === 0.65, "Import restored defaultVolume to 0.65");
  assert(settingsState.accentColor === "#00D2D3", "Import restored accentColor to '#00D2D3'");
  assert(settingsState.themeMode === "oled", "Import restored themeMode to 'oled'");

  // Test invalid import handling
  const invalidImportResult = useSettingsStore.getState().importConfigJson("invalid json syntax");
  assert(invalidImportResult === false, "importConfigJson safely rejected malformed JSON");

  // =========================================================================
  // SECTION 3: useLibraryStore Auto-Aggregation & Async Error Handling
  // =========================================================================
  console.log("\n--- 3. Testing useLibraryStore Auto-Aggregation & Error Invariants ---");

  const { useLibraryStore } = libraryStoreModule;

  // 3a. setTracks Auto-Aggregation
  console.log("  Testing setTracks auto-aggregation into albums and artists...");
  const syntheticTracks = generateSyntheticTracks(60);
  useLibraryStore.getState().setTracks(syntheticTracks);

  let libState = useLibraryStore.getState();
  assert(libState.tracks.length === 60, `setTracks populated ${libState.tracks.length} tracks`);
  assert(libState.albums.length > 0, `setTracks aggregated ${libState.albums.length} albums`);
  assert(libState.artists.length > 0, `setTracks aggregated ${libState.artists.length} artists`);

  // Verify Album aggregation structure
  const firstAlbum = libState.albums[0];
  assert(typeof firstAlbum.title === "string" && firstAlbum.title.length > 0, `Album has valid title: '${firstAlbum.title}'`);
  assert(typeof firstAlbum.artist === "string" && firstAlbum.artist.length > 0, `Album has valid artist: '${firstAlbum.artist}'`);
  assert(firstAlbum.trackCount === firstAlbum.tracks.length, "Album trackCount matches tracks array length");
  assert(firstAlbum.totalDurationSecs > 0, `Album totalDurationSecs computed: ${firstAlbum.totalDurationSecs}s`);
  assert(typeof firstAlbum.artworkTrackId === "string" && firstAlbum.artworkTrackId.length > 0, "Album has valid artworkTrackId");

  // Verify tracks inside album are sorted by disc_number and track_number
  for (const album of libState.albums) {
    for (let i = 1; i < album.tracks.length; i++) {
      const prev = album.tracks[i - 1].metadata;
      const curr = album.tracks[i].metadata;
      const prevDisc = prev.disc_number || 1;
      const currDisc = curr.disc_number || 1;
      const prevTrack = prev.track_number || 0;
      const currTrack = curr.track_number || 0;
      assert(
        prevDisc < currDisc || (prevDisc === currDisc && prevTrack <= currTrack),
        `Album '${album.title}' tracks are sorted by disc/track number`
      );
    }
  }

  // Verify Artist aggregation structure
  const firstArtist = libState.artists[0];
  assert(typeof firstArtist.name === "string" && firstArtist.name.length > 0, `Artist has valid name: '${firstArtist.name}'`);
  assert(firstArtist.trackCount === firstArtist.tracks.length, "Artist trackCount matches tracks array length");
  assert(firstArtist.albumCount === firstArtist.albums.length, "Artist albumCount matches albums array length");

  // Verify alphabetical sorting of artists
  for (let i = 1; i < libState.artists.length; i++) {
    const prevName = libState.artists[i - 1].name.toLowerCase();
    const currName = libState.artists[i].name.toLowerCase();
    assert(prevName <= currName, `Artists list is sorted alphabetically: '${prevName}' <= '${currName}'`);
  }

  // 3b. loadTracks Error Handling & Loading Flag Resetting
  console.log("  Testing loadTracks error handling and loading flag resetting...");
  // Simulate adapter failure with Error instance
  adapterModule.playerAdapter.getTracks = async () => {
    throw new Error("SQLite connection timeout: WAL journal locked");
  };

  useLibraryStore.setState({ isLoading: true, error: null });
  await useLibraryStore.getState().loadTracks();
  libState = useLibraryStore.getState();
  assert(libState.isLoading === false, "loadTracks reset isLoading to false on Error exception");
  assert(
    libState.error === "SQLite connection timeout: WAL journal locked",
    `loadTracks stored expected error message: '${libState.error}'`
  );

  // Simulate adapter failure with non-Error string
  adapterModule.playerAdapter.getTracks = async () => {
    throw "Fatal backend panic in native thread";
  };

  useLibraryStore.setState({ isLoading: true, error: null });
  await useLibraryStore.getState().loadTracks();
  libState = useLibraryStore.getState();
  assert(libState.isLoading === false, "loadTracks reset isLoading to false on string exception");
  assert(
    libState.error === "Fatal backend panic in native thread",
    `loadTracks formatted string exception into error: '${libState.error}'`
  );

  // Simulate adapter success
  adapterModule.playerAdapter.getTracks = async () => {
    return syntheticTracks.slice(0, 15);
  };

  useLibraryStore.setState({ isLoading: true, error: "Previous error" });
  await useLibraryStore.getState().loadTracks();
  libState = useLibraryStore.getState();
  assert(libState.isLoading === false, "loadTracks reset isLoading to false on success");
  assert(libState.error === null, "loadTracks cleared error on success");
  assert(libState.tracks.length === 15, `loadTracks updated tracks list to 15 items`);

  // 3c. deleteTrack Action & Player Queue Sync
  console.log("  Testing deleteTrack action, optimistic update and player queue cleanup...");
  const { usePlayerStore } = playerStoreModule;

  const testTrackToDelete = syntheticTracks[0];
  const remainingTrack = syntheticTracks[1];

  useLibraryStore.getState().setTracks([testTrackToDelete, remainingTrack]);
  useLibraryStore.setState({
    likedTrackIds: new Set([testTrackToDelete.id, remainingTrack.id]),
    likedTracks: [testTrackToDelete, remainingTrack],
  });

  usePlayerStore.setState({
    queue: [testTrackToDelete, remainingTrack],
    queueIndex: 0,
    currentTrackId: testTrackToDelete.id,
    status: {
      state: "Playing",
      volume: 0.8,
      position_secs: 15,
      duration_secs: 120,
      current_track: testTrackToDelete,
      loop_mode: "Off",
    },
  });

  const originalDeleteTrack = adapterModule.playerAdapter.deleteTrack;
  const originalStop = adapterModule.playerAdapter.stop;

  let deletedTrackIdPassed = "";
  let removeFileFlagPassed = false;
  adapterModule.playerAdapter.deleteTrack = async (id: string, removeFile = false) => {
    deletedTrackIdPassed = id;
    removeFileFlagPassed = removeFile;
  };
  adapterModule.playerAdapter.stop = async () => {};

  try {
    await useLibraryStore.getState().deleteTrack(testTrackToDelete.id, true);

    assert(deletedTrackIdPassed === testTrackToDelete.id, "deleteTrack called playerAdapter.deleteTrack with track id");
    assert(removeFileFlagPassed === true, "deleteTrack called playerAdapter.deleteTrack with removeFile=true");

    libState = useLibraryStore.getState();
    assert(libState.tracks.length === 1, "deleteTrack reduced library tracks length to 1");
    assert(!libState.tracks.some((t: any) => t.id === testTrackToDelete.id), "deleteTrack removed deleted track from library tracks");
    assert(!libState.likedTrackIds.has(testTrackToDelete.id), "deleteTrack removed deleted track from likedTrackIds");
    assert(!libState.likedTracks.some((t: any) => t.id === testTrackToDelete.id), "deleteTrack removed deleted track from likedTracks");

    const playerState = usePlayerStore.getState();
    assert(playerState.queue.length === 1, "deleteTrack cleaned active queue in playerStore");
    assert(!playerState.queue.some((t: any) => t.id === testTrackToDelete.id), "deleteTrack removed track from queue");
    assert(playerState.status.state === "Stopped", "deleteTrack stopped playback because active track was deleted");

    // Verify deleteTrack error handling
    adapterModule.playerAdapter.deleteTrack = async () => {
      throw new Error("Disk permission denied");
    };
    let errorCaught = false;
    try {
      await useLibraryStore.getState().deleteTrack(remainingTrack.id, false);
    } catch (err: any) {
      errorCaught = true;
      assert(err.message === "Disk permission denied", "deleteTrack rethrows error on failure");
    }
    assert(errorCaught, "deleteTrack threw when adapter failed");
    assert(useLibraryStore.getState().error === "Disk permission denied", "deleteTrack stored error in libraryStore");
  } finally {
    adapterModule.playerAdapter.deleteTrack = originalDeleteTrack;
    adapterModule.playerAdapter.stop = originalStop;
  }

  // =========================================================================
  // SECTION 4: utils/library.ts String Tokenizers, Formatter & Helpers
  // =========================================================================
  console.log("\n--- 4. Testing utils/library.ts Tokenizers, Formatters & Helpers ---");

  const {
    extractPrimaryArtist,
    splitArtists,
    parseArtistTokens,
    formatTotalDuration,
    formatDuration,
    extractFeaturedArtistsFromTitle,
    extractArtistFromPath,
    sortTracks,
    sortAlbums,
    sortArtists,
  } = libUtils;

  // 4a. extractPrimaryArtist
  console.log("  Testing extractPrimaryArtist()...");
  const primaryCases: Array<[string | undefined, string]> = [
    ["", "Unknown Artist"],
    ["   ", "Unknown Artist"],
    [undefined, "Unknown Artist"],
    ["Daft Punk", "Daft Punk"],
    ["Radiohead", "Radiohead"],
    ["Daft Punk feat. Pharrell Williams", "Daft Punk"],
    ["Daft Punk ft. Pharrell Williams", "Daft Punk"],
    ["Eminem featuring Rihanna", "Daft Punk" === "Daft Punk" ? "Eminem" : ""],
    ["Kanye West with Lupe Fiasco", "Kanye West"],
    ["Godzilla vs. Kong", "Godzilla"],
    ["Artist A / Artist B", "Artist A"],
    ["Artist A ; Artist B", "Artist A"],
    ["Artist A & Artist B", "Artist A"],
    ["Artist A, Artist B", "Artist A"],
    ["Artist 1 / Artist 2 feat. Artist 3", "Artist 1"],
    ["The Beatles (Remastered)", "The Beatles (Remastered)"],
  ];

  for (const [input, expected] of primaryCases) {
    const res = extractPrimaryArtist(input);
    assert(res === expected, `extractPrimaryArtist(${JSON.stringify(input)}) -> '${res}' === '${expected}'`);
  }

  // 4b. splitArtists
  console.log("  Testing splitArtists()...");
  const splitCases: Array<[string | undefined, string[]]> = [
    ["", ["Unknown Artist"]],
    ["   ", ["Unknown Artist"]],
    [undefined, ["Unknown Artist"]],
    ["Pink Floyd", ["Pink Floyd"]],
    ["Daft Punk feat. Pharrell Williams & Nile Rodgers", ["Daft Punk", "Pharrell Williams", "Nile Rodgers"]],
    ["Eminem, Rihanna", ["Eminem", "Rihanna"]],
    ["Artist A / Artist B; Artist C & Artist D", ["Artist A", "Artist B", "Artist C", "Artist D"]],
    ["Artist A ft. Artist B with Artist C vs. Artist D", ["Artist A", "Artist B", "Artist C", "Artist D"]],
    ["Artist A & artist a & ARTIST A", ["Artist A"]], // Case-insensitive deduplication
  ];

  for (const [input, expected] of splitCases) {
    const res = splitArtists(input);
    assert(
      JSON.stringify(res) === JSON.stringify(expected),
      `splitArtists(${JSON.stringify(input)}) -> ${JSON.stringify(res)} === ${JSON.stringify(expected)}`
    );
  }

  // 4c. parseArtistTokens
  console.log("  Testing parseArtistTokens()...");
  const emptyTokens = parseArtistTokens("");
  assert(
    emptyTokens.length === 1 && emptyTokens[0].text === "Unknown Artist" && emptyTokens[0].isArtist === true,
    "parseArtistTokens('') returns single Unknown Artist token"
  );

  const singleTokens = parseArtistTokens("Daft Punk");
  assert(
    singleTokens.length === 1 && singleTokens[0].text === "Daft Punk" && singleTokens[0].isArtist === true,
    "parseArtistTokens('Daft Punk') returns single artist token"
  );

  const featTokens = parseArtistTokens("Daft Punk feat. Pharrell Williams & Nile Rodgers");
  assert(
    featTokens.length === 5 &&
    featTokens[0].text === "Daft Punk" && featTokens[0].isArtist === true &&
    featTokens[1].text === " feat. " && featTokens[1].isArtist === false &&
    featTokens[2].text === "Pharrell Williams" && featTokens[2].isArtist === true &&
    featTokens[3].text === " & " && featTokens[3].isArtist === false &&
    featTokens[4].text === "Nile Rodgers" && featTokens[4].isArtist === true,
    "parseArtistTokens handles 'feat.' and '&' delimiters preserving interactive token separation"
  );

  const slashTokens = parseArtistTokens("Artist 1 / Artist 2; Artist 3");
  assert(
    slashTokens.length === 5 &&
    slashTokens[0].text === "Artist 1" && slashTokens[0].isArtist === true &&
    slashTokens[1].text.includes("/") && slashTokens[1].isArtist === false &&
    slashTokens[2].text === "Artist 2" && slashTokens[2].isArtist === true &&
    slashTokens[3].text.includes(";") && slashTokens[3].isArtist === false &&
    slashTokens[4].text === "Artist 3" && slashTokens[4].isArtist === true,
    "parseArtistTokens handles '/' and ';' delimiters properly"
  );

  // 4d. formatTotalDuration
  console.log("  Testing formatTotalDuration()...");
  const totalDurationCases: Array<[number, string]> = [
    [0, "0 min"],
    [30, "0 min"],
    [60, "1 min"],
    [125, "2 min"],
    [3599, "59 min"],
    [3600, "1 hr 0 min"],
    [3661, "1 hr 1 min"],
    [7200, "2 hr 0 min"],
    [7325, "2 hr 2 min"],
    [86400, "24 hr 0 min"], // 24 hours
    [100000, "27 hr 46 min"], // large duration
    [360000, "100 hr 0 min"], // 100 hours
    [10000000, "2777 hr 46 min"], // huge seconds duration
  ];

  for (const [secs, expected] of totalDurationCases) {
    const res = formatTotalDuration(secs);
    assert(res === expected, `formatTotalDuration(${secs}s) -> '${res}' === '${expected}'`);
  }

  // 4e. formatDuration
  console.log("  Testing formatDuration()...");
  assert(formatDuration(0) === "0:00", "formatDuration(0) is '0:00'");
  assert(formatDuration(5) === "0:05", "formatDuration(5) is '0:05'");
  assert(formatDuration(65) === "1:05", "formatDuration(65) is '1:05'");
  assert(formatDuration(600) === "10:00", "formatDuration(600) is '10:00'");
  assert(formatDuration(3605) === "60:05", "formatDuration(3605) is '60:05'");

  // 4f. extractFeaturedArtistsFromTitle
  console.log("  Testing extractFeaturedArtistsFromTitle()...");
  assert(
    JSON.stringify(extractFeaturedArtistsFromTitle("Get Lucky (feat. Pharrell Williams)")) === JSON.stringify(["Pharrell Williams"]),
    "extractFeaturedArtistsFromTitle extracts from (feat. ...)"
  );
  assert(
    JSON.stringify(extractFeaturedArtistsFromTitle("Song [ft. Artist B & Artist C]")) === JSON.stringify(["Artist B", "Artist C"]),
    "extractFeaturedArtistsFromTitle extracts multiple artists from [ft. ...]"
  );
  assert(
    JSON.stringify(extractFeaturedArtistsFromTitle("Champion (with Lupe Fiasco)")) === JSON.stringify(["Lupe Fiasco"]),
    "extractFeaturedArtistsFromTitle extracts from (with ...)"
  );
  assert(
    JSON.stringify(extractFeaturedArtistsFromTitle("Standard Song Title")) === JSON.stringify([]),
    "extractFeaturedArtistsFromTitle returns empty array when no featured artist"
  );

  // 4g. extractArtistFromPath
  console.log("  Testing extractArtistFromPath()...");
  const path1 = "/home/user/Music/Radiohead/In Rainbows/01 15 Step.flac";
  assert(extractArtistFromPath(path1, "In Rainbows") === "Radiohead", "extractArtistFromPath extracted 'Radiohead' from directory tree");

  const path2 = "/music/Led Zeppelin - Physical Graffiti/01 Custard Pie.mp3";
  assert(extractArtistFromPath(path2) === "Led Zeppelin", "extractArtistFromPath extracted 'Led Zeppelin' from folder 'Artist - Album'");

  const path3 = "/media/01 - Daft Punk - One More Time.flac";
  assert(extractArtistFromPath(path3) === "Daft Punk", "extractArtistFromPath extracted 'Daft Punk' from track filename");

  // 4h. sortTracks, sortAlbums, sortArtists
  console.log("  Testing sortTracks, sortAlbums, sortArtists...");
  const sampleTracks = syntheticTracks.slice(0, 10);
  const sortedByTitleAsc = sortTracks(sampleTracks, "title", "asc");
  for (let i = 1; i < sortedByTitleAsc.length; i++) {
    const prev = (sortedByTitleAsc[i - 1].metadata.title || "").toLowerCase();
    const curr = (sortedByTitleAsc[i].metadata.title || "").toLowerCase();
    assert(prev <= curr, `sortTracks('title', 'asc') -> '${prev}' <= '${curr}'`);
  }

  const sortedByDurationDesc = sortTracks(sampleTracks, "duration", "desc");
  for (let i = 1; i < sortedByDurationDesc.length; i++) {
    const prev = sortedByDurationDesc[i - 1].metadata.duration?.secs || 0;
    const curr = sortedByDurationDesc[i].metadata.duration?.secs || 0;
    assert(prev >= curr, `sortTracks('duration', 'desc') -> ${prev}s >= ${curr}s`);
  }

  const sampleAlbums = libState.albums.slice(0, 8);
  const sortedAlbumsDesc = sortAlbums(sampleAlbums, "track_count", "desc");
  for (let i = 1; i < sortedAlbumsDesc.length; i++) {
    assert(
      sortedAlbumsDesc[i - 1].trackCount >= sortedAlbumsDesc[i].trackCount,
      `sortAlbums('track_count', 'desc') sorted descending`
    );
  }

  const sampleArtists = libState.artists.slice(0, 8);
  const sortedArtistsAsc = sortArtists(sampleArtists, "name", "asc");
  for (let i = 1; i < sortedArtistsAsc.length; i++) {
    assert(
      sortedArtistsAsc[i - 1].name.toLowerCase() <= sortedArtistsAsc[i].name.toLowerCase(),
      `sortArtists('name', 'asc') sorted alphabetically`
    );
  }

  // =========================================================================
  // SECTION 5: Hard Architectural Boundaries Automated Verification
  // =========================================================================
  console.log("\n--- 5. Testing Hard Architectural Boundaries (Cargo & Frontend) ---");

  const projectRoot = path.resolve(__dirname, "../..");
  const forbiddenDriverPackages = ["rusqlite", "lofty", "rodio", "zbus", "cpal", "gstreamer"];

  // Helper to read and scan directory files
  function getAllFiles(dirPath: string, extensions: string[]): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dirPath)) return files;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "target" && entry.name !== "dist" && entry.name !== ".git") {
          files.push(...getAllFiles(fullPath, extensions));
        }
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  // 5a. Check crates/core Cargo.toml & source files
  const coreCargoPath = path.join(projectRoot, "crates/core/Cargo.toml");
  assert(fs.existsSync(coreCargoPath), "crates/core/Cargo.toml exists");
  const coreCargoContent = fs.readFileSync(coreCargoPath, "utf-8");
  for (const pkg of forbiddenDriverPackages) {
    assert(
      !coreCargoContent.includes(`${pkg} =`) && !coreCargoContent.includes(`"${pkg}"`),
      `crates/core/Cargo.toml does not declare forbidden dependency '${pkg}'`
    );
  }

  const coreRsFiles = getAllFiles(path.join(projectRoot, "crates/core/src"), [".rs"]);
  assert(coreRsFiles.length > 0, `Found ${coreRsFiles.length} Rust files in crates/core/src`);
  for (const file of coreRsFiles) {
    const content = fs.readFileSync(file, "utf-8");
    for (const pkg of forbiddenDriverPackages) {
      assert(
        !content.includes(`use ${pkg}::`) && !content.includes(`extern crate ${pkg}`),
        `${path.relative(projectRoot, file)} has zero imports of forbidden driver '${pkg}'`
      );
    }
  }

  // 5b. Check crates/config Cargo.toml & source files
  const configCargoPath = path.join(projectRoot, "crates/config/Cargo.toml");
  if (fs.existsSync(configCargoPath)) {
    const configCargoContent = fs.readFileSync(configCargoPath, "utf-8");
    for (const pkg of forbiddenDriverPackages) {
      assert(
        !configCargoContent.includes(`${pkg} =`) && !configCargoContent.includes(`"${pkg}"`),
        `crates/config/Cargo.toml does not declare forbidden dependency '${pkg}'`
      );
    }
  }

  // 5c. Check crates/server Cargo.toml
  const serverCargoPath = path.join(projectRoot, "crates/server/Cargo.toml");
  if (fs.existsSync(serverCargoPath)) {
    const serverCargoContent = fs.readFileSync(serverCargoPath, "utf-8");
    for (const pkg of ["rusqlite", "lofty", "rodio", "zbus"]) {
      assert(
        !serverCargoContent.includes(`${pkg} =`),
        `crates/server/Cargo.toml does not declare direct driver dependency '${pkg}'`
      );
    }
  }

  // 5d. Check ui/package.json & frontend source code
  const uiPackageJsonPath = path.join(projectRoot, "ui/package.json");
  assert(fs.existsSync(uiPackageJsonPath), "ui/package.json exists");
  const uiPackageJson = JSON.parse(fs.readFileSync(uiPackageJsonPath, "utf-8"));
  const allDeps = { ...(uiPackageJson.dependencies || {}), ...(uiPackageJson.devDependencies || {}) };

  for (const pkg of forbiddenDriverPackages) {
    assert(!allDeps[pkg], `ui/package.json does not contain native driver dependency '${pkg}'`);
  }

  const uiSrcFiles = getAllFiles(path.join(projectRoot, "ui/src"), [".ts", ".tsx", ".js", ".jsx"]);
  assert(uiSrcFiles.length > 0, `Found ${uiSrcFiles.length} frontend source files in ui/src`);
  for (const file of uiSrcFiles) {
    const content = fs.readFileSync(file, "utf-8");
    for (const pkg of forbiddenDriverPackages) {
      assert(
        !content.includes(`from "${pkg}"`) &&
        !content.includes(`from '${pkg}'`) &&
        !content.includes(`require("${pkg}")`) &&
        !content.includes(`require('${pkg}')`),
        `${path.relative(projectRoot, file)} does not import native backend package '${pkg}'`
      );
    }
  }

  // 5e. Check ui/src-tauri/Cargo.toml for direct native driver leakage
  const tauriCargoPath = path.join(projectRoot, "ui/src-tauri/Cargo.toml");
  if (fs.existsSync(tauriCargoPath)) {
    const tauriCargoContent = fs.readFileSync(tauriCargoPath, "utf-8");
    for (const pkg of ["rusqlite", "lofty", "rodio", "zbus"]) {
      assert(
        !tauriCargoContent.includes(`${pkg} =`),
        `ui/src-tauri/Cargo.toml delegates to workspace crates and does not directly import '${pkg}'`
      );
    }
  }

  // 5f. Check audio/library/mpris isolation
  const audioCargoPath = path.join(projectRoot, "crates/audio/Cargo.toml");
  if (fs.existsSync(audioCargoPath)) {
    const audioCargoContent = fs.readFileSync(audioCargoPath, "utf-8");
    assert(!audioCargoContent.includes("rusqlite ="), "crates/audio does not depend on rusqlite");
    assert(!audioCargoContent.includes("lofty ="), "crates/audio does not depend on lofty");
    assert(!audioCargoContent.includes("zbus ="), "crates/audio does not depend on zbus");
  }

  const libraryCargoPath = path.join(projectRoot, "crates/library/Cargo.toml");
  if (fs.existsSync(libraryCargoPath)) {
    const libraryCargoContent = fs.readFileSync(libraryCargoPath, "utf-8");
    assert(!libraryCargoContent.includes("rodio ="), "crates/library does not depend on rodio");
    assert(!libraryCargoContent.includes("zbus ="), "crates/library does not depend on zbus");
  }

  const mprisCargoPath = path.join(projectRoot, "crates/mpris/Cargo.toml");
  if (fs.existsSync(mprisCargoPath)) {
    const mprisCargoContent = fs.readFileSync(mprisCargoPath, "utf-8");
    assert(!mprisCargoContent.includes("rodio ="), "crates/mpris does not depend on rodio");
    assert(!mprisCargoContent.includes("rusqlite ="), "crates/mpris does not depend on rusqlite");
    assert(!mprisCargoContent.includes("lofty ="), "crates/mpris does not depend on lofty");
  }

  console.log(`\n=======================================================`);
  console.log(`  ALL ${passedAssertions}/${totalAssertions} STORE, UTILS & ARCH TESTS PASSED`);
  console.log(`=======================================================\n`);

  return {
    passedAssertions,
    totalAssertions,
    success: true,
  };
}

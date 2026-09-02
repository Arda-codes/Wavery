/**
 * Empirical Challenger 1 Test Suite for Milestone 3
 * Stress testing frontend state management and string tokenizer utilities
 * 
 * 1. Rapid interleaved state transitions across navigationStore and settingsStore (5,000 randomized actions).
 * 2. Adversarial fuzzing and boundary condition testing on:
 *    - extractPrimaryArtist
 *    - splitArtists
 *    - parseArtistTokens
 *    - formatTotalDuration
 *    - formatDuration
 *    - extractFeaturedArtistsFromTitle
 * 3. ReDoS timing attack resistance on 10,000+ character strings with complex nested patterns.
 */

export async function runM3Challenger1Tests(jiti: any) {
  console.log("\n=======================================================");
  console.log("  EMPIRICAL CHALLENGER 1: M3 STATE STRESS & STRING FUZZ");
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

  // Load target modules via jiti
  const navigationStoreModule = jiti("../src/stores/navigationStore.ts");
  const settingsStoreModule = jiti("../src/stores/settingsStore.ts");
  const libUtils = jiti("../src/utils/library.ts");

  const { useNavigationStore } = navigationStoreModule;
  const { useSettingsStore } = settingsStoreModule;
  const {
    extractPrimaryArtist,
    splitArtists,
    parseArtistTokens,
    formatTotalDuration,
    formatDuration,
    extractFeaturedArtistsFromTitle,
  } = libUtils;

  // =========================================================================
  // SECTION 1: 5,000 Randomized Interleaved State Updates
  // =========================================================================
  console.log("--- 1. Testing Navigation & Settings Stores Under 5,000 Rapid Interleaved Updates ---");

  const viewModes = ["tracks", "artists", "albums", "artist_detail", "album_detail", "settings", "playlists"] as const;
  const sampleArtists = ["Radiohead", "Daft Punk", "Pink Floyd", "The Beatles", "Kendrick Lamar", "Björk", "Miles Davis", "Aphex Twin"];
  const sampleAlbums = ["In Rainbows", "Discovery", "Dark Side of the Moon", "Abbey Road", "DAMN.", "Homogenic", "Kind of Blue", "Drukqs"];
  const sampleQueries = ["", "rock", "electronic", "jazz", "remix 2024", "feat. drake", "🔥 playlist", "üñíçødé"];

  const startTime = performance.now();
  const NUM_ITERATIONS = 5000;

  for (let i = 0; i < NUM_ITERATIONS; i++) {
    const actionType = Math.floor(Math.random() * 9);

    switch (actionType) {
      case 0: { // navigate
        const targetView = viewModes[Math.floor(Math.random() * viewModes.length)];
        useNavigationStore.getState().navigate(targetView as any);
        const state = useNavigationStore.getState();
        assert(state.viewMode === targetView, `Iteration ${i}: navigate('${targetView}') set viewMode`);
        if (targetView === "tracks" || targetView === "artists" || targetView === "albums") {
          assert(state.selectedArtistName === null, `Iteration ${i}: main view reset selectedArtistName`);
          assert(state.selectedAlbumKey === null, `Iteration ${i}: main view reset selectedAlbumKey`);
        }
        break;
      }
      case 1: { // selectArtist
        const artist = sampleArtists[Math.floor(Math.random() * sampleArtists.length)];
        useNavigationStore.getState().selectArtist(artist);
        const state = useNavigationStore.getState();
        assert(state.viewMode === "artist_detail", `Iteration ${i}: selectArtist set viewMode='artist_detail'`);
        assert(state.selectedArtistName === artist, `Iteration ${i}: selectArtist set selectedArtistName='${artist}'`);
        assert(state.selectedAlbumKey === null, `Iteration ${i}: selectArtist reset selectedAlbumKey`);
        break;
      }
      case 2: { // selectAlbum
        const album = sampleAlbums[Math.floor(Math.random() * sampleAlbums.length)];
        const artist = sampleArtists[Math.floor(Math.random() * sampleArtists.length)];
        const fromArtist = Math.random() > 0.5 ? (Math.random() > 0.5) : undefined;
        const prevArtist = useNavigationStore.getState().selectedArtistName;
        const prevView = useNavigationStore.getState().viewMode;

        useNavigationStore.getState().selectAlbum(album, artist, fromArtist);
        const state = useNavigationStore.getState();
        assert(state.viewMode === "album_detail", `Iteration ${i}: selectAlbum set viewMode='album_detail'`);
        assert(
          state.selectedAlbumKey?.title === album && state.selectedAlbumKey?.artist === artist,
          `Iteration ${i}: selectAlbum set album key`
        );
        
        const expectedSource = fromArtist ?? (prevView === "artist_detail" || !!prevArtist);
        assert(state.navSource === (expectedSource ? "artists" : "albums"), `Iteration ${i}: navSource matches expectation`);
        break;
      }
      case 3: { // breadcrumbNavigate
        const targetView = viewModes[Math.floor(Math.random() * viewModes.length)];
        const artistBefore = useNavigationStore.getState().selectedArtistName;
        useNavigationStore.getState().breadcrumbNavigate(targetView as any);
        const state = useNavigationStore.getState();

        if (targetView === "artists") {
          assert(state.viewMode === "artists", `Iteration ${i}: breadcrumbNavigate('artists')`);
          assert(state.selectedArtistName === null && state.selectedAlbumKey === null, `Iteration ${i}: breadcrumb to artists reset state`);
        } else if (targetView === "artist_detail" && artistBefore) {
          assert(state.viewMode === "artist_detail", `Iteration ${i}: breadcrumbNavigate('artist_detail')`);
          assert(state.selectedArtistName === artistBefore, `Iteration ${i}: preserved artist`);
          assert(state.selectedAlbumKey === null, `Iteration ${i}: cleared album key`);
        } else if (targetView === "albums") {
          assert(state.viewMode === "albums", `Iteration ${i}: breadcrumbNavigate('albums')`);
          assert(state.selectedArtistName === null && state.selectedAlbumKey === null, `Iteration ${i}: breadcrumb to albums reset state`);
        } else if (targetView === "playlists") {
          assert(state.viewMode === "playlists", `Iteration ${i}: breadcrumbNavigate('playlists')`);
          assert(state.selectedArtistName === null && state.selectedAlbumKey === null, `Iteration ${i}: breadcrumb to playlists reset state`);
        } else if (targetView === "liked") {
          assert(state.viewMode === "liked", `Iteration ${i}: breadcrumbNavigate('liked')`);
          assert(state.selectedArtistName === null && state.selectedAlbumKey === null, `Iteration ${i}: breadcrumb to liked reset state`);
        } else {
          assert(state.viewMode === "tracks", `Iteration ${i}: breadcrumbNavigate fallback to tracks`);
          assert(state.selectedArtistName === null && state.selectedAlbumKey === null, `Iteration ${i}: breadcrumb to tracks reset state`);
        }
        break;
      }
      case 4: { // setGlobalSearch
        const query = sampleQueries[Math.floor(Math.random() * sampleQueries.length)];
        useNavigationStore.getState().setGlobalSearch(query);
        const state = useNavigationStore.getState();
        assert(state.globalSearch === query, `Iteration ${i}: globalSearch set to '${query}'`);
        break;
      }
      case 5: { // toggleSimplifyMode
        const prev = useSettingsStore.getState().simplifyMode;
        useSettingsStore.getState().toggleSimplifyMode();
        const state = useSettingsStore.getState();
        assert(state.simplifyMode === !prev, `Iteration ${i}: toggleSimplifyMode flipped flag`);
        assert(localStorageMock.getItem("wavery_simplify_mode") === String(!prev), `Iteration ${i}: localStorage updated`);
        assert(classSet.has("simplify-mode") === !prev, `Iteration ${i}: DOM classList synchronized`);
        break;
      }
      case 6: { // setSimplifyMode
        const targetVal = Math.random() > 0.5;
        useSettingsStore.getState().setSimplifyMode(targetVal);
        const state = useSettingsStore.getState();
        assert(state.simplifyMode === targetVal, `Iteration ${i}: setSimplifyMode(${targetVal})`);
        assert(localStorageMock.getItem("wavery_simplify_mode") === String(targetVal), `Iteration ${i}: localStorage matches`);
        assert(classSet.has("simplify-mode") === targetVal, `Iteration ${i}: DOM classList matches`);
        break;
      }
      case 7: { // dismissLinuxBanner
        useSettingsStore.getState().dismissLinuxBanner();
        const state = useSettingsStore.getState();
        assert(state.isLinuxBannerDismissed === true, `Iteration ${i}: dismissLinuxBanner set true`);
        assert(localStorageMock.getItem("wavery_linux_banner_dismissed") === "true", `Iteration ${i}: storage set`);
        break;
      }
      case 8: { // setLinuxBannerDismissed
        const targetVal = Math.random() > 0.5;
        useSettingsStore.getState().setLinuxBannerDismissed(targetVal);
        const state = useSettingsStore.getState();
        assert(state.isLinuxBannerDismissed === targetVal, `Iteration ${i}: setLinuxBannerDismissed(${targetVal})`);
        assert(localStorageMock.getItem("wavery_linux_banner_dismissed") === String(targetVal), `Iteration ${i}: storage set`);
        break;
      }
    }
  }

  const duration = performance.now() - startTime;
  console.log(`  ✓ Completed 5,000 rapid interleaved state updates in ${duration.toFixed(2)} ms (~${(5000 / (duration / 1000)).toFixed(0)} ops/sec)`);

  // =========================================================================
  // SECTION 2: Adversarial String Fuzzing on Tokenizer Utilities
  // =========================================================================
  console.log("\n--- 2. Adversarial Fuzzing on String Tokenizers ---");

  // 2a. Extreme Long String (10,000 chars)
  console.log("  Testing 10,000-character adversarial string inputs...");
  const longPrimary = "A".repeat(5000) + " feat. " + "B".repeat(4990);
  const t0 = performance.now();
  const primaryResult = extractPrimaryArtist(longPrimary);
  const t0_dur = performance.now() - t0;
  assert(primaryResult === "A".repeat(5000), "extractPrimaryArtist cleanly extracted 5000-char primary artist");
  assert(t0_dur < 100, `extractPrimaryArtist took ${t0_dur.toFixed(2)} ms (ReDoS safe < 100ms)`);

  const longMulti = Array.from({ length: 500 }, (_, i) => `Artist_${i}`).join(" / ");
  const t1 = performance.now();
  const splitResult = splitArtists(longMulti);
  const t1_dur = performance.now() - t1;
  assert(splitResult.length === 500, `splitArtists split 500 artists correctly`);
  assert(splitResult[0] === "Artist_0" && splitResult[499] === "Artist_499", "First and last artists match");
  assert(t1_dur < 100, `splitArtists took ${t1_dur.toFixed(2)} ms (< 100ms)`);

  const t2 = performance.now();
  const tokenResult = parseArtistTokens(longMulti);
  const t2_dur = performance.now() - t2;
  assert(tokenResult.length === 999, `parseArtistTokens created 999 tokens (500 artists + 499 delimiters)`);
  assert(t2_dur < 100, `parseArtistTokens took ${t2_dur.toFixed(2)} ms (< 100ms)`);

  // 2b. Nested Parentheticals & Brackets (Depth 100)
  console.log("  Testing deep nested parentheticals and adversarial brackets...");
  let nested = "Main Artist";
  for (let i = 0; i < 50; i++) {
    nested = `(${nested} [feat. SubArtist_${i} {with Collab_${i}}])`;
  }
  const t3 = performance.now();
  const nestedPrimary = extractPrimaryArtist(nested);
  const nestedSplit = splitArtists(nested);
  const nestedTokens = parseArtistTokens(nested);
  const t3_dur = performance.now() - t3;
  assert(typeof nestedPrimary === "string" && nestedPrimary.length > 0, "extractPrimaryArtist returned non-empty string on nested brackets");
  assert(Array.isArray(nestedSplit) && nestedSplit.length > 0, "splitArtists returned array on nested brackets");
  assert(Array.isArray(nestedTokens) && nestedTokens.length > 0, "parseArtistTokens returned tokens on nested brackets");
  assert(t3_dur < 100, `Nested bracket parsing completed in ${t3_dur.toFixed(2)} ms`);

  // 2c. Multilingual, RTL, CJK, Emoji, Diacritics, Zalgo & Control Characters
  console.log("  Testing multilingual, Unicode, RTL, CJK, Zalgo and control characters...");
  const unicodeCases = [
    // RTL Arabic
    "فيروز feat. نزار قباني & وديع الصافي",
    // Hebrew
    "אריק איינשטיין ft. שלום חנוך",
    // CJK
    "初音ミク feat. 巡音ルカ & 鏡音リン",
    "周杰倫 with 蔡依林 / 方文山",
    "BTS (방탄소년단) feat. Halsey",
    // Emoji
    "🎵 CyberPunk 2077 🤖 feat. 🎸 RockStar 🔥 & 🎧 DJ Master ⚡",
    // Zalgo / Combining diacritics
    "Z̸a̸l̸g̸o̸ feat. D̸a̸r̸k̸n̸e̸s̸s̸",
    // Non-standard spacing and zero-width chars
    "Artist\u200BA\u200C feat. Artist\u00A0B\uFEFF & Artist\u2003C",
    // Newlines, tabs, carriage returns, null bytes
    "Artist\nOne\t\r feat. Artist\x00Two ; Artist Three",
    // Special punctuations & punctuation only
    ";;; /// ,,, &&& feat. ft. with vs.",
    "--- === +++ *** ??? !!!",
    "   ",
    "",
    null as any,
    undefined as any,
    // Artist names with punctuation as identity
    "AC/DC",
    "Sunn O)))",
    "Panic! At The Disco",
    "Earth, Wind & Fire",
    "Crosby, Stills, Nash & Young",
    "Simon & Garfunkel",
    "Tyler, The Creator",
    "!!! (Chk Chk Chk)",
    "$uicideboy$",
    "P!nk",
    "Ke$ha",
    "deadmau5",
  ];

  for (const input of unicodeCases) {
    const prim = extractPrimaryArtist(input);
    assert(typeof prim === "string", `extractPrimaryArtist(${JSON.stringify(input)}) -> string '${prim}'`);

    const split = splitArtists(input);
    assert(Array.isArray(split) && split.length > 0, `splitArtists(${JSON.stringify(input)}) -> array of length ${split.length}`);
    for (const item of split) {
      assert(typeof item === "string" && item.length > 0, `split artist item is non-empty string: '${item}'`);
    }

    const tokens = parseArtistTokens(input);
    assert(Array.isArray(tokens) && tokens.length > 0, `parseArtistTokens(${JSON.stringify(input)}) -> tokens array`);
    for (const tok of tokens) {
      assert(typeof tok.text === "string", "token text is string");
      assert(typeof tok.isArtist === "boolean", "token isArtist is boolean");
    }
  }

  // 2d. formatTotalDuration & formatDuration boundary values
  console.log("  Testing formatTotalDuration and formatDuration boundary numbers...");
  const durationTestValues = [
    { input: 0, expTotal: "0 min", expDur: "0:00" },
    { input: 1, expTotal: "0 min", expDur: "0:01" },
    { input: 59, expTotal: "0 min", expDur: "0:59" },
    { input: 60, expTotal: "1 min", expDur: "1:00" },
    { input: 3599, expTotal: "59 min", expDur: "59:59" },
    { input: 3600, expTotal: "1 hr 0 min", expDur: "60:00" },
    { input: 3661, expTotal: "1 hr 1 min", expDur: "61:01" },
    { input: 7200, expTotal: "2 hr 0 min", expDur: "120:00" },
    { input: 86400, expTotal: "24 hr 0 min", expDur: "1440:00" },
    { input: 1000000, expTotal: "277 hr 46 min", expDur: "16666:40" },
    { input: -10, expTotal: "0 min", expDur: "-1:00" },
    { input: 123.456, expTotal: "2 min", expDur: "2:03" },
    { input: NaN, expTotal: "0 min", expDur: "NaN:NaN" },
    { input: undefined as any, expTotal: "0 min", expDur: "0:00" },
  ];

  for (const item of durationTestValues) {
    const total = formatTotalDuration(item.input);
    assert(typeof total === "string" && !total.includes("undefined"), `formatTotalDuration(${item.input}) -> '${total}'`);
    const dur = formatDuration(item.input);
    assert(typeof dur === "string", `formatDuration(${item.input}) -> '${dur}'`);
  }

  // 2e. extractFeaturedArtistsFromTitle boundaries
  console.log("  Testing extractFeaturedArtistsFromTitle adversarial cases...");
  const titleCases = [
    { title: "Song (feat. Artist A & Artist B)", expected: ["Artist A", "Artist B"] },
    { title: "Song [ft. Artist X, Artist Y / Artist Z]", expected: ["Artist X", "Artist Y", "Artist Z"] },
    { title: "Song {featuring Collab 1 with Collab 2}", expected: ["Collab 1", "Collab 2"] },
    { title: "Song (feat. Artist A", expected: ["Artist A"] },
    { title: "Song [ft. Artist B", expected: ["Artist B"] },
    { title: "Standard Song (Acoustic Version) [Live 2024]", expected: [] },
    { title: "", expected: [] },
    { title: undefined as any, expected: [] },
  ];

  for (const tc of titleCases) {
    const res = extractFeaturedArtistsFromTitle(tc.title);
    assert(Array.isArray(res), `extractFeaturedArtistsFromTitle(${JSON.stringify(tc.title)}) returned array`);
    if (tc.expected.length > 0) {
      assert(
        JSON.stringify(res) === JSON.stringify(tc.expected),
        `extractFeaturedArtistsFromTitle(${JSON.stringify(tc.title)}) -> ${JSON.stringify(res)} === ${JSON.stringify(tc.expected)}`
      );
    }
  }

  // =========================================================================
  // SECTION 3: ReDoS (Regular Expression DOS) Stress Harness
  // =========================================================================
  console.log("\n--- 3. ReDoS Timing & Catastrophic Backtracking Stress ---");

  const redosPayloads = [
    "feat. ".repeat(1000) + "Artist",
    "A".repeat(2000) + " feat. " + " ".repeat(2000) + "B",
    "feat. " + "a".repeat(3000) + " with " + "b".repeat(3000) + " vs. " + "c".repeat(3000),
    " / / / ".repeat(500) + "Artist" + " ; ; ; ".repeat(500),
    "((((((((((".repeat(200) + "feat. Artist" + "))))))))))".repeat(200),
    "A & ".repeat(1000) + "Z",
  ];

  for (let i = 0; i < redosPayloads.length; i++) {
    const payload = redosPayloads[i];
    const t0 = performance.now();
    const p = extractPrimaryArtist(payload);
    const s = splitArtists(payload);
    const tok = parseArtistTokens(payload);
    const dur = performance.now() - t0;

    assert(dur < 100, `ReDoS Payload #${i + 1} (length ${payload.length}) processed in ${dur.toFixed(2)} ms (< 100ms budget)`);
    assert(typeof p === "string" && Array.isArray(s) && Array.isArray(tok), `ReDoS Payload #${i + 1} produced valid structures`);
  }

  console.log(`\n=======================================================`);
  console.log(`  ALL ${passedAssertions}/${totalAssertions} CHALLENGER 1 STRESS TESTS PASSED`);
  console.log(`=======================================================\n`);

  return {
    passedAssertions,
    totalAssertions,
    success: true,
  };
}

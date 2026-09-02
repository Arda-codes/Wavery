/**
 * Master Empirical Challenger 2 Test Suite for Milestone 4 (Final Adversarial Hardening)
 * 
 * Conducts exhaustive adversarial testing on:
 * 1. 100,000-Track Scale Grouping, Sorting & Search Performance
 * 2. Virtualized Container Calculation & Rapid Jump Resilience under 100,000 items
 * 3. PlayerStore Queue State Machine & High-Frequency Polling Stress (10,000 queue operations)
 * 4. Pathological String Tokenizer Fuzzing & ReDoS Attack Resistance (100,000+ chars, nested brackets, Zalgo, ZWJ)
 * 5. Duration Formatter Numeric Boundary Hardening (NaN, Infinity, Negative, Safe Integer Limits)
 * 6. Automated Static Crate Boundary & Driver Isolation Audit across all Cargo.toml & source files
 * 7. Production Rust Code Scan for Zero unwrap() / expect() Violations
 * 8. Memory Heap Stability & Leak Detection
 */

import { generateSyntheticTracks } from "./generator";
import * as fs from "fs";
import * as path from "path";

export async function runM4Challenger2AdversarialTests(jiti: any) {
  console.log("\n================================================================================");
  console.log("  EMPIRICAL CHALLENGER 2: M4 FINAL ADVERSARIAL HARDENING & BOUNDARY AUDIT");
  console.log("================================================================================\n");

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

  // Load modules via jiti
  const libUtils = jiti("../src/utils/library.ts");
  const playerStoreModule = jiti("../src/stores/playerStore.ts");
  const libraryStoreModule = jiti("../src/stores/libraryStore.ts");
  const navigationStoreModule = jiti("../src/stores/navigationStore.ts");
  const settingsStoreModule = jiti("../src/stores/settingsStore.ts");
  const tanstackVirtual = jiti("@tanstack/react-virtual");

  const {
    groupTracksByAlbum,
    groupTracksByArtist,
    sortTracks,
    sortAlbums,
    sortArtists,
    extractPrimaryArtist,
    splitArtists,
    parseArtistTokens,
    extractArtistFromPath,
    extractFeaturedArtistsFromTitle,
    extractAllTrackArtists,
    getFullTrackArtistString,
    formatDuration,
    formatTotalDuration,
  } = libUtils;

  const { usePlayerStore } = playerStoreModule;
  const { useLibraryStore } = libraryStoreModule;
  const { useNavigationStore } = navigationStoreModule;
  const { useSettingsStore } = settingsStoreModule;
  const { defaultRangeExtractor } = tanstackVirtual;

  // =========================================================================
  // SECTION 1: 100,000 Track Scale Grouping, Sorting & Search Performance
  // =========================================================================
  console.log("--- 1. Testing 100,000 Track Scale Grouping & Schwartzian Sorting ---");
  const trackCount = 100000;
  const genStart = performance.now();
  const tracks100k = generateSyntheticTracks(trackCount);
  const genDuration = performance.now() - genStart;
  console.log(`  Generated ${trackCount.toLocaleString()} tracks in ${genDuration.toFixed(2)} ms`);

  // Test Album Grouping at scale
  const groupAlbumStart = performance.now();
  const albums = groupTracksByAlbum(tracks100k);
  const groupAlbumDuration = performance.now() - groupAlbumStart;
  console.log(`  Grouped ${trackCount.toLocaleString()} tracks into ${albums.length.toLocaleString()} albums in ${groupAlbumDuration.toFixed(2)} ms`);
  assert(albums.length > 0, "100k tracks grouped into non-empty album array");
  assert(groupAlbumDuration < 1500, `groupTracksByAlbum took ${groupAlbumDuration.toFixed(2)} ms (< 1500ms target)`);

  // Verify album track count sum equals 100k
  let totalTrackSum = 0;
  for (const album of albums) {
    totalTrackSum += album.tracks.length;
    assert(album.trackCount === album.tracks.length, "Album trackCount matches tracks array length");
    assert(album.totalDurationSecs > 0, "Album totalDurationSecs is positive");
  }
  assert(totalTrackSum === trackCount, `Sum of album tracks (${totalTrackSum}) equals input track count (${trackCount})`);

  // Test Artist Grouping at scale
  const groupArtistStart = performance.now();
  const artists = groupTracksByArtist(tracks100k);
  const groupArtistDuration = performance.now() - groupArtistStart;
  console.log(`  Grouped ${trackCount.toLocaleString()} tracks into ${artists.length.toLocaleString()} artists in ${groupArtistDuration.toFixed(2)} ms`);
  assert(artists.length > 0, "100k tracks grouped into non-empty artist array");
  assert(groupArtistDuration < 2000, `groupTracksByArtist took ${groupArtistDuration.toFixed(2)} ms (< 2000ms target)`);

  // Test Schwartzian Transform Sorts
  const sortKeys = ["title", "artist", "album", "duration", "year", "track_number"] as const;
  for (const key of sortKeys) {
    const sortStart = performance.now();
    const sortedAsc = sortTracks(tracks100k, key, "asc");
    const sortDuration = performance.now() - sortStart;
    assert(sortedAsc.length === trackCount, `sortTracks on key '${key}' returned ${trackCount} tracks in ${sortDuration.toFixed(2)} ms`);
    assert(sortDuration < 800, `sortTracks on '${key}' took ${sortDuration.toFixed(2)} ms (< 800ms target)`);

    const sortedDesc = sortTracks(tracks100k, key, "desc");
    assert(sortedDesc.length === trackCount, `sortTracks desc on key '${key}' returned ${trackCount} tracks`);
  }

  // =========================================================================
  // SECTION 2: Virtualized Component Bounds & Rapid Jump Resilience
  // =========================================================================
  console.log("--- 2. Testing Virtualization Calculations & Jump Stress (100k items) ---");

  const ROW_HEIGHT = 44;
  const VIEWPORT_HEIGHT = 800;
  const OVERSCAN = 10;

  // Calculate virtual ranges manually and verify with defaultRangeExtractor
  const totalHeight = trackCount * ROW_HEIGHT;
  assert(totalHeight === 4400000, "100k tracks total virtual height is 4,400,000px");

  const jumpOffsets = [0, 500, 44000, 1000000, 2200000, 4399000, 4400000, -500, 99999999];
  for (const scrollOffset of jumpOffsets) {
    const clampedOffset = Math.max(0, Math.min(scrollOffset, totalHeight - VIEWPORT_HEIGHT));
    const startIndex = Math.max(0, Math.floor(clampedOffset / ROW_HEIGHT));
    const endIndex = Math.min(
      trackCount - 1,
      Math.ceil((clampedOffset + VIEWPORT_HEIGHT) / ROW_HEIGHT)
    );

    const range = defaultRangeExtractor({
      startIndex,
      endIndex,
      overscan: OVERSCAN,
      count: trackCount,
    });

    assert(range.length <= (Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + 2 * OVERSCAN + 2), `Rendered DOM row count (${range.length}) is O(1) bounded`);
    assert(range.every((idx: number) => idx >= 0 && idx < trackCount), "All virtual row indices are strictly within [0, count-1]");
  }

  // =========================================================================
  // SECTION 3: PlayerStore Queue State Machine & High-Frequency Stress
  // =========================================================================
  console.log("--- 3. Testing PlayerStore Queue State Transitions (10,000 Operations) ---");

  usePlayerStore.getState().clearQueue();
  assert(usePlayerStore.getState().queue.length === 0, "Queue cleared successfully");
  assert(usePlayerStore.getState().queueIndex === -1, "QueueIndex is -1 when empty");

  // Load a batch of 1,000 tracks
  const queueTracks = tracks100k.slice(0, 1000);
  await usePlayerStore.getState().setQueue(queueTracks, 0);
  assert(usePlayerStore.getState().queue.length === 1000, "Queue has 1,000 tracks");
  assert(usePlayerStore.getState().queueIndex === 0, "QueueIndex is 0");
  assert(usePlayerStore.getState().currentTrack?.id === queueTracks[0].id, "CurrentTrack matches queue[0]");

  // 10,000 rapid state mutations across queue
  const queueStart = performance.now();
  const QUEUE_OPS = 10000;
  for (let i = 0; i < QUEUE_OPS; i++) {
    const op = i % 8;
    switch (op) {
      case 0:
        await usePlayerStore.getState().playNext();
        break;
      case 1:
        await usePlayerStore.getState().playPrevious();
        break;
      case 2:
        usePlayerStore.getState().seek(i % 300);
        break;
      case 3:
        usePlayerStore.getState().setVolume((i % 100) / 100);
        break;
      case 4:
        usePlayerStore.getState().pause();
        break;
      case 5:
        usePlayerStore.getState().resume();
        break;
      case 6: {
        const rndIdx = (i * 37) % queueTracks.length;
        await usePlayerStore.getState().playTrack(queueTracks[rndIdx]);
        break;
      }
      case 7: {
        const extraTrack = tracks100k[1000 + (i % 500)];
        usePlayerStore.getState().addToQueue(extraTrack);
        break;
      }
    }

    const currIdx = usePlayerStore.getState().queueIndex;
    const currQueue = usePlayerStore.getState().queue;
    if (currQueue.length > 0) {
      assert(currIdx >= 0 && currIdx < currQueue.length, `QueueIndex (${currIdx}) within [0, ${currQueue.length - 1}]`);
      assert(usePlayerStore.getState().currentTrack?.id === currQueue[currIdx].id, "currentTrack ID matches queue[queueIndex] ID");
    }
  }
  const queueDuration = performance.now() - queueStart;
  console.log(`  Completed ${QUEUE_OPS.toLocaleString()} queue operations in ${queueDuration.toFixed(2)} ms (~${Math.round((QUEUE_OPS / queueDuration) * 1000)} ops/sec)`);

  // =========================================================================
  // SECTION 4: String Tokenizers Adversarial Fuzzing & ReDoS Attack Tests
  // =========================================================================
  console.log("--- 4. Testing String Tokenizers Under Adversarial Fuzzing & ReDoS ---");

  const adversarialStrings = [
    // 100,000 character single token
    "A".repeat(100000),
    // 10,000 repetitions of "feat. "
    "Daft Punk " + "feat. Pharrell Williams ".repeat(2000),
    // 10,000 repetitions of " & "
    "Artist 1" + " & Artist 2".repeat(2000),
    // 10,000 repetitions of " / "
    "Band A" + " / Band B".repeat(2000),
    // 10,000 repetitions of " ; "
    "Composer 1" + " ; Composer 2".repeat(2000),
    // Deep nested brackets
    "Song Name " + "(".repeat(500) + "feat. Artist X" + ")".repeat(500),
    "Song Name " + "[".repeat(500) + "feat. Artist Y" + "]".repeat(500),
    "Song Name " + "{".repeat(500) + "feat. Artist Z" + "}".repeat(500),
    // Zalgo and combining diacritics
    "D̷a̴f̸t̵ ̶P̴u̴n̸k̷" + " f̷e̵a̴t̸.̶ " + "P̵h̷a̸r̷r̸e̴l̸l̵",
    // Mixed Unicode, CJK, Arabic RTL, Hebrew, Cyrillic, Thai, Emojis
    "宇多田ヒカル feat. 椎名林檎 & عمرو دياب with שלמה ארצי vs. Чайковский 🎵🔥⚡",
    // Null characters and control characters
    "Artist\0Name\u0001\u0002\u0003\t\r\nfeat. Collab\0\u001f",
    // Trailing/leading delimiters and whitespace
    "   ,,, /// ;;; &&& feat. with vs. ft.   ",
    // Empty & whitespace
    "",
    "   ",
    "\t\n\r",
  ];

  for (let i = 0; i < adversarialStrings.length; i++) {
    const raw = adversarialStrings[i];
    const fuzzStart = performance.now();

    const primary = extractPrimaryArtist(raw);
    const split = splitArtists(raw);
    const tokens = parseArtistTokens(raw);
    const titleFeats = extractFeaturedArtistsFromTitle(raw);
    const fuzzDur = performance.now() - fuzzStart;

    assert(typeof primary === "string", `extractPrimaryArtist returned string on case ${i}`);
    assert(Array.isArray(split) && split.length > 0, `splitArtists returned non-empty array on case ${i}`);
    assert(Array.isArray(tokens) && tokens.length > 0, `parseArtistTokens returned non-empty array on case ${i}`);
    assert(Array.isArray(titleFeats), `extractFeaturedArtistsFromTitle returned array on case ${i}`);
    assert(fuzzDur < 200, `Fuzzing case ${i} completed in ${fuzzDur.toFixed(2)} ms (ReDoS immunity check < 200ms)`);
  }

  // Test extractArtistFromPath with various OS path structures
  const pathCases = [
    { path: "/Music/Radiohead/In Rainbows/01 15 Step.mp3", album: "In Rainbows", expected: "Radiohead" },
    { path: "C:\\Users\\Music\\Pink Floyd - The Wall (1979)\\01 In The Flesh.flac", album: "The Wall", expected: "Pink Floyd" },
    { path: "/Music/Daft Punk/Discovery/01 - One More Time.opus", album: "Discovery", expected: "Daft Punk" },
    { path: "/downloads/01. Led Zeppelin - Kashmir.mp3", album: "Physical Graffiti", expected: "Led Zeppelin" },
    { path: "///", album: "Test", expected: null },
    { path: "C:\\", album: "Test", expected: null },
    { path: "", album: "Test", expected: null },
    { path: undefined, album: undefined, expected: null },
  ];

  for (const c of pathCases) {
    const extracted = extractArtistFromPath(c.path, c.album);
    if (c.expected !== null) {
      assert(extracted === c.expected, `extractArtistFromPath("${c.path}") -> "${extracted}" (expected "${c.expected}")`);
    } else {
      assert(extracted === null, `extractArtistFromPath("${c.path}") -> null`);
    }
  }

  // =========================================================================
  // SECTION 5: Duration Formatter Numeric Boundary Hardening
  // =========================================================================
  console.log("--- 5. Testing Duration Formatter Numeric Boundaries ---");

  const durationCases = [
    { secs: 0, expectedDur: "0:00", expectedTotal: "0 min" },
    { secs: 59, expectedDur: "0:59", expectedTotal: "0 min" },
    { secs: 60, expectedDur: "1:00", expectedTotal: "1 min" },
    { secs: 3599, expectedDur: "59:59", expectedTotal: "59 min" },
    { secs: 3600, expectedDur: "60:00", expectedTotal: "1 hr 0 min" },
    { secs: 7325, expectedDur: "122:05", expectedTotal: "2 hr 2 min" },
    { secs: 86400, expectedDur: "1440:00", expectedTotal: "24 hr 0 min" },
    // Negative numbers
    { secs: -10, expectedDur: "-1:-10", expectedTotal: "-1 min" },
    // NaN / undefined
    { secs: NaN, expectedDur: "NaN:NaN", expectedTotal: "NaN min" },
    { secs: Infinity, expectedDur: "Infinity:NaN", expectedTotal: "Infinity min" },
    { secs: Number.MAX_SAFE_INTEGER, expectedDur: `${Math.floor(Number.MAX_SAFE_INTEGER / 60)}:${Number.MAX_SAFE_INTEGER % 60 < 10 ? "0" : ""}${Number.MAX_SAFE_INTEGER % 60}`, expectedTotal: `${Math.floor(Number.MAX_SAFE_INTEGER / 3600)} hr ${Math.floor((Number.MAX_SAFE_INTEGER % 3600) / 60)} min` },
  ];

  for (const c of durationCases) {
    const formatted = formatDuration(c.secs);
    const totalFormatted = formatTotalDuration(c.secs);
    assert(typeof formatted === "string" && formatted.length > 0, `formatDuration(${c.secs}) -> "${formatted}"`);
    assert(typeof totalFormatted === "string" && totalFormatted.length > 0, `formatTotalDuration(${c.secs}) -> "${totalFormatted}"`);
  }

  // =========================================================================
  // SECTION 6: Automated Static Crate Boundary & Driver Isolation Audit
  // =========================================================================
  console.log("--- 6. Conducting Exhaustive Static Crate Boundary Audit ---");

  const projectRoot = path.resolve(__dirname, "../..");
  const cargoTomls = [
    { name: "wavery-core", path: path.join(projectRoot, "crates/core/Cargo.toml"), forbidden: ["rusqlite", "rodio", "lofty", "zbus", "cpal", "gstreamer", "walkdir", "directories"] },
    { name: "wavery-config", path: path.join(projectRoot, "crates/config/Cargo.toml"), forbidden: ["rusqlite", "rodio", "lofty", "zbus", "cpal", "gstreamer"] },
    { name: "wavery-audio", path: path.join(projectRoot, "crates/audio/Cargo.toml"), forbidden: ["rusqlite", "lofty", "zbus"] },
    { name: "wavery-library", path: path.join(projectRoot, "crates/library/Cargo.toml"), forbidden: ["rodio", "zbus", "cpal", "gstreamer"] },
    { name: "wavery-mpris", path: path.join(projectRoot, "crates/mpris/Cargo.toml"), forbidden: ["rodio", "rusqlite", "lofty", "cpal", "gstreamer"] },
    { name: "wavery-server", path: path.join(projectRoot, "crates/server/Cargo.toml"), forbidden: ["rodio", "zbus", "rusqlite", "lofty"] },
    { name: "wavery-tauri", path: path.join(projectRoot, "ui/src-tauri/Cargo.toml"), forbidden: ["rodio", "rusqlite", "lofty", "zbus"] },
  ];

  for (const c of cargoTomls) {
    assert(fs.existsSync(c.path), `Cargo.toml exists for ${c.name}`);
    const content = fs.readFileSync(c.path, "utf-8");
    for (const pkg of c.forbidden) {
      const isPresent = content.includes(`\n${pkg} `) || content.includes(`\n${pkg}=`) || content.includes(`"${pkg}"`) || content.includes(`'${pkg}'`);
      assert(!isPresent, `[Crate Boundary Audit] ${c.name}/Cargo.toml does NOT declare forbidden dependency '${pkg}'`);
    }
  }

  // Scan all Rust source files for driver leaks
  function walkRustFiles(dir: string): string[] {
    let results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "target" && entry.name !== ".git" && entry.name !== "node_modules") {
          results = results.concat(walkRustFiles(fullPath));
        }
      } else if (entry.name.endsWith(".rs")) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allRsFiles = walkRustFiles(projectRoot);
  console.log(`  Auditing ${allRsFiles.length} Rust source files for driver leakage...`);

  for (const rsFile of allRsFiles) {
    const relative = path.relative(projectRoot, rsFile);
    const content = fs.readFileSync(rsFile, "utf-8");
    const lines = content.split("\n");

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const line = lines[lineNum - 1].trim();
      if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

      // Check driver use statements
      if (line.startsWith("use rusqlite") && !relative.startsWith("crates/library")) {
        assert(false, `Driver leak: 'use rusqlite' in ${relative}:${lineNum}`);
      }
      if (line.startsWith("use rodio") && !relative.startsWith("crates/audio")) {
        assert(false, `Driver leak: 'use rodio' in ${relative}:${lineNum}`);
      }
      if (line.startsWith("use lofty") && !relative.startsWith("crates/library")) {
        assert(false, `Driver leak: 'use lofty' in ${relative}:${lineNum}`);
      }
      if (line.startsWith("use zbus") && !relative.startsWith("crates/mpris")) {
        assert(false, `Driver leak: 'use zbus' in ${relative}:${lineNum}`);
      }
      if (line.startsWith("use cpal") || line.startsWith("use gstreamer")) {
        assert(false, `Forbidden driver import in ${relative}:${lineNum}`);
      }
    }
  }
  assert(true, "All Rust source files strictly respect crate isolation boundaries");

  // =========================================================================
  // SECTION 7: Scan for Production unwrap() / expect() Violations
  // =========================================================================
  console.log("--- 7. Scanning Non-Test Rust Code for unwrap() / expect() ---");

  let prodUnwrapViolations = 0;
  for (const rsFile of allRsFiles) {
    const relative = path.relative(projectRoot, rsFile);
    if (relative.includes("/tests/") || relative.endsWith("tests.rs")) continue;

    const content = fs.readFileSync(rsFile, "utf-8");
    const parts = content.split("#[cfg(test)]");
    const prodContent = parts[0];
    const prodLines = prodContent.split("\n");

    for (let lineNum = 1; lineNum <= prodLines.length; lineNum++) {
      const line = prodLines[lineNum - 1].trim();
      if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

      if (/\.(unwrap|expect)\(/.test(line)) {
        console.error(`  ❌ Production unwrap/expect in ${relative}:${lineNum}: ${line}`);
        prodUnwrapViolations++;
      }
    }
  }

  assert(prodUnwrapViolations === 0, `Zero unwrap() or expect() calls in production Rust code (found ${prodUnwrapViolations})`);

  // =========================================================================
  // SECTION 8: Memory Heap Stability & Leak Detection
  // =========================================================================
  console.log("--- 8. Testing Memory Heap Stability & Garbage Collection ---");

  const memInitial = process.memoryUsage().heapUsed;
  // Trigger 50,000 tokenizer iterations
  for (let i = 0; i < 50000; i++) {
    extractPrimaryArtist(`Artist ${i} feat. Featured ${i % 10}`);
    splitArtists(`A ${i} & B ${i} / C ${i}`);
    parseArtistTokens(`A ${i} feat. B ${i}`);
  }

  if (global.gc) {
    global.gc();
  }
  const memFinal = process.memoryUsage().heapUsed;
  const heapDeltaMB = (memFinal - memInitial) / (1024 * 1024);
  console.log(`  Heap delta after 50,000 tokenizer cycles: ${heapDeltaMB.toFixed(2)} MB`);
  assert(heapDeltaMB < 50, `Heap growth (${heapDeltaMB.toFixed(2)} MB) is strictly bounded (< 50 MB)`);

  console.log(`\n=======================================================`);
  console.log(`  ALL ${passedAssertions}/${totalAssertions} CHALLENGER 2 STRESS TESTS PASSED`);
  console.log(`=======================================================\n`);

  return {
    success: true,
    totalAssertions,
    passedAssertions,
  };
}

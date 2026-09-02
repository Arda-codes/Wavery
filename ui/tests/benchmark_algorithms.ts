import { generateSyntheticTracks, Track } from "./generator";

// We use dynamic require via jiti runner or local imports
export function runAlgorithmBenchmarks(lib: any) {
  console.log("\n=======================================================");
  console.log("  EMPIRICAL BENCHMARKS: FRONTEND DATA ALGORITHMS");
  console.log("=======================================================\n");

  const SIZES = [1000, 10000, 50000];
  const results: Record<string, any> = {};

  for (const count of SIZES) {
    console.log(`--- Benchmarking Dataset Size: ${count.toLocaleString()} tracks ---`);
    const tracks = generateSyntheticTracks(count);

    // 1. sortTracks by String Key (Title, Artist, Album)
    const stringKeys = ["title", "artist", "album"] as const;
    for (const key of stringKeys) {
      // Force GC if available or record memory
      if (global.gc) global.gc();
      const memBefore = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      const sortedAsc = lib.sortTracks(tracks, key, "asc");
      const t1 = performance.now();
      const sortedDesc = lib.sortTracks(tracks, key, "desc");
      const t2 = performance.now();
      const memAfter = process.memoryUsage().heapUsed;

      const durationAsc = t1 - t0;
      const durationDesc = t2 - t1;
      const throughput = (count / ((durationAsc + durationDesc) / 2000)).toFixed(0);

      console.log(
        `  [sortTracks] key=${key.padEnd(6)} | asc: ${durationAsc.toFixed(2).padStart(6)} ms | desc: ${durationDesc.toFixed(2).padStart(6)} ms | throughput: ${throughput.padStart(9)} tracks/sec | Heap Δ: ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MB`
      );

      // Verify correctness
      if (sortedAsc.length !== count || sortedDesc.length !== count) {
        throw new Error(`Length mismatch for sortTracks ${key}`);
      }
      const firstAsc = (sortedAsc[0].metadata as any)[key] || "";
      const lastAsc = (sortedAsc[count - 1].metadata as any)[key] || "";
      if (firstAsc.toLowerCase() > lastAsc.toLowerCase()) {
        throw new Error(`Ascending sort invariant violated for key ${key}: ${firstAsc} > ${lastAsc}`);
      }

      results[`sortTracks_${key}_${count}`] = {
        count,
        durationAscMs: durationAsc,
        durationDescMs: durationDesc,
        throughputTracksPerSec: Number(throughput),
      };
    }

    // 2. sortTracks by Numeric Key (duration, track_number, date_added, year)
    const numericKeys = ["duration", "track_number", "date_added", "year"] as const;
    for (const key of numericKeys) {
      const t0 = performance.now();
      const sortedAsc = lib.sortTracks(tracks, key, "asc");
      const t1 = performance.now();
      const sortedDesc = lib.sortTracks(tracks, key, "desc");
      const t2 = performance.now();

      const durationAsc = t1 - t0;
      const durationDesc = t2 - t1;
      const throughput = (count / ((durationAsc + durationDesc) / 2000)).toFixed(0);

      console.log(
        `  [sortTracks] key=${key.padEnd(12)} | asc: ${durationAsc.toFixed(2).padStart(6)} ms | desc: ${durationDesc.toFixed(2).padStart(6)} ms | throughput: ${throughput.padStart(9)} tracks/sec`
      );

      results[`sortTracks_${key}_${count}`] = {
        count,
        durationAscMs: durationAsc,
        durationDescMs: durationDesc,
        throughputTracksPerSec: Number(throughput),
      };
    }

    // 3. groupTracksByArtist Benchmark (O(N) single-pass)
    if (global.gc) global.gc();
    const memBeforeArtist = process.memoryUsage().heapUsed;
    const tStartArtist = performance.now();
    const artists = lib.groupTracksByArtist(tracks);
    const tEndArtist = performance.now();
    const memAfterArtist = process.memoryUsage().heapUsed;

    const artistDuration = tEndArtist - tStartArtist;
    const artistThroughput = (count / (artistDuration / 1000)).toFixed(0);
    const totalGroupedTracks = artists.reduce((sum: number, a: any) => sum + a.trackCount, 0);

    console.log(
      `  [groupTracksByArtist] ${count} tracks -> ${artists.length} artists | Time: ${artistDuration.toFixed(2)} ms | Throughput: ${artistThroughput} tracks/sec | Heap Δ: ${((memAfterArtist - memBeforeArtist) / 1024 / 1024).toFixed(2)} MB`
    );

    if (totalGroupedTracks !== count) {
      throw new Error(`groupTracksByArtist dropped tracks: expected ${count}, got ${totalGroupedTracks}`);
    }

    results[`groupTracksByArtist_${count}`] = {
      count,
      artistCount: artists.length,
      durationMs: artistDuration,
      throughputTracksPerSec: Number(artistThroughput),
      heapDeltaMb: (memAfterArtist - memBeforeArtist) / 1024 / 1024,
    };

    // 4. groupTracksByAlbum Benchmark
    const tStartAlbum = performance.now();
    const albums = lib.groupTracksByAlbum(tracks);
    const tEndAlbum = performance.now();
    const albumDuration = tEndAlbum - tStartAlbum;
    const albumThroughput = (count / (albumDuration / 1000)).toFixed(0);

    console.log(
      `  [groupTracksByAlbum]  ${count} tracks -> ${albums.length} albums  | Time: ${albumDuration.toFixed(2)} ms | Throughput: ${albumThroughput} tracks/sec`
    );

    results[`groupTracksByAlbum_${count}`] = {
      count,
      albumCount: albums.length,
      durationMs: albumDuration,
      throughputTracksPerSec: Number(albumThroughput),
    };

    // 5. Search Filtering Benchmark
    const queries = ["pink", "dark side", "radio", "vol. 5", "nonexistent_query_xyz"];
    for (const q of queries) {
      const t0 = performance.now();
      const qLower = q.toLowerCase();
      const filtered = tracks.filter((t: Track) => {
        const title = t.metadata.title?.toLowerCase() || "";
        const artist = t.metadata.artist?.toLowerCase() || "";
        const album = t.metadata.album?.toLowerCase() || "";
        return title.includes(qLower) || artist.includes(qLower) || album.includes(qLower);
      });
      const t1 = performance.now();
      const searchTime = t1 - t0;
      console.log(
        `  [SearchFilter] query="${q.padEnd(22)}" -> ${filtered.length.toString().padStart(5)} matches | Time: ${searchTime.toFixed(2)} ms`
      );
      results[`search_${q}_${count}`] = {
        query: q,
        matchCount: filtered.length,
        durationMs: searchTime,
      };
    }

    console.log();
  }

  // Edge cases verification
  console.log("--- Verifying Edge Cases for Algorithms ---");
  // Empty list
  const emptySort = lib.sortTracks([], "title", "asc");
  const emptyArtists = lib.groupTracksByArtist([]);
  const emptyAlbums = lib.groupTracksByAlbum([]);
  if (emptySort.length !== 0 || emptyArtists.length !== 0 || emptyAlbums.length !== 0) {
    throw new Error("Empty track list handling failed");
  }

  // Single item
  const single = generateSyntheticTracks(1);
  const singleSort = lib.sortTracks(single, "title", "desc");
  const singleArtists = lib.groupTracksByArtist(single);
  if (singleSort.length !== 1 || singleArtists.length !== 1 || singleArtists[0].trackCount !== 1) {
    throw new Error("Single track handling failed");
  }

  // Missing / undefined metadata
  const missingMetaTrack: Track = {
    id: "empty-meta",
    path: "/test.mp3",
    date_added: 0,
    metadata: {},
  };
  const mixedTracks = [single[0], missingMetaTrack];
  const mixedSorted = lib.sortTracks(mixedTracks, "title", "asc");
  const mixedArtists = lib.groupTracksByArtist(mixedTracks);
  if (mixedSorted.length !== 2 || mixedArtists.length < 1) {
    throw new Error("Missing metadata handling failed");
  }
  console.log("  ✓ All edge cases passed successfully (empty arrays, singletons, missing metadata).");

  return results;
}

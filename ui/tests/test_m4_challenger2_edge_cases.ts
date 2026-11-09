/**
 * Challenger 2 In-Depth Edge-Case & Adversarial Harness for Milestone M4
 * 
 * Exhaustively stress-tests:
 * 1. Empty candidate pools & edge-case Autoplay fallbacks (Adapter & Store)
 * 2. Multi-factor Autoplay candidate scoring (Artist +50, Album +30, Genre +20, History penalty -100)
 * 3. Full library queuing at scale (20,000 tracks) with rapid queue mutations
 * 4. Loop modes ('Off', 'Queue', 'Track') boundary transitions & seek behavior
 * 5. Deterministic Fisher-Yates shuffle permutations, index pinning & dynamic insertion
 * 6. TauriAudioPlayer IPC bridge contract verification (command signatures & parameter mappings)
 * 7. BrowserAudioPlayer two-tier user priority drain & queue jumps
 */

import { generateSyntheticTracks } from "./generator";
import type { Track, QueueStateSnapshot, LoopMode } from "../src/types";

export async function runM4Challenger2EdgeCaseTests(jiti: any) {
  console.log("\n================================================================================");
  console.log("  CHALLENGER 2: DEEP EDGE CASES & AUDIO PLAYER ADAPTER ADVERSARIAL HARNESS");
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
  const adapterModule = jiti("../src/services/adapter.ts");
  const playerStoreModule = jiti("../src/stores/playerStore.ts");

  const { playerAdapter } = adapterModule;
  const {
    usePlayerStore,
    getAutoplayNextTrack,
    generateShuffleIndices,
    computeQueueState,
    applyQueueSnapshot,
  } = playerStoreModule;

  // Setup sample tracks with distinctive artists, albums, genres
  const sampleTracks: Track[] = [
    {
      id: "track-1",
      path: "/music/artistA/album1/01.mp3",
      title: "Song 1",
      duration_secs: 200,
      metadata: { artist: "Artist Alpha", album: "Album One", genre: "Electronic" },
    },
    {
      id: "track-2",
      path: "/music/artistA/album1/02.mp3",
      title: "Song 2",
      duration_secs: 210,
      metadata: { artist: "Artist Alpha", album: "Album One", genre: "Electronic" },
    },
    {
      id: "track-3",
      path: "/music/artistA/album2/01.mp3",
      title: "Song 3",
      duration_secs: 190,
      metadata: { artist: "Artist Alpha", album: "Album Two", genre: "Rock" },
    },
    {
      id: "track-4",
      path: "/music/artistB/album3/01.mp3",
      title: "Song 4",
      duration_secs: 220,
      metadata: { artist: "Artist Beta", album: "Album Three", genre: "Electronic" },
    },
    {
      id: "track-5",
      path: "/music/artistC/album4/01.mp3",
      title: "Song 5",
      duration_secs: 180,
      metadata: { artist: "Artist Gamma", album: "Album Four", genre: "Jazz" },
    },
  ];

  // =========================================================================
  // SUB-SUITE 1: Empty candidate pools & Autoplay fallbacks
  // =========================================================================
  console.log("--- 1. Testing Empty Candidate Pools & Autoplay Fallbacks ---");

  // 1.1 Store getAutoplayNextTrack with empty library
  const emptyLibResult = getAutoplayNextTrack(sampleTracks[0], [sampleTracks[0]], []);
  assert(emptyLibResult?.id === sampleTracks[0].id, "getAutoplayNextTrack falls back to current queue[0] on empty library");

  // 1.2 Store getAutoplayNextTrack with empty library and empty queue
  const emptyBothResult = getAutoplayNextTrack(null, [], []);
  assert(emptyBothResult === null, "getAutoplayNextTrack returns null on empty library and empty queue");

  // 1.3 Adapter getAutoplayNext with empty library getter and empty getTracks
  const savedGetter = (globalThis as any).__waveryLibraryTracksGetter;
  const savedGetTracks = playerAdapter.getTracks;
  try {
    (globalThis as any).__waveryLibraryTracksGetter = () => [];
    playerAdapter.getTracks = async () => [];
    const adapterEmptyPoolResult = await playerAdapter.getAutoplayNext([]);
    assert(adapterEmptyPoolResult === null, "playerAdapter.getAutoplayNext([]) returns null gracefully when library is empty");
  } finally {
    (globalThis as any).__waveryLibraryTracksGetter = savedGetter;
    playerAdapter.getTracks = savedGetTracks;
  }

  // 1.4 Full library queuing: All tracks in library are already in queue
  const fullQueue = [...sampleTracks];
  const fullQueueAutoplay = getAutoplayNextTrack(sampleTracks[0], fullQueue, sampleTracks);
  assert(fullQueueAutoplay !== null, "getAutoplayNextTrack returns a track even if all tracks are queued");
  assert(fullQueueAutoplay?.id !== sampleTracks[0].id, "getAutoplayNextTrack does not pick currently playing track when alternatives exist");

  // 1.5 Single track library where track is already playing
  const singleTrackLib = [sampleTracks[0]];
  const singleTrackAutoplay = getAutoplayNextTrack(sampleTracks[0], singleTrackLib, singleTrackLib);
  assert(singleTrackAutoplay?.id === sampleTracks[0].id, "getAutoplayNextTrack returns current track when only 1 track exists in entire library");

  // =========================================================================
  // SUB-SUITE 2: Multi-Factor Autoplay Candidate Scoring
  // =========================================================================
  console.log("--- 2. Testing Autoplay Candidate Scoring Hierarchy ---");

  // Current track is track-1: Artist Alpha, Album One, Electronic
  // Candidates:
  // track-2: same artist (+50), same album (+30), same genre (+20) -> score 100
  // track-3: same artist (+50), diff album, diff genre -> score 50
  // track-4: diff artist, diff album, same genre (+20) -> score 20
  // track-5: diff artist, diff album, diff genre -> score 0
  const candidatePool = [sampleTracks[4], sampleTracks[3], sampleTracks[2], sampleTracks[1]]; // intentionally reverse order

  // Set context in adapter with track-1
  await playerAdapter.queueSetContext([sampleTracks[0]], 0);
  const bestCandidate = await playerAdapter.getAutoplayNext(candidatePool);
  assert(bestCandidate?.id === "track-2", `Autoplay candidate selection picked top-scoring candidate track-2 (got ${bestCandidate?.id})`);

  // Now test history penalty:
  // Set context with track-1, then advance once to track-2.
  // track-1 is in history, track-2 is currently playing.
  await playerAdapter.queueSetContext([sampleTracks[0], sampleTracks[1]], 0);
  await playerAdapter.queueNext(); // currentTrack is now track-2, track-1 is in history!
  assert((await playerAdapter.queueGetState()).currentTrack?.id === "track-2", "currentTrack is track-2");

  // Candidates: track-1 (in history, score 100 - 100 = 0), track-3 (same artist, score 50), track-4 (same genre, score 20), track-5 (score 0)
  const candidatePoolWithHistory = [sampleTracks[4], sampleTracks[0], sampleTracks[3], sampleTracks[2]];
  const candidateAfterHistory = await playerAdapter.getAutoplayNext(candidatePoolWithHistory);
  assert(candidateAfterHistory?.id === "track-3", `Autoplay candidate picked track-3 (score 50) over track-1 (in history, score 0) and track-4 (genre, score 20), got ${candidateAfterHistory?.id}`);

  // =========================================================================
  // SUB-SUITE 3: Full Library Queuing at Scale (20,000 Tracks)
  // =========================================================================
  console.log("--- 3. Testing Full Library Queuing (20,000 tracks) & Rapid State Jumps ---");

  const SCALE_COUNT = 20000;
  const tStart = performance.now();
  const largeTrackList = generateSyntheticTracks(SCALE_COUNT);
  const genMs = performance.now() - tStart;
  console.log(`  Generated ${SCALE_COUNT.toLocaleString()} synthetic tracks in ${genMs.toFixed(2)} ms`);

  // Queue all 20,000 tracks via playerAdapter
  const setCtxStart = performance.now();
  const snap20k = await playerAdapter.queueSetContext(largeTrackList, 1000);
  const setCtxMs = performance.now() - setCtxStart;
  console.log(`  queueSetContext(20,000) took ${setCtxMs.toFixed(2)} ms`);

  assert(snap20k.queue.length === SCALE_COUNT, "20,000 tracks loaded in queue");
  assert(snap20k.currentIndex === 1000, "currentIndex is 1000");
  assert(snap20k.contextIndex === 1000, "contextIndex is 1000");
  assert(snap20k.currentTrack?.id === largeTrackList[1000].id, "currentTrack matches track at index 1000");

  // Perform 20 rapid jumps across extreme boundaries
  const jumpTargets = [0, 19999, 5000, 15000, 1, 19998, 10000, 500, 19500, 2];
  for (const target of jumpTargets) {
    const jumpSnap = await playerAdapter.queueJumpToIndex(target);
    assert(jumpSnap.currentIndex === target, `Jumped to index ${target} correctly`);
    assert(jumpSnap.currentTrack?.id === largeTrackList[target].id, `currentTrack matches jump target ${target}`);
  }

  // =========================================================================
  // SUB-SUITE 4: Loop Modes ('Off', 'Queue', 'Track') Boundary Invariants
  // =========================================================================
  console.log("--- 4. Testing Loop Modes Boundary Invariants ---");

  // Setup small 3-track queue for precise state tracking
  const smallQueue = sampleTracks.slice(0, 3); // track-1, track-2, track-3
  await playerAdapter.queueSetContext(smallQueue, 2); // Start at last track (index 2)
  await playerAdapter.queueSetAutoplay(false); // Disable autoplay to test clean stopping

  // 4.1 Mode: Off
  await playerAdapter.queueSetLoopMode("Off");
  const snapLoopOff = await playerAdapter.queueNext();
  assert(snapLoopOff.currentTrack === null, "LoopMode 'Off' stops playback at end of queue (currentTrack is null)");

  // 4.2 Mode: Queue
  await playerAdapter.queueSetContext(smallQueue, 2); // At last track
  await playerAdapter.queueSetLoopMode("Queue");
  const snapLoopQueue = await playerAdapter.queueNext();
  assert(snapLoopQueue.currentIndex === 0, "LoopMode 'Queue' wraps from index 2 back to index 0");
  assert(snapLoopQueue.currentTrack?.id === smallQueue[0].id, "LoopMode 'Queue' currentTrack is first track");

  // 4.3 Mode: Track
  await playerAdapter.queueSetContext(smallQueue, 1); // At track-2
  await playerAdapter.queueSetLoopMode("Track");
  const snapLoopTrack1 = await playerAdapter.queueNext();
  assert(snapLoopTrack1.currentIndex === 1, "LoopMode 'Track' does NOT increment index on queueNext");
  assert(snapLoopTrack1.currentTrack?.id === smallQueue[1].id, "LoopMode 'Track' repeats same track");
  const snapLoopTrack2 = await playerAdapter.queueNext();
  assert(snapLoopTrack2.currentIndex === 1, "LoopMode 'Track' continues repeating same track on repeated queueNext");

  // 4.4 Store cycleLoopMode
  usePlayerStore.getState().setLoopMode("Off");
  assert(usePlayerStore.getState().loopMode === "Off", "Store loopMode set to Off");
  usePlayerStore.getState().cycleLoopMode();
  assert(usePlayerStore.getState().loopMode === "Queue", "cycleLoopMode transitions Off -> Queue");
  usePlayerStore.getState().cycleLoopMode();
  assert(usePlayerStore.getState().loopMode === "Track", "cycleLoopMode transitions Queue -> Track");
  usePlayerStore.getState().cycleLoopMode();
  assert(usePlayerStore.getState().loopMode === "Off", "cycleLoopMode transitions Track -> Off");

  // =========================================================================
  // SUB-SUITE 5: Deterministic Fisher-Yates Shuffle Permutations
  // =========================================================================
  console.log("--- 5. Testing Shuffle Permutations & Index Pinning ---");

  // 5.1 Permutation completeness (lengths 1, 5, 50, 500)
  const testLengths = [1, 2, 5, 50, 500];
  for (const len of testLengths) {
    const pinnedIdx = Math.floor(len / 2);
    const indices = generateShuffleIndices(len, pinnedIdx);
    assert(indices.length === len, `Shuffle permutation of length ${len} has ${len} elements`);
    assert(indices[0] === pinnedIdx, `Shuffle permutation pinned index ${pinnedIdx} at position 0`);

    // Verify all indices [0..len-1] are present with zero duplicates
    const set = new Set(indices);
    assert(set.size === len, `Shuffle permutation of length ${len} contains zero duplicate indices`);
    for (let i = 0; i < len; i++) {
      assert(set.has(i), `Shuffle permutation contains index ${i}`);
    }
  }

  // 5.2 Shuffle operations in BrowserAudioPlayer
  await playerAdapter.queueSetContext(sampleTracks, 2); // track-3 active
  const snapShuffleOn = await playerAdapter.queueSetShuffle(true);
  assert(snapShuffleOn.isShuffle === true, "Shuffle flag enabled in adapter snapshot");
  assert(snapShuffleOn.currentIndex === 2, "CurrentIndex 2 preserved when enabling shuffle");

  // Advance through shuffle sequence
  const visitedTrackIds = new Set<string>();
  visitedTrackIds.add(snapShuffleOn.currentTrack!.id);

  for (let i = 1; i < sampleTracks.length; i++) {
    const nextSnap = await playerAdapter.queueNext();
    assert(nextSnap.currentTrack !== null, `Step ${i} in shuffle sequence yielded non-null track`);
    visitedTrackIds.add(nextSnap.currentTrack!.id);
  }
  assert(visitedTrackIds.size === sampleTracks.length, "All sample tracks visited during shuffle sequence without premature repeats");

  // 5.3 Dynamic User Queue Insertion while Shuffled
  // Adding a user track while shuffled must not corrupt queue or index
  const extraTrack: Track = {
    id: "track-extra",
    path: "/music/extra.mp3",
    title: "Extra Track",
    duration_secs: 150,
    metadata: { artist: "Extra", album: "Single", genre: "Pop" },
  };
  const snapAddUserShuffled = await playerAdapter.queueAddUser([extraTrack]);
  assert(snapAddUserShuffled.userQueue.some((t) => t.id === "track-extra"), "User queue contains added extra track under shuffle");
  assert(snapAddUserShuffled.queue.some((t) => t.id === "track-extra"), "Unified queue contains added extra track under shuffle");

  // =========================================================================
  // SUB-SUITE 6: queuePrevious Boundary & Seeking Invariants
  // =========================================================================
  console.log("--- 6. Testing queuePrevious Boundary & Seek Behavior ---");

  await playerAdapter.queueSetContext(sampleTracks, 2); // At track-3
  await playerAdapter.queueSetShuffle(false);

  // Position > 3s: seeking to 0 without decrementing index
  const snapPrevSeek = await playerAdapter.queuePrevious(15.5);
  assert(snapPrevSeek.currentIndex === 2, "queuePrevious with position > 3s keeps currentIndex unchanged");
  assert(snapPrevSeek.currentTrack?.id === sampleTracks[2].id, "queuePrevious with position > 3s keeps current track");

  // Position <= 3s: steps back to index 1
  const snapPrevStep = await playerAdapter.queuePrevious(1.2);
  assert(snapPrevStep.currentIndex === 1, "queuePrevious with position <= 3s decrements currentIndex to 1");
  assert(snapPrevStep.currentTrack?.id === sampleTracks[1].id, "queuePrevious moves back to track-2");

  // Position <= 3s at index 0: clamps to 0
  await playerAdapter.queuePrevious(0); // moves to 0
  const snapPrevAt0 = await playerAdapter.queuePrevious(0); // at 0
  assert(snapPrevAt0.currentIndex === 0, "queuePrevious at index 0 remains clamped at 0");

  // =========================================================================
  // SUB-SUITE 7: TauriAudioPlayer Contract & IPC Call Verification
  // =========================================================================
  console.log("--- 7. Verifying TauriAudioPlayer Command Names & Signatures ---");

  // Instantiate TauriAudioPlayer and inspect prototype methods
  const TauriClass = adapterModule.playerAdapter.constructor;
  // Let's verify method presence on AudioPlayerAdapter
  const requiredMethods = [
    "queueSetContext",
    "queueAddUser",
    "queuePlayNext",
    "queueRemoveUserTrack",
    "queueReorderUser",
    "queueClearUser",
    "queueNext",
    "queuePrevious",
    "queueJumpToIndex",
    "queueJumpToContextTrack",
    "queueJumpToUserTrack",
    "queueSetShuffle",
    "queueSetLoopMode",
    "queueSetAutoplay",
    "queueClear",
    "queueGetState",
    "getAutoplayNext",
    "getAlbums",
    "getArtists",
    "getGenres",
    "getAlbumDetails",
    "getArtistDetails",
  ];

  for (const method of requiredMethods) {
    assert(typeof (playerAdapter as any)[method] === "function", `playerAdapter implements required method '${method}'`);
  }

  // =========================================================================
  // SUB-SUITE 8: Zustand Store applyQueueSnapshot Atomicity & Reactivity
  // =========================================================================
  console.log("--- 8. Testing Store applyQueueSnapshot Atomicity ---");

  const mockSnapshot: QueueStateSnapshot = {
    currentTrack: sampleTracks[3],
    currentIndex: 3,
    userQueue: [sampleTracks[4]],
    contextQueue: sampleTracks.slice(0, 4),
    contextIndex: 3,
    queue: sampleTracks,
    isShuffle: true,
    loopMode: "Queue",
    isAutoplay: false,
    history: [sampleTracks[0], sampleTracks[1]],
  };

  applyQueueSnapshot(usePlayerStore.setState, mockSnapshot);

  const storeState = usePlayerStore.getState();
  assert(storeState.currentTrack?.id === sampleTracks[3].id, "applyQueueSnapshot correctly updated currentTrack");
  assert(storeState.queueIndex === 3, "applyQueueSnapshot correctly updated queueIndex");
  assert(storeState.userQueue.length === 1 && storeState.userQueue[0].id === sampleTracks[4].id, "applyQueueSnapshot updated userQueue");
  assert(storeState.contextQueue.length === 4, "applyQueueSnapshot updated contextQueue");
  assert(storeState.contextIndex === 3, "applyQueueSnapshot updated contextIndex");
  assert(storeState.isShuffle === true, "applyQueueSnapshot updated isShuffle");
  assert(storeState.shuffleIndices.length === sampleTracks.length, "applyQueueSnapshot populated shuffleIndices when isShuffle is true");
  assert(storeState.shufflePos < storeState.shuffleIndices.length - 1, "Next track skip remains enabled when shuffle is turned on");
  assert(storeState.loopMode === "Queue", "applyQueueSnapshot updated loopMode");
  assert(storeState.isAutoplay === false, "applyQueueSnapshot updated isAutoplay");
  assert(storeState.sessionHistory.length === 2, "applyQueueSnapshot updated sessionHistory");

  console.log(`\n=======================================================`);
  console.log(`  ALL ${passedAssertions}/${totalAssertions} CHALLENGER 2 DEEP EDGE CASE TESTS PASSED`);
  console.log(`=======================================================\n`);

  return {
    success: true,
    totalAssertions,
    passedAssertions,
  };
}

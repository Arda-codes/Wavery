/**
 * Empirical Challenger 1 Test Suite for Milestone M4 (Frontend Thinning & IPC Integration)
 * 
 * Verifies:
 * 1. Two-tier priority queue transitions:
 *    - playNextInUserQueue (head insertion, order preservation)
 *    - addToUserQueue (tail insertion, order preservation)
 *    - playNext priority drainage (userQueue drained before contextQueue advances)
 *    - playPrevious step-back and >3s seek restart behavior
 *    - Direct jumps (jumpToUserQueueItem, jumpToContextTrack, jumpToQueueIndex)
 *    - User queue mutation (reorderUserQueue, removeFromUserQueue, clearUserQueue)
 *    - Track deletion handling (handleTrackDeleted) across current, userQueue, and contextQueue
 *    - Loop modes (Track, Queue, Off) and Autoplay transitions
 * 2. LibraryStore integration & CRUD:
 *    - setTracks, getAlbumDetails, getArtistDetails
 *    - toggleLike optimistic Set and array synchronization
 * 3. Rapid sequential and concurrent state mutations:
 *    - 5,000 rapid sequential store operations
 *    - 1,000 concurrent async mutations via Promise.all batches
 *    - Invariant checks: bounded indices, no null/undefined holes, no NaNs
 */

import { generateSyntheticTracks, Track } from "./generator";

export async function runChallenger1EmpiricalTests(jiti: any) {
  console.log("\n================================================================================");
  console.log("  EMPIRICAL CHALLENGER 1: TWO-TIER QUEUE & CONCURRENT MUTATION STRESS");
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
  const playerStoreModule = jiti("../src/stores/playerStore.ts");
  const libraryStoreModule = jiti("../src/stores/libraryStore.ts");
  const settingsStoreModule = jiti("../src/stores/settingsStore.ts");
  const libUtils = jiti("../src/utils/library.ts");

  const { usePlayerStore, computeQueueState } = playerStoreModule;
  const { useLibraryStore } = libraryStoreModule;
  const { useSettingsStore } = settingsStoreModule;

  // Disable auto-resume for predictable deterministic test state
  useSettingsStore.setState({ autoResumePlayback: false, crossfadeDurationMs: 0 });

  const syntheticTracks = generateSyntheticTracks(200);

  // =========================================================================
  // SECTION 1: Two-Tier Priority Queue Ordering & Drainage Invariants
  // =========================================================================
  console.log("--- 1. Testing Two-Tier Priority Queue Ordering & Invariants ---");

  // Reset player store
  usePlayerStore.getState().clearQueue();
  assert(usePlayerStore.getState().queue.length === 0, "Initial queue is empty");
  assert(usePlayerStore.getState().userQueue.length === 0, "Initial userQueue is empty");
  assert(usePlayerStore.getState().contextQueue.length === 0, "Initial contextQueue is empty");

  // Setup context tracks C0, C1, C2, C3, C4
  const cTracks = syntheticTracks.slice(0, 5);
  await usePlayerStore.getState().setQueue(cTracks, 0);

  let pState = usePlayerStore.getState();
  assert(pState.contextQueue.length === 5, "Context queue has 5 tracks (C0..C4)");
  assert(pState.contextIndex === 0, "Context index is at 0 (C0)");
  assert(pState.currentTrack?.id === cTracks[0].id, "Current track is C0");
  assert(pState.userQueue.length === 0, "User queue is empty initially");

  // Add tracks to tail of user queue: addToUserQueue([U1, U2])
  const u1 = syntheticTracks[10];
  const u2 = syntheticTracks[11];
  usePlayerStore.getState().addToUserQueue([u1, u2]);

  pState = usePlayerStore.getState();
  assert(pState.userQueue.length === 2, "userQueue has 2 tracks after addToUserQueue");
  assert(pState.userQueue[0].id === u1.id, "userQueue[0] is U1");
  assert(pState.userQueue[1].id === u2.id, "userQueue[1] is U2");

  // Add track to head of user queue: playNextInUserQueue([U0])
  const u0 = syntheticTracks[12];
  usePlayerStore.getState().playNextInUserQueue(u0);

  pState = usePlayerStore.getState();
  assert(pState.userQueue.length === 3, "userQueue has 3 tracks after playNextInUserQueue");
  assert(pState.userQueue[0].id === u0.id, "userQueue[0] is U0 (head priority)");
  assert(pState.userQueue[1].id === u1.id, "userQueue[1] is U1");
  assert(pState.userQueue[2].id === u2.id, "userQueue[2] is U2");

  // Verify unified queue representation places userQueue immediately after current context track
  // Expected unified queue: [C0, U0, U1, U2, C1, C2, C3, C4]
  assert(pState.queue.length === 8, "Unified queue length is 8 (1 context current + 3 user + 4 remaining context)");
  assert(pState.queue[0].id === cTracks[0].id, "queue[0] is C0");
  assert(pState.queue[1].id === u0.id, "queue[1] is U0");
  assert(pState.queue[2].id === u1.id, "queue[2] is U1");
  assert(pState.queue[3].id === u2.id, "queue[3] is U2");
  assert(pState.queue[4].id === cTracks[1].id, "queue[4] is C1");

  // Drain #1: playNext() must play U0 (first user queue track)
  await usePlayerStore.getState().playNext();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === u0.id, "Drain 1: playNext() played U0 from userQueue");
  assert(pState.userQueue.length === 2, "Drain 1: userQueue decremented to 2 tracks");
  assert(pState.userQueue[0].id === u1.id, "Drain 1: next user track is U1");
  assert(pState.contextIndex === 0, "Drain 1: contextIndex remains 0 (context has not advanced yet)");

  // Drain #2: playNext() must play U1
  await usePlayerStore.getState().playNext();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === u1.id, "Drain 2: playNext() played U1 from userQueue");
  assert(pState.userQueue.length === 1, "Drain 2: userQueue decremented to 1 track");
  assert(pState.userQueue[0].id === u2.id, "Drain 2: next user track is U2");
  assert(pState.contextIndex === 0, "Drain 2: contextIndex remains 0");

  // Drain #3: playNext() must play U2
  await usePlayerStore.getState().playNext();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === u2.id, "Drain 3: playNext() played U2 from userQueue");
  assert(pState.userQueue.length === 0, "Drain 3: userQueue is now empty");
  assert(pState.contextIndex === 0, "Drain 3: contextIndex remains 0");

  // Drain #4: playNext() with empty userQueue must now advance contextQueue from C0 to C1!
  await usePlayerStore.getState().playNext();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === cTracks[1].id, "Drain 4: playNext() advanced contextQueue to C1");
  assert(pState.contextIndex === 1, "Drain 4: contextIndex is now 1");
  assert(pState.userQueue.length === 0, "Drain 4: userQueue remains empty");

  // Drain #5: playNext() advances to C2
  await usePlayerStore.getState().playNext();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === cTracks[2].id, "Drain 5: playNext() advanced contextQueue to C2");
  assert(pState.contextIndex === 2, "Drain 5: contextIndex is now 2");

  // =========================================================================
  // SECTION 2: playPrevious Position > 3s vs <= 3s & Step-Back
  // =========================================================================
  console.log("--- 2. Testing playPrevious Position Threshold & Step-Back ---");

  // When position > 3 seconds: seeks to 0 without changing track
  usePlayerStore.setState({
    status: { ...usePlayerStore.getState().status, position_secs: 15 },
  });
  await usePlayerStore.getState().playPrevious();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === cTracks[2].id, "playPrevious with pos > 3s keeps current track C2");

  // When position <= 3 seconds: steps back to previous track C1
  usePlayerStore.setState({
    status: { ...usePlayerStore.getState().status, position_secs: 1 },
  });
  await usePlayerStore.getState().playPrevious();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === cTracks[1].id, "playPrevious with pos <= 3s stepped back to C1");
  assert(pState.contextIndex === 1, "contextIndex stepped back to 1");

  // Stepping back from C1 (which followed U2 in playback history):
  // Should step back to U2
  await usePlayerStore.getState().playPrevious();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === u2.id, "playPrevious stepped back to U2 (played before C1)");

  // Step back to U1
  await usePlayerStore.getState().playPrevious();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === u1.id, "playPrevious stepped back to U1");

  // Step back to U0
  await usePlayerStore.getState().playPrevious();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === u0.id, "playPrevious stepped back to U0");

  // Step back to C0
  await usePlayerStore.getState().playPrevious();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === cTracks[0].id, "playPrevious stepped back to C0");
  assert(pState.contextIndex === 0, "contextIndex is 0");

  // Step back at beginning of queue (index 0): should stay at 0
  await usePlayerStore.getState().playPrevious();
  pState = usePlayerStore.getState();
  assert(pState.contextIndex === 0, "playPrevious at index 0 remains at index 0");

  // =========================================================================
  // SECTION 3: Direct Jumps (jumpToUserQueueItem, jumpToContextTrack, jumpToQueueIndex)
  // =========================================================================
  console.log("--- 3. Testing Direct Jumps & Queue Invariants ---");

  // Populate userQueue with 3 tracks [J0, J1, J2]
  const jTracks = syntheticTracks.slice(20, 23);
  usePlayerStore.getState().addToUserQueue(jTracks);

  pState = usePlayerStore.getState();
  assert(pState.userQueue.length === 3, "userQueue has 3 jump candidates");

  // Direct jump to userQueue item at index 1 (J1)
  await usePlayerStore.getState().jumpToUserQueueItem(1);
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === jTracks[1].id, "jumpToUserQueueItem(1) played J1");
  assert(pState.userQueue.length === 2, "jumpToUserQueueItem consumed J1 from userQueue");
  assert(pState.userQueue.some(t => t.id === jTracks[0].id), "J0 remains in userQueue");
  assert(pState.userQueue.some(t => t.id === jTracks[2].id), "J2 remains in userQueue");

  // Direct jump to context track at index 3 (C3)
  await usePlayerStore.getState().jumpToContextTrack(3);
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === cTracks[3].id, "jumpToContextTrack(3) played C3");
  assert(pState.contextIndex === 3, "contextIndex is 3");
  // User queue must remain intact across context jumps
  assert(pState.userQueue.length === 2, "userQueue preserved across context jump");

  // Direct jump to unified queue index
  // Current queue has C3, followed by [J0, J2], followed by [C4]
  const targetQueueIdx = pState.queue.findIndex(t => t.id === cTracks[4].id);
  assert(targetQueueIdx !== -1, "Found C4 in unified queue");
  await usePlayerStore.getState().jumpToQueueIndex(targetQueueIdx);
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === cTracks[4].id, "jumpToQueueIndex played C4");

  // Out of bounds jump tests (should not throw or corrupt state)
  await usePlayerStore.getState().jumpToUserQueueItem(-5);
  await usePlayerStore.getState().jumpToUserQueueItem(999);
  await usePlayerStore.getState().jumpToContextTrack(-1);
  await usePlayerStore.getState().jumpToContextTrack(999);
  await usePlayerStore.getState().jumpToQueueIndex(-1);
  await usePlayerStore.getState().jumpToQueueIndex(999);
  assert(usePlayerStore.getState().currentTrack?.id === cTracks[4].id, "State unchanged after invalid out-of-bounds jumps");

  // =========================================================================
  // SECTION 4: User Queue Reordering, Removal and Clear
  // =========================================================================
  console.log("--- 4. Testing User Queue Reordering, Removal and Clear ---");

  usePlayerStore.getState().clearUserQueue();
  pState = usePlayerStore.getState();
  assert(pState.userQueue.length === 0, "clearUserQueue() emptied userQueue");

  const rTracks = syntheticTracks.slice(30, 34); // [R0, R1, R2, R3]
  usePlayerStore.getState().addToUserQueue(rTracks);
  pState = usePlayerStore.getState();
  assert(pState.userQueue.length === 4, "userQueue has 4 tracks [R0, R1, R2, R3]");

  // Reorder index 0 to 2: [R0, R1, R2, R3] -> [R1, R2, R0, R3]
  usePlayerStore.getState().reorderUserQueue(0, 2);
  pState = usePlayerStore.getState();
  assert(pState.userQueue[0].id === rTracks[1].id, "Reorder: pos 0 is R1");
  assert(pState.userQueue[1].id === rTracks[2].id, "Reorder: pos 1 is R2");
  assert(pState.userQueue[2].id === rTracks[0].id, "Reorder: pos 2 is R0");
  assert(pState.userQueue[3].id === rTracks[3].id, "Reorder: pos 3 is R3");

  // Reorder boundary invalid checks: no mutation on invalid from/to
  usePlayerStore.getState().reorderUserQueue(-1, 2);
  usePlayerStore.getState().reorderUserQueue(0, 100);
  usePlayerStore.getState().reorderUserQueue(1, 1);
  assert(pState.userQueue[0].id === rTracks[1].id, "Reorder invalid parameters caused zero mutation");

  // Remove from userQueue: remove index 1 (R2) -> [R1, R0, R3]
  usePlayerStore.getState().removeFromUserQueue(1);
  pState = usePlayerStore.getState();
  assert(pState.userQueue.length === 3, "removeFromUserQueue reduced length to 3");
  assert(pState.userQueue[0].id === rTracks[1].id, "User queue[0] is R1");
  assert(pState.userQueue[1].id === rTracks[0].id, "User queue[1] is R0");
  assert(pState.userQueue[2].id === rTracks[3].id, "User queue[2] is R3");

  // Remove boundary invalid checks
  usePlayerStore.getState().removeFromUserQueue(-1);
  usePlayerStore.getState().removeFromUserQueue(999);
  assert(usePlayerStore.getState().userQueue.length === 3, "Invalid remove index caused zero mutation");

  // =========================================================================
  // SECTION 5: Track Deletion Handling (handleTrackDeleted)
  // =========================================================================
  console.log("--- 5. Testing Track Deletion Handling Across All Queues ---");

  // Allow in-flight adapter microtasks to settle
  await new Promise(r => setTimeout(r, 20));

  // Case A: Delete track that is in userQueue (R0)
  await usePlayerStore.getState().handleTrackDeleted(rTracks[0].id);
  pState = usePlayerStore.getState();
  assert(!pState.userQueue.some(t => t.id === rTracks[0].id), "handleTrackDeleted removed R0 from userQueue");
  assert(!pState.queue.some(t => t.id === rTracks[0].id), "handleTrackDeleted removed R0 from unified queue");

  // Case B: Delete track in contextQueue (C1)
  assert(pState.contextQueue.some(t => t.id === cTracks[1].id), "C1 present before deletion");
  await usePlayerStore.getState().handleTrackDeleted(cTracks[1].id);
  pState = usePlayerStore.getState();
  assert(!pState.contextQueue.some(t => t.id === cTracks[1].id), "handleTrackDeleted removed C1 from contextQueue");
  assert(!pState.queue.some(t => t.id === cTracks[1].id), "handleTrackDeleted removed C1 from unified queue");

  // Case C: Delete currently playing track
  const activeTrack = pState.currentTrack;
  assert(Boolean(activeTrack), "Active track exists");
  if (activeTrack) {
    await usePlayerStore.getState().handleTrackDeleted(activeTrack.id);
    pState = usePlayerStore.getState();
    assert(pState.currentTrackId !== activeTrack.id, "handleTrackDeleted switched currentTrack away from deleted track");
  }

  // Case D: Delete non-existent track
  const queueLenBefore = pState.queue.length;
  await usePlayerStore.getState().handleTrackDeleted("non-existent-uuid-999");
  assert(usePlayerStore.getState().queue.length === queueLenBefore, "Deleting non-existent track is safe no-op");

  // =========================================================================
  // SECTION 6: Loop Modes & Autoplay Transitions
  // =========================================================================
  console.log("--- 6. Testing Loop Modes & Autoplay Invariants ---");

  // Setup 2 context tracks: [L0, L1]
  const lTracks = syntheticTracks.slice(40, 42);
  await usePlayerStore.getState().setQueue(lTracks, 0);
  usePlayerStore.getState().clearUserQueue();

  // Test loopMode = 'Track'
  usePlayerStore.getState().setLoopMode("Track");
  assert(usePlayerStore.getState().loopMode === "Track", "Loop mode set to Track");
  // Add track to user queue
  usePlayerStore.getState().addToUserQueue(syntheticTracks[50]);
  // playNext with loopMode = 'Track' must repeat the same track L0 and not consume userQueue
  await usePlayerStore.getState().playNext();
  pState = usePlayerStore.getState();
  assert(pState.currentTrack?.id === lTracks[0].id, "playNext under loopMode=Track repeats current track");
  assert(pState.userQueue.length === 1, "userQueue not consumed under loopMode=Track");

  // Test loopMode = 'Queue'
  usePlayerStore.getState().clearUserQueue();
  usePlayerStore.getState().setLoopMode("Queue");
  // Advance to L1 (last context track)
  await usePlayerStore.getState().playNext();
  assert(usePlayerStore.getState().currentTrack?.id === lTracks[1].id, "Advanced to last context track L1");
  // playNext at end of queue under loopMode=Queue wraps back to L0
  await usePlayerStore.getState().playNext();
  assert(usePlayerStore.getState().currentTrack?.id === lTracks[0].id, "playNext wrapped around to index 0 under loopMode=Queue");

  // Test loopMode = 'Off' and Autoplay = false
  usePlayerStore.getState().setLoopMode("Off");
  usePlayerStore.getState().setAutoplay(false);
  // Advance to last track L1
  await usePlayerStore.getState().playNext();
  assert(usePlayerStore.getState().currentTrack?.id === lTracks[1].id, "At last track L1");
  // playNext at end of queue with loop Off and Autoplay false stops playback
  await usePlayerStore.getState().playNext();
  pState = usePlayerStore.getState();
  assert(pState.status.state === "Stopped" || pState.currentTrack === undefined, "Playback stopped at queue end with loop Off and Autoplay false");

  // =========================================================================
  // SECTION 7: LibraryStore Integration, Aggregations & Optimistic Likes
  // =========================================================================
  console.log("--- 7. Testing LibraryStore Integration & Optimistic Updates ---");

  useLibraryStore.getState().setTracks(syntheticTracks.slice(0, 50));
  const libState = useLibraryStore.getState();
  assert(libState.tracks.length === 50, "Library has 50 tracks");
  assert(libState.albums.length > 0, "Albums auto-aggregated");
  assert(libState.artists.length > 0, "Artists auto-aggregated");
  assert(libState.genres.length > 0, "Genres auto-aggregated");

  // Test getAlbumDetails and getArtistDetails
  const firstAlbum = libState.albums[0];
  const albumDetail = await useLibraryStore.getState().getAlbumDetails(firstAlbum.title, firstAlbum.artist);
  assert(albumDetail !== null, "getAlbumDetails returned matching album");
  assert(albumDetail?.title.toLowerCase() === firstAlbum.title.toLowerCase(), "Album title matches");

  const firstArtist = libState.artists[0];
  const artistDetail = await useLibraryStore.getState().getArtistDetails(firstArtist.name);
  assert(artistDetail !== null, "getArtistDetails returned matching artist");
  assert(artistDetail?.name.toLowerCase() === firstArtist.name.toLowerCase(), "Artist name matches");

  // Test Case-Insensitive matching
  const upperArtistDetail = await useLibraryStore.getState().getArtistDetails(firstArtist.name.toUpperCase());
  assert(upperArtistDetail !== null, "getArtistDetails handles uppercase query");

  // Test toggleLike optimistic update
  const sampleTrackId = libState.tracks[0].id;
  const initialLiked = libState.likedTrackIds.has(sampleTrackId);
  const toggleRes1 = await useLibraryStore.getState().toggleLike(sampleTrackId);
  assert(useLibraryStore.getState().likedTrackIds.has(sampleTrackId) === !initialLiked, "toggleLike flipped Set membership");

  const toggleRes2 = await useLibraryStore.getState().toggleLike(sampleTrackId);
  assert(useLibraryStore.getState().likedTrackIds.has(sampleTrackId) === initialLiked, "second toggleLike restored original state");

  // =========================================================================
  // SECTION 8: 5,000 Rapid Sequential State Mutations
  // =========================================================================
  console.log("--- 8. Testing 5,000 Rapid Sequential State Mutations ---");

  const seqTracks = syntheticTracks.slice(0, 100);
  await usePlayerStore.getState().setQueue(seqTracks.slice(0, 20), 0);
  usePlayerStore.getState().setLoopMode("Queue");

  const seqStart = performance.now();
  const NUM_SEQUENTIAL_OPS = 5000;

  for (let i = 0; i < NUM_SEQUENTIAL_OPS; i++) {
    const op = i % 10;
    switch (op) {
      case 0:
        await usePlayerStore.getState().playNext();
        break;
      case 1:
        await usePlayerStore.getState().playPrevious();
        break;
      case 2:
        usePlayerStore.getState().addToUserQueue(seqTracks[(i + 20) % seqTracks.length]);
        break;
      case 3:
        usePlayerStore.getState().playNextInUserQueue(seqTracks[(i + 40) % seqTracks.length]);
        break;
      case 4: {
        const uLen = usePlayerStore.getState().userQueue.length;
        if (uLen > 1) {
          usePlayerStore.getState().reorderUserQueue(0, uLen - 1);
        }
        break;
      }
      case 5: {
        const uLen = usePlayerStore.getState().userQueue.length;
        if (uLen > 5) {
          usePlayerStore.getState().removeFromUserQueue(0);
        }
        break;
      }
      case 6:
        usePlayerStore.getState().seek(i % 180);
        break;
      case 7:
        usePlayerStore.getState().setVolume((i % 100) / 100);
        break;
      case 8:
        usePlayerStore.getState().toggleShuffle();
        break;
      case 9:
        usePlayerStore.getState().cycleLoopMode();
        break;
    }

    // Periodic invariant check every 500 iterations
    if (i % 500 === 0) {
      const state = usePlayerStore.getState();
      assert(!isNaN(state.status.volume), `Iteration ${i}: volume is not NaN`);
      assert(!isNaN(state.status.position_secs), `Iteration ${i}: position is not NaN`);
      assert(state.queueIndex >= -1 && state.queueIndex <= state.queue.length, `Iteration ${i}: queueIndex bounded`);
      assert(state.contextIndex >= -1 && state.contextIndex <= state.contextQueue.length, `Iteration ${i}: contextIndex bounded`);
    }
  }

  const seqDuration = performance.now() - seqStart;
  console.log(`  Completed ${NUM_SEQUENTIAL_OPS} sequential mutations in ${seqDuration.toFixed(2)} ms (~${(NUM_SEQUENTIAL_OPS / (seqDuration / 1000)).toFixed(0)} ops/sec)`);
  assert(seqDuration < 15000, "5,000 sequential mutations executed comfortably within time allowance");

  // =========================================================================
  // SECTION 9: 1,000 Concurrent Async Mutations (Promise.all Batches)
  // =========================================================================
  console.log("--- 9. Testing 1,000 Concurrent Async Mutations (Promise.all) ---");

  // Reset queue with fresh set
  await usePlayerStore.getState().setQueue(seqTracks.slice(0, 30), 0);
  usePlayerStore.getState().setLoopMode("Queue");

  const conStart = performance.now();
  const BATCH_COUNT = 50;
  const BATCH_SIZE = 20; // 50 * 20 = 1,000 concurrent operations

  for (let b = 0; b < BATCH_COUNT; b++) {
    const promises: Promise<any>[] = [];
    for (let j = 0; j < BATCH_SIZE; j++) {
      const op = (b * BATCH_SIZE + j) % 6;
      switch (op) {
        case 0:
          promises.push(usePlayerStore.getState().playNext());
          break;
        case 1:
          promises.push(usePlayerStore.getState().playPrevious());
          break;
        case 2:
          promises.push((async () => {
            usePlayerStore.getState().addToUserQueue(seqTracks[(b + j) % seqTracks.length]);
          })());
          break;
        case 3:
          promises.push((async () => {
            usePlayerStore.getState().playNextInUserQueue(seqTracks[(b + j + 50) % seqTracks.length]);
          })());
          break;
        case 4:
          promises.push(usePlayerStore.getState().jumpToContextTrack((b + j) % 20));
          break;
        case 5:
          promises.push((async () => {
            usePlayerStore.getState().toggleShuffle();
          })());
          break;
      }
    }
    await Promise.all(promises);

    // Verify invariants after each concurrent wave
    const state = usePlayerStore.getState();
    assert(state.queue.length > 0, `Batch ${b}: queue not empty`);
    assert(state.queueIndex >= -1 && state.queueIndex <= state.queue.length, `Batch ${b}: queueIndex is valid`);
    assert(state.contextIndex >= -1 && state.contextIndex <= state.contextQueue.length, `Batch ${b}: contextIndex is valid`);
    assert(!state.queue.some(t => !t || !t.id), `Batch ${b}: no null or undefined holes in queue`);
  }

  const conDuration = performance.now() - conStart;
  console.log(`  Completed 1,000 concurrent mutations in ${conDuration.toFixed(2)} ms (~${(1000 / (conDuration / 1000)).toFixed(0)} ops/sec)`);

  // Final invariant check
  const finalState = usePlayerStore.getState();
  assert(finalState.queueIndex >= 0 && finalState.queueIndex < finalState.queue.length, "Final queueIndex within valid bounds");
  assert(finalState.currentTrack !== undefined, "Final currentTrack is defined");
  assert(finalState.status.volume >= 0 && finalState.status.volume <= 1, "Final volume in [0, 1]");

  console.log(`\n  ✅ ALL ${passedAssertions}/${totalAssertions} CHALLENGER 1 EMPIRICAL ASSERTIONS PASSED!\n`);

  return {
    totalAssertions,
    passedAssertions,
    seqDuration,
    conDuration,
  };
}

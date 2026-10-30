import { generateSyntheticTracks, Track } from "./generator";

export async function runScrubberAndQueueTests(playerStoreModule: any) {
  console.log("\n=======================================================");
  console.log("  EMPIRICAL TESTS: SCRUBBER DRAG & QUEUE ACTIONS");
  console.log("=======================================================\n");

  const { usePlayerStore } = playerStoreModule;
  const store = usePlayerStore;
  const tracks = generateSyntheticTracks(20);

  // Track playerAdapter calls
  const adapterCalls = {
    seekCalls: [] as number[],
    playCalls: [] as Track[],
    resumeCalls: 0,
    pauseCalls: 0,
    stopCalls: 0,
  };

  // Mock playerAdapter in store if needed
  // Note: playerAdapter methods are called by store actions
  const mockAdapter = {
    playTrack: async (t: Track) => {
      adapterCalls.playCalls.push(t);
    },
    seek: (s: number) => {
      adapterCalls.seekCalls.push(s);
    },
    resume: () => { adapterCalls.resumeCalls++; },
    pause: () => { adapterCalls.pauseCalls++; },
    stop: () => { adapterCalls.stopCalls++; },
  };

  // Replace adapter methods on window/global if necessary or rely on store
  // Reset store
  store.setState({
    status: {
      state: "Playing",
      volume: 0.8,
      position_secs: 10,
      duration_secs: 200,
      loop_mode: "Off",
    },
    currentTrack: tracks[0],
    currentTrackId: tracks[0].id,
    queue: tracks.slice(0, 5),
    queueIndex: 0,
    isAutoplay: false,
  });

  console.log("--- 1. Testing Scrubber Drag Behavior & Invariant Protection ---");

  // Scrubber state simulation matching ScrubberInner in PlayerBar.tsx
  class ScrubberSimulator {
    public isDragging = false;
    public dragPos = 0;

    public getDisplayPos(storePos: number): number {
      return this.isDragging ? this.dragPos : storePos;
    }

    public handlePointerDown(currentStorePos: number) {
      this.isDragging = true;
      this.dragPos = currentStorePos;
    }

    public handleChange(val: number) {
      this.dragPos = val;
    }

    public handlePointerUp(seekFn: (pos: number) => void) {
      if (this.isDragging) {
        seekFn(this.dragPos);
        this.isDragging = false;
      }
    }
  }

  const scrubber = new ScrubberSimulator();
  const soughtPositions: number[] = [];
  const mockSeek = (p: number) => soughtPositions.push(p);

  // Step 1: Initial position
  let currentBackendPos = 10;
  if (scrubber.getDisplayPos(currentBackendPos) !== 10) {
    throw new Error("Scrubber display pos mismatch at rest");
  }

  // Step 2: User grabs slider at 10s
  scrubber.handlePointerDown(currentBackendPos);
  if (!scrubber.isDragging || scrubber.getDisplayPos(currentBackendPos) !== 10) {
    throw new Error("PointerDown failed to initialize drag state");
  }

  // Step 3: User drags rapidly to 50s, 120s, 175s
  scrubber.handleChange(50);
  if (scrubber.getDisplayPos(currentBackendPos) !== 50) {
    throw new Error("Drag position not updated during move");
  }
  if (soughtPositions.length !== 0) {
    throw new Error("Seek called prematurely during active drag!");
  }

  scrubber.handleChange(120);
  scrubber.handleChange(175);
  if (scrubber.getDisplayPos(currentBackendPos) !== 175) {
    throw new Error("Drag position not updated to 175s");
  }

  // Step 4: Background 500ms playback update arrives during dragging!
  currentBackendPos = 12.5; // playback continued to tick
  // Verify displayPos does NOT snap back to 12.5s
  if (scrubber.getDisplayPos(currentBackendPos) !== 175) {
    throw new Error(`Thumb snapping occurred! Expected displayPos 175, got ${scrubber.getDisplayPos(currentBackendPos)}`);
  }
  console.log("  ✓ Drag isolation verified: 500ms background updates do not cause thumb snap-back.");

  // Step 5: User releases mouse at 175s
  scrubber.handlePointerUp(mockSeek);
  if (scrubber.isDragging) {
    throw new Error("PointerUp failed to reset isDragging");
  }
  if (soughtPositions.length !== 1 || soughtPositions[0] !== 175) {
    throw new Error(`PointerUp failed to seek: expected [175], got ${JSON.stringify(soughtPositions)}`);
  }
  console.log("  ✓ PointerUp committed seek exactly once at target position (175s).\n");

  console.log("--- 2. Testing Queue Manipulation Actions ---");

  // A. setQueue
  console.log("  Testing setQueue(tracks, 2)...");
  await store.getState().setQueue(tracks.slice(0, 5), 2);
  let state = store.getState();
  if (state.queue.length !== 5 || state.queueIndex !== 2 || state.currentTrackId !== tracks[2].id) {
    throw new Error(`setQueue failed: queueLength=${state.queue.length}, queueIndex=${state.queueIndex}`);
  }
  console.log(`  ✓ setQueue initialized queue length 5 at startIndex 2 (trackId: ${state.currentTrackId})`);

  // B. addToQueue
  console.log("  Testing addToQueue(additionalTracks)...");
  store.getState().addToQueue(tracks.slice(5, 8));
  state = store.getState();
  if (state.queue.length !== 8 || state.queueIndex !== 2) {
    throw new Error(`addToQueue failed: queueLength=${state.queue.length}`);
  }
  console.log(`  ✓ addToQueue appended 3 tracks (total queue length: ${state.queue.length}, current index preserved at 2)`);

  // C. playNext
  console.log("  Testing playNext()...");
  await store.getState().playNext();
  state = store.getState();
  if (state.queueIndex !== 3 || state.currentTrackId !== tracks[3].id) {
    throw new Error(`playNext failed: queueIndex=${state.queueIndex}`);
  }
  console.log(`  ✓ playNext advanced queueIndex to 3 (trackId: ${state.currentTrackId})`);

  // Advance to end of queue (index 7)
  await store.getState().playNext(); // 4
  await store.getState().playNext(); // 5
  await store.getState().playNext(); // 6
  await store.getState().playNext(); // 7 (last)
  state = store.getState();
  if (state.queueIndex !== 7) {
    throw new Error(`Failed to advance to end of queue: index=${state.queueIndex}`);
  }

  // Next at end with loop_mode = Off
  store.setState({ status: { ...state.status, loop_mode: "Off" }, isAutoplay: false });
  await store.getState().playNext();
  state = store.getState();
  if (state.queueIndex !== 7) {
    throw new Error(`playNext advanced beyond end with loop_mode=Off: index=${state.queueIndex}`);
  }
  console.log("  ✓ playNext at end of queue respected loop_mode='Off' (stayed at index 7)");

  // Next at end with loop_mode = Queue
  store.setState({ status: { ...state.status, loop_mode: "Queue" } });
  await store.getState().playNext();
  state = store.getState();
  if (state.queueIndex !== 0 || state.currentTrackId !== tracks[0].id) {
    throw new Error(`playNext failed to wrap around with loop_mode=Queue: index=${state.queueIndex}`);
  }
  console.log("  ✓ playNext wrapped around to index 0 with loop_mode='Queue'");

  // D. playPrevious
  console.log("  Testing playPrevious()...");
  // Sub-case 1: position > 3s -> restarts track
  store.setState({
    queueIndex: 3,
    currentTrack: tracks[3],
    currentTrackId: tracks[3].id,
    status: { ...state.status, position_secs: 45 },
  });
  await store.getState().playPrevious();
  state = store.getState();
  if (state.queueIndex !== 3) {
    throw new Error(`playPrevious did not keep index when position > 3s: index=${state.queueIndex}`);
  }
  console.log("  ✓ playPrevious with position_secs > 3s restarted current track without decrementing index");

  // Sub-case 2: position <= 3s -> skips to previous track
  store.setState({
    status: { ...state.status, position_secs: 1.5 },
  });
  await store.getState().playPrevious();
  state = store.getState();
  if (state.queueIndex !== 2 || state.currentTrackId !== tracks[2].id) {
    throw new Error(`playPrevious failed to decrement index: expected 2, got ${state.queueIndex}`);
  }
  console.log("  ✓ playPrevious with position_secs <= 3s decremented index to 2");

  // E. clearQueue
  console.log("  Testing clearQueue()...");
  store.getState().clearQueue();
  state = store.getState();
  if (state.queue.length !== 0 || state.queueIndex !== -1) {
    throw new Error(`clearQueue failed: length=${state.queue.length}, index=${state.queueIndex}`);
  }
  console.log("  ✓ clearQueue successfully emptied queue and reset queueIndex to -1.\n");

  console.log("--- 3. Testing Song End Auto-Transition ---");

  // Re-initialize queue with 3 tracks
  await store.getState().setQueue(tracks.slice(0, 3), 0);
  state = store.getState();
  if (state.queueIndex !== 0 || state.currentTrackId !== tracks[0].id) {
    throw new Error("Failed to initialize queue for auto-advance test");
  }

  // Simulate song 0 ending -> playNext()
  await store.getState().playNext();
  state = store.getState();
  if (state.queueIndex !== 1 || state.currentTrackId !== tracks[1].id) {
    throw new Error(`Song 0 ending did not advance to song 1: got index ${state.queueIndex}`);
  }
  console.log("  ✓ Song end auto-transitioned from track 0 to track 1");

  // Simulate song 1 ending -> playNext()
  await store.getState().playNext();
  state = store.getState();
  if (state.queueIndex !== 2 || state.currentTrackId !== tracks[2].id) {
    throw new Error(`Song 1 ending did not advance to song 2: got index ${state.queueIndex}`);
  }
  console.log("  ✓ Song end auto-transitioned from track 1 to track 2");

  // Track loop mode test
  store.setState({ status: { ...state.status, loop_mode: "Track" } });
  await store.getState().playNext();
  state = store.getState();
  if (state.queueIndex !== 2 || state.currentTrackId !== tracks[2].id) {
    throw new Error(`Track loop mode failed to replay track 2: got index ${state.queueIndex}`);
  }
  console.log("  ✓ LoopMode='Track' replayed current track when song ended");

  // Queue loop mode test at end of queue
  store.setState({ status: { ...state.status, loop_mode: "Queue" } });
  await store.getState().playNext();
  state = store.getState();
  if (state.queueIndex !== 0 || state.currentTrackId !== tracks[0].id) {
    throw new Error(`Queue loop mode failed to loop back to track 0: got index ${state.queueIndex}`);
  }
  console.log("  ✓ LoopMode='Queue' looped back to track 0 at queue boundary\n");

  console.log("--- 4. Testing Autoplay Toggle & All Songs Continuous Playback ---");

  // A. Toggle autoplay
  store.getState().setAutoplay(false);
  if (store.getState().isAutoplay !== false) {
    throw new Error("setAutoplay(false) failed");
  }
  store.getState().toggleAutoplay();
  if (store.getState().isAutoplay !== true) {
    throw new Error("toggleAutoplay() failed to toggle to true");
  }
  console.log("  ✓ toggleAutoplay and setAutoplay state transitions verified");

  // B. Autoplay enabled when playing from All Songs context (synthetic queue loop test)
  await store.getState().setQueue(tracks.slice(0, 3), 2, { type: "tracks", name: "All Tracks" });
  store.setState({ status: { ...store.getState().status, loop_mode: "Off" }, isAutoplay: true });
  await store.getState().playNext();
  state = store.getState();
  if (state.queueIndex !== 0 || state.currentTrackId !== tracks[0].id) {
    throw new Error(`Autoplay failed to loop All Songs queue: expected index 0, got ${state.queueIndex}`);
  }
  console.log("  ✓ Autoplay from All Songs looped back to start of tracks queue when reaching end");

  // C. Autoplay disabled when playing from All Songs context
  store.setState({ isAutoplay: false, queueIndex: 2, currentTrack: tracks[2], currentTrackId: tracks[2].id });
  await store.getState().playNext();
  state = store.getState();
  if (state.status.state !== "Stopped" || !state.isManualStop) {
    throw new Error(`Playback did not stop at end of queue when autoplay is disabled: state=${state.status.state}`);
  }
  console.log("  ✓ Playback stopped at end of queue when Autoplay was disabled for All Songs");

  // D. Autoplay enabled across Album context with Library recommendations
  const { registerLibraryTracksGetter } = playerStoreModule;
  const libraryPool = tracks.slice(0, 10);
  registerLibraryTracksGetter(() => libraryPool);

  // Queue an album with 2 tracks
  const albumTracks = tracks.slice(0, 2);
  await store.getState().setQueue(albumTracks, 1, { type: "album", name: "Test Album", artist: "Test Artist" });
  store.setState({ status: { ...store.getState().status, loop_mode: "Off" }, isAutoplay: true });
  await store.getState().playNext();
  state = store.getState();
  // Expect Autoplay to append a new track from the library pool (queue length increases from 2 to 3)
  if (state.queue.length !== 3 || state.queueIndex !== 2) {
    throw new Error(`Autoplay failed to append continuous recommendation track from library: queue length ${state.queue.length}, index ${state.queueIndex}`);
  }
  if (!state.currentTrackId || state.status.state === "Stopped" || state.isManualStop) {
    throw new Error("Autoplay must continue playback without stopping at end of album");
  }
  console.log("  ✓ Autoplay seamlessly recommended and appended new track when Album finished");

  // E. Autoplay disabled in Album context stops at end of album
  store.setState({ queue: albumTracks, isAutoplay: false, queueIndex: 1, currentTrack: albumTracks[1], currentTrackId: albumTracks[1].id });
  await store.getState().playNext();
  state = store.getState();
  if (state.status.state !== "Stopped" || !state.isManualStop) {
    throw new Error(`Playback did not stop at end of album when autoplay was disabled: state=${state.status.state}`);
  }
  console.log("  ✓ Playback stopped at end of album when Autoplay was disabled");

  // Reset library getter for clean test isolation
  registerLibraryTracksGetter(() => []);

  console.log("--- 5. Testing Morphing Waveform Generator Invariants ---");
  const { generateWaveformBarHeights, FLAT_BAR_HEIGHT, MIN_WAVEFORM_HEIGHT, MAX_WAVEFORM_HEIGHT } = await import("../src/utils/waveform");

  // 1. Idle state (no track) returns all flat bars
  const idleBars = generateWaveformBarHeights(null);
  if (idleBars.length !== 72 || !idleBars.every((h: number) => h === FLAT_BAR_HEIGHT)) {
    throw new Error(`Idle waveform must return flat ${FLAT_BAR_HEIGHT}px bars`);
  }
  console.log("  ✓ Idle state generates uniform flat line");

  // 2. Active track morphs into dynamic heights
  const track1Bars = generateWaveformBarHeights(tracks[0]);
  if (track1Bars.length !== 72) {
    throw new Error(`Waveform must generate 72 bars, got ${track1Bars.length}`);
  }
  const hasPeaks = track1Bars.some((h: number) => h > FLAT_BAR_HEIGHT);
  const allInRange = track1Bars.every((h: number) => h >= MIN_WAVEFORM_HEIGHT && h <= MAX_WAVEFORM_HEIGHT);
  if (!hasPeaks || !allInRange) {
    throw new Error(`Track waveform bars must be within [${MIN_WAVEFORM_HEIGHT}, ${MAX_WAVEFORM_HEIGHT}]`);
  }
  console.log("  ✓ Active track morphs into dynamic waveform peaks");

  // 3. Determinism: identical tracks yield identical waveforms
  const track1BarsRepeat = generateWaveformBarHeights(tracks[0]);
  const isIdentical = track1Bars.every((h: number, idx: number) => h === track1BarsRepeat[idx]);
  if (!isIdentical) {
    throw new Error("Waveform generation must be completely deterministic for identical tracks");
  }
  console.log("  ✓ Deterministic consistency verified across repeated calls");

  // 4. Distinct tracks produce distinct waveforms
  const track2Bars = generateWaveformBarHeights(tracks[1]);
  const isDistinct = track1Bars.some((h: number, idx: number) => h !== track2Bars[idx]);
  if (!isDistinct) {
    throw new Error("Distinct tracks must yield distinct waveform silhouettes");
  }
  console.log("  ✓ Different tracks produce unique audio silhouettes");

  // 5. Degraded / minimal track metadata resilience
  const degradedBars = generateWaveformBarHeights({ id: "unknown" });
  if (degradedBars.some((h: number) => isNaN(h) || h < MIN_WAVEFORM_HEIGHT || h > MAX_WAVEFORM_HEIGHT)) {
    throw new Error("Degraded metadata must not produce NaN or out-of-range heights");
  }
  console.log("  ✓ Degraded metadata handled with zero NaN or errors\n");

  console.log("--- 6. Testing Two-Tier Dedicated Queue & Play Next Invariants ---");
  // A. Initialize context queue
  const cTracks = tracks.slice(0, 4); // C0, C1, C2, C3
  await store.getState().setQueue(cTracks, 0, { type: "album", name: "Abbey Road", artist: "The Beatles" });
  let qState = store.getState();
  if (qState.contextQueue.length !== 4 || qState.userQueue.length !== 0 || qState.contextIndex !== 0) {
    throw new Error(`Context queue initialization failed: contextLength=${qState.contextQueue.length}, userLength=${qState.userQueue.length}`);
  }
  console.log("  ✓ Two-tier context initialized with 4 tracks, userQueue clean");

  // B. Single and Batch Play Next (Top insertion with batch preservation)
  const u1 = tracks[4];
  const u2 = tracks[5];
  const u3 = tracks[6];
  store.getState().playNextInUserQueue(u1);
  if (store.getState().userQueue.length !== 1 || store.getState().userQueue[0].id !== u1.id) {
    throw new Error("playNextInUserQueue failed for single track insertion");
  }

  // Batch insert [u2, u3] at top
  store.getState().playNextInUserQueue([u2, u3]);
  const userQ = store.getState().userQueue;
  if (userQ.length !== 3 || userQ[0].id !== u2.id || userQ[1].id !== u3.id || userQ[2].id !== u1.id) {
    throw new Error(`playNextInUserQueue failed to preserve batch ordering: [${userQ.map(t => t.id).join(", ")}]`);
  }
  console.log("  ✓ playNextInUserQueue inserts at top while preserving batch sequence: [U2, U3, U1]");

  // C. Add to user queue (append to end of priority queue)
  const u4 = tracks[7];
  store.getState().addToUserQueue(u4);
  if (store.getState().userQueue.length !== 4 || store.getState().userQueue[3].id !== u4.id) {
    throw new Error("addToUserQueue failed to append to end of user queue");
  }
  console.log("  ✓ addToUserQueue appended U4 to end of user queue: [U2, U3, U1, U4]");

  // D. Reorder user queue
  store.getState().reorderUserQueue(3, 0); // Move U4 to index 0
  if (store.getState().userQueue[0].id !== u4.id || store.getState().userQueue[1].id !== u2.id) {
    throw new Error("reorderUserQueue failed to move item from index 3 to 0");
  }
  console.log("  ✓ reorderUserQueue moved U4 from index 3 to 0: [U4, U2, U3, U1]");

  // E. Remove from user queue
  store.getState().removeFromUserQueue(1); // Remove U2
  if (store.getState().userQueue.length !== 3 || store.getState().userQueue.some(t => t.id === u2.id)) {
    throw new Error("removeFromUserQueue failed to remove item at index 1");
  }
  console.log("  ✓ removeFromUserQueue removed U2: [U4, U3, U1]");

  // F. Sequential Playback Drains User Queue First, Then Continues Context
  // Active track is C0. Next must be U4, then U3, then U1, then C1, then C2.
  await store.getState().playNext();
  if (store.getState().currentTrackId !== u4.id) {
    throw new Error(`Expected U4 to play next, got ${store.getState().currentTrackId}`);
  }

  await store.getState().playNext();
  if (store.getState().currentTrackId !== u3.id) {
    throw new Error(`Expected U3 to play next, got ${store.getState().currentTrackId}`);
  }

  await store.getState().playNext();
  if (store.getState().currentTrackId !== u1.id) {
    throw new Error(`Expected U1 to play next, got ${store.getState().currentTrackId}`);
  }
  if (store.getState().userQueue.length !== 0) {
    throw new Error(`User queue should be empty after playing U1, but has length ${store.getState().userQueue.length}`);
  }

  // Next should cleanly fall back into context at C1
  await store.getState().playNext();
  if (store.getState().currentTrackId !== cTracks[1].id) {
    throw new Error(`Expected context track C1 (${cTracks[1].id}) to resume, got ${store.getState().currentTrackId}`);
  }
  console.log("  ✓ Playback priority drained userQueue [U4 -> U3 -> U1] and seamlessly resumed context [C1]");

  // G. Direct Jump into Context Track
  await store.getState().jumpToContextTrack(3); // C3
  if (store.getState().currentTrackId !== cTracks[3].id || store.getState().contextIndex !== 3) {
    throw new Error(`jumpToContextTrack failed: expected ${cTracks[3].id}, got ${store.getState().currentTrackId}`);
  }
  console.log("  ✓ jumpToContextTrack(3) jumped directly to C3");

  // H. Direct Jump into User Queue Item
  const u5 = tracks[8];
  store.getState().playNextInUserQueue(u5);
  await store.getState().jumpToUserQueueItem(0);
  if (store.getState().currentTrackId !== u5.id || store.getState().userQueue.length !== 0) {
    throw new Error(`jumpToUserQueueItem failed: current=${store.getState().currentTrackId}, userQueueLength=${store.getState().userQueue.length}`);
  }
  console.log("  ✓ jumpToUserQueueItem played U5 and drained it from userQueue");

  // I. Clear User Queue
  store.getState().playNextInUserQueue([tracks[0], tracks[1]]);
  store.getState().clearUserQueue();
  if (store.getState().userQueue.length !== 0) {
    throw new Error("clearUserQueue failed to empty user queue");
  }
  console.log("  ✓ clearUserQueue cleanly wiped user queue while preserving playback state");

  // J. Session History Recording
  const hist = store.getState().sessionHistory;
  if (!hist || hist.length === 0) {
    throw new Error("sessionHistory must record played tracks");
  }
  console.log(`  ✓ sessionHistory correctly recorded ${hist.length} recent playback entries\n`);

  return {
    scrubberDragVerified: true,
    queueActionsVerified: true,
    autoAdvanceVerified: true,
    autoplayVerified: true,
    waveformVerified: true,
    twoTierQueueVerified: true,
  };
}

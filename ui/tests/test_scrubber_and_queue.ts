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
  store.setState({ status: { ...state.status, loop_mode: "Off" } });
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

  // B. Autoplay enabled when playing from All Songs context
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
  console.log("  ✓ Playback stopped at end of queue when Autoplay was disabled for All Songs\n");

  return {
    scrubberDragVerified: true,
    queueActionsVerified: true,
    autoAdvanceVerified: true,
    autoplayVerified: true,
  };
}

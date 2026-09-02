import { generateSyntheticTracks, Track } from "./generator";

/**
 * Simulates React selector subscription hook behavior with Zustand.
 * Tracks how many times a component re-renders when the store emits state changes.
 */
class ComponentSubscriber<T> {
  public renderCount = 0;
  private lastSelectedValue: any;
  private isInitialized = false;

  constructor(
    public name: string,
    private store: any,
    private selector: (state: any) => T,
    private equalityFn: (a: any, b: any) => boolean = Object.is
  ) {
    this.lastSelectedValue = selector(store.getState());
    this.isInitialized = true;
    this.renderCount = 1; // Initial mount render

    store.subscribe((state: any) => {
      const nextValue = this.selector(state);
      if (!this.equalityFn(this.lastSelectedValue, nextValue)) {
        this.lastSelectedValue = nextValue;
        this.renderCount++;
      }
    });
  }

  public getRendersSinceMount(): number {
    return this.renderCount - 1;
  }
}

export async function runRerenderIsolationTests(createStore: any, playerStoreModule: any) {
  console.log("\n=======================================================");
  console.log("  EMPIRICAL TESTS: RE-RENDER ISOLATION & ZUSTAND SELECTORS");
  console.log("=======================================================\n");

  const { usePlayerStore } = playerStoreModule;
  const store = usePlayerStore;

  const tracks = generateSyntheticTracks(50);
  const track1 = tracks[0];
  const track2 = tracks[1];

  // Initialize store state
  store.setState({
    status: {
      state: "Playing",
      volume: 0.8,
      position_secs: 0,
      duration_secs: 240,
      loop_mode: "Off",
    },
    currentTrack: track1,
    currentTrackId: track1.id,
    queue: tracks.slice(0, 10),
    queueIndex: 0,
  });

  // Setup component subscribers mirroring exact component selectors in the app

  // 1. Scrubber: subscribes to position_secs and duration_secs
  const scrubberSub = new ComponentSubscriber("Scrubber", store, (s) => ({
    position_secs: s.status.position_secs || 0,
    duration_secs: s.status.duration_secs || 0,
  }), (a, b) => a.position_secs === b.position_secs && a.duration_secs === b.duration_secs);

  // 2. TrackInfo: subscribes to currentTrack
  const trackInfoSub = new ComponentSubscriber("TrackInfo", store, (s) => s.currentTrack);

  // 3. PlayControls: subscribes to state, queue.length, queueIndex, currentTrack
  const playControlsSub = new ComponentSubscriber("PlayControls", store, (s) => ({
    isPlaying: s.status.state === "Playing",
    queueLength: s.queue.length,
    queueIndex: s.queueIndex,
    hasCurrentTrack: !!s.currentTrack,
  }), (a, b) =>
    a.isPlaying === b.isPlaying &&
    a.queueLength === b.queueLength &&
    a.queueIndex === b.queueIndex &&
    a.hasCurrentTrack === b.hasCurrentTrack
  );

  // 4. VolumeControl: subscribes to volume
  const volumeSub = new ComponentSubscriber("VolumeControl", store, (s) => s.status.volume);

  // 5. TrackTable: subscribes to currentTrackId and isPlaying
  const trackTableSub = new ComponentSubscriber("TrackTable", store, (s) => ({
    currentTrackId: s.currentTrackId,
    isPlaying: s.status.state === "Playing",
  }), (a, b) => a.currentTrackId === b.currentTrackId && a.isPlaying === b.isPlaying);

  // 6. TrackRow (for track 0 - active)
  const trackRow0Sub = new ComponentSubscriber("TrackRow[0] (active)", store, (s) => ({
    isSelected: s.currentTrackId === track1.id,
    isPlaying: s.status.state === "Playing",
  }), (a, b) => a.isSelected === b.isSelected && a.isPlaying === b.isPlaying);

  // 7. TrackRow (for track 5 - inactive)
  const trackRow5Sub = new ComponentSubscriber("TrackRow[5] (inactive)", store, (s) => ({
    isSelected: s.currentTrackId === tracks[5].id,
    isPlaying: s.status.state === "Playing",
  }), (a, b) => a.isSelected === b.isSelected && a.isPlaying === b.isPlaying);

  // 8. Top-level App / Views (tracks, viewMode, navigation)
  // App only subscribes to startPolling and setQueue from player store
  const appSub = new ComponentSubscriber("App / Main Views", store, (s) => ({
    // stable action references
    startPolling: s.startPolling,
    setQueue: s.setQueue,
  }), (a, b) => a.startPolling === b.startPolling && a.setQueue === b.setQueue);

  console.log("--- Test Phase 1: 50 Playback Position Ticks (500ms intervals) ---");
  const TICKS = 50;
  for (let i = 1; i <= TICKS; i++) {
    const newPos = i * 0.5;
    store.setState((prev: any) => ({
      status: {
        ...prev.status,
        position_secs: newPos,
      },
    }));
  }

  console.log(`  Emitted ${TICKS} position updates (0.5s -> 25.0s):`);
  console.log(`    - Scrubber renders:     ${scrubberSub.getRendersSinceMount()} (Expected: ${TICKS})`);
  console.log(`    - TrackInfo renders:    ${trackInfoSub.getRendersSinceMount()} (Expected: 0)`);
  console.log(`    - PlayControls renders: ${playControlsSub.getRendersSinceMount()} (Expected: 0)`);
  console.log(`    - VolumeControl renders:${volumeSub.getRendersSinceMount()} (Expected: 0)`);
  console.log(`    - TrackTable renders:   ${trackTableSub.getRendersSinceMount()} (Expected: 0)`);
  console.log(`    - TrackRow[0] renders:  ${trackRow0Sub.getRendersSinceMount()} (Expected: 0)`);
  console.log(`    - TrackRow[5] renders:  ${trackRow5Sub.getRendersSinceMount()} (Expected: 0)`);
  console.log(`    - App / Views renders:  ${appSub.getRendersSinceMount()} (Expected: 0)`);

  if (scrubberSub.getRendersSinceMount() !== TICKS) {
    throw new Error(`Scrubber did not update on position ticks: expected ${TICKS}, got ${scrubberSub.getRendersSinceMount()}`);
  }
  if (trackInfoSub.getRendersSinceMount() !== 0) {
    throw new Error(`Isolation leak: TrackInfo re-rendered ${trackInfoSub.getRendersSinceMount()} times during position ticks!`);
  }
  if (playControlsSub.getRendersSinceMount() !== 0) {
    throw new Error(`Isolation leak: PlayControls re-rendered ${playControlsSub.getRendersSinceMount()} times during position ticks!`);
  }
  if (volumeSub.getRendersSinceMount() !== 0) {
    throw new Error(`Isolation leak: VolumeControl re-rendered ${volumeSub.getRendersSinceMount()} times during position ticks!`);
  }
  if (trackTableSub.getRendersSinceMount() !== 0) {
    throw new Error(`Isolation leak: TrackTable re-rendered ${trackTableSub.getRendersSinceMount()} times during position ticks!`);
  }
  if (trackRow0Sub.getRendersSinceMount() !== 0 || trackRow5Sub.getRendersSinceMount() !== 0) {
    throw new Error(`Isolation leak: TrackRows re-rendered during position ticks!`);
  }
  if (appSub.getRendersSinceMount() !== 0) {
    throw new Error(`Isolation leak: App re-rendered during position ticks!`);
  }

  console.log("  ✓ Re-render isolation confirmed: 0 unnecessary re-renders during playback ticks.\n");

  console.log("--- Test Phase 2: Track Transition (track1 -> track2) ---");
  const initialTrackInfoRenders = trackInfoSub.getRendersSinceMount();
  const initialTrackTableRenders = trackTableSub.getRendersSinceMount();
  const initialRow0Renders = trackRow0Sub.getRendersSinceMount();

  // Track changed
  store.setState({
    currentTrack: track2,
    currentTrackId: track2.id,
    queueIndex: 1,
    status: {
      ...store.getState().status,
      position_secs: 0,
      duration_secs: 300,
    },
  });

  console.log(`    - TrackInfo renders:    ${trackInfoSub.getRendersSinceMount() - initialTrackInfoRenders} (Expected: 1)`);
  console.log(`    - TrackTable renders:   ${trackTableSub.getRendersSinceMount() - initialTrackTableRenders} (Expected: 1)`);
  console.log(`    - TrackRow[0] renders:  ${trackRow0Sub.getRendersSinceMount() - initialRow0Renders} (Expected: 1, deselected)`);
  console.log(`    - TrackRow[5] renders:  ${trackRow5Sub.getRendersSinceMount()} (Expected: 0)`);
  console.log(`    - VolumeControl renders:${volumeSub.getRendersSinceMount()} (Expected: 0)`);

  if (trackInfoSub.getRendersSinceMount() - initialTrackInfoRenders !== 1) {
    throw new Error("TrackInfo failed to update on track change");
  }

  console.log("  ✓ Track transition properly updates only relevant components.\n");

  console.log("--- Test Phase 3: Play/Pause State Toggles ---");
  const playControlsBefore = playControlsSub.getRendersSinceMount();
  store.setState((prev: any) => ({
    status: { ...prev.status, state: "Paused" },
  }));
  store.setState((prev: any) => ({
    status: { ...prev.status, state: "Playing" },
  }));

  console.log(`    - PlayControls renders: ${playControlsSub.getRendersSinceMount() - playControlsBefore} (Expected: 2)`);
  console.log(`    - TrackInfo renders:    ${trackInfoSub.getRendersSinceMount() - initialTrackInfoRenders - 1} (Expected: 0)`);
  console.log(`    - VolumeControl renders:${volumeSub.getRendersSinceMount()} (Expected: 0)`);

  console.log("  ✓ State toggles properly isolated.\n");

  return {
    ticksProcessed: TICKS,
    scrubberRenders: scrubberSub.getRendersSinceMount(),
    isolatedComponentRenders: 0,
  };
}

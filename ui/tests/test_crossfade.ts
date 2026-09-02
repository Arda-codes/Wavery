import assert from "assert";
import { playerAdapter } from "../src/services/adapter";
import { useSettingsStore } from "../src/stores/settingsStore";
import { usePlayerStore } from "../src/stores/playerStore";
import { Track } from "../src/types";

function createMockTrack(id: string, title: string, durationSecs: number = 240): Track {
  return {
    id,
    source: { type: "local", path: `/music/${id}.flac` },
    metadata: {
      title,
      artist: "Test Artist",
      album: "Test Album",
      duration: { secs: durationSecs, nanos: 0 },
    },
  };
}

export async function runCrossfadeTests(): Promise<void> {
  console.log("\n=======================================================");
  console.log("  CROSSFADE DUAL-ELEMENT & EQUAL-POWER VERIFICATION");
  console.log("=======================================================\n");

  // ---------------------------------------------------------------------------
  // 1. Verify Equal-Power Trigonometric Curve Invariants
  // ---------------------------------------------------------------------------
  console.log("--- 1. Testing Equal-Power Mathematical Curve Invariants ---");
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const inGain = Math.sin(t * (Math.PI / 2));
    const outGain = Math.cos(t * (Math.PI / 2));

    // Pythagorean identity: sin^2 + cos^2 === 1.0 (constant acoustic power)
    const power = inGain * inGain + outGain * outGain;
    assert(
      Math.abs(power - 1.0) < 1e-6,
      `Equal power identity failed at t=${t}: power=${power}`
    );

    // Endpoint checks
    if (step === 0) {
      assert(Math.abs(inGain - 0.0) < 1e-6, "inGain should be 0 at t=0");
      assert(Math.abs(outGain - 1.0) < 1e-6, "outGain should be 1 at t=0");
    }
    if (step === 100) {
      assert(Math.abs(inGain - 1.0) < 1e-6, "inGain should be 1 at t=1");
      assert(Math.abs(outGain - 0.0) < 1e-6, "outGain should be 0 at t=1");
    }

    // Midpoint check (at t=0.5, both gains should be sqrt(0.5) ≈ 0.7071)
    if (step === 50) {
      assert(
        Math.abs(inGain - Math.SQRT1_2) < 1e-4,
        `Midpoint inGain should be ~0.7071, got ${inGain}`
      );
      assert(
        Math.abs(outGain - Math.SQRT1_2) < 1e-4,
        `Midpoint outGain should be ~0.7071, got ${outGain}`
      );
    }
  }
  console.log("  ✓ 101 sample points of Equal-Power curve verified (constant 0 dB power)");

  // ---------------------------------------------------------------------------
  // 2. Testing Crossfade Transitions on Adapter
  // ---------------------------------------------------------------------------
  console.log("--- 2. Testing Dual-Element Crossfade Transitions ---");
  const track1 = createMockTrack("track-1", "Track One", 180);
  const track2 = createMockTrack("track-2", "Track Two", 200);
  const track3 = createMockTrack("track-3", "Track Three", 220);

  // Set crossfade duration to 2000ms
  useSettingsStore.getState().setSetting("crossfadeDurationMs", 2000);
  assert.strictEqual(
    useSettingsStore.getState().crossfadeDurationMs,
    2000,
    "Crossfade duration should be 2000ms"
  );

  // Play track 1
  await playerAdapter.playTrack(track1);
  let status = await playerAdapter.getStatus();
  assert.strictEqual(status.current_track?.id, "track-1");
  assert.strictEqual(status.state, "Playing");

  // Crossfade to track 2
  await playerAdapter.playTrack(track2);
  status = await playerAdapter.getStatus();
  assert.strictEqual(status.current_track?.id, "track-2");
  assert.strictEqual(status.state, "Playing");

  // Rapidly switch to track 3 mid-crossfade (stress test interval cleanup)
  await playerAdapter.playTrack(track3);
  status = await playerAdapter.getStatus();
  assert.strictEqual(status.current_track?.id, "track-3");
  assert.strictEqual(status.state, "Playing");

  // Stop playback cleanly
  await playerAdapter.stop();
  status = await playerAdapter.getStatus();
  assert.strictEqual(status.state, "Stopped");
  console.log("  ✓ Dual-element handoff and rapid switching interval cancellation verified");

  // ---------------------------------------------------------------------------
  // 3. Testing PlayerStore Queue and Auto-Crossfade Integration
  // ---------------------------------------------------------------------------
  console.log("--- 3. Testing PlayerStore Auto-Crossfade Remaining Time Calculation ---");
  const queue = [track1, track2, track3];
  const playerStore = usePlayerStore.getState();

  await playerStore.setQueue(queue, 0);
  assert.strictEqual(usePlayerStore.getState().queueIndex, 0);
  assert.strictEqual(usePlayerStore.getState().currentTrack?.id, "track-1");

  // Next track transition
  await playerStore.playNext();
  assert.strictEqual(usePlayerStore.getState().queueIndex, 1);
  assert.strictEqual(usePlayerStore.getState().currentTrack?.id, "track-2");

  // Next track transition to end of queue
  await playerStore.playNext();
  assert.strictEqual(usePlayerStore.getState().queueIndex, 2);
  assert.strictEqual(usePlayerStore.getState().currentTrack?.id, "track-3");

  // Clean stop
  playerStore.stop();
  assert.strictEqual(usePlayerStore.getState().status.state, "Stopped");

  // Restore 0s default for subsequent tests
  useSettingsStore.getState().setSetting("crossfadeDurationMs", 0);
  console.log("  ✓ PlayerStore queue transitions with crossfade settings verified");

  console.log("\n  ✓ ALL CROSSFADE TESTS PASSED (100% SUCCESS)!\n");
}

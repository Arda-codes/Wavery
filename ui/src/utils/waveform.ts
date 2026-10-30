/**
 * Deterministic audio waveform generator.
 *
 * Produces organic, DAW-grade waveform silhouettes derived deterministically
 * from track metadata (id, title, artist, duration).
 *
 * Starts flat (uniform min height) when no track is present,
 * and morphs into a unique, realistic musical waveform when a track is opened.
 */

export interface TrackWaveformSource {
  id?: string | number;
  title?: string;
  artist?: string;
  album?: string;
  metadata?: {
    title?: string;
    artist?: string;
    album?: string;
    duration?: {
      secs?: number;
      nanos?: number;
    };
  };
}

/**
 * 32-bit FNV-1a / DJB2 string hasher.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Mulberry32 fast deterministic pseudo-random number generator.
 */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Number of bars displayed in the player bar waveform scrubber.
 * 72 bars provides optimal visual density and smoothness across desktop widths.
 */
export const DEFAULT_WAVEFORM_BAR_COUNT = 72;

export const FLAT_BAR_HEIGHT = 3;
export const MIN_WAVEFORM_HEIGHT = 4;
export const MAX_WAVEFORM_HEIGHT = 22;

/**
 * Generates an array of pixel heights for the waveform scrubber.
 *
 * @param track The current track, or null/undefined if idle.
 * @param barCount Number of bars across the scrubber.
 * @returns An array of bar heights in pixels (all FLAT_BAR_HEIGHT if no track).
 */
export function generateWaveformBarHeights(
  track: TrackWaveformSource | null | undefined,
  barCount: number = DEFAULT_WAVEFORM_BAR_COUNT
): number[] {
  if (!track) {
    return Array.from({ length: barCount }, () => FLAT_BAR_HEIGHT);
  }

  // Derive unique seed from track attributes
  const title = track.metadata?.title ?? track.title ?? "";
  const artist = track.metadata?.artist ?? track.artist ?? "";
  const durationSecs = track.metadata?.duration?.secs ?? 0;
  const trackKey = `${track.id ?? ""}-${title}-${artist}-${durationSecs}`;
  const seed = hashString(trackKey);
  const rng = mulberry32(seed);

  // Random phase offsets for harmonic frequencies
  const phase1 = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;
  const phase3 = rng() * Math.PI * 2;
  const phase4 = rng() * Math.PI * 2;

  // Track temperament (dynamic range factor)
  const dynamicFactor = 0.65 + rng() * 0.35; // 0.65 - 1.0

  const heights: number[] = new Array(barCount);

  for (let i = 0; i < barCount; i++) {
    const t = i / (barCount - 1); // 0.0 to 1.0

    // 1. Musical structure envelope (intro -> verse -> chorus -> breakdown -> climax -> outro)
    let envelope: number;
    if (t < 0.08) {
      // Intro ramp
      envelope = 0.25 + (t / 0.08) * 0.35;
    } else if (t < 0.30) {
      // Verse 1
      envelope = 0.55 + 0.15 * Math.sin(t * 12 + phase1);
    } else if (t < 0.50) {
      // Chorus 1
      envelope = 0.82 + 0.14 * Math.sin(t * 18 + phase2);
    } else if (t < 0.65) {
      // Verse 2
      envelope = 0.62 + 0.12 * Math.sin(t * 14 + phase3);
    } else if (t < 0.74) {
      // Bridge / Breakdown dip
      envelope = 0.38 + 0.15 * Math.cos(t * 10 + phase1);
    } else if (t < 0.90) {
      // Climax / Final Chorus
      envelope = 0.90 + 0.10 * Math.sin(t * 22 + phase4);
    } else {
      // Outro fadeout
      const fade = (1.0 - t) / 0.10;
      envelope = 0.25 + Math.max(0, fade) * 0.55;
    }

    // 2. Harmonic frequencies representing rhythmic cadence
    const harmonics =
      0.18 * Math.sin(t * Math.PI * 8 + phase1) +
      0.12 * Math.sin(t * Math.PI * 18 + phase2) +
      0.08 * Math.cos(t * Math.PI * 34 + phase3);

    // 3. High-frequency transients (beats, kicks, snare spikes)
    const transient = (rng() * 2 - 1) * 0.22;

    // 4. Combine and normalize
    let normalized = (envelope + harmonics + transient) * dynamicFactor;
    normalized = Math.max(0.08, Math.min(1.0, normalized));

    // Map to pixel range [MIN_WAVEFORM_HEIGHT, MAX_WAVEFORM_HEIGHT]
    const pxHeight = Math.round(
      MIN_WAVEFORM_HEIGHT + normalized * (MAX_WAVEFORM_HEIGHT - MIN_WAVEFORM_HEIGHT)
    );

    heights[i] = pxHeight;
  }

  return heights;
}

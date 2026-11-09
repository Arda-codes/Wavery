/**
 * Enrichment scope tests.
 *
 * "Only fill missing fields" must guarantee that a track with existing lyrics
 * (even plain) is never sent to LRCLIB, and that a track with year and genre
 * present is never sent to Apple Music. These helpers drive both the worker
 * pool and the modal's pending-count preview, so the two can never disagree.
 */

import assert from "assert";
import {
  EnrichOptions,
  trackNeedsEnrichment,
  trackNeedsLyrics,
  trackNeedsMetadata,
} from "../src/stores/enrichmentStore";
import { Track } from "../src/types";

function baseOptions(overrides: Partial<EnrichOptions> = {}): EnrichOptions {
  return {
    fetchArtwork: true,
    fetchLyrics: true,
    fetchMetadata: true,
    onlyMissing: true,
    overwriteExisting: false,
    writeTags: true,
    ...overrides,
  };
}

function makeTrack(overrides: {
  lyrics?: string;
  year?: number;
  genre?: string;
}): Track {
  return {
    id: "scope-track",
    source: { Managed: "/tmp/scope-track.flac" },
    metadata: {
      title: "Scope",
      artist: "Artist",
      album: "Album",
      duration: { secs: 200, nanos: 0 },
      format: "FLAC",
      lyrics: overrides.lyrics,
      year: overrides.year,
      genre: overrides.genre,
    },
    date_added: 1_700_000_000,
  };
}

const SYNCED = "[00:01.00]First line\n[00:05.00]Second line";
const PLAIN = "First line\nSecond line";

export async function runEnrichmentScopeTests(): Promise<void> {
  console.log("\n=======================================================");
  console.log("  ENRICHMENT SCOPE (ONLY FILL MISSING FIELDS)");
  console.log("=======================================================\n");

  let assertions = 0;
  function ok(condition: boolean, description: string) {
    assertions++;
    if (!condition) throw new Error(`Assertion failed: ${description}`);
    console.log(`  ✓ ${description}`);
  }

  console.log("--- Lyrics ---");
  ok(
    !trackNeedsLyrics(makeTrack({ lyrics: PLAIN }), baseOptions()),
    "Plain lyrics are left alone when only filling missing fields"
  );
  ok(
    !trackNeedsLyrics(makeTrack({ lyrics: SYNCED }), baseOptions()),
    "Synced lyrics are left alone when only filling missing fields"
  );
  ok(
    trackNeedsLyrics(makeTrack({}), baseOptions()),
    "A track without lyrics is fetched"
  );
  ok(
    trackNeedsLyrics(makeTrack({ lyrics: PLAIN }), baseOptions({ onlyMissing: false })),
    "Plain lyrics are upgraded to synced when only-missing is off"
  );
  ok(
    !trackNeedsLyrics(makeTrack({ lyrics: SYNCED }), baseOptions({ onlyMissing: false })),
    "Synced lyrics are not refetched when only-missing is off"
  );
  ok(
    trackNeedsLyrics(
      makeTrack({ lyrics: SYNCED }),
      baseOptions({ onlyMissing: false, overwriteExisting: true })
    ),
    "Overwrite replaces existing lyrics when only-missing is off"
  );
  ok(
    !trackNeedsLyrics(
      makeTrack({ lyrics: PLAIN }),
      baseOptions({ onlyMissing: true, overwriteExisting: true })
    ),
    "Only-missing wins over overwrite so present lyrics stay untouched"
  );
  ok(
    !trackNeedsLyrics(makeTrack({}), baseOptions({ fetchLyrics: false })),
    "Disabling lyrics skips the lyrics fetch"
  );

  console.log("--- Metadata ---");
  ok(
    !trackNeedsMetadata(makeTrack({ year: 1999, genre: "Rock" }), baseOptions()),
    "A fully tagged track needs no metadata lookup"
  );
  ok(
    trackNeedsMetadata(makeTrack({ year: 1999 }), baseOptions()),
    "A missing genre triggers a lookup"
  );
  ok(
    trackNeedsMetadata(makeTrack({ genre: "Rock" }), baseOptions()),
    "A missing year triggers a lookup"
  );
  ok(
    !trackNeedsMetadata(makeTrack({}), baseOptions({ fetchMetadata: false })),
    "Disabling metadata skips the lookup"
  );

  console.log("--- Combined work decision ---");
  ok(
    !trackNeedsEnrichment(
      makeTrack({ lyrics: SYNCED, year: 1999, genre: "Rock" }),
      baseOptions()
    ),
    "A complete track has nothing to do"
  );
  ok(
    trackNeedsEnrichment(
      makeTrack({ lyrics: SYNCED, year: 1999 }),
      baseOptions()
    ),
    "A complete-lyrics track with a missing genre is still processed"
  );
  ok(
    trackNeedsEnrichment(
      makeTrack({ year: 1999, genre: "Rock" }),
      baseOptions()
    ),
    "A tagged track with no lyrics is still processed"
  );
  ok(
    !trackNeedsEnrichment(
      makeTrack({ lyrics: SYNCED, year: 1999, genre: "Rock" }),
      baseOptions({ fetchLyrics: false, fetchMetadata: false })
    ),
    "No selected features means no work"
  );

  console.log("--- Batch preview ---");
  const batch = [
    makeTrack({ lyrics: SYNCED, year: 1999, genre: "Rock" }),
    makeTrack({ lyrics: PLAIN, genre: "Rock" }),
    makeTrack({ year: 1999, genre: "Rock" }),
    makeTrack({}),
  ];
  const pending = batch.filter((track) => trackNeedsEnrichment(track, baseOptions())).length;
  ok(pending === 3, "Three of four tracks still need at least one field");
  const pendingOverride = batch.filter((track) =>
    trackNeedsEnrichment(track, baseOptions({ onlyMissing: false, overwriteExisting: true }))
  ).length;
  ok(pendingOverride === 4, "Overwriting schedules the already-complete track too");

  console.log(`\n  ${assertions} assertions passed.\n`);
}

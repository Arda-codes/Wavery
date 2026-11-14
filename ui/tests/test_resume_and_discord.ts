/**
 * Regression suite for two reported playback defects:
 *
 *  1. "Pressing play does nothing the first time after an app restart."
 *     A restored session is shown as playing while the audio engine holds no
 *     sink, so the scrubber moves in silence. `resume()` must reload the track
 *     instead of trusting a no-op engine resume.
 *
 *  2. Discord Rich Presence showed the wrong (or no) album art, and scrubbing
 *     never moved the Discord progress bar.
 *     Artwork is now scored against artist/album/title instead of taking the
 *     first iTunes hit, and seeks are detected from the engine position.
 */

import assert from "assert";
import { usePlayerStore } from "../src/stores/playerStore";
import { playerAdapter } from "../src/services/adapter";
import {
  normalizeForMatch,
  tokenScore,
  upscaleArtwork,
  bestArtworkScore,
} from "../src/utils/discordRpc";
import { generateSyntheticTracks, Track } from "./generator";

/** Minimal iTunes-shaped results used by the matcher tests. */
interface FakeResult {
  artistName?: string;
  collectionName?: string;
  trackName?: string;
  artworkUrl100?: string;
}

export async function runPlaybackResumeAndDiscordTests(): Promise<void> {
  console.log("\n=======================================================");
  console.log("  PLAYBACK RESUME & DISCORD PRESENCE REGRESSIONS");
  console.log("=======================================================\n");

  let assertions = 0;
  function ok(condition: boolean, description: string) {
    assertions++;
    if (!condition) throw new Error(`Assertion failed: ${description}`);
    console.log(`  ✓ ${description}`);
  }

  // ---------------------------------------------------------------
  // 1. Artwork matching
  // ---------------------------------------------------------------
  console.log("--- 1. iTunes artwork matching ---");
  ok(
    normalizeForMatch("Rumours (Deluxe Edition)") === "rumours",
    "Bracketed edition suffixes are stripped before matching"
  );
  ok(
    normalizeForMatch("Björk") === "bjork",
    "Diacritics are folded so accented artists still match"
  );
  ok(
    tokenScore(normalizeForMatch("In Rainbows"), normalizeForMatch("in rainbows")) === 1,
    "Identical normalized strings score 1"
  );
  ok(
    tokenScore(normalizeForMatch("Rumours"), normalizeForMatch("Tusk")) === 0,
    "Unrelated albums score 0"
  );

  const studio: FakeResult = {
    artistName: "Fleetwood Mac",
    collectionName: "Rumours (Deluxe Edition)",
    trackName: "Dreams",
    artworkUrl100: "https://is1.mzstatic.com/image/thumb/x/100x100bb.jpg",
  };
  const live: FakeResult = {
    artistName: "Fleetwood Mac",
    collectionName: "Rumours Live",
    trackName: "Dreams (Live)",
    artworkUrl100: "https://is1.mzstatic.com/image/thumb/y/100x100bb.jpg",
  };
  const wrongArtist: FakeResult = {
    artistName: "Some Cover Band",
    collectionName: "Rumours",
    trackName: "Dreams",
    artworkUrl100: "https://is1.mzstatic.com/image/thumb/z/100x100bb.jpg",
  };

  // Deliberately list the wrong cover first: the old first-hit implementation
  // would have used it.
  const best = bestArtworkScore(
    [wrongArtist, live, studio],
    normalizeForMatch("Fleetwood Mac"),
    normalizeForMatch("Rumours"),
    normalizeForMatch("Dreams")
  );
  ok(best !== null, "A candidate is selected");
  ok(
    best!.url === upscaleArtwork(studio.artworkUrl100!),
    "The studio release wins over a live version listed earlier"
  );
  ok(
    upscaleArtwork("https://is1.mzstatic.com/a/100x100bb.jpg").includes("600x600bb"),
    "Artwork is upscaled to 600px for Discord"
  );

  const obscure = bestArtworkScore(
    [wrongArtist],
    normalizeForMatch("Fleetwood Mac"),
    normalizeForMatch("Rumours"),
    normalizeForMatch("Dreams")
  );
  ok(
    obscure !== null && obscure.score < 0.55,
    "A wrong-artist cover falls below the confidence bar instead of being used"
  );

  // Regional storefronts list the same release under a localized artist name
  // ("Anri" in the file vs "杏里" on the JP store). An exact album match must
  // still resolve, but a wrong album by that localized artist must not.
  const localized: FakeResult = {
    artistName: "杏里",
    collectionName: "Timely!!",
    trackName: "DRIVING MY LOVE",
    artworkUrl100: "https://is1.mzstatic.com/image/thumb/jp/100x100bb.jpg",
  };
  const localizedBest = bestArtworkScore(
    [localized],
    normalizeForMatch("Anri"),
    normalizeForMatch("Timely!!"),
    normalizeForMatch("DRIVING MY LOVE")
  );
  ok(
    localizedBest !== null && localizedBest.score >= 0.55,
    "A localized artist name does not hide an exact album cover"
  );
  ok(
    bestArtworkScore(
      [{ ...localized, collectionName: "Different Album" }],
      normalizeForMatch("Anri"),
      normalizeForMatch("Timely!!"),
      normalizeForMatch("DRIVING MY LOVE")
    )!.score < 0.55,
    "A localized artist with the wrong album is still rejected"
  );

  // Reverse localized: user tag is non-Latin ("杏里") and the storefront result is Latin ("Anri")
  const reverseLocalized: FakeResult = {
    artistName: "Anri",
    collectionName: "Timely!!",
    trackName: "DRIVING MY LOVE",
    artworkUrl100: "https://is1.mzstatic.com/image/thumb/us/100x100bb.jpg",
  };
  const reverseLocalizedBest = bestArtworkScore(
    [reverseLocalized],
    normalizeForMatch("杏里"),
    normalizeForMatch("Timely!!"),
    normalizeForMatch("DRIVING MY LOVE")
  );
  ok(
    reverseLocalizedBest !== null && reverseLocalizedBest.score >= 0.55,
    "A localized track tag does not hide an exact album cover in a Latin storefront"
  );

  // Non-Latin album title match
  const nonLatinAlbum: FakeResult = {
    artistName: "杏里",
    collectionName: "タイムリー",
    trackName: "DRIVING MY LOVE",
    artworkUrl100: "https://is1.mzstatic.com/image/thumb/jp/100x100bb.jpg",
  };
  const nonLatinAlbumBest = bestArtworkScore(
    [nonLatinAlbum],
    normalizeForMatch("杏里"),
    normalizeForMatch("タイムリー"),
    normalizeForMatch("DRIVING MY LOVE")
  );
  ok(
    nonLatinAlbumBest !== null && nonLatinAlbumBest.score >= 0.55,
    "Non-Latin album titles are preserved and match with high confidence"
  );

  // Stop-word-only artists & titles: "The The" or "EP" must not collapse to empty string
  ok(
    normalizeForMatch("The The") === "the the",
    "An artist composed solely of stop words retains base tokens"
  );
  ok(
    normalizeForMatch("EP") === "ep",
    "A title or album composed solely of stop words retains base tokens"
  );
  ok(
    normalizeForMatch("Track - Single") === "track",
    "Single release suffix is normalized away when other tokens exist"
  );
  const theTheResult: FakeResult = {
    artistName: "The The",
    collectionName: "Soul Mining",
    trackName: "This Is the Day",
    artworkUrl100: "https://is1.mzstatic.com/image/thumb/us/100x100bb.jpg",
  };
  const theTheBest = bestArtworkScore(
    [theTheResult],
    normalizeForMatch("The The"),
    normalizeForMatch("Soul Mining"),
    normalizeForMatch("This Is the Day")
  );
  ok(
    theTheBest !== null && theTheBest.score >= 0.55,
    "An artist composed of stop words matches with full confidence"
  );

  // ---------------------------------------------------------------
  // 2. Resume after restart
  // ---------------------------------------------------------------
  console.log("\n--- 2. Resume reloads when the engine has nothing loaded ---");
  const tracks = generateSyntheticTracks(2);
  const track: Track = tracks[0];

  const originalResume = playerAdapter.resume;
  const originalPlayTrack = playerAdapter.playTrack;
  const originalSeek = playerAdapter.seek;

  let resumeCalls = 0;
  let playCalls: string[] = [];
  let seeks: number[] = [];

  try {
    // Case A: engine refuses to resume (NothingToResume) and the session was
    // restored at 42s of a 240s track.
    playerAdapter.resume = async () => {
      resumeCalls++;
      throw new Error("Nothing to resume: no track is loaded");
    };
    playerAdapter.playTrack = async (t: Track) => {
      playCalls.push(t.id);
    };
    playerAdapter.seek = async (secs: number) => {
      seeks.push(secs);
    };

    usePlayerStore.setState({
      currentTrack: track,
      currentTrackId: track.id,
      isManualStop: true,
      status: {
        ...usePlayerStore.getState().status,
        state: "Paused",
        position_secs: 42,
        duration_secs: 240,
      },
    });

    await usePlayerStore.getState().resume();
    ok(resumeCalls === 1, "resume() asks the engine first");
    ok(playCalls.length === 1 && playCalls[0] === track.id, "The track is reloaded exactly once");
    ok(seeks.length === 1 && seeks[0] === 42, "Playback resumes at the saved position");
    ok(
      usePlayerStore.getState().status.state === "Playing",
      "The store reports Playing only after the reload succeeded"
    );

    // Case B: a track that already reached its end restarts from zero rather
    // than seeking to the final second.
    playCalls = [];
    seeks = [];
    usePlayerStore.setState({
      status: {
        ...usePlayerStore.getState().status,
        state: "Stopped",
        position_secs: 240,
        duration_secs: 240,
      },
    });
    await usePlayerStore.getState().resume();
    ok(playCalls.length === 1, "A finished track is reloaded");
    ok(seeks.length === 0, "A finished track restarts from the beginning, without a seek");

    // Case C: if reloading also fails, the UI must not claim to be playing.
    playerAdapter.playTrack = async () => {
      throw new Error("file missing");
    };
    usePlayerStore.setState({
      status: {
        ...usePlayerStore.getState().status,
        state: "Stopped",
        position_secs: 10,
        duration_secs: 240,
      },
    });
    await usePlayerStore.getState().resume();
    ok(
      usePlayerStore.getState().status.state === "Paused",
      "A failed reload leaves the player paused instead of silently 'playing'"
    );
  } finally {
    playerAdapter.resume = originalResume;
    playerAdapter.playTrack = originalPlayTrack;
    playerAdapter.seek = originalSeek;
    usePlayerStore.setState({ currentTrack: null, currentTrackId: null });
  }

  console.log(`\n  ${assertions} assertions passed.\n`);
}

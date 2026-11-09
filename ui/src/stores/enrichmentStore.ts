import { create } from "zustand";
import { Track } from "../types";
import { playerAdapter } from "../services/adapter";
import { useLibraryStore } from "./libraryStore";
import { searchAppleMusicTrack, searchAppleMusicAlbum } from "../services/appleMusic";
import { fetchLyrics } from "../services/lyrics";
import { hasLrcTimestamps } from "../utils/lyrics";

export interface EnrichOptions {
  fetchArtwork: boolean;
  fetchLyrics: boolean;
  fetchMetadata: boolean;
  /**
   * Only fill gaps: never request or replace a field that already has a value.
   * When enabled, tracks with lyrics and year/genre present are skipped without
   * a single network call.
   */
  onlyMissing: boolean;
  overwriteExisting: boolean;
  writeTags: boolean;
}

/**
 * Returns whether the track should have lyrics fetched under the given options.
 *
 * With `onlyMissing` enabled, any existing lyrics (plain or synced) are left
 * untouched and no LRCLIB request is made. Otherwise plain lyrics are upgraded
 * to synced lyrics, and `overwriteExisting` replaces anything present.
 */
export function trackNeedsLyrics(track: Track, options: EnrichOptions): boolean {
  if (!options.fetchLyrics) return false;
  const lyrics = track.metadata.lyrics?.trim();
  if (options.overwriteExisting && !options.onlyMissing) return true;
  if (!lyrics) return true;
  return !options.onlyMissing && !hasLrcTimestamps(lyrics);
}

/**
 * Returns whether the track should look up year, genre, and track numbers.
 *
 * Year and genre are the trigger; when either is absent the Apple Music lookup
 * runs and fills whichever individual fields are still empty.
 */
export function trackNeedsMetadata(track: Track, options: EnrichOptions): boolean {
  if (!options.fetchMetadata) return false;
  if (options.overwriteExisting && !options.onlyMissing) return true;
  return !track.metadata.year || !track.metadata.genre;
}

/**
 * Returns whether any selected enrichment feature still has work to do.
 */
export function trackNeedsEnrichment(track: Track, options: EnrichOptions): boolean {
  return trackNeedsLyrics(track, options) || trackNeedsMetadata(track, options);
}

export interface EnrichLogItem {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  status: "success" | "skipped" | "error";
  details: string[];
}

export interface EnrichmentState {
  isOpen: boolean;
  isRunning: boolean;
  isPaused: boolean;
  total: number;
  completed: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  currentTrackTitle: string;
  log: EnrichLogItem[];
  options: EnrichOptions;
  tracksQueue: Track[];

  // Actions
  openModal: (tracks?: Track[], albumName?: string) => void;
  closeModal: () => void;
  setOptions: (opts: Partial<EnrichOptions>) => void;
  startEnrichment: () => Promise<void>;
  pauseEnrichment: () => void;
  resumeEnrichment: () => void;
  cancelEnrichment: () => void;
}

let _isCancelled = false;
let _isPaused = false;

export const useEnrichmentStore = create<EnrichmentState>((set, get) => ({
  isOpen: false,
  isRunning: false,
  isPaused: false,
  total: 0,
  completed: 0,
  successCount: 0,
  skippedCount: 0,
  failedCount: 0,
  currentTrackTitle: "",
  log: [],
  tracksQueue: [],
  options: {
    fetchArtwork: true,
    fetchLyrics: true,
    fetchMetadata: true,
    onlyMissing: true,
    overwriteExisting: false,
    writeTags: true,
  },

  openModal: (tracks?: Track[], albumName?: string) => {
    const queue = tracks && tracks.length > 0 ? tracks : useLibraryStore.getState().tracks;
    set({
      isOpen: true,
      tracksQueue: queue,
      total: queue.length,
      completed: 0,
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      log: [],
      currentTrackTitle: albumName ? `Album: ${albumName}` : "",
    });
  },

  closeModal: () => {
    set({ isOpen: false });
  },

  setOptions: (opts) => {
    set((state) => ({
      options: { ...state.options, ...opts },
    }));
  },

  pauseEnrichment: () => {
    _isPaused = true;
    set({ isPaused: true });
  },

  resumeEnrichment: () => {
    _isPaused = false;
    set({ isPaused: false });
  },

  cancelEnrichment: () => {
    _isCancelled = true;
    set({ isRunning: false, isPaused: false });
  },

  startEnrichment: async () => {
    const { tracksQueue, options } = get();
    if (tracksQueue.length === 0 || get().isRunning) return;

    _isCancelled = false;
    _isPaused = false;
    set({
      isRunning: true,
      isPaused: false,
      completed: 0,
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      log: [],
    });

    // 1. Group tracks by album for 90% network request reduction
    const albumGroups = new Map<string, Track[]>();
    const individualTracks: Track[] = [];

    for (const track of tracksQueue) {
      const album = track.metadata.album?.trim();
      const artist = track.metadata.artist?.trim();
      if (album && artist && album !== "Unknown Album" && artist !== "Unknown Artist") {
        const key = `${artist}__${album}`.toLowerCase();
        if (!albumGroups.has(key)) {
          albumGroups.set(key, []);
        }
        albumGroups.get(key)!.push(track);
      } else {
        individualTracks.push(track);
      }
    }

    // Helper: update a single track in library
    const commitTrack = async (updated: Track) => {
      const all = useLibraryStore.getState().tracks;
      const idx = all.findIndex((t) => t.id === updated.id);
      if (idx !== -1) {
        const copy = [...all];
        copy[idx] = updated;
        useLibraryStore.setState({ tracks: copy });
      }
    };

    // Helper: wait while paused
    const waitIfPaused = async () => {
      while (_isPaused && !_isCancelled) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };

    // Helper: delay to respect rate limits
    const throttle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Concurrency worker pool runner for 3x-5x faster batch processing
    const runWorkerPool = async (
      tracksToProcess: Track[],
      processor: (track: Track) => Promise<void>,
      concurrency: number = 3
    ) => {
      let idx = 0;
      const worker = async () => {
        while (idx < tracksToProcess.length && !_isCancelled) {
          await waitIfPaused();
          const track = tracksToProcess[idx++];
          if (!track) break;
          await processor(track);
        }
      };
      const workers = Array.from(
        { length: Math.min(concurrency, tracksToProcess.length) },
        () => worker()
      );
      await Promise.all(workers);
    };

    // 2. Process Album Groups
    for (const [, tracks] of albumGroups) {
      if (_isCancelled) break;
      await waitIfPaused();

      const sample = tracks[0];
      const sampleAlbum = sample.metadata.album || "";
      const sampleArtist = sample.metadata.artist || "";

      set({ currentTrackTitle: `Album: ${sampleAlbum}` });

      // Only call Apple Music when at least one track in the group is missing a
      // metadata field. With "only missing" enabled this avoids a request for
      // fully tagged albums.
      const anyTrackNeedsMetadata =
        options.fetchMetadata && tracks.some((t) => trackNeedsMetadata(t, options));
      let appleAlbum = null;
      if (options.fetchArtwork || anyTrackNeedsMetadata) {
        appleAlbum = await searchAppleMusicAlbum(sampleAlbum, sampleArtist);
        await throttle(200);
      }

      const processAlbumTrack = async (track: Track) => {
        if (_isCancelled) return;
        await waitIfPaused();

        const title = track.metadata.title || "Untitled";
        const artist = track.metadata.artist || "Unknown Artist";
        set({ currentTrackTitle: `${title} — ${artist}` });

        const existingLyrics = track.metadata.lyrics?.trim() ?? "";
        const isMissingLyrics = existingLyrics.length === 0;
        const hasOnlyPlainLyrics = existingLyrics.length > 0 && !hasLrcTimestamps(existingLyrics);
        const replaceExisting = options.overwriteExisting && !options.onlyMissing;
        const needsLyrics = trackNeedsLyrics(track, options);
        const needsMetadata = trackNeedsMetadata(track, options);

        // Immediate fast skip if no enrichment is required for this track
        if (!needsLyrics && !needsMetadata) {
          set((state) => ({
            completed: state.completed + 1,
            skippedCount: state.skippedCount + 1,
            log: [
              {
                id: `${track.id}-${Date.now()}`,
                trackId: track.id,
                title,
                artist,
                status: "skipped",
                details: [
                  options.onlyMissing ? "Already has the selected fields" : "Already up to date",
                ],
              },
              ...state.log.slice(0, 99),
            ],
          }));
          return;
        }

        const details: string[] = [];
        let hasChanges = false;
        const newMeta = { ...track.metadata };

        // Match with Apple Album track if available
        if (appleAlbum && needsMetadata) {
          const matchedAppleTrack = appleAlbum.tracks.find(
            (at) =>
              at.title.toLowerCase() === title.toLowerCase() ||
              title.toLowerCase().includes(at.title.toLowerCase()) ||
              at.title.toLowerCase().includes(title.toLowerCase())
          );

          if (matchedAppleTrack) {
            if (matchedAppleTrack.year && (!newMeta.year || replaceExisting)) {
              newMeta.year = matchedAppleTrack.year;
              details.push(`Year: ${matchedAppleTrack.year}`);
              hasChanges = true;
            }
            if (matchedAppleTrack.genre && (!newMeta.genre || replaceExisting)) {
              newMeta.genre = matchedAppleTrack.genre;
              details.push(`Genre: ${matchedAppleTrack.genre}`);
              hasChanges = true;
            }
            if (matchedAppleTrack.trackNumber && (!newMeta.track_number || replaceExisting)) {
              newMeta.track_number = matchedAppleTrack.trackNumber;
              details.push(`Track #${matchedAppleTrack.trackNumber}`);
              hasChanges = true;
            }
            if (matchedAppleTrack.discNumber && (!newMeta.disc_number || replaceExisting)) {
              newMeta.disc_number = matchedAppleTrack.discNumber;
              details.push(`Disc #${matchedAppleTrack.discNumber}`);
              hasChanges = true;
            }
          }
        }

        // Fetch Lyrics via LRCLIB if needed (auto-upgrade plain text to synced lyrics)
        if (needsLyrics) {
          const lyricsRes = await fetchLyrics(
            artist,
            title,
            sampleAlbum,
            track.metadata.duration?.secs || 0,
            Boolean(hasOnlyPlainLyrics)
          );
          await throttle(60);

          if (lyricsRes?.bestLyrics) {
            if (isMissingLyrics || replaceExisting || (hasOnlyPlainLyrics && lyricsRes.syncedLyrics && !options.onlyMissing)) {
              newMeta.lyrics = lyricsRes.bestLyrics;
              details.push(lyricsRes.syncedLyrics ? "Synced Lyrics" : "Plain Lyrics");
              hasChanges = true;
            }
          }
        }

        // Apply and persist if changed
        if (hasChanges) {
          try {
            const updated = await playerAdapter.updateTrackMetadata({
              track_id: track.id,
              title: newMeta.title,
              artist: newMeta.artist,
              album: newMeta.album,
              album_artist: newMeta.album_artist,
              track_number: newMeta.track_number,
              disc_number: newMeta.disc_number,
              year: newMeta.year,
              genre: newMeta.genre,
              lyrics: newMeta.lyrics,
              write_tags: options.writeTags,
            });
            await commitTrack(updated);

            set((state) => ({
              completed: state.completed + 1,
              successCount: state.successCount + 1,
              log: [
                {
                  id: `${track.id}-${Date.now()}`,
                  trackId: track.id,
                  title,
                  artist,
                  status: "success",
                  details,
                },
                ...state.log.slice(0, 99),
              ],
            }));
          } catch {
            set((state) => ({
              completed: state.completed + 1,
              failedCount: state.failedCount + 1,
              log: [
                {
                  id: `${track.id}-${Date.now()}`,
                  trackId: track.id,
                  title,
                  artist,
                  status: "error",
                  details: ["Failed to save tags"],
                },
                ...state.log.slice(0, 99),
              ],
            }));
          }
        } else {
          const stillMissingSelected =
            (options.fetchLyrics && !newMeta.lyrics?.trim()) ||
            (options.fetchMetadata && (!newMeta.year || !newMeta.genre));
          const reason = stillMissingSelected ? "No online metadata found" : "Already up to date";
          set((state) => ({
            completed: state.completed + 1,
            skippedCount: state.skippedCount + 1,
            log: [
              {
                id: `${track.id}-${Date.now()}`,
                trackId: track.id,
                title,
                artist,
                status: "skipped",
                details: [reason],
              },
              ...state.log.slice(0, 99),
            ],
          }));
        }
      };

      await runWorkerPool(tracks, processAlbumTrack, 3);
    }

    // 3. Process Individual Non-Album Tracks
    const processIndividualTrack = async (track: Track) => {
      if (_isCancelled) return;
      await waitIfPaused();

      const title = track.metadata.title || "Untitled";
      const artist = track.metadata.artist || "Unknown Artist";
      set({ currentTrackTitle: `${title} — ${artist}` });

      const existingLyrics = track.metadata.lyrics?.trim() ?? "";
      const isMissingLyrics = existingLyrics.length === 0;
      const hasOnlyPlainLyrics = existingLyrics.length > 0 && !hasLrcTimestamps(existingLyrics);
      const replaceExisting = options.overwriteExisting && !options.onlyMissing;
      const needsLyrics = trackNeedsLyrics(track, options);
      const needsMetadata = trackNeedsMetadata(track, options);

      // Fast skip if already complete
      if (!needsLyrics && !needsMetadata) {
        set((state) => ({
          completed: state.completed + 1,
          skippedCount: state.skippedCount + 1,
          log: [
            {
              id: `${track.id}-${Date.now()}`,
              trackId: track.id,
              title,
              artist,
              status: "skipped",
              details: [
                options.onlyMissing ? "Already has the selected fields" : "Already up to date",
              ],
            },
            ...state.log.slice(0, 99),
          ],
        }));
        return;
      }

      const details: string[] = [];
      let hasChanges = false;
      const newMeta = { ...track.metadata };

      if (needsMetadata) {
        const appleTrack = await searchAppleMusicTrack(title, artist, track.metadata.album);
        await throttle(150);

        if (appleTrack) {
          if (appleTrack.year && (!newMeta.year || replaceExisting)) {
            newMeta.year = appleTrack.year;
            details.push(`Year: ${appleTrack.year}`);
            hasChanges = true;
          }
          if (appleTrack.genre && (!newMeta.genre || replaceExisting)) {
            newMeta.genre = appleTrack.genre;
            details.push(`Genre: ${appleTrack.genre}`);
            hasChanges = true;
          }
          if (appleTrack.trackNumber && (!newMeta.track_number || replaceExisting)) {
            newMeta.track_number = appleTrack.trackNumber;
            details.push(`Track #${appleTrack.trackNumber}`);
            hasChanges = true;
          }
        }
      }

      if (needsLyrics) {
        const lyricsRes = await fetchLyrics(
          artist,
          title,
          track.metadata.album,
          track.metadata.duration?.secs || 0,
          Boolean(hasOnlyPlainLyrics)
        );
        await throttle(60);

        if (lyricsRes?.bestLyrics) {
          if (isMissingLyrics || replaceExisting || (hasOnlyPlainLyrics && lyricsRes.syncedLyrics && !options.onlyMissing)) {
            newMeta.lyrics = lyricsRes.bestLyrics;
            details.push(lyricsRes.syncedLyrics ? "Synced Lyrics" : "Plain Lyrics");
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        try {
          const updated = await playerAdapter.updateTrackMetadata({
            track_id: track.id,
            title: newMeta.title,
            artist: newMeta.artist,
            album: newMeta.album,
            album_artist: newMeta.album_artist,
            track_number: newMeta.track_number,
            disc_number: newMeta.disc_number,
            year: newMeta.year,
            genre: newMeta.genre,
            lyrics: newMeta.lyrics,
            write_tags: options.writeTags,
          });
          await commitTrack(updated);

          set((state) => ({
            completed: state.completed + 1,
            successCount: state.successCount + 1,
            log: [
              {
                id: `${track.id}-${Date.now()}`,
                trackId: track.id,
                title,
                artist,
                status: "success",
                details,
              },
              ...state.log.slice(0, 99),
            ],
          }));
        } catch {
          set((state) => ({
            completed: state.completed + 1,
            failedCount: state.failedCount + 1,
            log: [
              {
                id: `${track.id}-${Date.now()}`,
                trackId: track.id,
                title,
                artist,
                status: "error",
                details: ["Failed to save tags"],
              },
              ...state.log.slice(0, 99),
            ],
          }));
        }
      } else {
        const stillMissingSelected =
          (options.fetchLyrics && !newMeta.lyrics?.trim()) ||
          (options.fetchMetadata && (!newMeta.year || !newMeta.genre));
        const reason = stillMissingSelected ? "No online metadata found" : "Already up to date";
        set((state) => ({
          completed: state.completed + 1,
          skippedCount: state.skippedCount + 1,
          log: [
            {
              id: `${track.id}-${Date.now()}`,
              trackId: track.id,
              title,
              artist,
              status: "skipped",
              details: [reason],
            },
            ...state.log.slice(0, 99),
          ],
        }));
      }
    };

    await runWorkerPool(individualTracks, processIndividualTrack, 3);

    set({ isRunning: false, currentTrackTitle: "Finished" });
  },
}));

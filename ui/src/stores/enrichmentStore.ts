import { create } from "zustand";
import { Track } from "../types";
import { playerAdapter } from "../services/adapter";
import { useLibraryStore } from "./libraryStore";
import { searchAppleMusicTrack, searchAppleMusicAlbum } from "../services/appleMusic";
import { fetchLyrics } from "../services/lyrics";

export interface EnrichOptions {
  fetchArtwork: boolean;
  fetchLyrics: boolean;
  fetchMetadata: boolean;
  overwriteExisting: boolean;
  writeTags: boolean;
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

    const updatedLibraryTracks = [...useLibraryStore.getState().tracks];

    // Helper: update a single track in library
    const commitTrack = async (updated: Track) => {
      const idx = updatedLibraryTracks.findIndex((t) => t.id === updated.id);
      if (idx !== -1) {
        updatedLibraryTracks[idx] = updated;
      }
      useLibraryStore.setState({ tracks: [...updatedLibraryTracks] });
    };

    // Helper: wait while paused
    const waitIfPaused = async () => {
      while (_isPaused && !_isCancelled) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };

    // Helper: delay to respect rate limits
    const throttle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // 2. Process Album Groups
    for (const [, tracks] of albumGroups) {
      if (_isCancelled) break;
      await waitIfPaused();

      const sample = tracks[0];
      const sampleAlbum = sample.metadata.album || "";
      const sampleArtist = sample.metadata.artist || "";

      set({ currentTrackTitle: `Album: ${sampleAlbum}` });

      // If metadata or artwork is enabled, query album metadata in ONE call
      let appleAlbum = null;
      if (options.fetchMetadata || options.fetchArtwork) {
        appleAlbum = await searchAppleMusicAlbum(sampleAlbum, sampleArtist);
        await throttle(300);
      }

      for (const track of tracks) {
        if (_isCancelled) break;
        await waitIfPaused();

        const title = track.metadata.title || "Untitled";
        const artist = track.metadata.artist || "Unknown Artist";
        set({ currentTrackTitle: `${title} — ${artist}` });

        const details: string[] = [];
        let hasChanges = false;
        const newMeta = { ...track.metadata };

        // Match with Apple Album track if available
        if (appleAlbum && (options.fetchMetadata || options.fetchArtwork)) {
          const matchedAppleTrack = appleAlbum.tracks.find(
            (at) =>
              at.title.toLowerCase() === title.toLowerCase() ||
              title.toLowerCase().includes(at.title.toLowerCase()) ||
              at.title.toLowerCase().includes(title.toLowerCase())
          );

          if (matchedAppleTrack) {
            if (options.fetchMetadata) {
              if (matchedAppleTrack.year && (!newMeta.year || options.overwriteExisting)) {
                newMeta.year = matchedAppleTrack.year;
                details.push(`Year: ${matchedAppleTrack.year}`);
                hasChanges = true;
              }
              if (matchedAppleTrack.genre && (!newMeta.genre || options.overwriteExisting)) {
                newMeta.genre = matchedAppleTrack.genre;
                details.push(`Genre: ${matchedAppleTrack.genre}`);
                hasChanges = true;
              }
              if (matchedAppleTrack.trackNumber && (!newMeta.track_number || options.overwriteExisting)) {
                newMeta.track_number = matchedAppleTrack.trackNumber;
                details.push(`Track #${matchedAppleTrack.trackNumber}`);
                hasChanges = true;
              }
              if (matchedAppleTrack.discNumber && (!newMeta.disc_number || options.overwriteExisting)) {
                newMeta.disc_number = matchedAppleTrack.discNumber;
                details.push(`Disc #${matchedAppleTrack.discNumber}`);
                hasChanges = true;
              }
            }
          }
        }

        // Fetch Lyrics via LRCLIB if enabled
        if (options.fetchLyrics && (!newMeta.lyrics || options.overwriteExisting)) {
          const lyricsRes = await fetchLyrics(artist, title, sampleAlbum, track.metadata.duration.secs);
          await throttle(250);

          if (lyricsRes?.bestLyrics) {
            newMeta.lyrics = lyricsRes.bestLyrics;
            details.push(lyricsRes.syncedLyrics ? "Synced Lyrics" : "Plain Lyrics");
            hasChanges = true;
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
                details: ["Up to date / No new tags"],
              },
              ...state.log.slice(0, 99),
            ],
          }));
        }
      }
    }

    // 3. Process Individual Non-Album Tracks
    for (const track of individualTracks) {
      if (_isCancelled) break;
      await waitIfPaused();

      const title = track.metadata.title || "Untitled";
      const artist = track.metadata.artist || "Unknown Artist";
      set({ currentTrackTitle: `${title} — ${artist}` });

      const details: string[] = [];
      let hasChanges = false;
      const newMeta = { ...track.metadata };

      if (options.fetchMetadata || options.fetchArtwork) {
        const appleTrack = await searchAppleMusicTrack(title, artist, track.metadata.album);
        await throttle(300);

        if (appleTrack) {
          if (options.fetchMetadata) {
            if (appleTrack.year && (!newMeta.year || options.overwriteExisting)) {
              newMeta.year = appleTrack.year;
              details.push(`Year: ${appleTrack.year}`);
              hasChanges = true;
            }
            if (appleTrack.genre && (!newMeta.genre || options.overwriteExisting)) {
              newMeta.genre = appleTrack.genre;
              details.push(`Genre: ${appleTrack.genre}`);
              hasChanges = true;
            }
            if (appleTrack.trackNumber && (!newMeta.track_number || options.overwriteExisting)) {
              newMeta.track_number = appleTrack.trackNumber;
              details.push(`Track #${appleTrack.trackNumber}`);
              hasChanges = true;
            }
          }
        }
      }

      if (options.fetchLyrics && (!newMeta.lyrics || options.overwriteExisting)) {
        const lyricsRes = await fetchLyrics(artist, title, track.metadata.album, track.metadata.duration.secs);
        await throttle(250);

        if (lyricsRes?.bestLyrics) {
          newMeta.lyrics = lyricsRes.bestLyrics;
          details.push(lyricsRes.syncedLyrics ? "Synced Lyrics" : "Plain Lyrics");
          hasChanges = true;
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
              details: ["Up to date / No new tags"],
            },
            ...state.log.slice(0, 99),
          ],
        }));
      }
    }

    set({ isRunning: false, currentTrackTitle: "Finished" });
  },
}));

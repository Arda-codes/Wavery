/**
 * Zustand-based library state store.
 *
 * Centralizes tracks, pre-aggregated albums, and artists, isolating library data
 * from component-level re-render cascades.
 */

import { create } from "zustand";
import { Track, AlbumInfo, ArtistInfo, ImportStrategy, Playlist } from "../types";
import { playerAdapter } from "../services/adapter";
import { groupTracksByAlbum, groupTracksByArtist } from "../utils/library";
import { usePlayerStore } from "./playerStore";

interface LibraryState {
  tracks: Track[];
  albums: AlbumInfo[];
  artists: ArtistInfo[];
  likedTrackIds: Set<string>;
  likedTracks: Track[];
  playlists: Playlist[];
  isLoading: boolean;
  error: string | null;

  loadTracks: () => Promise<void>;
  setTracks: (tracks: Track[]) => void;
  deleteTrack: (trackId: string, removeFile?: boolean) => Promise<void>;
  loadLiked: () => Promise<void>;
  toggleLike: (trackId: string) => Promise<boolean>;
  loadPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<Playlist>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  importFile: (path: string, strategy: ImportStrategy) => Promise<void>;
  importFolder: (path: string, strategy: ImportStrategy) => Promise<void>;
  rebuildDatabase: () => Promise<void>;
  vacuumDatabase: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  albums: [],
  artists: [],
  likedTrackIds: new Set<string>(),
  likedTracks: [],
  playlists: [],
  isLoading: false,
  error: null,

  setTracks: (tracks: Track[]) => {
    const albums = groupTracksByAlbum(tracks);
    const artists = groupTracksByArtist(tracks);
    set({ tracks, albums, artists });
  },

  deleteTrack: async (trackId: string, removeFile = false) => {
    try {
      await playerAdapter.deleteTrack(trackId, removeFile);

      // Clean up in playerStore if this track was playing or in queue
      await usePlayerStore.getState().handleTrackDeleted(trackId);

      const nextTracks = get().tracks.filter((t) => t.id !== trackId);
      const nextAlbums = groupTracksByAlbum(nextTracks);
      const nextArtists = groupTracksByArtist(nextTracks);

      const nextLikedIds = new Set(get().likedTrackIds);
      nextLikedIds.delete(trackId);
      const nextLikedTracks = get().likedTracks.filter((t) => t.id !== trackId);

      set({
        tracks: nextTracks,
        albums: nextAlbums,
        artists: nextArtists,
        likedTrackIds: nextLikedIds,
        likedTracks: nextLikedTracks,
      });

      // Also reload playlists to refresh their counts/track lists
      get().loadPlaylists();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg || "Failed to delete track" });
      throw err;
    }
  },

  loadTracks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tracks = await playerAdapter.getTracks();
      const albums = groupTracksByAlbum(tracks);
      const artists = groupTracksByArtist(tracks);
      set({ tracks, albums, artists, isLoading: false });
      // Also silently load liked IDs and playlists
      get().loadLiked();
      get().loadPlaylists();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        error: msg || "Failed to load tracks",
        isLoading: false,
      });
    }
  },

  loadLiked: async () => {
    try {
      const [ids, likedTracks] = await Promise.all([
        playerAdapter.getLikedTrackIds(),
        playerAdapter.getLikedTracks(),
      ]);
      set({
        likedTrackIds: new Set(ids),
        likedTracks,
      });
    } catch (err: unknown) {
      console.error("Failed to load liked tracks:", err);
    }
  },

  toggleLike: async (trackId: string) => {
    const { likedTrackIds, likedTracks: prevLikedTracks, tracks } = get();
    const currentlyLiked = likedTrackIds.has(trackId);
    const nextLiked = !currentlyLiked;

    // 1. Instant optimistic UI update
    const nextSet = new Set(likedTrackIds);
    if (nextLiked) {
      nextSet.add(trackId);
    } else {
      nextSet.delete(trackId);
    }

    const currentTrackObj = tracks.find((t) => t.id === trackId);
    let nextLikedTracks = prevLikedTracks;
    if (nextLiked && currentTrackObj) {
      nextLikedTracks = [currentTrackObj, ...nextLikedTracks.filter((t) => t.id !== trackId)];
    } else {
      nextLikedTracks = nextLikedTracks.filter((t) => t.id !== trackId);
    }

    set({ likedTrackIds: nextSet, likedTracks: nextLikedTracks });

    // 2. Network sync
    try {
      const result = await playerAdapter.toggleLike(trackId);
      if (result !== nextLiked) {
        // Correct if server had different state
        const correctedSet = new Set(get().likedTrackIds);
        if (result) correctedSet.add(trackId);
        else correctedSet.delete(trackId);
        set({ likedTrackIds: correctedSet });
      }
      return result;
    } catch (err) {
      // Rollback on error
      set({ likedTrackIds, likedTracks: prevLikedTracks });
      throw err;
    }
  },

  loadPlaylists: async () => {
    try {
      const playlists = await playerAdapter.listPlaylists();
      set({ playlists });
    } catch (err: unknown) {
      console.error("Failed to load playlists:", err);
    }
  },

  createPlaylist: async (name: string) => {
    const playlist = await playerAdapter.createPlaylist(name);
    set((state) => ({ playlists: [...state.playlists, playlist] }));
    return playlist;
  },

  renamePlaylist: async (id: string, name: string) => {
    await playerAdapter.renamePlaylist(id, name);
    set((state) => ({
      playlists: state.playlists.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  },

  deletePlaylist: async (id: string) => {
    await playerAdapter.deletePlaylist(id);
    set((state) => ({
      playlists: state.playlists.filter((p) => p.id !== id),
    }));
  },

  addTracksToPlaylist: async (playlistId: string, trackIds: string[]) => {
    await playerAdapter.addTracksToPlaylist(playlistId, trackIds);
    await get().loadPlaylists();
  },

  removeTrackFromPlaylist: async (playlistId: string, trackId: string) => {
    await playerAdapter.removeTrackFromPlaylist(playlistId, trackId);
    await get().loadPlaylists();
  },

  importFile: async (path: string, strategy: ImportStrategy) => {
    set({ isLoading: true, error: null });
    try {
      await playerAdapter.importFile(path, strategy);
      await get().loadTracks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        error: msg || "Failed to import file",
        isLoading: false,
      });
      throw err;
    }
  },

  importFolder: async (path: string, strategy: ImportStrategy) => {
    set({ isLoading: true, error: null });
    try {
      await playerAdapter.importFolder(path, strategy);
      await get().loadTracks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        error: msg || "Failed to import folder",
        isLoading: false,
      });
      throw err;
    }
  },

  rebuildDatabase: async () => {
    set({ isLoading: true, error: null });
    try {
      const tracks = await playerAdapter.rebuildLibrary();
      const albums = groupTracksByAlbum(tracks);
      const artists = groupTracksByArtist(tracks);
      set({ tracks, albums, artists, isLoading: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        error: msg || "Failed to rebuild database",
        isLoading: false,
      });
      throw err;
    }
  },

  vacuumDatabase: async () => {
    try {
      await playerAdapter.vacuumDatabase();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg || "Failed to vacuum database" });
      throw err;
    }
  },
}));

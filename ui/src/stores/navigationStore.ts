/**
 * Zustand-based navigation & search store.
 *
 * Decouples view routing, breadcrumb history, and global search from top-level App component.
 */

import { create } from "zustand";
import { ViewMode } from "../types";

interface NavigationState {
  viewMode: ViewMode;
  selectedArtistName: string | null;
  selectedAlbumKey: { title: string; artist: string } | null;
  selectedPlaylistId: string | null;
  navSource: "artists" | "albums" | "playlists";
  globalSearch: string;
  isNowPlayingDrawerOpen: boolean;
  nowPlayingTab: "queue" | "lyrics";
  isFullscreenNowPlayingOpen: boolean;

  navigate: (view: ViewMode) => void;
  selectArtist: (artistName: string) => void;
  selectAlbum: (albumTitle: string, artistName: string, fromArtist?: boolean) => void;
  selectPlaylist: (playlistId: string) => void;
  breadcrumbNavigate: (view: ViewMode, targetId?: string) => void;
  setGlobalSearch: (query: string) => void;
  toggleNowPlayingDrawer: (tab?: "queue" | "lyrics") => void;
  setNowPlayingDrawerOpen: (open: boolean) => void;
  setNowPlayingTab: (tab: "queue" | "lyrics") => void;
  toggleFullscreenNowPlaying: () => void;
  setFullscreenNowPlayingOpen: (open: boolean) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  viewMode: "tracks",
  selectedArtistName: null,
  selectedAlbumKey: null,
  selectedPlaylistId: null,
  navSource: "albums",
  globalSearch: "",
  isNowPlayingDrawerOpen: false,
  nowPlayingTab: "queue",
  isFullscreenNowPlayingOpen: false,

  navigate: (view: ViewMode) => {
    set({
      viewMode: view,
      ...(view === "tracks" || view === "artists" || view === "albums" || view === "liked" || view === "playlists"
        ? { selectedArtistName: null, selectedAlbumKey: null, selectedPlaylistId: null }
        : {}),
    });
  },

  selectArtist: (artistName: string) => {
    set({
      selectedArtistName: artistName,
      selectedAlbumKey: null,
      selectedPlaylistId: null,
      viewMode: "artist_detail",
    });
  },

  selectAlbum: (albumTitle: string, artistName: string, fromArtist?: boolean) => {
    const { viewMode, selectedArtistName } = get();
    const isFromArtist =
      fromArtist ?? (viewMode === "artist_detail" || !!selectedArtistName);
    set({
      selectedAlbumKey: { title: albumTitle, artist: artistName },
      selectedPlaylistId: null,
      navSource: isFromArtist ? "artists" : "albums",
      viewMode: "album_detail",
    });
  },

  selectPlaylist: (playlistId: string) => {
    set({
      selectedPlaylistId: playlistId,
      selectedArtistName: null,
      selectedAlbumKey: null,
      navSource: "playlists",
      viewMode: "playlist_detail",
    });
  },

  breadcrumbNavigate: (view: ViewMode) => {
    const { selectedArtistName, selectedPlaylistId } = get();
    if (view === "artists") {
      set({
        selectedArtistName: null,
        selectedAlbumKey: null,
        selectedPlaylistId: null,
        viewMode: "artists",
      });
    } else if (view === "artist_detail" && selectedArtistName) {
      set({
        selectedAlbumKey: null,
        selectedPlaylistId: null,
        viewMode: "artist_detail",
      });
    } else if (view === "albums") {
      set({
        selectedArtistName: null,
        selectedAlbumKey: null,
        selectedPlaylistId: null,
        viewMode: "albums",
      });
    } else if (view === "playlists") {
      set({
        selectedArtistName: null,
        selectedAlbumKey: null,
        selectedPlaylistId: null,
        viewMode: "playlists",
      });
    } else if (view === "playlist_detail" && selectedPlaylistId) {
      set({
        selectedArtistName: null,
        selectedAlbumKey: null,
        viewMode: "playlist_detail",
      });
    } else if (view === "liked") {
      set({
        selectedArtistName: null,
        selectedAlbumKey: null,
        selectedPlaylistId: null,
        viewMode: "liked",
      });
    } else {
      set({
        selectedArtistName: null,
        selectedAlbumKey: null,
        selectedPlaylistId: null,
        viewMode: "tracks",
      });
    }
  },

  setGlobalSearch: (query: string) => {
    set({ globalSearch: query });
  },

  toggleNowPlayingDrawer: (tab?: "queue" | "lyrics") => {
    set((state) => {
      const willOpen = !state.isNowPlayingDrawerOpen || (tab && state.nowPlayingTab !== tab);
      return {
        isNowPlayingDrawerOpen: willOpen,
        ...(tab ? { nowPlayingTab: tab } : {}),
      };
    });
  },

  setNowPlayingDrawerOpen: (open: boolean) => {
    set({ isNowPlayingDrawerOpen: open });
  },

  setNowPlayingTab: (tab: "queue" | "lyrics") => {
    set({ nowPlayingTab: tab });
  },

  toggleFullscreenNowPlaying: () => {
    set((state) => ({ isFullscreenNowPlayingOpen: !state.isFullscreenNowPlayingOpen }));
  },

  setFullscreenNowPlayingOpen: (open: boolean) => {
    set({ isFullscreenNowPlayingOpen: open });
  },
}));

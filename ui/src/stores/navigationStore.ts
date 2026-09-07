/**
 * Zustand-based navigation & search store.
 *
 * Decouples view routing, breadcrumb history, and global search from top-level App component.
 */

import { create } from "zustand";
import { ViewMode } from "../types";

const RECENT_SEARCHES_KEY = "wavery:recent_searches";

function loadRecentSearches(): string[] {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.slice(0, 10);
      }
    }
  } catch {
    // Ignore storage errors
  }
  return [];
}

function saveRecentSearches(searches: string[]) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches.slice(0, 10)));
    }
  } catch {
    // Ignore storage errors
  }
}

interface NavigationState {
  viewMode: ViewMode;
  selectedArtistName: string | null;
  selectedAlbumKey: { title: string; artist: string } | null;
  selectedPlaylistId: string | null;
  navSource: "artists" | "albums" | "playlists";
  globalSearch: string;
  recentSearches: string[];
  isNowPlayingDrawerOpen: boolean;
  nowPlayingTab: "queue" | "lyrics";
  isFullscreenNowPlayingOpen: boolean;
  isMobileSidebarOpen: boolean;

  navigate: (view: ViewMode) => void;
  selectArtist: (artistName: string) => void;
  selectAlbum: (albumTitle: string, artistName: string, fromArtist?: boolean) => void;
  selectPlaylist: (playlistId: string) => void;
  breadcrumbNavigate: (view: ViewMode, targetId?: string) => void;
  setGlobalSearch: (query: string) => void;
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  toggleNowPlayingDrawer: (tab?: "queue" | "lyrics") => void;
  setNowPlayingDrawerOpen: (open: boolean) => void;
  setNowPlayingTab: (tab: "queue" | "lyrics") => void;
  toggleFullscreenNowPlaying: () => void;
  setFullscreenNowPlayingOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  toggleMobileSidebar: () => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  viewMode: "home",
  selectedArtistName: null,
  selectedAlbumKey: null,
  selectedPlaylistId: null,
  navSource: "albums",
  globalSearch: "",
  recentSearches: loadRecentSearches(),
  isNowPlayingDrawerOpen: false,
  nowPlayingTab: "queue",
  isFullscreenNowPlayingOpen: false,
  isMobileSidebarOpen: false,

  navigate: (view: ViewMode) => {
    set({
      viewMode: view,
      isMobileSidebarOpen: false,
      ...(view === "home" ||
      view === "search" ||
      view === "tracks" ||
      view === "artists" ||
      view === "albums" ||
      view === "liked" ||
      view === "playlists"
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
      isMobileSidebarOpen: false,
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
      isMobileSidebarOpen: false,
    });
  },

  selectPlaylist: (playlistId: string) => {
    set({
      selectedPlaylistId: playlistId,
      selectedArtistName: null,
      selectedAlbumKey: null,
      navSource: "playlists",
      viewMode: "playlist_detail",
      isMobileSidebarOpen: false,
    });
  },

  breadcrumbNavigate: (view: ViewMode) => {
    const { selectedArtistName, selectedPlaylistId } = get();
    if (view === "home") {
      set({
        selectedArtistName: null,
        selectedAlbumKey: null,
        selectedPlaylistId: null,
        viewMode: "home",
        isMobileSidebarOpen: false,
      });
    } else if (view === "search") {
      set({
        selectedArtistName: null,
        selectedAlbumKey: null,
        selectedPlaylistId: null,
        viewMode: "search",
        isMobileSidebarOpen: false,
      });
    } else if (view === "artists") {
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

  addRecentSearch: (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const current = get().recentSearches;
    const updated = [trimmed, ...current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 10);
    set({ recentSearches: updated });
    saveRecentSearches(updated);
  },

  removeRecentSearch: (query: string) => {
    const updated = get().recentSearches.filter((item) => item.toLowerCase() !== query.toLowerCase());
    set({ recentSearches: updated });
    saveRecentSearches(updated);
  },

  clearRecentSearches: () => {
    set({ recentSearches: [] });
    saveRecentSearches([]);
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

  setMobileSidebarOpen: (open: boolean) => {
    set({ isMobileSidebarOpen: open });
  },

  toggleMobileSidebar: () => {
    set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen }));
  },
}));

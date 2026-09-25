import React, { useEffect, useState, useMemo, useCallback, useDeferredValue, useRef } from "react";
import { playerAdapter, isTauri } from "./services/adapter";
import {
  ImportStrategy,
  AlbumInfo,
  ArtistInfo,
  Playlist,
  Track,
} from "./types";
import { useLibraryStore } from "./stores/libraryStore";
import { useNavigationStore } from "./stores/navigationStore";
import { usePlayerStore } from "./stores/playerStore";
import { useSettingsStore } from "./stores/settingsStore";
import { PlayerBar } from "./components/PlayerBar";
import { TrackTable } from "./components/TrackTable";
import { ArtistsView } from "./components/ArtistsView";
import { ArtistProfile } from "./components/ArtistProfile";
import { AlbumsView } from "./components/AlbumsView";
import { AlbumDetail } from "./components/AlbumDetail";
import { LikedSongsView } from "./components/LikedSongsView";
import { PlaylistsView } from "./components/PlaylistsView";
import { PlaylistDetail } from "./components/PlaylistDetail";
import { CreatePlaylistModal } from "./components/CreatePlaylistModal";
import { Sidebar } from "./components/Sidebar";
import { SettingsView } from "./components/SettingsView";
import { HomeView } from "./components/HomeView";
import { SearchView } from "./components/SearchView";
import { HistoryView } from "./components/HistoryView";
import { Breadcrumbs, BreadcrumbItem } from "./components/Breadcrumbs";
import { ImportModal } from "./components/ImportModal";
import { NowPlayingDrawer } from "./components/NowPlayingDrawer";
import { FullscreenPlayer } from "./components/FullscreenPlayer";
import { ContextMenu } from "./components/ContextMenu";
import { matchesKeyCombo, isEditableTarget } from "./utils/keybindings";
import { WindowControls } from "./components/WindowControls";
import { windowService, useWindowState } from "./services/windowService";
import { Search, X, ExternalLink, Home, Menu, Library, ListMusic } from "lucide-react";

export const App: React.FC = () => {
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
  const [isAppClosed, setIsAppClosed] = useState(() => {
    if (typeof window !== "undefined" && window.location.pathname === "/closed") {
      return true;
    }
    return false;
  });

  // Listen for signal to close web page (from both Tauri IPC and Web server event stream)
  useEffect(() => {
    let active = true;

    const handleCloseSignal = () => {
      playerAdapter.pause().catch(() => {});
      if (typeof window !== "undefined") {
        try {
          window.close();
        } catch {}
        try {
          window.open("", "_self");
          window.close();
        } catch {}

        setTimeout(() => {
          try {
            window.history.replaceState(null, "", "/closed");
          } catch {}
          setIsAppClosed(true);
        }, 120);
      } else {
        setIsAppClosed(true);
      }
    };

    if (isTauri) {
      let unlisten: (() => void) | undefined;
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          if (!active) return;
          listen("close-web-page", () => {
            handleCloseSignal();
          })
            .then((fn) => {
              unlisten = fn;
            })
            .catch(() => {});
        })
        .catch(() => {});

      return () => {
        active = false;
        unlisten?.();
      };
    } else {
      // Browser mode: poll for server application lifecycle signals
      const pollSignals = async () => {
        while (active) {
          try {
            const res = await fetch("/api/app/events");
            if (!active) break;
            if (res.ok) {
              const data = (await res.json()) as { signal?: string };
              if (data.signal === "close" || data.signal === "quit") {
                handleCloseSignal();
                break;
              }
            }
          } catch {
            if (!active) break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      };

      pollSignals();

      return () => {
        active = false;
      };
    }
  }, []);

  // Settings & Linux banner
  const isLinuxBannerDismissed = useSettingsStore((s) => s.isLinuxBannerDismissed);
  const dismissLinuxBanner = useSettingsStore((s) => s.dismissLinuxBanner);

  // Centralized Library Store
  const tracks = useLibraryStore((s) => s.tracks);
  const albums = useLibraryStore((s) => s.albums);
  const artists = useLibraryStore((s) => s.artists);
  const likedTracks = useLibraryStore((s) => s.likedTracks);
  const playlists = useLibraryStore((s) => s.playlists);
  const loadTracks = useLibraryStore((s) => s.loadTracks);
  const loadLiked = useLibraryStore((s) => s.loadLiked);
  const loadPlaylists = useLibraryStore((s) => s.loadPlaylists);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const renamePlaylist = useLibraryStore((s) => s.renamePlaylist);
  const deletePlaylist = useLibraryStore((s) => s.deletePlaylist);
  const removeTrackFromPlaylist = useLibraryStore((s) => s.removeTrackFromPlaylist);
  const importFile = useLibraryStore((s) => s.importFile);
  const importFolder = useLibraryStore((s) => s.importFolder);

  // Centralized Navigation Store
  const viewMode = useNavigationStore((s) => s.viewMode);
  const selectedArtistName = useNavigationStore((s) => s.selectedArtistName);
  const selectedAlbumKey = useNavigationStore((s) => s.selectedAlbumKey);
  const selectedPlaylistId = useNavigationStore((s) => s.selectedPlaylistId);
  const navSource = useNavigationStore((s) => s.navSource);
  const globalSearch = useNavigationStore((s) => s.globalSearch);
  const navigate = useNavigationStore((s) => s.navigate);
  const selectArtist = useNavigationStore((s) => s.selectArtist);
  const selectAlbum = useNavigationStore((s) => s.selectAlbum);
  const selectPlaylist = useNavigationStore((s) => s.selectPlaylist);
  const breadcrumbNavigate = useNavigationStore((s) => s.breadcrumbNavigate);
  const setGlobalSearch = useNavigationStore((s) => s.setGlobalSearch);
  const addRecentSearch = useNavigationStore((s) => s.addRecentSearch);

  // Playlist detail tracks state
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);

  // Search input ref & platform detection
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isMaximized: isWindowMaximized } = useWindowState();
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent),
    []
  );

  // Dynamic Global Keyboard Shortcuts
  const keybindings = useSettingsStore((s) => s.keybindings);
  const volumeStep = useSettingsStore((s) => s.volumeStep);
  const previousVolumeRef = useRef<number>(0.8);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Search shortcut: user-configured openSearch, Cmd+K / Ctrl+K, or Cmd+F / Ctrl+F (prevent browser find overlay)
      if (
        matchesKeyCombo(e, keybindings?.openSearch || "Ctrl+K", isMac) ||
        ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K" || e.key === "f" || e.key === "F"))
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (useNavigationStore.getState().viewMode !== "search") {
          useNavigationStore.getState().navigate("search");
        }
        setTimeout(() => {
          if (searchInputRef.current) {
            searchInputRef.current.focus();
            searchInputRef.current.select();
          }
        }, 20);
        return;
      }

      // 1b. Intercept and block webview/browser accelerator keys (F5 reload, Ctrl+R, Ctrl+P, Ctrl+S, Ctrl+U, Ctrl+O, etc.)
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      const keyLower = e.key.toLowerCase();
      if (
        e.key === "F5" ||
        e.key === "F7" ||
        (isCtrlOrMeta && (
          keyLower === "r" ||
          keyLower === "p" ||
          keyLower === "s" ||
          keyLower === "u" ||
          keyLower === "o" ||
          keyLower === "g" ||
          keyLower === "j" ||
          (!isMac && keyLower === "h") ||
          keyLower === "n" ||
          keyLower === "t" ||
          keyLower === "+" ||
          keyLower === "-" ||
          keyLower === "=" ||
          keyLower === "0"
        )) ||
        (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"))
      ) {
        e.preventDefault();
        return;
      }

      // 2. Escape key handling for search input
      if (e.key === "Escape") {
        if (document.activeElement === searchInputRef.current) {
          e.preventDefault();
          searchInputRef.current?.blur();
          return;
        }
      }

      // If user is actively typing in any input/textarea, do not intercept non-search shortcuts
      if (isEditableTarget(e.target)) return;

      // 3. Quick '/' key to search
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (useNavigationStore.getState().viewMode !== "search") {
          useNavigationStore.getState().navigate("search");
        }
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 20);
        return;
      }

      // 4. Toggle Play / Pause
      if (matchesKeyCombo(e, keybindings?.togglePlay || "Space", isMac)) {
        e.preventDefault();
        const playerState = usePlayerStore.getState();
        if (playerState.status.state === "Playing") {
          playerState.pause();
        } else {
          playerState.resume();
        }
        return;
      }

      // 5. Next Track
      if (matchesKeyCombo(e, keybindings?.nextTrack || "Ctrl+Right", isMac)) {
        e.preventDefault();
        usePlayerStore.getState().playNext();
        return;
      }

      // 6. Previous Track
      if (matchesKeyCombo(e, keybindings?.prevTrack || "Ctrl+Left", isMac)) {
        e.preventDefault();
        usePlayerStore.getState().playPrevious();
        return;
      }

      // 7. Volume Up
      if (matchesKeyCombo(e, keybindings?.volumeUp || "Up", isMac)) {
        e.preventDefault();
        const playerState = usePlayerStore.getState();
        const step = volumeStep || 0.05;
        const newVol = Math.min(1.0, playerState.status.volume + step);
        playerState.setVolume(newVol);
        return;
      }

      // 8. Volume Down
      if (matchesKeyCombo(e, keybindings?.volumeDown || "Down", isMac)) {
        e.preventDefault();
        const playerState = usePlayerStore.getState();
        const step = volumeStep || 0.05;
        const newVol = Math.max(0.0, playerState.status.volume - step);
        playerState.setVolume(newVol);
        return;
      }

      // 9. Seek Forward
      if (matchesKeyCombo(e, keybindings?.seekForward || "Right", isMac)) {
        e.preventDefault();
        const playerState = usePlayerStore.getState();
        playerState.seek(playerState.status.position_secs + 5);
        return;
      }

      // 10. Seek Backward
      if (matchesKeyCombo(e, keybindings?.seekBackward || "Left", isMac)) {
        e.preventDefault();
        const playerState = usePlayerStore.getState();
        playerState.seek(Math.max(0, playerState.status.position_secs - 5));
        return;
      }

      // 11. Toggle Mute
      if (matchesKeyCombo(e, keybindings?.toggleMute || "M", isMac)) {
        e.preventDefault();
        const playerState = usePlayerStore.getState();
        if (playerState.status.volume > 0.001) {
          previousVolumeRef.current = playerState.status.volume;
          playerState.setVolume(0);
        } else {
          playerState.setVolume(previousVolumeRef.current || 0.8);
        }
        return;
      }

      // 12. Toggle Fullscreen Player
      if (matchesKeyCombo(e, keybindings?.toggleFullscreen || "F", isMac)) {
        e.preventDefault();
        useNavigationStore.getState().toggleFullscreenNowPlaying();
        return;
      }

      // 13. Toggle Lyrics Drawer
      if (matchesKeyCombo(e, keybindings?.toggleLyrics || "L", isMac)) {
        e.preventDefault();
        useNavigationStore.getState().toggleNowPlayingDrawer("lyrics");
        return;
      }
    };

    // Global browser context menu suppression (Edge/Chrome right-click menus)
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Auxiliary / middle-click autoscroll suppression
    const handleAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };

    // Prevent Ctrl + MouseWheel / Trackpad pinch zooming
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    // Drag-and-drop file navigation suppression (prevent browser opening or downloading dropped files)
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    // Intercept external links so they open in the default browser, never inside the desktop app window
    const handleLinkClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (anchor && anchor.href && (anchor.href.startsWith("http://") || anchor.href.startsWith("https://"))) {
        e.preventDefault();
        if (isTauri) {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("open_external_url", { url: anchor.href }).catch(() => {
              window.open(anchor.href, "_blank", "noopener,noreferrer");
            });
          }).catch(() => {
            window.open(anchor.href, "_blank", "noopener,noreferrer");
          });
        } else {
          window.open(anchor.href, "_blank", "noopener,noreferrer");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu, { capture: true });
    window.addEventListener("auxclick", handleAuxClick, { capture: true });
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("dragover", handleDragOver, false);
    window.addEventListener("drop", handleDrop, false);
    document.addEventListener("click", handleLinkClick, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
      window.removeEventListener("auxclick", handleAuxClick, { capture: true });
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("dragover", handleDragOver, false);
      window.removeEventListener("drop", handleDrop, false);
      document.removeEventListener("click", handleLinkClick, { capture: true });
    };
  }, [keybindings, isMac, volumeStep]);


  // Zustand Player Actions
  const startPolling = usePlayerStore((s) => s.startPolling);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const restoreSession = usePlayerStore((s) => s.restoreSession);

  // Defer global search input to keep typing at 60 fps
  const deferredGlobalSearch = useDeferredValue(globalSearch);

  useEffect(() => {
    useSettingsStore.getState().loadSettingsFromBackend();
    loadTracks();
    loadLiked();
    loadPlaylists();
    const stopPolling = startPolling();
    // Restore last session: reloads queue + track + position into the player.
    // A small delay lets the audio element initialise before seek/play commands arrive.
    const restoreTimer = setTimeout(() => { restoreSession(); }, 300);
    return () => {
      clearTimeout(restoreTimer);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTracks, loadLiked, loadPlaylists, startPolling]);


  // Fetch playlist tracks when opening a playlist detail
  useEffect(() => {
    if (viewMode === "playlist_detail" && selectedPlaylistId) {
      playerAdapter
        .getPlaylistTracks(selectedPlaylistId)
        .then((t) => setPlaylistTracks(t))
        .catch((err) => console.error("Failed to load playlist tracks:", err));
    }
  }, [viewMode, selectedPlaylistId, playlists]);

  // Selected Entities
  const selectedArtist = useMemo<ArtistInfo | undefined>(() => {
    if (!selectedArtistName) return undefined;
    const nameLower = selectedArtistName.trim().toLowerCase();
    // Pass 1: exact case-insensitive match
    const exact = artists.find((a) => a.name.trim().toLowerCase() === nameLower);
    if (exact) return exact;
    // Pass 2: partial match — artist name starts with selected name or vice versa,
    // handles minor tag inconsistencies (trailing spaces, subtitle suffixes).
    return artists.find(
      (a) =>
        a.name.trim().toLowerCase().startsWith(nameLower) ||
        nameLower.startsWith(a.name.trim().toLowerCase())
    );
  }, [artists, selectedArtistName]);

  const selectedAlbum = useMemo<AlbumInfo | undefined>(() => {
    if (!selectedAlbumKey) return undefined;
    const titleLower = selectedAlbumKey.title.toLowerCase();
    const artistLower = selectedAlbumKey.artist.toLowerCase();
    // Pass 1: exact title + artist match (most precise)
    const exact = albums.find(
      (a) =>
        a.title.toLowerCase() === titleLower &&
        a.artist.toLowerCase() === artistLower
    );
    if (exact) return exact;
    // Pass 2: title-only match — handles cases where the stored artist key
    // (e.g. "Danny Brown, Femtanyl") differs from AlbumInfo.artist ("Danny Brown").
    // If there is only one album with this title, use it unambiguously.
    const byTitle = albums.filter((a) => a.title.toLowerCase() === titleLower);
    if (byTitle.length === 1) return byTitle[0];
    // Pass 3: when multiple albums share the same title, pick the one whose artist
    // starts with or contains the stored artist key (or vice versa).
    const fuzzy = byTitle.find(
      (a) =>
        a.artist.toLowerCase().includes(artistLower) ||
        artistLower.includes(a.artist.toLowerCase())
    );
    return fuzzy ?? byTitle[0];
  }, [albums, selectedAlbumKey]);

  const selectedPlaylist = useMemo<Playlist | undefined>(() => {
    if (!selectedPlaylistId) return undefined;
    return playlists.find((p) => p.id === selectedPlaylistId);
  }, [playlists, selectedPlaylistId]);

  // Stable artwork URL builder
  const getArtworkUrl = useCallback(
    (id: string) => playerAdapter.getArtworkUrl(id),
    []
  );

  // Navigation handlers
  const handleSelectArtist = useCallback(
    (artistName: string) => {
      selectArtist(artistName);
    },
    [selectArtist]
  );

  const handleSelectAlbum = useCallback(
    (albumTitle: string, artistName: string) => {
      selectAlbum(albumTitle, artistName);
    },
    [selectAlbum]
  );

  const handleSelectPlaylist = useCallback(
    (id: string) => {
      selectPlaylist(id);
    },
    [selectPlaylist]
  );

  const handlePlayAlbum = useCallback(
    async (album: AlbumInfo) => {
      if (album.tracks.length === 0) return;
      await setQueue(album.tracks, 0, {
        type: "album",
        name: album.title,
        artist: album.artist,
      });
    },
    [setQueue]
  );

  const handleImport = useCallback(
    async (path: string, strategy: ImportStrategy, isFolder: boolean) => {
      if (isFolder) {
        await importFolder(path, strategy);
      } else {
        await importFile(path, strategy);
      }
    },
    [importFolder, importFile]
  );

  const handleDeletePlaylist = useCallback(
    async (id: string) => {
      await deletePlaylist(id);
      if (selectedPlaylistId === id) {
        navigate("playlists");
      }
    },
    [deletePlaylist, selectedPlaylistId, navigate]
  );

  // Breadcrumb Trail Items
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    switch (viewMode) {
      case "home":
        return [{ label: "Home", view: "home" }];
      case "search":
        return [{ label: "Search", view: "search" }];
      case "artists":
        return [{ label: "Artists", view: "artists" }];
      case "artist_detail":
        return [
          { label: "Artists", view: "artists" },
          { label: selectedArtistName || "Artist", view: "artist_detail" },
        ];
      case "albums":
        return [{ label: "Albums", view: "albums" }];
      case "album_detail":
        if (navSource === "artists" && selectedArtistName) {
          return [
            { label: "Artists", view: "artists" },
            { label: selectedArtistName, view: "artist_detail" },
            {
              label: selectedAlbumKey?.title || "Album",
              view: "album_detail",
            },
          ];
        }
        return [
          { label: "Albums", view: "albums" },
          { label: selectedAlbumKey?.title || "Album", view: "album_detail" },
        ];
      case "liked":
        return [{ label: "Liked Songs", view: "liked" }];
      case "history":
        return [{ label: "Listening History", view: "history" }];
      case "playlists":
        return [{ label: "Playlists", view: "playlists" }];
      case "playlist_detail":
        return [
          { label: "Playlists", view: "playlists" },
          { label: selectedPlaylist?.name || "Playlist", view: "playlist_detail" },
        ];
      case "settings":
        return [{ label: "Settings & Maintenance", view: "settings" }];
      case "tracks":
      default:
        return [{ label: "All Tracks", view: "tracks" }];
    }
  }, [viewMode, selectedArtistName, selectedAlbumKey, selectedPlaylist, navSource]);

  // Filtered tracks for global search in All Tracks view
  const displayedTracks = useMemo(() => {
    if (!deferredGlobalSearch.trim()) return tracks;
    const q = deferredGlobalSearch.toLowerCase();
    return tracks.filter(
      (t) =>
        t.metadata.title?.toLowerCase().includes(q) ||
        t.metadata.artist?.toLowerCase().includes(q) ||
        t.metadata.album?.toLowerCase().includes(q)
    );
  }, [tracks, deferredGlobalSearch]);

  if (isAppClosed) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center text-textPrimary p-6 select-none">
        <div className="text-center">
          <p className="text-xl font-medium tracking-tight text-textPrimary/90">Wavery has closed</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-textPrimary font-sans antialiased selection:bg-accent/30 selection:text-white">
      {/* Top Desktop Chrome / Merged Title Bar Header */}
      <header
        data-tauri-drag-region={!isWindowMaximized ? "" : undefined}
        onPointerDown={(e) => {
          if (
            !isTauri ||
            e.button !== 0 ||
            (e.target as HTMLElement).closest("button, input, a, [role='group'], [data-tauri-drag-region='none']")
          ) {
            return;
          }
          if (isWindowMaximized) {
            dragStartPosRef.current = { x: e.screenX, y: e.screenY };
          }
        }}
        onPointerMove={(e) => {
          if (!isTauri || !isWindowMaximized || !dragStartPosRef.current) return;
          const dx = e.screenX - dragStartPosRef.current.x;
          const dy = e.screenY - dragStartPosRef.current.y;
          if (Math.hypot(dx, dy) >= 6) {
            dragStartPosRef.current = null;
            windowService.startHeaderDrag().catch(() => {});
          }
        }}
        onPointerUp={() => {
          dragStartPosRef.current = null;
        }}
        onPointerCancel={() => {
          dragStartPosRef.current = null;
        }}
        onDoubleClick={(e) => {
          if (
            isTauri &&
            !(e.target as HTMLElement).closest("button, input, a, [role='group'], [data-tauri-drag-region='none']")
          ) {
            windowService.toggleMaximize().catch(() => {});
          }
        }}
        className="relative h-13 sm:h-14 bg-sidebar/95 backdrop-blur-xl border-b border-white/[0.06] px-3 sm:px-4 flex items-center justify-between flex-shrink-0 z-30 select-none cursor-default"
      >
        {/* Left: macOS Traffic Lights space (if on Mac) + Hamburger + Brand Text */}
        <div
          data-tauri-drag-region="none"
          className={`flex items-center space-x-2 sm:space-x-3 min-w-0 flex-shrink-0 z-20 pointer-events-auto ${
            isMac && isTauri ? "pl-16 sm:pl-18" : ""
          }`}
        >
          {/* Hamburger button on screens < lg */}
          <button
            type="button"
            onClick={() => useNavigationStore.getState().toggleMobileSidebar()}
            className="lg:hidden w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 text-white flex items-center justify-center transition focus:outline-none flex-shrink-0"
            title="Toggle Navigation Menu"
            aria-label="Toggle Navigation Menu"
          >
            <Menu className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => navigate("home")}
            className="cursor-pointer flex-shrink-0 font-bold text-[15px] sm:text-base tracking-tight text-white hover:text-white/80 transition-colors focus:outline-none select-none hidden sm:inline"
          >
            Wavery
          </button>
        </div>

        {/* Drag spacer between Brand and Search */}
        <div
          className="flex-1 h-full min-w-4 pointer-events-none"
          data-tauri-drag-region={!isWindowMaximized ? "" : undefined}
        />

        {/* Center: Global Search Bar (Prominent Spotlight-grade Apple HIG search bar) */}
        <div
          data-tauri-drag-region="none"
          className="absolute left-1/2 -translate-x-1/2 w-[calc(100%-110px)] sm:w-[calc(100%-200px)] md:w-full md:max-w-md lg:max-w-xl xl:max-w-2xl pointer-events-auto z-20 px-2 sm:px-0"
        >
          <div className="relative group flex items-center w-full">
            <Search
              onClick={() => {
                if (viewMode !== "search") navigate("search");
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
              }}
              className="w-4 h-4 sm:w-4.5 sm:h-4.5 absolute left-3.5 sm:left-4 text-textMuted group-focus-within:text-accent transition-colors duration-200 cursor-pointer pointer-events-auto flex-shrink-0"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={globalSearch}
              onFocus={() => {
                if (viewMode !== "search") navigate("search");
              }}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                if (viewMode !== "search") navigate("search");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && globalSearch.trim()) {
                  addRecentSearch(globalSearch.trim());
                } else if (e.key === "Escape") {
                  if (globalSearch) {
                    setGlobalSearch("");
                  } else {
                    searchInputRef.current?.blur();
                  }
                }
              }}
              placeholder="Search songs, albums, artists, playlists..."
              className="w-full h-10 sm:h-10.5 bg-surface hover:bg-surfaceHover focus:bg-surfaceActive border border-white/[0.08] hover:border-white/[0.15] focus:border-accent rounded-full pl-10 sm:pl-11 pr-24 sm:pr-28 text-xs sm:text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all duration-200 shadow-sm focus:shadow-md"
            />
            <div className="absolute right-2.5 sm:right-3.5 flex items-center space-x-1.5 pointer-events-auto">
              {globalSearch ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setGlobalSearch("");
                      searchInputRef.current?.focus();
                    }}
                    className="w-6 h-6 rounded-full bg-white/[0.08] hover:bg-white/[0.18] active:scale-95 text-textMuted hover:text-white flex items-center justify-center transition-all focus:outline-none"
                    title="Clear search (Esc)"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <span className="hidden sm:inline-flex items-center text-[10px] font-mono text-textMuted/70 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.05]">
                    ↵
                  </span>
                </>
              ) : (
                <span
                  onClick={() => {
                    if (viewMode !== "search") navigate("search");
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                  }}
                  className="hidden sm:inline-flex items-center cursor-pointer text-[11px] font-mono font-medium text-textMuted bg-white/[0.06] hover:bg-white/[0.12] hover:text-white px-2 py-0.5 rounded-md border border-white/[0.06] transition select-none"
                  title={`Focus search (${isMac ? "⌘K" : "Ctrl+K"})`}
                >
                  {isMac ? "⌘K" : "Ctrl+K"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Drag spacer between Search and Right controls */}
        <div
          className="flex-1 h-full min-w-4 pointer-events-none"
          data-tauri-drag-region={!isWindowMaximized ? "" : undefined}
        />

        {/* Right: Windows/Linux Window Controls */}
        <div
          data-tauri-drag-region="none"
          className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-shrink-0 z-20 pointer-events-auto"
        >
          {!isMac && <WindowControls variant="windows" />}
        </div>
      </header>

      {/* Linux WebKitGTK Performance Banner */}
      {playerAdapter.isTauri() && !isLinuxBannerDismissed && (
        <div className="bg-surface border-b border-white/[0.07] px-6 py-2 flex items-center justify-between text-xs text-textSecondary flex-shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className="flex h-2 w-2 rounded-full bg-accent flex-shrink-0" />
            <p className="truncate">
              <span className="font-semibold text-white">Linux note:</span> Open in your browser for smoother rendering if needed.
            </p>
          </div>
          <div className="flex items-center space-x-2.5 flex-shrink-0 ml-4">
            <button
              onClick={() => {
                usePlayerStore.getState().switchToWeb();
              }}
              className="px-2.5 py-1 bg-surfaceActive hover:bg-surfaceHover text-white rounded-md font-semibold text-[11px] flex items-center space-x-1 transition border border-white/[0.08]"
              title="Open in default browser"
            >
              <span>Open in Browser</span>
              <ExternalLink className="w-3 h-3 ml-0.5 text-textSecondary" />
            </button>
            <button
              onClick={dismissLinuxBanner}
              className="text-textMuted hover:text-white text-xs px-2 py-0.5 rounded hover:bg-white/[0.06] transition"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Layout Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar
          currentView={viewMode}
          onNavigate={navigate}
          onOpenImport={() => setIsImportModalOpen(true)}
          trackCount={tracks.length}
          artistCount={artists.length}
          albumCount={albums.length}
          likedCount={likedTracks.length}
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          onSelectPlaylist={handleSelectPlaylist}
          onCreatePlaylist={() => setIsCreatePlaylistOpen(true)}
          onDeletePlaylist={handleDeletePlaylist}
        />

        {/* Center Content Pane */}
        <main className="flex-1 flex flex-col bg-background overflow-hidden min-h-0">
          {/* Breadcrumb Navigation Trail */}
          <Breadcrumbs
            items={breadcrumbItems}
            onNavigate={breadcrumbNavigate}
          />

          {/* View Routing with VSync smooth transition */}
          <div key={viewMode} className="flex-1 flex flex-col min-h-0 overflow-hidden animate-fadeIn">
            {viewMode === "home" && (
            <HomeView
              tracks={tracks}
              albums={albums}
              artists={artists}
              playlists={playlists}
              likedTracks={likedTracks}
              onSelectAlbum={handleSelectAlbum}
              onSelectArtist={handleSelectArtist}
              onSelectPlaylist={handleSelectPlaylist}
              onNavigate={navigate}
              onOpenImport={() => setIsImportModalOpen(true)}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "search" && (
            <SearchView
              tracks={tracks}
              albums={albums}
              artists={artists}
              playlists={playlists}
              onSelectAlbum={handleSelectAlbum}
              onSelectArtist={handleSelectArtist}
              onSelectPlaylist={handleSelectPlaylist}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "tracks" && (
            <TrackTable
              tracks={displayedTracks}
              playbackContext={{ type: "tracks", name: "All Tracks" }}
              onSelectArtist={handleSelectArtist}
              onSelectAlbum={handleSelectAlbum}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "liked" && (
            <LikedSongsView
              likedTracks={likedTracks}
              onSelectArtist={handleSelectArtist}
              onSelectAlbum={handleSelectAlbum}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "history" && (
            <HistoryView
              tracks={tracks}
              onSelectArtist={handleSelectArtist}
              onSelectAlbum={handleSelectAlbum}
              onNavigate={navigate}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "playlists" && (
            <PlaylistsView
              playlists={playlists}
              onSelectPlaylist={handleSelectPlaylist}
              onCreatePlaylist={() => setIsCreatePlaylistOpen(true)}
              onDeletePlaylist={handleDeletePlaylist}
            />
          )}

          {viewMode === "playlist_detail" && selectedPlaylist && (
            <PlaylistDetail
              playlist={selectedPlaylist}
              tracks={playlistTracks}
              onRenamePlaylist={async (name) => {
                await renamePlaylist(selectedPlaylist.id, name);
              }}
              onDeletePlaylist={async () => {
                await handleDeletePlaylist(selectedPlaylist.id);
              }}
              onRemoveTrack={async (trackId) => {
                await removeTrackFromPlaylist(selectedPlaylist.id, trackId);
                const updated = await playerAdapter.getPlaylistTracks(selectedPlaylist.id);
                setPlaylistTracks(updated);
              }}
              onSelectArtist={handleSelectArtist}
              onSelectAlbum={handleSelectAlbum}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "artists" && (
            <ArtistsView
              artists={artists}
              onSelectArtist={handleSelectArtist}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "artist_detail" && selectedArtist && (
            <ArtistProfile
              artist={selectedArtist}
              onSelectAlbum={handleSelectAlbum}
              onSelectArtist={handleSelectArtist}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "albums" && (
            <AlbumsView
              albums={albums}
              onSelectAlbum={handleSelectAlbum}
              onSelectArtist={handleSelectArtist}
              onPlayAlbum={handlePlayAlbum}
              getArtworkUrl={getArtworkUrl}
            />
          )}

          {viewMode === "album_detail" && selectedAlbum && (
            <AlbumDetail
              album={selectedAlbum}
              onPlayAlbum={handlePlayAlbum}
              onSelectArtist={handleSelectArtist}
              getArtworkUrl={getArtworkUrl}
            />
          )}

            {viewMode === "settings" && <SettingsView />}
          </div>
        </main>

        {/* Apple Music Inspired Now Playing & Queue Drawer */}
        <NowPlayingDrawer />
      </div>

      {/* Bottom Sticky Player Bar */}
      <PlayerBar />

      {/* Mobile Bottom Navigation Bar (sm:hidden) */}
      <nav
        aria-label="Mobile Navigation"
        className="sm:hidden h-14 bg-deck/95 backdrop-blur-2xl border-t border-white/[0.08] flex items-center justify-around flex-shrink-0 z-30 px-2 select-none"
      >
        <button
          type="button"
          onClick={() => navigate("home")}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            viewMode === "home" ? "text-accent" : "text-textMuted hover:text-textPrimary"
          }`}
        >
          <Home className="w-4 h-4 mb-0.5" />
          <span className="text-[10px] font-semibold">Home</span>
        </button>

        <button
          type="button"
          onClick={() => {
            navigate("search");
            searchInputRef.current?.focus();
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            viewMode === "search" ? "text-accent" : "text-textMuted hover:text-textPrimary"
          }`}
        >
          <Search className="w-4 h-4 mb-0.5" />
          <span className="text-[10px] font-semibold">Search</span>
        </button>

        <button
          type="button"
          onClick={() => navigate("tracks")}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            viewMode === "tracks" ? "text-accent" : "text-textMuted hover:text-textPrimary"
          }`}
        >
          <Library className="w-4 h-4 mb-0.5" />
          <span className="text-[10px] font-semibold">Library</span>
        </button>

        <button
          type="button"
          onClick={() => navigate("playlists")}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            viewMode === "playlists" || viewMode === "playlist_detail"
              ? "text-accent"
              : "text-textMuted hover:text-textPrimary"
          }`}
        >
          <ListMusic className="w-4 h-4 mb-0.5" />
          <span className="text-[10px] font-semibold">Playlists</span>
        </button>

        <button
          type="button"
          onClick={() => useNavigationStore.getState().toggleMobileSidebar()}
          className="flex flex-col items-center justify-center flex-1 py-1 text-textMuted hover:text-white transition-colors"
        >
          <Menu className="w-4 h-4 mb-0.5" />
          <span className="text-[10px] font-semibold">More</span>
        </button>
      </nav>

      {/* Ingestion Strategy Modal */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImport}
      />

      {/* Create Playlist Modal */}
      <CreatePlaylistModal
        isOpen={isCreatePlaylistOpen}
        onClose={() => setIsCreatePlaylistOpen(false)}
        onCreate={async (name) => {
          const pl = await createPlaylist(name);
          selectPlaylist(pl.id);
        }}
      />

      {/* Immersive Fullscreen Now Playing & Live Lyrics */}
      <FullscreenPlayer />

      {/* Global Custom Context Menu Portal */}
      <ContextMenu />
    </div>
  );
};


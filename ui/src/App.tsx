import React, { useEffect, useState, useMemo, useCallback, useDeferredValue, useRef } from "react";
import { playerAdapter } from "./services/adapter";
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
import { Breadcrumbs, BreadcrumbItem } from "./components/Breadcrumbs";
import { ImportModal } from "./components/ImportModal";
import { NowPlayingDrawer } from "./components/NowPlayingDrawer";
import { FullscreenPlayer } from "./components/FullscreenPlayer";
import { ContextMenu } from "./components/ContextMenu";
import { matchesKeyCombo, isEditableTarget } from "./utils/keybindings";
import { Search, Settings, ExternalLink, ChevronLeft, Home } from "lucide-react";

export const App: React.FC = () => {
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);

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

  // Playlist detail tracks state
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);

  // Search input ref & platform detection
  const searchInputRef = useRef<HTMLInputElement>(null);
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
      // 1. Search shortcut: user-configured openSearch or standard fallback Cmd+K / Ctrl+K
      if (
        matchesKeyCombo(e, keybindings?.openSearch || "Ctrl+K", isMac) ||
        ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K"))
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
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
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
    return artists.find(
      (a) => a.name.toLowerCase() === selectedArtistName.toLowerCase()
    );
  }, [artists, selectedArtistName]);

  const selectedAlbum = useMemo<AlbumInfo | undefined>(() => {
    if (!selectedAlbumKey) return undefined;
    return albums.find(
      (a) =>
        a.title.toLowerCase() === selectedAlbumKey.title.toLowerCase() &&
        a.artist.toLowerCase() === selectedAlbumKey.artist.toLowerCase()
    );
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

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0D0D10] text-[#FFFFFF] font-sans antialiased selection:bg-[#FA586A]/30 selection:text-white">
      {/* Top Desktop Chrome / Header */}
      <header className="h-14 bg-[#0F0F13]/95 backdrop-blur-xl border-b border-white/[0.06] px-5 flex items-center justify-between flex-shrink-0 z-30 select-none">
        {/* Left: Brand + Navigation Chevrons */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FA586A] to-[#E0284F] flex items-center justify-center font-bold text-white shadow-md shadow-[#FA586A]/20">
              <span className="text-xs font-black tracking-tighter">W</span>
            </div>
            <span className="font-bold text-[15px] tracking-tight text-white">Wavery</span>
          </div>

          {/* History Back / Forward Controls */}
          <div className="flex items-center space-x-1 pl-2">
            <button
              onClick={() => {
                if (breadcrumbItems.length > 1) {
                  const prev = breadcrumbItems[breadcrumbItems.length - 2];
                  breadcrumbNavigate(prev.view, prev.targetId);
                } else {
                  navigate("tracks");
                }
              }}
              disabled={viewMode === "tracks"}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-30 disabled:hover:bg-white/[0.06] text-white flex items-center justify-center transition"
              title="Go Back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => navigate("tracks")}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white flex items-center justify-center transition"
              title="Home (All Tracks)"
            >
              <Home className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Center: Global Search Capsule (Apple Music / Spotify style) */}
        <div className="relative w-80 max-w-sm group">
          <Search
            onClick={() => {
              searchInputRef.current?.focus();
              searchInputRef.current?.select();
            }}
            className="w-3.5 h-3.5 absolute left-3.5 top-2.5 text-[#71717A] group-focus-within:text-[#FA586A] transition-colors cursor-pointer"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search songs, albums, artists..."
            className="w-full bg-[#16161A] border border-white/[0.08] hover:border-white/[0.15] focus:border-[#FA586A]/60 rounded-full pl-9 pr-9 py-1.5 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-2 focus:ring-[#FA586A]/20 transition-all shadow-inner"
          />
          {globalSearch ? (
            <button
              type="button"
              onClick={() => {
                setGlobalSearch("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-3 top-2 text-[#71717A] hover:text-white text-xs transition"
              title="Clear search"
            >
              ✕
            </button>
          ) : (
            <span
              onClick={() => {
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
              }}
              className="cursor-pointer absolute right-3 top-1.5 text-[10px] font-mono text-[#71717A] bg-white/[0.06] hover:bg-white/[0.12] hover:text-white px-1.5 py-0.5 rounded border border-white/[0.06] transition select-none"
              title={`Focus search (${isMac ? "⌘K" : "Ctrl+K"})`}
            >
              {isMac ? "⌘K" : "Ctrl+K"}
            </span>
          )}
        </div>

        {/* Right: Settings Quick Access */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => navigate("settings")}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition border ${
              viewMode === "settings"
                ? "bg-[#FA586A]/20 text-[#FA586A] border-[#FA586A]/40 shadow-sm"
                : "bg-white/[0.06] hover:bg-white/[0.12] text-[#A1A1AA] hover:text-white border-white/[0.06]"
            }`}
            title="Settings & Preferences"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Linux WebKitGTK Performance Banner */}
      {playerAdapter.isTauri() && !isLinuxBannerDismissed && (
        <div className="bg-[#16161A] border-b border-white/[0.07] px-6 py-2 flex items-center justify-between text-xs text-[#A1A1AA] flex-shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className="flex h-2 w-2 rounded-full bg-[#FA586A] flex-shrink-0" />
            <p className="truncate">
              <span className="font-semibold text-white">Linux Tip:</span> For 144Hz hardware-accelerated Chromium rendering, you can switch to the web client.
            </p>
          </div>
          <div className="flex items-center space-x-2.5 flex-shrink-0 ml-4">
            <button
              onClick={() => window.open("http://127.0.0.1:4242", "_blank")}
              className="px-2.5 py-1 bg-[#24242C] hover:bg-[#30303A] text-white rounded-md font-semibold text-[11px] flex items-center space-x-1 transition border border-white/[0.08]"
              title="Open http://127.0.0.1:4242 in default browser"
            >
              <span>Open in Browser</span>
              <ExternalLink className="w-3 h-3 ml-0.5 text-[#A1A1AA]" />
            </button>
            <button
              onClick={dismissLinuxBanner}
              className="text-[#71717A] hover:text-white text-xs px-2 py-0.5 rounded hover:bg-white/[0.06] transition"
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
        <main className="flex-1 flex flex-col bg-[#0D0D10] overflow-hidden">
          {/* Breadcrumb Navigation Trail */}
          <Breadcrumbs
            items={breadcrumbItems}
            onNavigate={breadcrumbNavigate}
          />

          {/* View Routing */}
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
        </main>

        {/* Apple Music Inspired Now Playing & Queue Drawer */}
        <NowPlayingDrawer />
      </div>

      {/* Bottom Sticky Player Bar */}
      <PlayerBar />

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


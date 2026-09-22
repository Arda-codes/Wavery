import React, { useState, useCallback } from "react";
import { ViewMode, Playlist, Track } from "../types";
import { usePlayerStore } from "../stores/playerStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { playerAdapter } from "../services/adapter";
import { EqualizerWave } from "./EqualizerWave";
import {
  Library,
  Users,
  Disc,
  Heart,
  ListMusic,
  Settings,
  Plus,
  Trash2,
  Play,
  ListPlus,
  CornerDownRight,
  FolderPlus,
  Home,
  Search,
  History,
  X,
} from "lucide-react";
import { useNavigationStore } from "../stores/navigationStore";

interface SidebarProps {
  currentView: ViewMode;
  onNavigate: (view: ViewMode) => void;
  onOpenImport?: () => void;
  trackCount: number;
  artistCount: number;
  albumCount: number;
  likedCount: number;
  playlists: Playlist[];
  selectedPlaylistId?: string | null;
  onSelectPlaylist?: (id: string) => void;
  onCreatePlaylist?: () => void;
  onDeletePlaylist?: (id: string) => void;
}

const SidebarInner: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  onOpenImport,
  trackCount,
  artistCount,
  albumCount,
  likedCount,
  playlists,
  selectedPlaylistId,
  onSelectPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
}) => {
  const [hoveredPlaylistId, setHoveredPlaylistId] = useState<string | null>(null);

  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const setQueue = usePlayerStore((s) => s.setQueue);
  const insertAfterCurrent = usePlayerStore((s) => s.insertAfterCurrent);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const isHomeActive = currentView === "home";
  const isSearchActive = currentView === "search";
  const isTracksActive = currentView === "tracks";
  const isArtistsActive = currentView === "artists" || currentView === "artist_detail";
  const isAlbumsActive = currentView === "albums" || currentView === "album_detail";
  const isLikedActive = currentView === "liked";
  const isHistoryActive = currentView === "history";
  const isPlaylistsActive = currentView === "playlists";
  const isSettingsActive = currentView === "settings";

  const playHistory = usePlayerStore((s) => s.playHistory);
  const isTracksPlaying = playbackContext?.type === "tracks" && !playbackContext?.name?.includes("History");
  const isLikedPlaying = playbackContext?.type === "liked";
  const isHistoryPlaying = playbackContext?.name?.includes("History");

  const handlePlaylistContextMenu = useCallback(
    (e: React.MouseEvent, pl: Playlist) => {
      e.preventDefault();
      e.stopPropagation();

      const menuItems: ContextMenuItem[] = [
        {
          id: "play-playlist",
          label: "Play Playlist",
          icon: Play,
          onClick: async () => {
            try {
              const tracks: Track[] = await playerAdapter.getPlaylistTracks(pl.id);
              if (tracks.length > 0) {
                setQueue(tracks, 0, {
                  type: "playlist",
                  id: pl.id,
                  name: pl.name,
                });
              }
            } catch (err) {
              console.error("Failed to play playlist:", err);
            }
          },
        },
        {
          id: "play-next-playlist",
          label: "Play Next",
          icon: CornerDownRight,
          onClick: async () => {
            try {
              const tracks: Track[] = await playerAdapter.getPlaylistTracks(pl.id);
              if (tracks.length > 0) {
                insertAfterCurrent(tracks);
              }
            } catch (err) {
              console.error("Failed to insert playlist to queue:", err);
            }
          },
        },
        {
          id: "add-playlist-to-queue",
          label: "Add to Queue",
          icon: ListPlus,
          onClick: async () => {
            try {
              const tracks: Track[] = await playerAdapter.getPlaylistTracks(pl.id);
              if (tracks.length > 0) {
                addToQueue(tracks);
              }
            } catch (err) {
              console.error("Failed to add playlist to queue:", err);
            }
          },
        },
        {
          id: "divider-1",
          label: "",
          divider: true,
        },
        {
          id: "open-playlist",
          label: "Open Playlist",
          icon: ListMusic,
          onClick: () => onSelectPlaylist?.(pl.id),
        },
      ];

      if (onDeletePlaylist) {
        menuItems.push(
          {
            id: "divider-delete",
            label: "",
            divider: true,
          },
          {
            id: "delete-playlist",
            label: "Delete Playlist",
            icon: Trash2,
            danger: true,
            onClick: () => {
              if (confirm(`Delete playlist "${pl.name}"?`)) {
                onDeletePlaylist(pl.id);
              }
            },
          }
        );
      }

      openContextMenu(e, menuItems);
    },
    [onSelectPlaylist, onDeletePlaylist, setQueue, insertAfterCurrent, addToQueue, openContextMenu]
  );

  const handleSidebarNavContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const menuItems: ContextMenuItem[] = [
        {
          id: "nav-home",
          label: "Home",
          icon: Home,
          onClick: () => onNavigate("home"),
        },
        {
          id: "nav-search",
          label: "Search",
          icon: Search,
          onClick: () => onNavigate("search"),
        },
        {
          id: "divider-top",
          label: "",
          divider: true,
        },
        {
          id: "nav-all-tracks",
          label: "All Tracks",
          icon: Library,
          onClick: () => onNavigate("tracks"),
        },
        {
          id: "nav-liked",
          label: "Liked Songs",
          icon: Heart,
          onClick: () => onNavigate("liked"),
        },
        {
          id: "nav-history",
          label: "Listening History",
          icon: History,
          onClick: () => onNavigate("history"),
        },
        {
          id: "nav-artists",
          label: "Artists",
          icon: Users,
          onClick: () => onNavigate("artists"),
        },
        {
          id: "nav-albums",
          label: "Albums",
          icon: Disc,
          onClick: () => onNavigate("albums"),
        },
        {
          id: "nav-playlists",
          label: "Playlists",
          icon: ListMusic,
          onClick: () => onNavigate("playlists"),
        },
        {
          id: "divider-1",
          label: "",
          divider: true,
        },
      ];

      if (onCreatePlaylist) {
        menuItems.push({
          id: "create-playlist",
          label: "New Playlist...",
          icon: Plus,
          onClick: onCreatePlaylist,
        });
      }

      if (onOpenImport) {
        menuItems.push({
          id: "import-music",
          label: "Import Music...",
          icon: FolderPlus,
          onClick: onOpenImport,
        });
      }

      menuItems.push(
        {
          id: "divider-settings",
          label: "",
          divider: true,
        },
        {
          id: "nav-settings",
          label: "Settings",
          icon: Settings,
          onClick: () => onNavigate("settings"),
        }
      );

      openContextMenu(e, menuItems);
    },
    [onNavigate, onCreatePlaylist, onOpenImport, openContextMenu]
  );

  const isMobileSidebarOpen = useNavigationStore((s) => s.isMobileSidebarOpen);
  const setMobileSidebarOpen = useNavigationStore((s) => s.setMobileSidebarOpen);

  const renderNavContent = () => (
    <div className="space-y-5">
        {/* Apple Music Style Main Navigation (Home & Search) */}
        <div className="space-y-1">
          {/* Home */}
          <button
            onClick={() => onNavigate("home")}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
              isHomeActive
                ? "bg-surfaceActive text-textPrimary border border-border shadow-sm"
                : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
            }`}
          >
            <Home
              className={`w-4 h-4 transition-colors ${
                isHomeActive ? "text-accent" : "text-textMuted group-hover:text-textPrimary"
              }`}
            />
            <span className="truncate">Home</span>
          </button>

          {/* Search */}
          <button
            onClick={() => onNavigate("search")}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
              isSearchActive
                ? "bg-surfaceActive text-textPrimary border border-border shadow-sm"
                : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
            }`}
          >
            <Search
              className={`w-4 h-4 transition-colors ${
                isSearchActive ? "text-accent" : "text-textMuted group-hover:text-textPrimary"
              }`}
            />
            <span className="truncate">Search</span>
          </button>
        </div>

        {/* Library Section */}
        <div>
          <p className="text-[11px] font-bold text-textMuted tracking-wider uppercase mb-2 px-3">
            Library
          </p>
          <nav className="space-y-1">
            {/* All Tracks */}
            <button
              onClick={() => onNavigate("tracks")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isTracksActive
                  ? "bg-surfaceActive text-textPrimary border border-border shadow-sm"
                  : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
              }`}
            >
              <Library
                className={`w-4 h-4 transition-colors ${
                  isTracksActive ? "text-accent" : "text-textMuted group-hover:text-textPrimary"
                }`}
              />
              <span className="truncate">All Tracks</span>
              {isTracksPlaying && (
                <span className="inline-flex items-center ml-1" title="Currently Playing from All Tracks">
                  <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-accent" />
                </span>
              )}
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                  isTracksActive
                    ? "bg-accent text-white font-bold shadow-sm shadow-accent/30"
                    : "bg-surfaceHover text-textMuted group-hover:text-textSecondary border border-border/40"
                }`}
              >
                {trackCount}
              </span>
            </button>

            {/* Liked Songs */}
            <button
              onClick={() => onNavigate("liked")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isLikedActive
                  ? "bg-surfaceActive text-textPrimary border border-border shadow-sm"
                  : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
              }`}
            >
              <Heart
                className={`w-4 h-4 transition-colors ${
                  isLikedActive
                    ? "text-accent fill-accent"
                    : "text-textMuted group-hover:text-accent"
                }`}
              />
              <span className="truncate">Liked Songs</span>
              {isLikedPlaying && (
                <span className="inline-flex items-center ml-1" title="Currently Playing from Liked Songs">
                  <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-accent" />
                </span>
              )}
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                  isLikedActive
                    ? "bg-accent text-white font-bold shadow-sm"
                    : "bg-surfaceHover text-textMuted group-hover:text-textSecondary border border-border/40"
                }`}
              >
                {likedCount}
              </span>
            </button>

            {/* Listening History */}
            <button
              onClick={() => onNavigate("history")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isHistoryActive
                  ? "bg-surfaceActive text-textPrimary border border-border shadow-sm"
                  : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
              }`}
            >
              <History
                className={`w-4 h-4 transition-colors ${
                  isHistoryActive ? "text-accent" : "text-textMuted group-hover:text-textPrimary"
                }`}
              />
              <span className="truncate">History</span>
              {isHistoryPlaying && (
                <span className="inline-flex items-center ml-1" title="Currently Playing from History">
                  <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-accent" />
                </span>
              )}
              {playHistory.length > 0 && (
                <span
                  className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                    isHistoryActive
                      ? "bg-accent text-white font-bold shadow-sm shadow-accent/30"
                      : "bg-surfaceHover text-textMuted group-hover:text-textSecondary border border-border/40"
                  }`}
                >
                  {playHistory.length}
                </span>
              )}
            </button>

            {/* Artists */}
            <button
              onClick={() => onNavigate("artists")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isArtistsActive
                  ? "bg-surfaceActive text-textPrimary border border-border shadow-sm"
                  : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
              }`}
            >
              <Users
                className={`w-4 h-4 transition-colors ${
                  isArtistsActive ? "text-accent" : "text-textMuted group-hover:text-textPrimary"
                }`}
              />
              <span>Artists</span>
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                  isArtistsActive
                    ? "bg-accent text-white font-bold shadow-sm shadow-accent/30"
                    : "bg-surfaceHover text-textMuted group-hover:text-textSecondary border border-border/40"
                }`}
              >
                {artistCount}
              </span>
            </button>

            {/* Albums */}
            <button
              onClick={() => onNavigate("albums")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isAlbumsActive
                  ? "bg-surfaceActive text-textPrimary border border-border shadow-sm"
                  : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
              }`}
            >
              <Disc
                className={`w-4 h-4 transition-colors ${
                  isAlbumsActive ? "text-accent" : "text-textMuted group-hover:text-textPrimary"
                }`}
              />
              <span>Albums</span>
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                  isAlbumsActive
                    ? "bg-accent text-white font-bold shadow-sm shadow-accent/30"
                    : "bg-surfaceHover text-textMuted group-hover:text-textSecondary border border-border/40"
                }`}
              >
                {albumCount}
              </span>
            </button>
          </nav>
        </div>

        {/* Playlists Section */}
        <div>
          <div className="flex items-center justify-between px-3 mb-2">
            <button
              onClick={() => onNavigate("playlists")}
              className={`text-[11px] font-bold transition-colors tracking-wider uppercase ${
                isPlaylistsActive ? "text-accent" : "text-textMuted hover:text-textPrimary"
              }`}
            >
              Playlists
            </button>
            {onCreatePlaylist && (
              <button
                onClick={onCreatePlaylist}
                className="w-5 h-5 rounded-md hover:bg-surfaceHover text-textMuted hover:text-textPrimary flex items-center justify-center transition"
                title="Create New Playlist"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <nav className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
            {playlists.length === 0 ? (
              <p className="text-[11px] text-textMuted px-3 py-1.5 italic">
                No playlists yet
              </p>
            ) : (
              playlists.map((pl) => {
                const isSelected =
                  currentView === "playlist_detail" && selectedPlaylistId === pl.id;
                const isThisPlaylistPlaying =
                  playbackContext?.type === "playlist" && playbackContext.id === pl.id;

                return (
                  <div
                    key={pl.id}
                    onMouseEnter={() => setHoveredPlaylistId(pl.id)}
                    onMouseLeave={() => setHoveredPlaylistId(null)}
                    onContextMenu={(e) => handlePlaylistContextMenu(e, pl)}
                    className="relative group flex items-center"
                  >
                    <button
                      onClick={() => onSelectPlaylist && onSelectPlaylist(pl.id)}
                      className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-left truncate ${
                        isSelected
                          ? "bg-surfaceActive text-textPrimary font-semibold border border-border"
                          : isThisPlaylistPlaying
                          ? "text-accent bg-accent/10 font-semibold"
                          : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
                      }`}
                    >
                      {isThisPlaylistPlaying ? (
                        <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-accent" />
                      ) : (
                        <ListMusic
                          className={`w-3.5 h-3.5 flex-shrink-0 ${
                            isSelected ? "text-accent" : "text-textMuted"
                          }`}
                        />
                      )}
                      <span className="truncate flex-1">{pl.name}</span>
                      <span className="text-[10px] text-textMuted font-mono pr-4">
                        {pl.track_ids.length}
                      </span>
                    </button>

                    {hoveredPlaylistId === pl.id && onDeletePlaylist && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete playlist "${pl.name}"?`)) {
                            onDeletePlaylist(pl.id);
                          }
                        }}
                        className="absolute right-1.5 p-1 rounded hover:bg-red-500/20 text-textMuted hover:text-red-400 transition"
                        title="Delete Playlist"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </nav>
        </div>

        {/* Manage & Settings Section */}
        <div>
          <p className="text-[11px] font-bold text-textMuted tracking-wider uppercase mb-2 px-3">
            Manage
          </p>
          <nav className="space-y-1.5">
            {/* Import Music CTA */}
            {onOpenImport && (
              <button
                onClick={onOpenImport}
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-accent hover:bg-accentHover active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-md shadow-accent/20 transition-all mb-2"
              >
                <Plus className="w-4 h-4" />
                <span>Import Music</span>
              </button>
            )}

            {/* Settings */}
            <button
              onClick={() => onNavigate("settings")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isSettingsActive
                  ? "bg-surfaceActive text-textPrimary border border-border shadow-sm"
                  : "text-textSecondary hover:text-textPrimary hover:bg-surfaceHover"
              }`}
            >
              <Settings
                className={`w-4 h-4 transition-colors ${
                  isSettingsActive ? "text-accent" : "text-textMuted group-hover:text-textPrimary"
                }`}
              />
              <span>Settings</span>
            </button>
          </nav>
        </div>
      </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar (>= 1024px / lg) */}
      <aside
        onContextMenu={handleSidebarNavContextMenu}
        className="hidden lg:flex w-60 bg-sidebar border-r border-border p-3 flex-col justify-between select-none flex-shrink-0 z-20 overflow-y-auto"
      >
        {renderNavContent()}
      </aside>

      {/* Mobile & Tablet Slide-Up Bottom Sheet Drawer (< 1024px / lg) */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex flex-col justify-end">
          {/* Subtle Frosted Backdrop Overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-fade-in"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />

          {/* Slide-Up Bottom Sheet Pane */}
          <aside
            onContextMenu={handleSidebarNavContextMenu}
            className="relative w-full max-h-[85vh] sm:max-h-[80vh] md:max-w-lg md:mx-auto bg-surface backdrop-blur-2xl border-t border-border rounded-t-[28px] p-5 pb-8 flex flex-col justify-between select-none shadow-[0_-16px_48px_rgba(0,0,0,0.6)] overflow-y-auto z-50 animate-drawer-in-up"
          >
            {/* Grab Handle Pill for bottom sheet */}
            <div
              onClick={() => setMobileSidebarOpen(false)}
              className="w-12 h-1.5 rounded-full bg-textMuted/30 hover:bg-textMuted/50 transition-colors mx-auto mb-3 flex-shrink-0 cursor-pointer"
            />

            {/* Mobile Header with Brand & Close Button */}
            <div className="flex items-center justify-between pb-3 border-b border-border/40 mb-3 flex-shrink-0">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-textPrimary tracking-tight">Wavery</span>
                <span className="text-[10px] text-textMuted font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-surfaceHover border border-border">Menu</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="w-8 h-8 rounded-full bg-surfaceHover hover:bg-surfaceActive active:scale-95 text-textSecondary hover:text-textPrimary flex items-center justify-center transition focus:outline-none"
                title="Close Navigation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {renderNavContent()}
          </aside>
        </div>
      )}
    </>
  );
};

export const Sidebar = React.memo(SidebarInner);

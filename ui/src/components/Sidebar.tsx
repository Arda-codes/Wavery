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
  HardDrive,
  Settings,
  Plus,
  Trash2,
  Play,
  ListPlus,
  CornerDownRight,
  FolderPlus,
} from "lucide-react";

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

  const isTracksActive = currentView === "tracks";
  const isArtistsActive = currentView === "artists" || currentView === "artist_detail";
  const isAlbumsActive = currentView === "albums" || currentView === "album_detail";
  const isLikedActive = currentView === "liked";
  const isPlaylistsActive = currentView === "playlists";
  const isSettingsActive = currentView === "settings";

  const isTracksPlaying = playbackContext?.type === "tracks";
  const isLikedPlaying = playbackContext?.type === "liked";

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

  return (
    <aside
      onContextMenu={handleSidebarNavContextMenu}
      className="w-60 bg-[#0F0F13]/95 border-r border-white/[0.07] p-3 flex flex-col justify-between select-none flex-shrink-0 z-20 overflow-y-auto"
    >
      <div className="space-y-5">
        {/* Library Section */}
        <div>
          <p className="text-[11px] font-bold text-[#71717A] tracking-wider uppercase mb-2 px-3">
            Library
          </p>
          <nav className="space-y-1">
            {/* All Tracks */}
            <button
              onClick={() => onNavigate("tracks")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isTracksActive
                  ? "bg-white/[0.10] text-white border border-white/[0.08] shadow-sm"
                  : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Library
                className={`w-4 h-4 transition-colors ${
                  isTracksActive ? "text-[#FA586A]" : "text-[#71717A] group-hover:text-white"
                }`}
              />
              <span className="truncate">All Tracks</span>
              {isTracksPlaying && (
                <span className="inline-flex items-center ml-1" title="Currently Playing from All Tracks">
                  <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-[#FA586A]" />
                </span>
              )}
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                  isTracksActive
                    ? "bg-[#FA586A] text-white font-bold shadow-sm shadow-[#FA586A]/30"
                    : "bg-white/[0.06] text-[#71717A] group-hover:text-[#A1A1AA]"
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
                  ? "bg-gradient-to-r from-[#FA586A]/15 to-transparent text-white border border-[#FA586A]/30 shadow-sm"
                  : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Heart
                className={`w-4 h-4 transition-colors ${
                  isLikedActive
                    ? "text-[#FA586A] fill-[#FA586A]"
                    : "text-[#FA586A]/70 group-hover:text-[#FA586A]"
                }`}
              />
              <span className="truncate">Liked Songs</span>
              {isLikedPlaying && (
                <span className="inline-flex items-center ml-1" title="Currently Playing from Liked Songs">
                  <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-[#FA586A]" />
                </span>
              )}
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                  isLikedActive
                    ? "bg-[#FA586A] text-white font-bold shadow-sm shadow-[#FA586A]/30"
                    : "bg-white/[0.06] text-[#71717A] group-hover:text-[#A1A1AA]"
                }`}
              >
                {likedCount}
              </span>
            </button>

            {/* Artists */}
            <button
              onClick={() => onNavigate("artists")}
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                isArtistsActive
                  ? "bg-white/[0.10] text-white border border-white/[0.08] shadow-sm"
                  : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Users
                className={`w-4 h-4 transition-colors ${
                  isArtistsActive ? "text-[#FA586A]" : "text-[#71717A] group-hover:text-white"
                }`}
              />
              <span>Artists</span>
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                  isArtistsActive
                    ? "bg-[#FA586A] text-white font-bold shadow-sm shadow-[#FA586A]/30"
                    : "bg-white/[0.06] text-[#71717A] group-hover:text-[#A1A1AA]"
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
                  ? "bg-white/[0.10] text-white border border-white/[0.08] shadow-sm"
                  : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Disc
                className={`w-4 h-4 transition-colors ${
                  isAlbumsActive ? "text-[#FA586A]" : "text-[#71717A] group-hover:text-white"
                }`}
              />
              <span>Albums</span>
              <span
                className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${
                  isAlbumsActive
                    ? "bg-[#FA586A] text-white font-bold shadow-sm shadow-[#FA586A]/30"
                    : "bg-white/[0.06] text-[#71717A] group-hover:text-[#A1A1AA]"
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
                isPlaylistsActive ? "text-[#FA586A]" : "text-[#71717A] hover:text-white"
              }`}
            >
              Playlists
            </button>
            {onCreatePlaylist && (
              <button
                onClick={onCreatePlaylist}
                className="w-5 h-5 rounded-md hover:bg-white/[0.08] text-[#71717A] hover:text-white flex items-center justify-center transition"
                title="Create New Playlist"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <nav className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
            {playlists.length === 0 ? (
              <p className="text-[11px] text-[#71717A] px-3 py-1.5 italic">
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
                          ? "bg-white/[0.10] text-white font-semibold border border-white/[0.08]"
                          : isThisPlaylistPlaying
                          ? "text-[#FA586A] bg-[#FA586A]/10 font-semibold"
                          : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.04]"
                      }`}
                    >
                      {isThisPlaylistPlaying ? (
                        <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-[#FA586A]" />
                      ) : (
                        <ListMusic
                          className={`w-3.5 h-3.5 flex-shrink-0 ${
                            isSelected ? "text-[#FA586A]" : "text-[#71717A]"
                          }`}
                        />
                      )}
                      <span className="truncate flex-1">{pl.name}</span>
                      <span className="text-[10px] text-[#71717A] font-mono pr-4">
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
                        className="absolute right-1.5 p-1 rounded hover:bg-red-500/20 text-[#71717A] hover:text-red-400 transition"
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
          <p className="text-[11px] font-bold text-[#71717A] tracking-wider uppercase mb-2 px-3">
            Manage
          </p>
          <nav className="space-y-1.5">
            {/* Import Music CTA */}
            {onOpenImport && (
              <button
                onClick={onOpenImport}
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-[#FA586A] hover:bg-[#E04859] active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-md shadow-[#FA586A]/20 transition-all mb-2"
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
                  ? "bg-white/[0.10] text-white border border-white/[0.08] shadow-sm"
                  : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <Settings
                className={`w-4 h-4 transition-colors ${
                  isSettingsActive ? "text-[#FA586A]" : "text-[#71717A] group-hover:text-white"
                }`}
              />
              <span>Settings & Maintenance</span>
            </button>
          </nav>
        </div>
      </div>

      <div className="p-3 bg-[#16161A] border border-white/[0.07] rounded-xl flex items-center gap-2.5 shadow-sm mt-4">
        <HardDrive className="w-4 h-4 text-[#FA586A] flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-white">Managed Store</p>
          <p className="text-[10px] text-[#71717A] truncate font-mono">
            ~/.local/share/wavery/library
          </p>
        </div>
      </div>
    </aside>
  );
};

export const Sidebar = React.memo(SidebarInner);

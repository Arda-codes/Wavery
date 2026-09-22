import React, { useState, useCallback } from "react";
import { Playlist, Track } from "../types";
import { ListMusic, Plus, Play, Trash2, ListPlus, CornerDownRight } from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { playerAdapter } from "../services/adapter";

interface PlaylistsViewProps {
  playlists: Playlist[];
  onSelectPlaylist: (id: string) => void;
  onCreatePlaylist: () => void;
  onDeletePlaylist?: (id: string) => void;
}

const PLAYLIST_COVER_GRADIENTS = [
  "bg-gradient-to-br from-slate-900 via-surfaceActive to-surface",
  "bg-gradient-to-br from-indigo-950/70 via-surfaceActive to-surface",
  "bg-gradient-to-br from-zinc-900 via-surfaceActive to-surface",
  "bg-gradient-to-br from-teal-950/60 via-surfaceActive to-surface",
  "bg-gradient-to-br from-amber-950/50 via-surfaceActive to-surface",
  "bg-gradient-to-br from-purple-950/50 via-surfaceActive to-surface",
  "bg-gradient-to-br from-rose-950/50 via-surfaceActive to-surface",
];

export const PlaylistsView: React.FC<PlaylistsViewProps> = ({
  playlists,
  onSelectPlaylist,
  onCreatePlaylist,
  onDeletePlaylist,
}) => {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const insertAfterCurrent = usePlayerStore((s) => s.insertAfterCurrent);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const [playingId, setPlayingId] = useState<string | null>(null);

  const handlePlayPlaylist = async (e: React.MouseEvent, pl: Playlist) => {
    e.stopPropagation();
    try {
      setPlayingId(pl.id);
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
    } finally {
      setPlayingId(null);
    }
  };

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
          onClick: () => onSelectPlaylist(pl.id),
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

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-8 bg-[#0D0D10]">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Playlists</h1>
          <p className="text-xs text-[#71717A] font-medium mt-1">
            {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"} in your library
          </p>
        </div>
        <button
          onClick={onCreatePlaylist}
          className="flex items-center space-x-2 px-4 py-2 bg-[#FA586A] hover:bg-[#E04859] active:scale-[0.98] text-white rounded-full text-xs font-bold shadow-md shadow-[#FA586A]/20 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Playlist</span>
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
        {/* Create Playlist Action Card */}
        <div
          onClick={onCreatePlaylist}
          className="group cursor-pointer aspect-square rounded-2xl border-2 border-dashed border-white/[0.10] hover:border-accent/50 bg-white/[0.02] hover:bg-white/[0.05] transition flex flex-col items-center justify-center p-6 text-center select-none"
        >
          <div className="w-12 h-12 rounded-2xl bg-white/[0.06] group-hover:bg-accent group-hover:text-white text-[#71717A] flex items-center justify-center transition mb-3 shadow-inner">
            <Plus className="w-6 h-6" />
          </div>
          <span className="text-xs font-bold text-[#A1A1AA] group-hover:text-white transition">
            Create Playlist
          </span>
        </div>

        {/* Existing Playlists */}
        {playlists.map((pl, idx) => {
          const isCurrentLoading = playingId === pl.id;
          const coverGradient = PLAYLIST_COVER_GRADIENTS[idx % PLAYLIST_COVER_GRADIENTS.length];

          return (
            <div
              key={pl.id}
              onClick={() => onSelectPlaylist(pl.id)}
              onContextMenu={(e) => handlePlaylistContextMenu(e, pl)}
              className="group cursor-pointer select-none flex flex-col"
            >
              {/* Art Card with Hover Play Overlay */}
              <div
                className={`w-full aspect-square rounded-2xl ${coverGradient} p-4 flex items-end justify-between relative overflow-hidden shadow-md group-hover:shadow-xl group-hover:border-white/20 transition-all border border-white/[0.08]`}
              >
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <ListMusic className="w-10 h-10 text-textMuted/70 group-hover:text-accent transition-colors" />
                </div>

                {/* Play button overlay */}
                <button
                  type="button"
                  onClick={(e) => handlePlayPlaylist(e, pl)}
                  disabled={isCurrentLoading}
                  className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-2xl opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95 transition-all ml-auto z-10"
                  title="Play Playlist"
                >
                  <Play className="w-5 h-5 fill-black translate-x-0.5" />
                </button>
              </div>

              {/* Title & Stats */}
              <div className="mt-3 flex items-start justify-between min-w-0">
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-bold text-white truncate group-hover:text-accent transition">
                    {pl.name}
                  </h3>
                  <p className="text-[11px] text-[#71717A] font-medium mt-0.5">
                    {pl.track_ids.length} {pl.track_ids.length === 1 ? "track" : "tracks"}
                  </p>
                </div>

                {onDeletePlaylist && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete playlist "${pl.name}"?`)) {
                        onDeletePlaylist(pl.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[#71717A] hover:text-red-400 rounded transition ml-1"
                    title="Delete Playlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

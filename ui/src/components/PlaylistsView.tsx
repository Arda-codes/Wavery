import React, { useState, useMemo, useCallback, useDeferredValue } from "react";
import { Playlist, Track, PlaylistSortKey, SortDirection } from "../types";
import { sortPlaylists } from "../utils/library";
import { useSortStore } from "../stores/sortStore";
import { FilterMenu, FilterSection } from "./FilterMenu";
import { ListMusic, Plus, Play, Trash2, ListPlus, CornerDownRight, ArrowUp, ArrowDown, Search, FolderPlus } from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { playerAdapter } from "../services/adapter";

interface PlaylistsViewProps {
  playlists: Playlist[];
  onSelectPlaylist: (id: string) => void;
  onCreatePlaylist: () => void;
  onImportFolderAsPlaylist?: () => void;
  onDeletePlaylist?: (id: string) => void;
}

export const PlaylistsView: React.FC<PlaylistsViewProps> = ({
  playlists,
  onSelectPlaylist,
  onCreatePlaylist,
  onImportFolderAsPlaylist,
  onDeletePlaylist,
}) => {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const insertAfterCurrent = usePlayerStore((s) => s.insertAfterCurrent);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [playlistFilter, setPlaylistFilter] = useState<"all" | "with_tracks" | "empty">("all");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const activeFilterCount = useMemo(() => {
    return playlistFilter !== "all" ? 1 : 0;
  }, [playlistFilter]);

  const resetAllFilters = useCallback(() => {
    setPlaylistFilter("all");
  }, []);

  const filterSections: FilterSection[] = useMemo(
    () => [
      {
        id: "content",
        title: "Playlist Content",
        selectedId: playlistFilter,
        onChange: (id) => setPlaylistFilter(id as "all" | "with_tracks" | "empty"),
        options: [
          { id: "all", label: "All Playlists" },
          { id: "with_tracks", label: "With Tracks" },
          { id: "empty", label: "Empty Playlists" },
        ],
      },
    ],
    [playlistFilter]
  );

  const sortState = useSortStore((s) => s.pageSorts["playlists"]);
  const togglePageSort = useSortStore((s) => s.togglePageSort);
  const sortKey = (sortState?.key as PlaylistSortKey) || "name";
  const sortDir = (sortState?.dir as SortDirection) || "asc";

  const toggleSort = useCallback(
    (key: PlaylistSortKey) => {
      togglePageSort("playlists", key, "name");
    },
    [togglePageSort]
  );

  const filteredAndSortedPlaylists = useMemo(() => {
    let list = playlists;
    if (playlistFilter === "with_tracks") {
      list = list.filter((p) => p.track_ids.length > 0);
    } else if (playlistFilter === "empty") {
      list = list.filter((p) => p.track_ids.length === 0);
    }
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return sortPlaylists(list, sortKey, sortDir);
  }, [playlists, playlistFilter, deferredSearchQuery, sortKey, sortDir]);

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
              if (confirm(`Are you sure you want to delete the playlist "${pl.name}"? Tracks inside your library will not be removed.`)) {
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
    <div className="flex-1 flex flex-col overflow-y-auto p-4 sm:p-8 pb-32 sm:pb-24 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Playlists</h1>
          <p className="text-xs text-textMuted font-medium mt-1">
            {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"} in your library
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onImportFolderAsPlaylist && (
            <button
              type="button"
              onClick={onImportFolderAsPlaylist}
              className="flex items-center space-x-2 px-4 py-2 bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.98] text-white border border-white/[0.08] rounded-xl text-xs font-semibold transition"
            >
              <FolderPlus className="w-4 h-4 text-accent" />
              <span>Import Folder(s)</span>
            </button>
          )}
          <button
            onClick={onCreatePlaylist}
            className="flex items-center space-x-2 px-4 py-2 bg-accent-fill hover:bg-accentHover active:scale-[0.98] text-white rounded-xl text-xs font-semibold shadow-md shadow-accent/20 transition"
          >
            <Plus className="w-4 h-4" />
            <span>New Playlist</span>
          </button>
        </div>
      </div>

      {/* Filter and Sort Controls */}
      {playlists.length > 0 && (
        <div className="flex flex-wrap items-center justify-between mb-6 pb-4 border-b border-white/[0.06] gap-2 sm:gap-4">
          {/* Search & Filter */}
          <div className="flex items-center space-x-2 sm:space-x-3 w-full sm:w-auto sm:flex-1 sm:min-w-0">
            <div className="relative w-40 sm:w-60 max-w-xs group flex-shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-textMuted group-focus-within:text-accent transition-colors" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter playlists..."
                className="w-full bg-surface border border-white/[0.08] hover:border-white/[0.15] focus:border-accent/60 rounded-full pl-8 pr-4 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
              />
            </div>

            <FilterMenu
              isOpen={isFilterOpen}
              onToggle={() => setIsFilterOpen((v) => !v)}
              onClose={() => setIsFilterOpen(false)}
              activeFilterCount={activeFilterCount}
              onResetAll={resetAllFilters}
              sections={filterSections}
            />
          </div>

          {/* Sort Controls */}
          <div className="flex items-center space-x-2 overflow-x-auto scrollbar-none flex-shrink-0">
            <span className="text-textMuted mr-1 hidden sm:inline text-xs">Sort:</span>
            {(["name", "tracks", "date"] as PlaylistSortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleSort(key)}
                className={`px-3 py-1 rounded-full border text-2xs font-medium flex items-center gap-1 whitespace-nowrap transition-all ${
                  sortKey === key
                    ? "bg-accent/15 border-accent/40 text-white font-semibold shadow-sm"
                    : "bg-surface border-white/[0.06] text-textMuted hover:text-white hover:border-white/[0.15]"
                }`}
              >
                <span>
                  {key === "name"
                    ? "Name"
                    : key === "tracks"
                    ? "Tracks"
                    : "Date Created"}
                </span>
                {sortKey === key &&
                  (sortDir === "asc" ? (
                    <ArrowUp className="w-3 h-3 text-accent" />
                  ) : (
                    <ArrowDown className="w-3 h-3 text-accent" />
                  ))}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid or Search Empty State */}
      {deferredSearchQuery.trim() && filteredAndSortedPlaylists.length === 0 ? (
        <div className="py-16 text-center text-textMuted space-y-3">
          <p className="text-xs text-textSecondary font-medium">
            No playlists matching &ldquo;{searchQuery}&rdquo;
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-textSecondary hover:text-white bg-white/[0.06] hover:bg-white/[0.12] transition"
          >
            Clear Filter
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {/* Create Playlist Action Card */}
          <div
            onClick={onCreatePlaylist}
            className="group cursor-pointer aspect-square rounded-2xl border-2 border-dashed border-white/[0.10] hover:border-accent/50 bg-white/[0.02] hover:bg-white/[0.05] transition flex flex-col items-center justify-center p-6 text-center select-none"
          >
            <Plus className="w-8 h-8 text-textMuted group-hover:text-accent mb-3 transition-colors stroke-[1.5]" />
            <span className="text-xs font-semibold text-textSecondary group-hover:text-white transition">
              Create Playlist
            </span>
          </div>

          {/* Existing Playlists */}
          {filteredAndSortedPlaylists.map((pl) => {
            const isCurrentLoading = playingId === pl.id;

            return (
              <div
                key={pl.id}
                onClick={() => onSelectPlaylist(pl.id)}
                onContextMenu={(e) => handlePlaylistContextMenu(e, pl)}
                className="group cursor-pointer select-none flex flex-col"
              >
                {/* Art Card with Hover Play Overlay */}
                <div
                  className="w-full aspect-square rounded-2xl bg-surfaceActive p-4 flex items-end justify-between relative overflow-hidden shadow-md group-hover:shadow-xl group-hover:border-white/20 transition-all border border-border"
                >
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <ListMusic className="w-10 h-10 text-textMuted/70 group-hover:text-accent transition-colors" />
                  </div>

                  {/* Play button overlay */}
                  <button
                    type="button"
                    onClick={(e) => handlePlayPlaylist(e, pl)}
                    disabled={isCurrentLoading}
                    className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-2xl opacity-0 group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.92] transition-[opacity,transform,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ml-auto z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title="Play Playlist"
                  >
                    <Play className="w-5 h-5 fill-black" />
                  </button>
                </div>

                {/* Title & Stats */}
                <div className="mt-3 flex items-start justify-between min-w-0">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-bold text-white truncate group-hover:text-accent transition">
                      {pl.name}
                    </h3>
                    <p className="text-2xs text-textMuted font-medium mt-1">
                      {pl.track_ids.length} {pl.track_ids.length === 1 ? "track" : "tracks"}
                    </p>
                  </div>

                  {onDeletePlaylist && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Are you sure you want to delete the playlist "${pl.name}"? Tracks inside your library will not be removed.`)) {
                          onDeletePlaylist(pl.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-textMuted hover:text-danger rounded transition ml-1"
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
      )}
    </div>
  );
};

import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Track, TrackSortKey, SortDirection, PlaybackContext } from "../types";
import { sortTracks } from "../utils/library";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSortStore } from "../stores/sortStore";
import { windowService } from "../services/windowService";
import { TrackRow } from "./TrackRow";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import { DeleteTrackModal } from "./DeleteTrackModal";
import { SongMetadataModal } from "./SongMetadataModal";
import { FilterMenu, FilterSection } from "./FilterMenu";
import {
  Music,
  Clock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  SlidersHorizontal,
} from "lucide-react";

interface TrackTableProps {
  tracks: Track[];
  playbackContext?: PlaybackContext;
  onSelectArtist?: (artistName: string) => void;
  onSelectAlbum?: (albumTitle: string, artistName: string) => void;
  getArtworkUrl?: (id: string) => string;
  showSearchBar?: boolean;
  onAddToPlaylist?: (track: Track) => void;
  onRemoveTrack?: (trackId: string) => void;
  onDeleteTrack?: (track: Track) => void;
  onEditTrack?: (track: Track) => void;
  pageKey?: string;
  fallbackPageKey?: string;
  defaultSortKey?: TrackSortKey;
  defaultSortDir?: SortDirection;
}

const TrackTableInner: React.FC<TrackTableProps> = ({
  tracks,
  playbackContext,
  onSelectArtist,
  onSelectAlbum,
  getArtworkUrl,
  showSearchBar = true,
  onAddToPlaylist: customAddToPlaylist,
  onRemoveTrack,
  onDeleteTrack: customDeleteTrack,
  onEditTrack: customEditTrack,
  pageKey,
  fallbackPageKey,
  defaultSortKey,
  defaultSortDir,
}) => {
  const rowDensity = useSettingsStore((s) => s.rowDensity);
  const rowHeight = rowDensity === "compact" ? 34 : 44;

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Filter Menu state
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterGenre, setFilterGenre] = useState<string>("all");
  const [filterEra, setFilterEra] = useState<string>("all");
  const [filterAudio, setFilterAudio] = useState<string>("all");
  const [filterDuration, setFilterDuration] = useState<string>("all");

  const availableGenres = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tracks) {
      const g = t.metadata.genre?.trim();
      if (g) {
        const parts = g.split(/[,/&;]/).map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          const cap = p.charAt(0).toUpperCase() + p.slice(1);
          map.set(cap, (map.get(cap) || 0) + 1);
        }
      }
    }
    return Array.from(map.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name]) => name);
  }, [tracks]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterGenre !== "all") count++;
    if (filterEra !== "all") count++;
    if (filterAudio !== "all") count++;
    if (filterDuration !== "all") count++;
    return count;
  }, [filterGenre, filterEra, filterAudio, filterDuration]);

  const resetAllFilters = useCallback(() => {
    setFilterGenre("all");
    setFilterEra("all");
    setFilterAudio("all");
    setFilterDuration("all");
  }, []);

  const filterSections: FilterSection[] = useMemo(() => {
    const sections: FilterSection[] = [
      {
        id: "audio",
        title: "Content & Audio",
        selectedId: filterAudio,
        onChange: setFilterAudio,
        options: [
          { id: "all", label: "All Songs" },
          { id: "lyrics", label: "Has Lyrics" },
          { id: "lossless", label: "Lossless (FLAC/WAV)" },
        ],
      },
      {
        id: "era",
        title: "Release Era",
        selectedId: filterEra,
        onChange: setFilterEra,
        options: [
          { id: "all", label: "All Eras" },
          { id: "2020s", label: "2020s" },
          { id: "2010s", label: "2010s" },
          { id: "2000s", label: "2000s" },
          { id: "1990s", label: "90s" },
          { id: "older", label: "Classic" },
        ],
      },
      {
        id: "duration",
        title: "Track Length",
        selectedId: filterDuration,
        onChange: setFilterDuration,
        options: [
          { id: "all", label: "Any Length" },
          { id: "short", label: "< 3 min" },
          { id: "medium", label: "3 – 5 min" },
          { id: "long", label: "> 5 min" },
        ],
      },
    ];

    if (availableGenres.length > 0) {
      sections.unshift({
        id: "genre",
        title: "Genre",
        selectedId: filterGenre,
        onChange: setFilterGenre,
        options: [
          { id: "all", label: "All Genres" },
          ...availableGenres.map((g) => ({ id: g, label: g })),
        ],
      });
    }

    return sections;
  }, [filterGenre, filterEra, filterAudio, filterDuration, availableGenres]);

  const [localSortKey, setLocalSortKey] = useState<TrackSortKey>(defaultSortKey || "title");
  const [localSortDir, setLocalSortDir] = useState<SortDirection>(defaultSortDir || "asc");

  const pageSortState = useSortStore(
    useCallback(
      (s) =>
        pageKey
          ? s.pageSorts[pageKey] ||
            (fallbackPageKey ? s.pageSorts[fallbackPageKey] : undefined)
          : undefined,
      [pageKey, fallbackPageKey]
    )
  );
  const togglePageSort = useSortStore((s) => s.togglePageSort);

  const sortKey: TrackSortKey =
    (pageKey ? (pageSortState?.key as TrackSortKey) : null) ||
    localSortKey ||
    defaultSortKey ||
    "title";
  const sortDir: SortDirection =
    (pageKey ? (pageSortState?.dir as SortDirection) : null) ||
    localSortDir ||
    defaultSortDir ||
    "asc";

  // Add to Playlist modal state
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<Track | null>(null);
  const playlists = useLibraryStore((s) => s.playlists);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);

  // Delete Track modal state
  const [trackToDelete, setTrackToDelete] = useState<Track | null>(null);
  const deleteTrack = useLibraryStore((s) => s.deleteTrack);

  // Edit Track modal state
  const [trackToEdit, setTrackToEdit] = useState<Track | null>(null);

  // Fine-grained selector subscriptions — avoids 500ms polling re-renders
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const parentRef = useRef<HTMLDivElement>(null);

  const handleHeaderClick = useCallback(
    (key: TrackSortKey) => {
      if (pageKey) {
        togglePageSort(pageKey, key, defaultSortKey || "title", fallbackPageKey);
      } else {
        if (localSortKey === key) {
          setLocalSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
          setLocalSortKey(key);
          setLocalSortDir("asc");
        }
      }
    },
    [pageKey, fallbackPageKey, defaultSortKey, togglePageSort, localSortKey]
  );

  const filteredAndSortedTracks = useMemo(() => {
    let list = tracks;

    // Apply Filter Menu criteria
    if (filterGenre !== "all") {
      const gLower = filterGenre.toLowerCase();
      list = list.filter((t) => t.metadata.genre?.toLowerCase().includes(gLower));
    }

    if (filterEra !== "all") {
      list = list.filter((t) => {
        const y = t.metadata.year;
        if (!y) return false;
        if (filterEra === "2020s") return y >= 2020;
        if (filterEra === "2010s") return y >= 2010 && y < 2020;
        if (filterEra === "2000s") return y >= 2000 && y < 2010;
        if (filterEra === "1990s") return y >= 1990 && y < 2000;
        if (filterEra === "older") return y < 1990;
        return true;
      });
    }

    if (filterAudio === "lyrics") {
      list = list.filter((t) => Boolean(t.metadata.lyrics?.trim()));
    } else if (filterAudio === "lossless") {
      list = list.filter((t) => {
        const fmt = (t.metadata.format || t.source?.Managed?.split(".").pop() || "").toUpperCase();
        return fmt === "FLAC" || fmt === "WAV" || fmt === "ALAC";
      });
    }

    if (filterDuration !== "all") {
      list = list.filter((t) => {
        const secs = t.metadata.duration?.secs || 0;
        if (filterDuration === "short") return secs < 180;
        if (filterDuration === "medium") return secs >= 180 && secs <= 300;
        if (filterDuration === "long") return secs > 300;
        return true;
      });
    }

    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter((t) => {
        const title = t.metadata.title?.toLowerCase() || "";
        const artist = t.metadata.artist?.toLowerCase() || "";
        const album = t.metadata.album?.toLowerCase() || "";
        const lyrics = t.metadata.lyrics?.toLowerCase() || "";
        return (
          title.includes(q) ||
          artist.includes(q) ||
          album.includes(q) ||
          lyrics.includes(q)
        );
      });
    }
    return sortTracks(list, sortKey, sortDir);
  }, [tracks, filterGenre, filterEra, filterAudio, filterDuration, deferredSearchQuery, sortKey, sortDir]);

  const virtualizer = useVirtualizer({
    count: filteredAndSortedTracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  // Force instantaneous virtualizer measurement when sudden window maximize/unmaximize/resize occurs
  useEffect(() => {
    return windowService.onWindowStateChange(() => {
      virtualizer.measure();
    });
  }, [virtualizer]);

  const handlePlayRow = useCallback(
    (track: Track, index: number) => {
      if (currentTrackId === track.id) {
        if (isPlaying) {
          pause();
        } else {
          resume();
        }
      } else {
        const effectiveContext =
          playbackContext || {
            type: "tracks" as const,
            name: "All Tracks",
          };

        setQueue(filteredAndSortedTracks, index, effectiveContext);
      }
    },
    [currentTrackId, isPlaying, pause, resume, setQueue, filteredAndSortedTracks, playbackContext]
  );

  const handleOpenAddToPlaylist = useCallback(
    (track: Track) => {
      if (customAddToPlaylist) {
        customAddToPlaylist(track);
      } else {
        setSelectedTrackForPlaylist(track);
      }
    },
    [customAddToPlaylist]
  );

  const handleDeleteTrackClick = useCallback(
    (track: Track) => {
      if (customDeleteTrack) {
        customDeleteTrack(track);
      } else {
        setTrackToDelete(track);
      }
    },
    [customDeleteTrack]
  );

  const handleEditTrackClick = useCallback(
    (track: Track) => {
      if (customEditTrack) {
        customEditTrack(track);
      } else {
        setTrackToEdit(track);
      }
    },
    [customEditTrack]
  );

  const handleConfirmDelete = useCallback(
    async (trackId: string, removeFile: boolean) => {
      await deleteTrack(trackId, removeFile);
    },
    [deleteTrack]
  );

  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background">
        <Music className="w-12 h-12 text-textMuted mb-4 stroke-[1.5]" />
        <h3 className="text-sm font-bold text-white mb-1">
          No songs found
        </h3>
        <p className="text-xs text-textMuted max-w-sm">
          Click Import to add music files from your computer.
        </p>
      </div>
    );
  }

  const renderSortIcon = (key: TrackSortKey) => {
    if (sortKey !== key) {
      return (
        <ArrowUpDown className="w-3 h-3 text-textMuted/40 group-hover/col:text-textMuted inline ml-1 transition" />
      );
    }
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-accent inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-accent inline ml-1" />
    );
  };

  return (
    <div
      role="table"
      aria-label="Track list"
      className="flex-1 flex flex-col overflow-hidden bg-background"
    >
      {/* Search & Filter Bar */}
      {showSearchBar && (
        <div className="flex flex-wrap items-center justify-between px-3 sm:px-6 py-3 border-b border-white/[0.06] flex-shrink-0 gap-2 sm:gap-4 bg-background">
          <div className="flex items-center space-x-2 sm:space-x-3 flex-1">
            <div className="relative w-40 sm:w-60 max-w-xs group flex-shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-textMuted group-focus-within:text-accent transition-colors" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter songs..."
                className="w-full bg-surface border border-white/[0.08] hover:border-white/[0.15] focus:border-accent/60 rounded-full pl-8 pr-4 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
              />
            </div>

            {/* Proper Filter Popover Menu */}
            <FilterMenu
              isOpen={isFilterOpen}
              onToggle={() => setIsFilterOpen((v) => !v)}
              onClose={() => setIsFilterOpen(false)}
              activeFilterCount={activeFilterCount}
              onResetAll={resetAllFilters}
              sections={filterSections}
            />
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3 text-xs text-textMuted flex-shrink-0">
            <span className="flex items-center gap-2 font-medium">
              <SlidersHorizontal className="w-3.5 h-3.5 text-textMuted" />
              <span>
                {filteredAndSortedTracks.length} of {tracks.length} tracks
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Pinned Table Header with ARIA columnheader and responsive CSS grid layout */}
      <div
        role="rowgroup"
        className="bg-background/95 backdrop-blur-md flex-shrink-0 border-b border-white/[0.07] z-10"
      >
        <div
          role="row"
          className="grid grid-cols-[36px_minmax(0,1fr)_auto] md:grid-cols-[40px_minmax(160px,1fr)_140px_80px] lg:grid-cols-[44px_minmax(180px,1fr)_150px_150px_90px] xl:grid-cols-[48px_minmax(180px,1fr)_160px_160px_80px_110px] gap-2 sm:gap-3 px-3 sm:px-6 items-center text-xs font-medium text-textMuted h-10 select-none"
        >
          <div
            role="columnheader"
            onClick={() => handleHeaderClick("track_number")}
            className="text-center cursor-pointer group/col hover:text-white transition"
            title="Sort by Track Number"
          >
            <span>#</span>
            {renderSortIcon("track_number")}
          </div>
          <div
            role="columnheader"
            onClick={() => handleHeaderClick("title")}
            className="cursor-pointer group/col hover:text-white transition min-w-0"
            title="Sort by Title"
          >
            <span>Title</span>
            {renderSortIcon("title")}
          </div>
          <div
            role="columnheader"
            onClick={() => handleHeaderClick("artist")}
            className="hidden md:block cursor-pointer group/col hover:text-white transition min-w-0"
            title="Sort by Artist"
          >
            <span>Artist</span>
            {renderSortIcon("artist")}
          </div>
          <div
            role="columnheader"
            onClick={() => handleHeaderClick("album")}
            className="hidden lg:block cursor-pointer group/col hover:text-white transition min-w-0"
            title="Sort by Album"
          >
            <span>Album</span>
            {renderSortIcon("album")}
          </div>
          <div role="columnheader" className="hidden xl:block text-center">
            Format
          </div>
          <div
            role="columnheader"
            onClick={() => handleHeaderClick("duration")}
            className="text-right pr-2 cursor-pointer group/col hover:text-white transition"
            title="Sort by Duration"
          >
            <Clock className="w-3.5 h-3.5 inline" />
            {renderSortIcon("duration")}
          </div>
        </div>
      </div>

      {/* Virtualized Body Container */}
      <div
        ref={parentRef}
        role="rowgroup"
        className="flex-1 overflow-y-auto pb-32 sm:pb-0"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const track = filteredAndSortedTracks[virtualRow.index];
            const isSelected = currentTrackId === track.id;

            return (
              <TrackRow
                key={track.id}
                track={track}
                index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                isSelected={isSelected}
                isPlaying={isPlaying}
                onPlay={handlePlayRow}
                onSelectArtist={onSelectArtist}
                onSelectAlbum={onSelectAlbum}
                onAddToPlaylist={handleOpenAddToPlaylist}
                onRemoveFromPlaylist={onRemoveTrack}
                onDeleteTrack={handleDeleteTrackClick}
                onEditMetadata={handleEditTrackClick}
                artworkUrl={getArtworkUrl ? getArtworkUrl(track.id) : undefined}
                rowDensity={rowDensity}
              />
            );
          })}
        </div>
      </div>

      {/* Add To Playlist Modal */}
      <AddToPlaylistModal
        isOpen={!!selectedTrackForPlaylist}
        onClose={() => setSelectedTrackForPlaylist(null)}
        track={selectedTrackForPlaylist}
        playlists={playlists}
        onAddToPlaylist={async (playlistId, trackId) => {
          await addTracksToPlaylist(playlistId, [trackId]);
        }}
        onCreateAndAdd={async (name, trackId) => {
          const pl = await createPlaylist(name);
          await addTracksToPlaylist(pl.id, [trackId]);
        }}
      />

      {/* Delete Track Modal */}
      <DeleteTrackModal
        isOpen={!!trackToDelete}
        onClose={() => setTrackToDelete(null)}
        track={trackToDelete}
        onConfirm={handleConfirmDelete}
      />

      {/* Edit Song Metadata Modal */}
      <SongMetadataModal
        isOpen={!!trackToEdit}
        onClose={() => setTrackToEdit(null)}
        track={trackToEdit}
      />
    </div>
  );
};

export const TrackTable = React.memo(TrackTableInner);

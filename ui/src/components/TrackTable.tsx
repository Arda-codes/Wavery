import React, { useState, useMemo, useRef, useCallback, useDeferredValue } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Track, TrackSortKey, SortDirection, PlaybackContext } from "../types";
import { sortTracks } from "../utils/library";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useSettingsStore } from "../stores/settingsStore";
import { TrackRow } from "./TrackRow";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import {
  Music,
  Clock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Search,
  SlidersHorizontal,
  Infinity,
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
}) => {
  const rowDensity = useSettingsStore((s) => s.rowDensity);
  const rowHeight = rowDensity === "compact" ? 34 : 44;

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [sortKey, setSortKey] = useState<TrackSortKey>("title");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  // Add to Playlist modal state
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<Track | null>(null);
  const playlists = useLibraryStore((s) => s.playlists);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);

  // Fine-grained selector subscriptions — avoids 500ms polling re-renders
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const isAutoplay = usePlayerStore((s) => s.isAutoplay);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const parentRef = useRef<HTMLDivElement>(null);

  const handleHeaderClick = useCallback(
    (key: TrackSortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  const filteredAndSortedTracks = useMemo(() => {
    let list = tracks;
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter((t) => {
        const title = t.metadata.title?.toLowerCase() || "";
        const artist = t.metadata.artist?.toLowerCase() || "";
        const album = t.metadata.album?.toLowerCase() || "";
        return title.includes(q) || artist.includes(q) || album.includes(q);
      });
    }
    return sortTracks(list, sortKey, sortDir);
  }, [tracks, deferredSearchQuery, sortKey, sortDir]);

  const virtualizer = useVirtualizer({
    count: filteredAndSortedTracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

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
          playbackContext ||
          (track.metadata.album
            ? {
                type: "album" as const,
                name: track.metadata.album,
                artist: track.metadata.artist,
              }
            : {
                type: "tracks" as const,
                name: "All Tracks",
              });

        if (effectiveContext.type === "tracks" && !isAutoplay) {
          setQueue([track], 0, effectiveContext);
        } else {
          setQueue(filteredAndSortedTracks, index, effectiveContext);
        }
      }
    },
    [currentTrackId, isPlaying, isAutoplay, pause, resume, setQueue, filteredAndSortedTracks, playbackContext]
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

  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0D0D10]">
        <div className="w-16 h-16 rounded-2xl bg-[#16161A] border border-white/[0.07] flex items-center justify-center mb-4 shadow-lg">
          <Music className="w-8 h-8 text-[#71717A]" />
        </div>
        <h3 className="text-sm font-bold text-white mb-1">
          No songs found
        </h3>
        <p className="text-xs text-[#71717A] max-w-sm">
          Click Import to add music files from your computer.
        </p>
      </div>
    );
  }

  const renderSortIcon = (key: TrackSortKey) => {
    if (sortKey !== key) {
      return (
        <ArrowUpDown className="w-3 h-3 text-[#71717A]/40 group-hover/col:text-[#71717A] inline ml-1 transition" />
      );
    }
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-[#FA586A] inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#FA586A] inline ml-1" />
    );
  };

  return (
    <div
      role="table"
      aria-label="Track list"
      className="flex-1 flex flex-col overflow-hidden bg-[#0D0D10]"
    >
      {/* Search & Stats Bar */}
      {showSearchBar && (
        <div className="flex flex-wrap items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-white/[0.06] flex-shrink-0 gap-2 sm:gap-4 bg-[#0D0D10]">
          <div className="relative flex-1 max-w-xs min-w-[140px] group">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#71717A] group-focus-within:text-[#FA586A] transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter songs..."
              className="w-full bg-[#18181D] border border-white/[0.08] hover:border-white/[0.15] focus:border-[#FA586A]/60 rounded-full pl-8 pr-4 py-1.5 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
            />
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3 text-xs text-[#71717A] flex-shrink-0">
            {(!playbackContext || playbackContext.type === "tracks") && (
              <button
                type="button"
                onClick={toggleAutoplay}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                  isAutoplay
                    ? "bg-[#FA586A]/15 text-[#FA586A] border-[#FA586A]/30 shadow-sm"
                    : "bg-white/[0.04] text-[#71717A] hover:text-white border-white/[0.06]"
                }`}
                title={
                  isAutoplay
                    ? "Autoplay is on (continues playing after queue finishes)"
                    : "Autoplay is off"
                }
              >
                <Infinity className="w-3.5 h-3.5" />
                <span className="text-[11px] hidden sm:inline">Autoplay</span>
              </button>
            )}

            <span className="flex items-center gap-1.5 font-medium">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#71717A]" />
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
        className="bg-[#0D0D10]/95 backdrop-blur-md flex-shrink-0 border-b border-white/[0.07] z-10"
      >
        <div
          role="row"
          className="grid grid-cols-[36px_minmax(0,1fr)_auto] md:grid-cols-[40px_minmax(160px,1fr)_140px_80px] lg:grid-cols-[44px_minmax(180px,1fr)_150px_150px_90px] xl:grid-cols-[48px_minmax(180px,1fr)_160px_160px_80px_110px] gap-2 sm:gap-3 px-3 sm:px-6 items-center text-[11px] font-bold text-[#71717A] uppercase tracking-wider h-10 select-none"
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
        className="flex-1 overflow-y-auto"
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
    </div>
  );
};

export const TrackTable = React.memo(TrackTableInner);

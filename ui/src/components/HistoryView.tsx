import React, { useState, useMemo, useCallback } from "react";
import { Track, ViewMode } from "../types";
import { usePlayerStore, PlayHistoryEntry } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { formatDuration, formatTotalDuration, getFullTrackArtistString } from "../utils/library";
import { useArtwork } from "../utils/useArtwork";
import { EqualizerWave } from "./EqualizerWave";
import {
  History,
  Play,
  Shuffle,
  Trash2,
  Search,
  Heart,
  MoreHorizontal,
  X,
  Music,
  Disc,
  User,
  ListPlus,
  CornerDownRight,
  AlertTriangle,
} from "lucide-react";

interface HistoryViewProps {
  tracks: Track[];
  onSelectArtist?: (artistName: string) => void;
  onSelectAlbum?: (albumTitle: string, artistName: string) => void;
  onNavigate: (view: ViewMode) => void;
  getArtworkUrl?: (id: string) => string;
}

interface EnrichedHistoryItem {
  entry: PlayHistoryEntry;
  track?: Track;
  trackId: string;
  playedAt: number;
}

type TimeGroup = "Today" | "Yesterday" | "Earlier This Week" | "Earlier This Month" | "Older";

function getTimeGroup(timestamp: number): TimeGroup {
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfSevenDaysAgo = startOfToday - 6 * 86400000;
  const startOfThirtyDaysAgo = startOfToday - 29 * 86400000;

  if (timestamp >= startOfToday) {
    return "Today";
  } else if (timestamp >= startOfYesterday) {
    return "Yesterday";
  } else if (timestamp >= startOfSevenDaysAgo) {
    return "Earlier This Week";
  } else if (timestamp >= startOfThirtyDaysAgo) {
    return "Earlier This Month";
  } else {
    return "Older";
  }
}

function formatPlayedTime(timestamp: number): string {
  const now = Date.now();
  const diffSecs = Math.floor((now - timestamp) / 1000);

  if (diffSecs < 60) return "Just now";
  if (diffSecs < 3600) {
    const mins = Math.floor(diffSecs / 60);
    return `${mins}m ago`;
  }

  const date = new Date(timestamp);
  const nowDate = new Date();
  const isSameDay =
    date.getDate() === nowDate.getDate() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getFullYear() === nowDate.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isSameDay) {
    return timeStr;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${timeStr}`;
}

// Single Track History Row
interface HistoryRowProps {
  item: EnrichedHistoryItem;
  index: number;
  isPlayingThisTrack: boolean;
  onPlay: (track: Track) => void;
  onSelectArtist?: (artistName: string) => void;
  onSelectAlbum?: (albumTitle: string, artistName: string) => void;
  onRemove: (trackId: string, timestamp: number) => void;
  getArtworkUrl?: (id: string) => string;
}

const HistoryRow: React.FC<HistoryRowProps> = ({
  item,
  index,
  isPlayingThisTrack,
  onPlay,
  onSelectArtist,
  onSelectAlbum,
  onRemove,
  getArtworkUrl,
}) => {
  const { track, entry } = item;
  const isLiked = useLibraryStore((s) => (track ? s.likedTrackIds.has(track.id) : false));
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const insertAfterCurrent = usePlayerStore((s) => s.insertAfterCurrent);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const fetchedArtwork = useArtwork(track ? track.id : "");
  const artworkUrl = getArtworkUrl && track ? getArtworkUrl(track.id) : fetchedArtwork;
  const [imgError, setImgError] = useState(false);

  const handleRowClick = useCallback(() => {
    if (track) onPlay(track);
  }, [track, onPlay]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!track) return;

      const menuItems: ContextMenuItem[] = [
        {
          id: "play",
          label: "Play",
          icon: Play,
          onClick: () => onPlay(track),
        },
        {
          id: "play-next",
          label: "Play Next",
          icon: CornerDownRight,
          onClick: () => insertAfterCurrent([track]),
        },
        {
          id: "add-to-queue",
          label: "Add to Queue",
          icon: ListPlus,
          onClick: () => addToQueue([track]),
        },
        {
          id: "divider-1",
          label: "",
          divider: true,
        },
      ];

      if (track.metadata.artist && onSelectArtist) {
        menuItems.push({
          id: "go-to-artist",
          label: `Go to ${track.metadata.artist}`,
          icon: User,
          onClick: () => onSelectArtist(track.metadata.artist!),
        });
      }

      if (track.metadata.album && onSelectAlbum) {
        menuItems.push({
          id: "go-to-album",
          label: `Go to ${track.metadata.album}`,
          icon: Disc,
          onClick: () => onSelectAlbum(track.metadata.album!, track.metadata.artist || ""),
        });
      }

      menuItems.push(
        {
          id: "divider-2",
          label: "",
          divider: true,
        },
        {
          id: "remove-from-history",
          label: "Remove from History",
          icon: X,
          danger: true,
          onClick: () => onRemove(entry.trackId, entry.playedAt),
        }
      );

      openContextMenu(e, menuItems);
    },
    [track, entry, onPlay, insertAfterCurrent, addToQueue, onSelectArtist, onSelectAlbum, onRemove, openContextMenu]
  );

  if (!track) {
    // Missing or deleted track from library
    return (
      <div className="group flex items-center px-4 py-3 rounded-xl hover:bg-white/[0.04] transition-colors border border-transparent text-xs text-textMuted">
        <div className="w-8 text-center font-mono text-2xs text-textMuted">
          {index + 1}
        </div>
        <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mr-3 flex-shrink-0">
          <Disc className="w-4 h-4 text-textMuted" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white/50 italic truncate">Track no longer in library</p>
          <p className="text-2xs text-textMuted">{formatPlayedTime(entry.playedAt)}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(entry.trackId, entry.playedAt);
          }}
          className="opacity-0 group-hover:opacity-100 p-2 text-textMuted hover:text-white rounded-lg hover:bg-white/[0.08] transition"
          title="Remove from history"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const artistName = getFullTrackArtistString(track);
  const albumTitle = track.metadata.album || "Unknown Album";
  const durationStr = formatDuration(track.metadata.duration?.secs || 0);
  const playedTimeStr = formatPlayedTime(entry.playedAt);

  return (
    <div
      onClick={handleRowClick}
      onContextMenu={handleContextMenu}
      className={`group flex items-center px-4 py-3 rounded-xl transition-all cursor-pointer border select-none ${
        isPlayingThisTrack
          ? "bg-accent/10 border-accent/30 text-white shadow-sm"
          : "hover:bg-white/[0.05] border-transparent text-textSecondary hover:text-white"
      }`}
    >
      {/* Play indicator / Index number */}
      <div className="w-8 flex items-center justify-center flex-shrink-0 mr-1">
        {isPlayingThisTrack ? (
          <EqualizerWave isPlaying={true} size="xs" color="bg-accent-fill" />
        ) : (
          <>
            <span className="group-hover:hidden font-mono text-2xs text-textMuted">
              {index + 1}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(track);
              }}
              className="hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-white text-black shadow-md hover:scale-105 active:scale-95 transition-transform"
              title="Play"
            >
              <Play className="w-3 h-3 fill-current" />
            </button>
          </>
        )}
      </div>

      {/* Album Artwork Thumbnail */}
      <div className="w-10 h-10 rounded-lg overflow-hidden bg-surface border border-white/[0.08] flex items-center justify-center mr-3 flex-shrink-0 relative group/thumb shadow-sm">
        {artworkUrl && !imgError ? (
          <img
            src={artworkUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <Music className="w-4 h-4 text-textMuted" />
        )}
      </div>

      {/* Title & Format Badge */}
      <div className="flex-1 min-w-0 pr-4">
        <div className="flex items-center gap-2">
          <span
            className={`font-semibold text-xs truncate transition-colors ${
              isPlayingThisTrack ? "text-accent" : "text-white"
            }`}
          >
            {track.metadata.title || "Unknown Title"}
          </span>
          {track.metadata.format && (
            <span className="text-2xs font-medium px-2 py-1 rounded bg-white/[0.06] text-textMuted border border-white/[0.04]">
              {track.metadata.format}
            </span>
          )}
        </div>

        {/* Artist Link */}
        <p className="text-2xs text-textMuted truncate group-hover:text-textSecondary transition-colors mt-1">
          {onSelectArtist ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onSelectArtist(artistName);
              }}
              className="hover:underline hover:text-white transition-colors"
            >
              {artistName}
            </span>
          ) : (
            artistName
          )}
        </p>
      </div>

      {/* Album Name */}
      <div className="hidden md:block w-44 lg:w-56 truncate pr-4 text-xs text-textMuted">
        {onSelectAlbum && track.metadata.album ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onSelectAlbum(track.metadata.album!, track.metadata.artist || "");
            }}
            className="hover:underline hover:text-white transition-colors truncate block"
          >
            {albumTitle}
          </span>
        ) : (
          <span className="truncate block">{albumTitle}</span>
        )}
      </div>

      {/* Played Timestamp */}
      <div className="w-28 text-right pr-4 text-2xs font-mono tabular-nums text-textMuted flex-shrink-0">
        {playedTimeStr}
      </div>

      {/* Track Duration */}
      <div className="w-14 text-right pr-3 text-2xs font-mono tabular-nums text-textMuted flex-shrink-0">
        {durationStr}
      </div>

      {/* Action Buttons: Like & Remove */}
      <div className="flex items-center space-x-1 flex-shrink-0">
        {/* Heart / Favorite */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track.id);
          }}
          className={`p-2 rounded-lg transition-colors ${
            isLiked
              ? "text-accent"
              : "text-textMuted opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/[0.08]"
          }`}
          title={isLiked ? "Remove from Liked Songs" : "Add to Liked Songs"}
        >
          <Heart className={`w-3.5 h-3.5 ${isLiked ? "fill-current" : ""}`} />
        </button>

        {/* Context Menu Button */}
        <button
          onClick={handleContextMenu}
          className="opacity-0 group-hover:opacity-100 p-2 text-textMuted hover:text-white rounded-lg hover:bg-white/[0.08] transition"
          title="More actions"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {/* Remove from History Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(entry.trackId, entry.playedAt);
          }}
          className="opacity-0 group-hover:opacity-100 p-2 text-textMuted hover:text-danger rounded-lg hover:bg-danger/10 transition"
          title="Remove from history"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export const HistoryView: React.FC<HistoryViewProps> = ({
  tracks,
  onSelectArtist,
  onSelectAlbum,
  onNavigate,
  getArtworkUrl,
}) => {
  const playHistory = usePlayerStore((s) => s.playHistory);
  const clearPlayHistory = usePlayerStore((s) => s.clearPlayHistory);
  const removePlayHistoryItem = usePlayerStore((s) => s.removePlayHistoryItem);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  const [searchQuery, setSearchQuery] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Fast map lookup for tracks by id
  const trackMap = useMemo(() => {
    const map = new Map<string, Track>();
    for (const t of tracks) {
      map.set(t.id, t);
    }
    return map;
  }, [tracks]);

  // Enrich play history entries with their corresponding Track objects
  const enrichedHistory = useMemo<EnrichedHistoryItem[]>(() => {
    return playHistory.map((entry) => ({
      entry,
      trackId: entry.trackId,
      playedAt: entry.playedAt,
      track: trackMap.get(entry.trackId),
    }));
  }, [playHistory, trackMap]);

  // Filter history based on search query
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return enrichedHistory;
    const q = searchQuery.toLowerCase().trim();
    return enrichedHistory.filter((item) => {
      if (!item.track) return false;
      const title = item.track.metadata.title?.toLowerCase() || "";
      const artist = item.track.metadata.artist?.toLowerCase() || "";
      const album = item.track.metadata.album?.toLowerCase() || "";
      return title.includes(q) || artist.includes(q) || album.includes(q);
    });
  }, [enrichedHistory, searchQuery]);

  // Total listening duration represented in history
  const totalDurationSecs = useMemo(() => {
    return enrichedHistory.reduce((acc, item) => {
      return acc + (item.track?.metadata.duration?.secs || 0);
    }, 0);
  }, [enrichedHistory]);

  // Unique tracks count
  const uniqueTracksCount = useMemo(() => {
    const set = new Set<string>();
    for (const item of enrichedHistory) {
      set.add(item.trackId);
    }
    return set.size;
  }, [enrichedHistory]);

  // Group filtered history into time buckets
  const groupedHistory = useMemo(() => {
    const groups: { title: TimeGroup; items: EnrichedHistoryItem[] }[] = [
      { title: "Today", items: [] },
      { title: "Yesterday", items: [] },
      { title: "Earlier This Week", items: [] },
      { title: "Earlier This Month", items: [] },
      { title: "Older", items: [] },
    ];

    for (const item of filteredHistory) {
      const bucket = getTimeGroup(item.playedAt);
      const target = groups.find((g) => g.title === bucket);
      if (target) {
        target.items.push(item);
      }
    }

    // Only return groups that contain at least one item
    return groups.filter((g) => g.items.length > 0);
  }, [filteredHistory]);

  // Valid tracks available for playback in current view
  const validTracks = useMemo(() => {
    return filteredHistory
      .map((item) => item.track)
      .filter((t): t is Track => Boolean(t));
  }, [filteredHistory]);

  // Play a specific track in the history context
  const handlePlayTrack = useCallback(
    (track: Track) => {
      const targetIdx = validTracks.findIndex((t) => t.id === track.id);
      const idx = targetIdx >= 0 ? targetIdx : 0;
      setQueue(validTracks, idx, {
        type: "tracks",
        name: "Listening History",
      });
    },
    [validTracks, setQueue]
  );

  // Play all history tracks
  const handlePlayAll = useCallback(() => {
    if (validTracks.length === 0) return;
    setQueue(validTracks, 0, {
      type: "tracks",
      name: "Listening History",
    });
  }, [validTracks, setQueue]);

  // Shuffle all history tracks
  const handleShuffleAll = useCallback(async () => {
    if (validTracks.length === 0) return;
    const shuffled = [...validTracks].sort(() => Math.random() - 0.5);
    await setQueue(shuffled, 0, {
      type: "tracks",
      name: "Listening History (Shuffled)",
    });
    if (!usePlayerStore.getState().isShuffle) {
      toggleShuffle();
    }
  }, [validTracks, toggleShuffle, setQueue]);

  // Handle clear history confirmation
  const handleConfirmClear = useCallback(() => {
    clearPlayHistory();
    setShowClearConfirm(false);
  }, [clearPlayHistory]);

  // Empty State
  if (playHistory.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-background select-none">
        <div className="w-24 h-24 rounded-3xl bg-surfaceActive border border-white/[0.08] flex items-center justify-center mb-6 shadow-xl relative group">
          <History className="w-10 h-10 text-accent relative z-10" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2 tracking-tight">
          No Listening History Yet
        </h2>
        <p className="text-xs text-textSecondary max-w-md leading-relaxed mb-8">
          Songs you play will appear here along with playback timestamps. Relive your favorite listening sessions and rediscover music you loved.
        </p>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => onNavigate("home")}
            className="px-5 py-3 bg-accent hover:opacity-90 text-white font-semibold text-xs rounded-xl shadow-lg shadow-black/20 transition active:scale-95"
          >
            Explore Home
          </button>
          <button
            onClick={() => onNavigate("tracks")}
            className="px-5 py-3 bg-white/[0.06] hover:bg-white/[0.12] text-white font-semibold text-xs rounded-xl border border-white/[0.08] transition active:scale-95"
          >
            Browse Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Hero Header */}
      <div className="p-4 sm:p-8 pb-6 flex flex-col sm:flex-row items-center sm:items-end gap-4 sm:gap-6 text-center sm:text-left bg-gradient-to-b from-accent/[0.10] via-surface/[0.03] to-transparent border-b border-white/[0.06] flex-shrink-0">
        {/* Large History Art Glyph */}
        <div className="w-24 h-24 sm:w-36 sm:h-36 rounded-2xl bg-gradient-to-br from-surfaceActive via-surface to-surfaceActive flex items-center justify-center shadow-xl border border-white/[0.08] ring-1 ring-white/10 ring-inset flex-shrink-0 relative overflow-hidden group hover:brightness-105 transition-all">
          <History className="w-10 h-10 sm:w-16 sm:h-16 text-accent relative z-10 drop-shadow-sm" />
        </div>

        {/* Info & Action Controls */}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight truncate mb-2">
            Listening History
          </h1>

          <p className="text-xs text-textSecondary font-medium flex items-center justify-center sm:justify-start flex-wrap gap-2 mb-4">
            <span className="text-white font-semibold">{playHistory.length} plays</span>
            <span>•</span>
            <span>{uniqueTracksCount} unique tracks</span>
            {totalDurationSecs > 0 && (
              <>
                <span>•</span>
                <span>{formatTotalDuration(totalDurationSecs)}</span>
              </>
            )}
          </p>

          {/* Action Button Strip */}
          <div className="flex items-center justify-center sm:justify-start gap-3 flex-wrap">
            {/* Play All */}
            <button
              onClick={handlePlayAll}
              disabled={validTracks.length === 0}
              className="px-5 py-2 rounded-xl bg-accent-fill hover:bg-accentHover disabled:opacity-40 text-white font-bold text-xs flex items-center space-x-2 transition-all shadow-lg shadow-accent/20 active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play All</span>
            </button>

            {/* Shuffle */}
            <button
              onClick={handleShuffleAll}
              disabled={validTracks.length === 0}
              className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40 text-white font-semibold text-xs flex items-center space-x-2 border border-white/[0.08] transition active:scale-95"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>Shuffle</span>
            </button>

            {/* Filter Search Input */}
            <div className="relative w-full sm:w-52">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-textMuted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter history..."
                className="w-full pl-8 pr-8 py-2 bg-white/[0.04] border border-white/[0.08] focus:border-accent/50 focus:bg-white/[0.08] rounded-lg text-xs text-white placeholder-textMuted outline-none transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2 text-textMuted hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Clear History Button */}
            <div className="sm:ml-auto">
              <button
                onClick={() => setShowClearConfirm(true)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-textSecondary hover:text-danger hover:bg-danger/10 border border-transparent hover:border-danger/20 transition flex items-center space-x-2"
                title="Clear all listening history"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Clear History */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4">
          <div className="bg-surface border border-white/[0.12] rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-danger">
              <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0" />
              <h3 className="font-bold text-base text-white">Clear Listening History?</h3>
            </div>
            <p className="text-xs text-textSecondary leading-relaxed">
              This will permanently delete your entire listening history ({playHistory.length} recorded plays). This action cannot be undone.
            </p>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClear}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-danger hover:bg-danger shadow-md shadow-danger/30 transition"
              >
                Clear History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Grouped Track List */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-6 pb-32 sm:pb-4">
        {groupedHistory.length === 0 ? (
          <div className="py-16 text-center text-xs text-textMuted">
            No matching tracks found in history for "{searchQuery}".
          </div>
        ) : (
          groupedHistory.map((group) => (
            <div key={group.title} className="space-y-1">
              {/* Group Sticky Header */}
              <div className="flex items-center justify-between py-2 px-3 border-b border-white/[0.06] mb-2 sticky top-0 bg-background/95 backdrop-blur-md z-10">
                <h3 className="text-xs font-semibold text-textSecondary">
                  {group.title}
                </h3>
              </div>

              {/* Items in this group */}
              <div className="space-y-1">
                {group.items.map((item, idx) => (
                  <HistoryRow
                    key={`${item.entry.trackId}-${item.entry.playedAt}-${idx}`}
                    item={item}
                    index={idx}
                    isPlayingThisTrack={currentTrackId === item.entry.trackId && isPlaying}
                    onPlay={handlePlayTrack}
                    onSelectArtist={onSelectArtist}
                    onSelectAlbum={onSelectAlbum}
                    onRemove={removePlayHistoryItem}
                    getArtworkUrl={getArtworkUrl}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

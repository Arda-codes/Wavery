import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { Track } from "../types";
import { usePlayerStore } from "../stores/playerStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { useArtwork } from "../utils/useArtwork";
import { getFullTrackArtistString, formatDuration } from "../utils/library";
import { parseLrc, getActiveLyricIndex, hasLrcTimestamps } from "../utils/lyrics";
import { ArtistLinks } from "./ArtistLinks";
import { windowService } from "../services/windowService";
import {
  X,
  Music,
  ListMusic,
  Disc,
  User,
  Trash2,
  Play,
  Pause,
  Mic2,
  Maximize2,
  Heart,
  Library,
  Users,
  ChevronRight,
  CornerDownRight,
  Copy,
  FilePenLine,
  Infinity as InfinityIcon,
  GripVertical,
  History,
  ArrowUp,
  ListPlus,
  Search,
  Loader2,
} from "lucide-react";
import { SongMetadataModal } from "./SongMetadataModal";
import { fetchLyrics } from "../services/lyrics";
import { playerAdapter } from "../services/adapter";

// ---------------------------------------------------------------------------
// Section 1: User Priority Queue Row (with Drag Handle & Instant Removal)
// ---------------------------------------------------------------------------

interface UserQueueRowProps {
  track: Track;
  index: number;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPlay: () => void;
  onRemove: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const UserQueueRowInner: React.FC<UserQueueRowProps> = ({
  track,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onPlay,
  onRemove,
  onContextMenu,
}) => {
  const artworkUrl = useArtwork(track.id);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onClick={onPlay}
      onContextMenu={onContextMenu}
      className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer select-none transition-[background-color,border-color,opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.99] ${
        isDragging
          ? "opacity-30 bg-white/[0.04] scale-[0.98]"
          : isDragOver
          ? "bg-accent/15 border-t-2 border-accent"
          : "hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06]"
      }`}
    >
      <div className="flex items-center space-x-3 min-w-0 pr-2">
        {/* Drag Reorder Handle */}
        <div
          className="text-textMuted group-hover:text-white/80 cursor-grab active:cursor-grabbing p-1 -ml-1 transition-colors flex-shrink-0"
          title="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        {/* Artwork Thumbnail with Refined Hover Play Overlay */}
        <div className="w-8 h-8 rounded-lg bg-surfaceHover flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm relative border border-white/[0.06]">
          {artworkUrl && !imgError ? (
            <img
              src={artworkUrl}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <Music className="w-3.5 h-3.5 text-textMuted" />
          )}

          {/* Frosted Play Overlay */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-150">
            <div className="w-5 h-5 rounded-full bg-white/20 hover:bg-accent-fill text-white flex items-center justify-center shadow-sm transition-[background-color,transform] duration-150 active:scale-90">
              <Play className="w-2.5 h-2.5 fill-current" />
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold text-white truncate group-hover:text-accent transition-colors">
            {track.metadata.title || "Untitled"}
          </p>
          <p className="text-2xs text-textSecondary truncate">
            {track.metadata.artist || "Unknown Artist"}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 flex-shrink-0">
        <span className="text-2xs text-textMuted font-mono tabular-nums">
          {formatDuration(track.metadata.duration?.secs || 0)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-md hover:bg-white/[0.08] text-textMuted hover:text-danger flex items-center justify-center transition-[background-color,color,opacity] duration-150"
          title="Remove from queue"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
const UserQueueRow = React.memo(UserQueueRowInner);

// ---------------------------------------------------------------------------
// Section 2: Context Queue Row (Shows Upcoming Tracks from Context)
// ---------------------------------------------------------------------------

interface ContextQueueRowProps {
  track: Track;
  orderNumber: number;
  onPlay: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const ContextQueueRowInner: React.FC<ContextQueueRowProps> = ({
  track,
  orderNumber,
  onPlay,
  onContextMenu,
}) => {
  const artworkUrl = useArtwork(track.id);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="group flex items-center justify-between p-2 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.99] cursor-pointer select-none"
      onClick={onPlay}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center space-x-3 min-w-0 pr-2">
        {/* Track Sequence Index */}
        <span className="w-4 text-center text-2xs font-mono text-textMuted group-hover:text-white/60 flex-shrink-0">
          {orderNumber}
        </span>

        {/* Artwork Thumbnail with Hover Play Overlay */}
        <div className="w-8 h-8 rounded-lg bg-surfaceHover flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm relative border border-white/[0.06]">
          {artworkUrl && !imgError ? (
            <img
              src={artworkUrl}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <Music className="w-3.5 h-3.5 text-textMuted" />
          )}

          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-150">
            <div className="w-5 h-5 rounded-full bg-white/20 hover:bg-accent-fill text-white flex items-center justify-center shadow-sm transition-[background-color,transform] duration-150 active:scale-90">
              <Play className="w-2.5 h-2.5 fill-current" />
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold text-white truncate group-hover:text-accent transition-colors">
            {track.metadata.title || "Untitled"}
          </p>
          <p className="text-2xs text-textSecondary truncate">
            {track.metadata.artist || "Unknown Artist"}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 flex-shrink-0">
        <span className="text-2xs text-textMuted font-mono tabular-nums">
          {formatDuration(track.metadata.duration?.secs || 0)}
        </span>
      </div>
    </div>
  );
};
const ContextQueueRow = React.memo(ContextQueueRowInner);

// ---------------------------------------------------------------------------
// Section 3: History Row (Recently Played)
// ---------------------------------------------------------------------------

interface HistoryRowProps {
  track: Track;
  onPlay: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const HistoryRowInner: React.FC<HistoryRowProps> = ({
  track,
  onPlay,
  onContextMenu,
}) => {
  const artworkUrl = useArtwork(track.id);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="group flex items-center justify-between p-2 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.99] cursor-pointer select-none"
      onClick={onPlay}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center space-x-3 min-w-0 pr-2">
        <div className="w-7 h-7 rounded-lg bg-surfaceHover flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm relative border border-white/[0.06]">
          {artworkUrl && !imgError ? (
            <img
              src={artworkUrl}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]"
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <Music className="w-3 h-3 text-textMuted" />
          )}

          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-150">
            <Play className="w-2.5 h-2.5 text-white fill-current" />
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-2xs font-semibold text-white/90 truncate group-hover:text-accent transition-colors">
            {track.metadata.title || "Untitled"}
          </p>
          <p className="text-2xs text-textSecondary truncate">
            {track.metadata.artist || "Unknown Artist"}
          </p>
        </div>
      </div>

      <span className="text-2xs text-textMuted font-mono tabular-nums flex-shrink-0">
        {formatDuration(track.metadata.duration?.secs || 0)}
      </span>
    </div>
  );
};
const HistoryRow = React.memo(HistoryRowInner);

// ---------------------------------------------------------------------------
// Main Now Playing Drawer Component
// ---------------------------------------------------------------------------

export const NowPlayingDrawer: React.FC = () => {
  const isDrawerOpen = useNavigationStore((s) => s.isNowPlayingDrawerOpen);
  const toggleDrawer = useNavigationStore((s) => s.toggleNowPlayingDrawer);
  const activeTab = useNavigationStore((s) => s.nowPlayingTab);
  const setTab = useNavigationStore((s) => s.setNowPlayingTab);
  const openFullscreen = useNavigationStore((s) => s.toggleFullscreenNowPlaying);
  const selectArtist = useNavigationStore((s) => s.selectArtist);
  const selectAlbum = useNavigationStore((s) => s.selectAlbum);
  const selectPlaylist = useNavigationStore((s) => s.selectPlaylist);
  const navigate = useNavigationStore((s) => s.navigate);
  const showLyricsSmoothScroll = useSettingsStore((s) => s.showLyricsSmoothScroll);

  // Player Store State & Actions
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const userQueue = usePlayerStore((s) => s.userQueue);
  const contextQueue = usePlayerStore((s) => s.contextQueue);
  const contextIndex = usePlayerStore((s) => s.contextIndex);
  const sessionHistory = usePlayerStore((s) => s.sessionHistory);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const shuffleIndices = usePlayerStore((s) => s.shuffleIndices);
  const shufflePos = usePlayerStore((s) => s.shufflePos);
  const isAutoplay = usePlayerStore((s) => s.isAutoplay);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const positionSecs = usePlayerStore((s) => s.status.position_secs || 0);
  const seek = usePlayerStore((s) => s.seek);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);

  // Two-Tier Specific Queue Actions
  const playNextInUserQueue = usePlayerStore((s) => s.playNextInUserQueue);
  const addToUserQueue = usePlayerStore((s) => s.addToUserQueue);
  const removeFromUserQueue = usePlayerStore((s) => s.removeFromUserQueue);
  const reorderUserQueue = usePlayerStore((s) => s.reorderUserQueue);
  const clearUserQueue = usePlayerStore((s) => s.clearUserQueue);
  const jumpToUserQueueItem = usePlayerStore((s) => s.jumpToUserQueueItem);
  const jumpToContextTrack = usePlayerStore((s) => s.jumpToContextTrack);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const playlists = useLibraryStore((s) => s.playlists);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);
  const likedTrackIds = useLibraryStore((s) => s.likedTrackIds);
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const artworkUrl = useArtwork(currentTrack?.id);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Animation & Transition Lifecycle State (Apple HIG fluid interruptibility)
  const [isRendered, setIsRendered] = useState(isDrawerOpen);
  const [isOpenAnimation, setIsOpenAnimation] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isDrawerOpen) {
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
      setIsRendered(true);
      setIsExiting(false);
      const frameId = requestAnimationFrame(() => {
        setIsOpenAnimation(true);
      });
      return () => cancelAnimationFrame(frameId);
    } else if (isRendered) {
      setIsOpenAnimation(false);
      setIsExiting(true);
      exitTimeoutRef.current = setTimeout(() => {
        setIsRendered(false);
        setIsExiting(false);
        exitTimeoutRef.current = null;
      }, 240);
    }

    return () => {
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
      }
    };
  }, [isDrawerOpen, isRendered]);

  // Direct manipulation: touch swipe-to-dismiss gesture tracking
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
      touchStartYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current !== null && touchStartYRef.current !== null) {
      const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
      const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartYRef.current);
      if (deltaX > 48 && deltaX > deltaY) {
        toggleDrawer();
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };
  const [trackToEdit, setTrackToEdit] = useState<Track | null>(null);

  // Drag and drop state for user queue reordering
  const [draggedUserQueueIdx, setDraggedUserQueueIdx] = useState<number | null>(null);
  const [dragOverUserQueueIdx, setDragOverUserQueueIdx] = useState<number | null>(null);

  // Accordion state for Recently Played history
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  // Compute upcoming tracks from active context, taking shuffle into account
  const upcomingContextTracks = useMemo(() => {
    const effectiveContext = contextQueue.length > 0 ? contextQueue : queue;
    const effectiveIndex = contextIndex >= 0 ? contextIndex : queueIndex;

    if (isShuffle && shuffleIndices.length > 0) {
      const userIds = new Set(userQueue.map((t) => t.id));
      const sourceQueue = queue.length === shuffleIndices.length ? queue : effectiveContext;
      const remainingIndices = shuffleIndices.slice(shufflePos + 1);
      return remainingIndices
        .map((idx) => {
          const track = sourceQueue[idx];
          if (!track || userIds.has(track.id)) return null;
          const cIdx = effectiveContext.findIndex((t) => t.id === track.id);
          return {
            track,
            targetContextIndex: cIdx !== -1 ? cIdx : idx,
          };
        })
        .filter((item): item is { track: Track; targetContextIndex: number } => item !== null);
    }

    if (effectiveIndex < 0) {
      return effectiveContext.map((track, offset) => ({
        track,
        targetContextIndex: offset,
      }));
    }

    return effectiveContext
      .slice(effectiveIndex + 1)
      .map((track, offset) => ({
        track,
        targetContextIndex: effectiveIndex + 1 + offset,
      }));
  }, [contextQueue, queue, contextIndex, queueIndex, isShuffle, shuffleIndices, shufflePos]);

  // Reversed recent history for display (most recent first, up to 20 tracks)
  const displayHistory = useMemo(() => {
    return [...sessionHistory].reverse().slice(0, 20);
  }, [sessionHistory]);

  // Parse real lyrics only (no placeholder fallback)
  const lyrics = useMemo(() => {
    if (!currentTrack) return [];
    let rawLyrics = currentTrack.metadata?.lyrics;
    if (!rawLyrics || !rawLyrics.trim()) {
      const libraryTrack = useLibraryStore.getState().tracks.find((t) => t.id === currentTrack.id);
      if (libraryTrack?.metadata?.lyrics) {
        rawLyrics = libraryTrack.metadata.lyrics;
      }
    }
    if (rawLyrics && rawLyrics.trim()) {
      return parseLrc(rawLyrics);
    }
    return [];
  }, [currentTrack]);

  const activeLyricIndex = useMemo(() => {
    return getActiveLyricIndex(lyrics, positionSecs);
  }, [lyrics, positionSecs]);

  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [lyricsFetchError, setLyricsFetchError] = useState<string | null>(null);

  const isSyncedLyrics = useMemo(
    () => hasLrcTimestamps(currentTrack?.metadata.lyrics),
    [currentTrack?.metadata.lyrics]
  );

  const handleFetchLyricsOnline = async (forceRefresh: boolean = false) => {
    if (!currentTrack) return;
    setIsFetchingLyrics(true);
    setLyricsFetchError(null);
    try {
      const res = await fetchLyrics(
        currentTrack.metadata.artist || "",
        currentTrack.metadata.title || "",
        currentTrack.metadata.album,
        currentTrack.metadata.duration.secs,
        forceRefresh
      );
      if (res?.bestLyrics) {
        const updated = await playerAdapter.updateTrackMetadata({
          track_id: currentTrack.id,
          lyrics: res.bestLyrics,
          write_tags: false,
        });
        const allTracks = useLibraryStore.getState().tracks;
        useLibraryStore.setState({
          tracks: allTracks.map((t) => (t.id === updated.id ? updated : t)),
        });
        usePlayerStore.setState({ currentTrack: updated });
      } else {
        setLyricsFetchError("No lyrics found on LRCLIB");
      }
    } catch {
      setLyricsFetchError("Failed to query LRCLIB");
    } finally {
      setIsFetchingLyrics(false);
    }
  };

  // Apple Music-style lyrics browsing: manual scroll lifts optical depth-of-field blur;
  // re-focusing (clicking a line or idle timeout) brings blur back and centers active lyric.
  const [isLyricsBrowsing, setIsLyricsBrowsing] = useState(false);
  const isPointerDownRef = useRef(false);
  const browsingTimeoutRef = useRef<number | null>(null);

  const scrollActiveLyric = useCallback(() => {
    const container = lyricsContainerRef.current;
    if (!container || activeLyricIndex < 0) return;
    const activeEl = container.children[activeLyricIndex] as HTMLElement;
    if (activeEl) {
      const targetScroll =
        activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
      // If already within 4px of target scroll, don't trigger unnecessary scroll animations
      if (Math.abs(container.scrollTop - targetScroll) < 4) return;
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: showLyricsSmoothScroll ? "smooth" : "auto",
      });
    }
  }, [activeLyricIndex, showLyricsSmoothScroll]);

  const handleUserScroll = useCallback(() => {
    setIsLyricsBrowsing(true);

    if (browsingTimeoutRef.current !== null) {
      window.clearTimeout(browsingTimeoutRef.current);
    }
    browsingTimeoutRef.current = window.setTimeout(() => {
      setIsLyricsBrowsing(false);
      browsingTimeoutRef.current = null;
    }, 3500);
  }, []);

  const handleLyricsPointerDown = useCallback(() => {
    isPointerDownRef.current = true;
  }, []);

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      isPointerDownRef.current = false;
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, []);

  const handleContainerScroll = useCallback(() => {
    // Only user pointer drags (e.g. dragging the scrollbar thumb) count as user scrolling.
    if (isPointerDownRef.current) {
      handleUserScroll();
    }
  }, [handleUserScroll]);

  const handleFocusLyrics = useCallback(() => {
    if (browsingTimeoutRef.current !== null) {
      window.clearTimeout(browsingTimeoutRef.current);
      browsingTimeoutRef.current = null;
    }
    setIsLyricsBrowsing(false);
    scrollActiveLyric();
  }, [scrollActiveLyric]);

  // Reset browsing state on unmount or track change
  useEffect(() => {
    setIsLyricsBrowsing(false);
    if (browsingTimeoutRef.current !== null) {
      window.clearTimeout(browsingTimeoutRef.current);
      browsingTimeoutRef.current = null;
    }
  }, [currentTrack?.id]);

  // Auto-scroll lyrics container in drawer, re-centering on window state change
  useEffect(() => {
    if (!isRendered || isExiting || activeTab !== "lyrics" || activeLyricIndex < 0 || !lyricsContainerRef.current) return;
    if (isLyricsBrowsing) return;

    scrollActiveLyric();
    return windowService.onWindowStateChange(scrollActiveLyric);
  }, [activeLyricIndex, isRendered, isExiting, activeTab, isLyricsBrowsing, scrollActiveLyric]);

  if (!isRendered) return null;

  const handleContextClick = () => {
    if (!playbackContext) return;
    switch (playbackContext.type) {
      case "album":
        selectAlbum(playbackContext.name, playbackContext.artist || "");
        break;
      case "playlist":
        if (playbackContext.id) {
          selectPlaylist(playbackContext.id);
        } else {
          navigate("playlists");
        }
        break;
      case "liked":
        navigate("liked");
        break;
      case "artist":
        selectArtist(playbackContext.name);
        break;
      case "tracks":
      default:
        navigate("tracks");
        break;
    }
  };

  const ContextIcon = () => {
    if (!playbackContext) return <Disc className="w-4 h-4 text-accent flex-shrink-0" />;
    switch (playbackContext.type) {
      case "album":
        return <Disc className="w-4 h-4 text-accent flex-shrink-0" />;
      case "playlist":
        return <ListMusic className="w-4 h-4 text-accent flex-shrink-0" />;
      case "liked":
        return <Heart className="w-4 h-4 text-accent flex-shrink-0" />;
      case "artist":
        return <Users className="w-4 h-4 text-accent flex-shrink-0" />;
      case "tracks":
      default:
        return <Library className="w-4 h-4 text-accent flex-shrink-0" />;
    }
  };

  const handleCurrentTrackContextMenu = (e: React.MouseEvent) => {
    if (!currentTrack) return;
    e.preventDefault();
    e.stopPropagation();

    const isLiked = likedTrackIds.has(currentTrack.id);
    const artistName = getFullTrackArtistString(currentTrack);

    const playlistSubmenu: ContextMenuItem[] = playlists.map((pl) => ({
      id: `current-pl-${pl.id}`,
      label: pl.name,
      icon: ListMusic,
      onClick: () => addTracksToPlaylist(pl.id, [currentTrack.id]),
    }));

    const menuItems: ContextMenuItem[] = [
      {
        id: "play-pause-current",
        label: isPlaying ? "Pause Track" : "Resume Track",
        icon: isPlaying ? Pause : Play,
        onClick: () => (isPlaying ? pause() : resume()),
      },
      {
        id: "divider-1",
        label: "",
        divider: true,
      },
      {
        id: "toggle-like-current",
        label: isLiked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: Heart,
        onClick: () => toggleLike(currentTrack.id),
      },
    ];

    if (playlistSubmenu.length > 0) {
      menuItems.push({
        id: "add-to-playlist-current",
        label: "Add to Playlist",
        icon: ListMusic,
        items: playlistSubmenu,
      });
    }

    if (currentTrack.metadata.artist) {
      menuItems.push(
        {
          id: "divider-nav",
          label: "",
          divider: true,
        },
        {
          id: "go-artist-current",
          label: `Go to Artist (${artistName})`,
          icon: User,
          onClick: () => selectArtist(currentTrack.metadata.artist || ""),
        }
      );
    }

    if (currentTrack.metadata.album) {
      menuItems.push({
        id: "go-album-current",
        label: `Go to Album (${currentTrack.metadata.album})`,
        icon: Disc,
        onClick: () =>
          selectAlbum(
            currentTrack.metadata.album || "",
            currentTrack.metadata.artist || ""
          ),
      });
    }

    menuItems.push(
      {
        id: "divider-lyrics",
        label: "",
        divider: true,
      },
      {
        id: "open-fullscreen",
        label: "Fullscreen Live Lyrics",
        icon: Maximize2,
        onClick: openFullscreen,
      },
      {
        id: "copy-info-current",
        label: "Copy Title & Artist",
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(
            `${currentTrack.metadata.title || "Untitled"} - ${artistName}`
          );
        },
      },
      {
        id: "divider-edit-meta-current",
        label: "",
        divider: true,
      },
      {
        id: "edit-metadata-current",
        label: "Edit Song Metadata...",
        icon: FilePenLine,
        onClick: () => setTrackToEdit(currentTrack),
      }
    );

    openContextMenu(e, menuItems);
  };

  // Context menu for items in the user queue
  const handleUserQueueItemContextMenu = (
    e: React.MouseEvent,
    itemTrack: Track,
    idx: number
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const isLiked = likedTrackIds.has(itemTrack.id);
    const artistName = getFullTrackArtistString(itemTrack);

    const playlistSubmenu: ContextMenuItem[] = playlists.map((pl) => ({
      id: `user-queue-pl-${pl.id}`,
      label: pl.name,
      icon: ListMusic,
      onClick: () => addTracksToPlaylist(pl.id, [itemTrack.id]),
    }));

    const menuItems: ContextMenuItem[] = [
      {
        id: "jump-to-user-item",
        label: "Play Now",
        icon: Play,
        onClick: () => jumpToUserQueueItem(idx),
      },
      ...(idx > 0
        ? [
            {
              id: "move-user-item-top",
              label: "Move to Top",
              icon: ArrowUp,
              onClick: () => reorderUserQueue(idx, 0),
            },
          ]
        : []),
      {
        id: "remove-from-user-queue",
        label: "Remove from Queue",
        icon: Trash2,
        danger: true,
        onClick: () => removeFromUserQueue(idx),
      },
      {
        id: "divider-1",
        label: "",
        divider: true,
      },
      {
        id: "toggle-like-user-item",
        label: isLiked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: Heart,
        onClick: () => toggleLike(itemTrack.id),
      },
    ];

    if (playlistSubmenu.length > 0) {
      menuItems.push({
        id: "add-to-playlist-user-item",
        label: "Add to Playlist",
        icon: ListMusic,
        items: playlistSubmenu,
      });
    }

    if (itemTrack.metadata.artist) {
      menuItems.push(
        {
          id: "divider-nav",
          label: "",
          divider: true,
        },
        {
          id: "go-artist-user-item",
          label: `Go to Artist (${artistName})`,
          icon: User,
          onClick: () => selectArtist(itemTrack.metadata.artist || ""),
        }
      );
    }

    if (itemTrack.metadata.album) {
      menuItems.push({
        id: "go-album-user-item",
        label: `Go to Album (${itemTrack.metadata.album})`,
        icon: Disc,
        onClick: () =>
          selectAlbum(
            itemTrack.metadata.album || "",
            itemTrack.metadata.artist || ""
          ),
      });
    }

    menuItems.push(
      {
        id: "divider-copy",
        label: "",
        divider: true,
      },
      {
        id: "copy-user-item-info",
        label: "Copy Title & Artist",
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(
            `${itemTrack.metadata.title || "Untitled"} - ${artistName}`
          );
        },
      },
      {
        id: "divider-edit-meta-user",
        label: "",
        divider: true,
      },
      {
        id: "edit-metadata-user",
        label: "Edit Song Metadata...",
        icon: FilePenLine,
        onClick: () => setTrackToEdit(itemTrack),
      }
    );

    openContextMenu(e, menuItems);
  };

  // Context menu for items in the context queue
  const handleContextItemContextMenu = (
    e: React.MouseEvent,
    itemTrack: Track,
    targetContextIdx: number
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const isLiked = likedTrackIds.has(itemTrack.id);
    const artistName = getFullTrackArtistString(itemTrack);

    const playlistSubmenu: ContextMenuItem[] = playlists.map((pl) => ({
      id: `context-item-pl-${pl.id}`,
      label: pl.name,
      icon: ListMusic,
      onClick: () => addTracksToPlaylist(pl.id, [itemTrack.id]),
    }));

    const menuItems: ContextMenuItem[] = [
      {
        id: "jump-to-context-item",
        label: "Play Now",
        icon: Play,
        onClick: () => jumpToContextTrack(targetContextIdx),
      },
      {
        id: "play-next-context-item",
        label: "Play Next",
        icon: CornerDownRight,
        onClick: () => playNextInUserQueue(itemTrack),
      },
      {
        id: "add-to-queue-context-item",
        label: "Add to Queue",
        icon: ListPlus,
        onClick: () => addToUserQueue(itemTrack),
      },
      {
        id: "divider-1",
        label: "",
        divider: true,
      },
      {
        id: "toggle-like-context-item",
        label: isLiked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: Heart,
        onClick: () => toggleLike(itemTrack.id),
      },
    ];

    if (playlistSubmenu.length > 0) {
      menuItems.push({
        id: "add-to-playlist-context-item",
        label: "Add to Playlist",
        icon: ListMusic,
        items: playlistSubmenu,
      });
    }

    if (itemTrack.metadata.artist) {
      menuItems.push(
        {
          id: "divider-nav",
          label: "",
          divider: true,
        },
        {
          id: "go-artist-context-item",
          label: `Go to Artist (${artistName})`,
          icon: User,
          onClick: () => selectArtist(itemTrack.metadata.artist || ""),
        }
      );
    }

    if (itemTrack.metadata.album) {
      menuItems.push({
        id: "go-album-context-item",
        label: `Go to Album (${itemTrack.metadata.album})`,
        icon: Disc,
        onClick: () =>
          selectAlbum(
            itemTrack.metadata.album || "",
            itemTrack.metadata.artist || ""
          ),
      });
    }

    menuItems.push(
      {
        id: "divider-copy",
        label: "",
        divider: true,
      },
      {
        id: "copy-context-item-info",
        label: "Copy Title & Artist",
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(
            `${itemTrack.metadata.title || "Untitled"} - ${artistName}`
          );
        },
      },
      {
        id: "divider-edit-meta-context",
        label: "",
        divider: true,
      },
      {
        id: "edit-metadata-context",
        label: "Edit Song Metadata...",
        icon: FilePenLine,
        onClick: () => setTrackToEdit(itemTrack),
      }
    );

    openContextMenu(e, menuItems);
  };

  // Context menu for items in the history section
  const handleHistoryItemContextMenu = (
    e: React.MouseEvent,
    itemTrack: Track
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const isLiked = likedTrackIds.has(itemTrack.id);
    const artistName = getFullTrackArtistString(itemTrack);

    const playlistSubmenu: ContextMenuItem[] = playlists.map((pl) => ({
      id: `history-item-pl-${pl.id}`,
      label: pl.name,
      icon: ListMusic,
      onClick: () => addTracksToPlaylist(pl.id, [itemTrack.id]),
    }));

    const menuItems: ContextMenuItem[] = [
      {
        id: "replay-history-item",
        label: "Play Now",
        icon: Play,
        onClick: () => playTrack(itemTrack),
      },
      {
        id: "play-next-history-item",
        label: "Play Next",
        icon: CornerDownRight,
        onClick: () => playNextInUserQueue(itemTrack),
      },
      {
        id: "add-to-queue-history-item",
        label: "Add to Queue",
        icon: ListPlus,
        onClick: () => addToUserQueue(itemTrack),
      },
      {
        id: "divider-1",
        label: "",
        divider: true,
      },
      {
        id: "toggle-like-history-item",
        label: isLiked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: Heart,
        onClick: () => toggleLike(itemTrack.id),
      },
    ];

    if (playlistSubmenu.length > 0) {
      menuItems.push({
        id: "add-to-playlist-history-item",
        label: "Add to Playlist",
        icon: ListMusic,
        items: playlistSubmenu,
      });
    }

    if (itemTrack.metadata.artist) {
      menuItems.push(
        {
          id: "divider-nav",
          label: "",
          divider: true,
        },
        {
          id: "go-artist-history-item",
          label: `Go to Artist (${artistName})`,
          icon: User,
          onClick: () => selectArtist(itemTrack.metadata.artist || ""),
        }
      );
    }

    if (itemTrack.metadata.album) {
      menuItems.push({
        id: "go-album-history-item",
        label: `Go to Album (${itemTrack.metadata.album})`,
        icon: Disc,
        onClick: () =>
          selectAlbum(
            itemTrack.metadata.album || "",
            itemTrack.metadata.artist || ""
          ),
      });
    }

    menuItems.push(
      {
        id: "divider-copy",
        label: "",
        divider: true,
      },
      {
        id: "copy-history-item-info",
        label: "Copy Title & Artist",
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(
            `${itemTrack.metadata.title || "Untitled"} - ${artistName}`
          );
        },
      },
      {
        id: "divider-edit-meta-hist",
        label: "",
        divider: true,
      },
      {
        id: "edit-metadata-hist",
        label: "Edit Song Metadata...",
        icon: FilePenLine,
        onClick: () => setTrackToEdit(itemTrack),
      }
    );

    openContextMenu(e, menuItems);
  };

  return (
    <>
      {/* Mobile-only backdrop (< sm) */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 sm:hidden ${
          isExiting ? "animate-backdrop-out" : "animate-backdrop-in"
        }`}
        onClick={() => toggleDrawer()}
        aria-hidden="true"
      />

      {/* Docked Right Sidebar Shell (sm+) with fluid width transition, overlay on mobile */}
      <div
        className={`fixed sm:relative inset-y-0 right-0 z-50 sm:z-20 h-full flex-shrink-0 overflow-hidden pointer-events-auto transition-[width] duration-240 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          isOpenAnimation && !isExiting ? "w-full sm:w-80 lg:w-96" : "w-0 sm:w-0"
        }`}
      >
        <aside
          aria-label="Now Playing and Queue"
          className={`h-full w-full sm:w-80 lg:w-96 max-w-[100vw] bg-surface border-l border-white/[0.08] flex flex-col justify-between select-none flex-shrink-0 shadow-2xl will-change-transform ${
            isExiting ? "animate-drawer-out-right" : "animate-drawer-in-right"
          }`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
        {/* Drawer Header & Tab Selector */}
        <div className="px-5 py-4 safe-drawer-header border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
          <div
            role="tablist"
            aria-label="Now Playing View"
            className="relative inline-flex items-center p-1 bg-white/[0.06] rounded-xl border border-white/[0.06] select-none"
          >
            {/* Sliding Active Pill Indicator */}
            <div
              aria-hidden="true"
              className="absolute top-1 bottom-1 w-24 rounded-lg bg-accent-fill shadow-sm pointer-events-none will-change-transform transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
              style={{
                left: 4,
                transform: activeTab === "queue" ? "translate3d(0, 0, 0)" : "translate3d(100%, 0, 0)",
              }}
            />

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "queue"}
              aria-controls="drawer-queue-tab"
              onClick={() => setTab("queue")}
              className={`relative z-10 w-24 flex items-center justify-center space-x-2 py-1 rounded-lg text-xs font-bold transition-[color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                activeTab === "queue"
                  ? "text-white"
                  : "text-textSecondary hover:text-white"
              }`}
            >
              <ListMusic className={`w-3.5 h-3.5 transition-colors duration-150 ${activeTab === "queue" ? "text-white" : "text-textMuted"}`} />
              <span>Queue</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "lyrics"}
              aria-controls="drawer-lyrics-tab"
              onClick={() => setTab("lyrics")}
              className={`relative z-10 w-24 flex items-center justify-center space-x-2 py-1 rounded-lg text-xs font-bold transition-[color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                activeTab === "lyrics"
                  ? "text-white"
                  : "text-textSecondary hover:text-white"
              }`}
            >
              <Mic2 className={`w-3.5 h-3.5 transition-colors duration-150 ${activeTab === "lyrics" ? "text-white" : "text-textMuted"}`} />
              <span>Lyrics</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={openFullscreen}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.88] text-textSecondary hover:text-white flex items-center justify-center transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title="Open Fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => toggleDrawer()}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.88] text-textMuted hover:text-white flex items-center justify-center transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              title="Close Drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 safe-drawer-body space-y-6">
          {/* Active Track Section */}
          {currentTrack ? (
            <div
              key={`drawer-track-${currentTrack.id}`}
              onContextMenu={handleCurrentTrackContextMenu}
              className="space-y-4 animate-track-switch"
            >
              {/* Artwork Card with Ambient Shadow & Play/Pause Physical Posture */}
              <div
                onClick={openFullscreen}
                className={`relative group mx-auto aspect-square max-w-[240px] rounded-2xl bg-surfaceHover overflow-hidden border border-white/[0.08] flex items-center justify-center cursor-pointer hover:border-white/20 active:scale-[0.97] transition-[border-color,transform,box-shadow,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isPlaying
                    ? "scale-100 shadow-2xl shadow-black/80"
                    : "scale-95 shadow-xl shadow-black/60 opacity-90"
                }`}
                title="Click to view in Fullscreen"
              >
                {artworkUrl ? (
                  <img
                    src={artworkUrl}
                    alt={currentTrack.metadata.title || "Now Playing"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  />
                ) : (
                  <Music className="w-16 h-16 text-textMuted/50" />
                )}
              </div>

              {/* Playing From Source Card */}
              {playbackContext && (
                <div
                  onClick={handleContextClick}
                  className="p-3 bg-white/[0.04] hover:bg-white/[0.08] active:scale-[0.98] border border-white/[0.07] rounded-xl flex items-center justify-between cursor-pointer transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group select-none shadow-sm"
                  title={`Jump to ${playbackContext.name}`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <ContextIcon />
                    <div className="min-w-0">
                      <p className="text-2xs text-textMuted font-medium leading-none mb-1">
                        Playing from {playbackContext.type === "liked" ? "Liked Songs" : playbackContext.type}
                      </p>
                      <p className="text-xs font-semibold text-white group-hover:text-accent transition-colors truncate">
                        {playbackContext.name}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-textMuted group-hover:text-white transition flex-shrink-0" />
                </div>
              )}

              {/* Song Credits & Metadata */}
              <div className="text-center space-y-1">
                <h3
                  onClick={openFullscreen}
                  className="text-base font-bold text-white tracking-tight truncate cursor-pointer hover:text-accent transition-colors"
                >
                  {currentTrack.metadata.title || "Untitled"}
                </h3>
                <div className="text-xs text-textSecondary truncate">
                  <ArtistLinks
                    artistName={getFullTrackArtistString(currentTrack)}
                    onSelectArtist={selectArtist}
                    className="truncate"
                    linkClassName="hover:text-accent hover:underline cursor-pointer transition-colors"
                    delimiterClassName="text-textMuted"
                  />
                </div>
                {currentTrack.metadata.album && (
                  <p
                    onClick={() =>
                      selectAlbum(
                        currentTrack.metadata.album || "",
                        currentTrack.metadata.artist || ""
                      )
                    }
                    className="text-xs text-textMuted hover:text-white cursor-pointer hover:underline truncate transition"
                  >
                    {currentTrack.metadata.album}
                    {currentTrack.metadata.year ? ` (${currentTrack.metadata.year})` : ""}
                  </p>
                )}
              </div>

              {/* Format & Audio Quality Badge */}
              <div className="flex items-center justify-center gap-2 pt-1">
                <span className="inline-flex items-center px-2 py-1 rounded-[4px] bg-white/[0.06] border border-white/[0.10] text-2xs font-medium text-white/70">
                  {currentTrack.metadata.format.toUpperCase() === "FLAC" ||
                  currentTrack.metadata.format.toUpperCase() === "WAV"
                    ? "Lossless"
                    : "High Quality"}{" "}
                  • {currentTrack.metadata.format.toUpperCase()}
                </span>
              </div>

              {/* Quick Actions Bar */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    selectArtist(currentTrack.metadata.artist || "Unknown Artist")
                  }
                  className="flex items-center justify-center space-x-2 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.96] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <User className="w-3.5 h-3.5 text-accent" />
                  <span className="truncate">View Artist</span>
                </button>
                {currentTrack.metadata.album ? (
                  <button
                    type="button"
                    onClick={() =>
                      selectAlbum(
                        currentTrack.metadata.album || "",
                        currentTrack.metadata.artist || ""
                      )
                    }
                    className="flex items-center justify-center space-x-2 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.96] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Disc className="w-3.5 h-3.5 text-accent" />
                    <span className="truncate">View Album</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openFullscreen}
                    className="flex items-center justify-center space-x-2 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.96] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-accent" />
                    <span>Fullscreen</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-textMuted space-y-3">
              <Music className="w-12 h-12 mx-auto opacity-20" />
              <p className="text-xs font-semibold text-textSecondary">
                No song selected
              </p>
              <p className="text-2xs text-textMuted">
                Choose a track from your library to start playback.
              </p>
            </div>
          )}

          {/* Tab 1: Queue Section (Two-Tier Model + History) */}
          {activeTab === "queue" && (
            <div key="tab-queue" className="pt-4 border-t border-white/[0.06] space-y-6 animate-tab-queue-in">
              {/* SECTION A: Queued by You (Next Up / Priority Queue) */}
              {userQueue.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <h4 className="text-xs font-bold text-white">
                        Next Up
                      </h4>
                    </div>
                    <button
                      onClick={clearUserQueue}
                      className="text-2xs text-textMuted hover:text-danger flex items-center gap-1 transition"
                      title="Clear explicit user queue"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    {userQueue.map((track, idx) => (
                      <UserQueueRow
                        key={`user-queue-${track.id}-${idx}`}
                        track={track}
                        index={idx}
                        isDragging={draggedUserQueueIdx === idx}
                        isDragOver={dragOverUserQueueIdx === idx}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", String(idx));
                          e.dataTransfer.effectAllowed = "move";
                          setDraggedUserQueueIdx(idx);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragOverUserQueueIdx !== idx) {
                            setDragOverUserQueueIdx(idx);
                          }
                        }}
                        onDragEnd={() => {
                          setDraggedUserQueueIdx(null);
                          setDragOverUserQueueIdx(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const fromIdx = Number(e.dataTransfer.getData("text/plain"));
                          if (!isNaN(fromIdx) && fromIdx !== idx) {
                            reorderUserQueue(fromIdx, idx);
                          }
                          setDraggedUserQueueIdx(null);
                          setDragOverUserQueueIdx(null);
                        }}
                        onPlay={() => jumpToUserQueueItem(idx)}
                        onRemove={() => removeFromUserQueue(idx)}
                        onContextMenu={(e) => handleUserQueueItemContextMenu(e, track, idx)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION B: Context Queue (Next From Context) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 min-w-0">
                    <h4 className="text-xs font-bold text-white truncate">
                      {playbackContext ? `Next from ${playbackContext.name}` : "Next from Context"}
                    </h4>
                  </div>
                </div>

                {isAutoplay && upcomingContextTracks.length === 0 && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-accent/10 border border-accent/20 text-2xs">
                    <div className="flex items-center space-x-2 text-accent font-medium">
                      <InfinityIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Autoplay enabled</span>
                    </div>
                    <span className="text-2xs text-textMuted">
                      {playbackContext?.name ? `After ${playbackContext.name}` : "Continuous"}
                    </span>
                  </div>
                )}

                {upcomingContextTracks.length === 0 && userQueue.length === 0 ? (
                  isAutoplay ? (
                    <div className="text-center py-6 space-y-2">
                      <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent mb-1">
                        <InfinityIcon className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-xs font-medium text-white/90">Autoplay is Active</p>
                      <p className="text-2xs text-textMuted max-w-[240px] mx-auto">
                        Continuous playback will play similar songs from your library when this track finishes.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-textMuted text-center py-6">
                      Queue is empty. Select songs or an album to add tracks.
                    </p>
                  )
                ) : (
                  <div className="space-y-1">
                    {upcomingContextTracks.map(({ track, targetContextIndex }, idx) => (
                      <ContextQueueRow
                        key={`context-track-${track.id}-${targetContextIndex}-${idx}`}
                        track={track}
                        orderNumber={idx + 1}
                        onPlay={() => jumpToContextTrack(targetContextIndex)}
                        onContextMenu={(e) =>
                          handleContextItemContextMenu(e, track, targetContextIndex)
                        }
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* SECTION C: Collapsible Session History (Recently Played) */}
              <div className="pt-2 border-t border-white/[0.06] space-y-2">
                <button
                  type="button"
                  onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                  className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-white/[0.04] active:scale-[0.99] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group"
                  aria-expanded={isHistoryExpanded}
                >
                  <div className="flex items-center space-x-2">
                    <History className="w-3.5 h-3.5 text-textMuted group-hover:text-accent transition-colors" />
                    <span className="text-xs font-bold text-textSecondary group-hover:text-white transition-colors">
                      Recently Played
                    </span>
                  </div>
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-textMuted group-hover:text-white transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] flex-shrink-0 ${
                      isHistoryExpanded ? "rotate-90 text-white" : ""
                    }`}
                  />
                </button>

                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-240 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                    isHistoryExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                  }`}
                >
                  <div className="overflow-hidden space-y-1 pl-1">
                    {displayHistory.length === 0 ? (
                      <p className="text-2xs text-textMuted py-3 text-center">
                        No recently played tracks in this session.
                      </p>
                    ) : (
                      displayHistory.map((track, idx) => (
                        <HistoryRow
                          key={`history-${track.id}-${idx}`}
                          track={track}
                          onPlay={() => playTrack(track)}
                          onContextMenu={(e) => handleHistoryItemContextMenu(e, track)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Synchronized Lyrics View */}
          {activeTab === "lyrics" && (
            <div
              key={`tab-lyrics-${currentTrack?.id || "none"}`}
              className="pt-4 border-t border-white/[0.06] space-y-3 animate-tab-lyrics-in"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white flex items-center gap-2">
                  <Mic2 className="w-3.5 h-3.5 text-accent" />
                  <span>Lyrics</span>
                </h4>
                {lyrics.length > 0 && (
                  <div className="flex items-center gap-3">
                    {isLyricsBrowsing && isSyncedLyrics && (
                      <button
                        type="button"
                        onClick={handleFocusLyrics}
                        className="text-2xs text-accent hover:underline font-semibold flex items-center gap-1 active:scale-95 transition-all animate-fade-in"
                        title="Resume auto-scroll and focus current lyric"
                      >
                        <Disc className="w-3 h-3 text-accent animate-spin" style={{ animationDuration: "3s" }} />
                        <span>Sync</span>
                      </button>
                    )}
                    {!isSyncedLyrics && (
                      <button
                        type="button"
                        onClick={() => handleFetchLyricsOnline(true)}
                        disabled={isFetchingLyrics}
                        className="text-2xs text-accent hover:underline font-semibold flex items-center gap-1 disabled:opacity-50"
                        title="Search LRCLIB for time-synced lyrics"
                      >
                        {isFetchingLyrics ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Search className="w-3 h-3" />
                        )}
                        <span>Find Synced Lyrics</span>
                      </button>
                    )}
                    <button
                      onClick={openFullscreen}
                      className="text-2xs text-textMuted hover:text-white font-semibold flex items-center gap-1 transition-colors"
                    >
                      <span>Fullscreen</span>
                      <Maximize2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {lyrics.length === 0 ? (
                <div className="py-12 text-center text-textMuted space-y-3 animate-fade-in">
                  <Mic2 className="w-8 h-8 mx-auto opacity-30" />
                  <p className="text-xs font-semibold text-textSecondary">
                    No lyrics available for this track
                  </p>
                  <p className="text-2xs text-textMuted max-w-xs mx-auto">
                    Search online or place an .lrc file in your track folder.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => handleFetchLyricsOnline(true)}
                      disabled={isFetchingLyrics}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-accent-fill hover:bg-accentHover active:scale-[0.96] shadow-sm transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    >
                      {isFetchingLyrics ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Searching LRCLIB...</span>
                        </>
                      ) : (
                        <>
                          <Search className="w-3.5 h-3.5" />
                          <span>Search Lyrics Online</span>
                        </>
                      )}
                    </button>
                    {lyricsFetchError && (
                      <p className="text-2xs text-rose-400 mt-2">{lyricsFetchError}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  ref={lyricsContainerRef}
                  data-lyrics-browsing={isLyricsBrowsing ? "true" : "false"}
                  onWheel={handleUserScroll}
                  onTouchMove={handleUserScroll}
                  onPointerDown={handleLyricsPointerDown}
                  onScroll={handleContainerScroll}
                  className="wavery-lyrics-mask max-h-[360px] overflow-y-auto space-y-4 py-12 scroll-smooth pr-2 select-none"
                >
                  {lyrics.map((line, idx) => {
                    const staggerStyle = {
                      "--lyric-stagger": Math.min(idx, 10),
                    } as React.CSSProperties;

                    if (!isSyncedLyrics) {
                      return (
                        <p
                          key={`plain-${idx}`}
                          style={staggerStyle}
                          className="lyric-line-cascade text-xs font-medium text-white/70 select-text leading-relaxed hover:text-white transition-colors duration-200"
                        >
                          {line.text}
                        </p>
                      );
                    }

                    const isActive = idx === activeLyricIndex;
                    const isPast = idx < activeLyricIndex;
                    const distance =
                      activeLyricIndex >= 0 ? Math.abs(idx - activeLyricIndex) : 0;
                    const distanceAttr = isActive
                      ? "0"
                      : distance === 1
                      ? "1"
                      : distance === 2
                      ? "2"
                      : "far";

                    return (
                      <p
                        key={`${line.time}-${idx}`}
                        style={staggerStyle}
                        data-lyric-state={isActive ? "active" : isPast ? "past" : "upcoming"}
                        data-lyric-distance={distanceAttr}
                        onClick={() => {
                          seek(line.time);
                          handleFocusLyrics();
                        }}
                        className={`wavery-lyric-line lyric-line-cascade cursor-pointer select-none ${
                          isActive
                            ? "text-base font-bold text-white scale-105 translate-x-2 opacity-100"
                            : isPast
                            ? "text-xs font-semibold text-white/30 hover:text-white/85 hover:translate-x-1"
                            : distance === 1
                            ? "text-xs font-semibold text-white/65 hover:text-white/90 hover:translate-x-1"
                            : "text-xs font-semibold text-white/45 hover:text-white/85 hover:translate-x-1"
                        }`}
                      >
                        {line.text}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>

      {/* Edit Song Metadata Modal */}
      <SongMetadataModal
        isOpen={!!trackToEdit}
        onClose={() => setTrackToEdit(null)}
        track={trackToEdit}
      />
    </>
  );
};

import React, { useMemo, useRef, useEffect, useState } from "react";
import { Track } from "../types";
import { usePlayerStore } from "../stores/playerStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { useArtwork } from "../utils/useArtwork";
import { getFullTrackArtistString, formatDuration } from "../utils/library";
import { parseLrc, getActiveLyricIndex } from "../utils/lyrics";
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
  ChevronDown,
  CornerDownRight,
  Copy,
  FilePenLine,
  Infinity as InfinityIcon,
  GripVertical,
  History,
  ArrowUp,
  ListPlus,
  Sparkles,
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
      className={`group flex items-center justify-between p-2 rounded-xl transition-all cursor-pointer select-none ${
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
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <Music className="w-3.5 h-3.5 text-textMuted" />
          )}

          {/* Frosted Play Overlay */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200">
            <div className="w-5 h-5 rounded-full bg-white/20 hover:bg-accent-fill text-white flex items-center justify-center shadow-sm transition-all active:scale-90">
              <Play className="w-2.5 h-2.5 fill-current ml-1" />
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
          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-md hover:bg-white/[0.08] text-textMuted hover:text-danger flex items-center justify-center transition"
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
      className="group flex items-center justify-between p-2 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] transition-all cursor-pointer select-none"
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
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <Music className="w-3.5 h-3.5 text-textMuted" />
          )}

          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200">
            <div className="w-5 h-5 rounded-full bg-white/20 hover:bg-accent-fill text-white flex items-center justify-center shadow-sm transition-all active:scale-90">
              <Play className="w-2.5 h-2.5 fill-current ml-1" />
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
      className="group flex items-center justify-between p-2 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06] transition-all cursor-pointer select-none"
      onClick={onPlay}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center space-x-3 min-w-0 pr-2">
        <div className="w-7 h-7 rounded-lg bg-surfaceHover flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm relative border border-white/[0.06]">
          {artworkUrl && !imgError ? (
            <img
              src={artworkUrl}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <Music className="w-3 h-3 text-textMuted" />
          )}

          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200">
            <Play className="w-2.5 h-2.5 text-white fill-current ml-1" />
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
      const remainingIndices = shuffleIndices.slice(shufflePos + 1);
      return remainingIndices
        .map((idx) => ({
          track: effectiveContext[idx],
          targetContextIndex: idx,
        }))
        .filter((item): item is { track: Track; targetContextIndex: number } => Boolean(item.track));
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

  const handleFetchLyricsOnline = async () => {
    if (!currentTrack) return;
    setIsFetchingLyrics(true);
    setLyricsFetchError(null);
    try {
      const res = await fetchLyrics(
        currentTrack.metadata.artist || "",
        currentTrack.metadata.title || "",
        currentTrack.metadata.album,
        currentTrack.metadata.duration.secs
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

  // Auto-scroll lyrics container in drawer, re-centering on window state change
  useEffect(() => {
    if (!isDrawerOpen || activeTab !== "lyrics" || activeLyricIndex < 0 || !lyricsContainerRef.current) return;
    const scrollActiveLyric = () => {
      const container = lyricsContainerRef.current;
      if (!container) return;
      const activeEl = container.children[activeLyricIndex] as HTMLElement;
      if (activeEl) {
        const targetScroll =
          activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
        container.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: showLyricsSmoothScroll ? "smooth" : "auto",
        });
      }
    };

    scrollActiveLyric();
    return windowService.onWindowStateChange(scrollActiveLyric);
  }, [activeLyricIndex, isDrawerOpen, activeTab, showLyricsSmoothScroll]);

  if (!isDrawerOpen) return null;

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
    if (!playbackContext) return <Disc className="w-3 h-3 text-accent" />;
    switch (playbackContext.type) {
      case "album":
        return <Disc className="w-3 h-3 text-accent" />;
      case "playlist":
        return <ListMusic className="w-3 h-3 text-accent" />;
      case "liked":
        return <Heart className="w-3 h-3 text-accent" />;
      case "artist":
        return <Users className="w-3 h-3 text-accent" />;
      case "tracks":
      default:
        return <Library className="w-3 h-3 text-accent" />;
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
      {/* Backdrop for viewports < 2xl */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 2xl:hidden animate-fade-in"
        onClick={() => toggleDrawer()}
        aria-hidden="true"
      />
      <aside
        aria-label="Now Playing and Queue"
        className="fixed 2xl:relative inset-y-0 right-0 z-50 2xl:z-20 w-full sm:w-80 lg:w-96 max-w-[100vw] bg-deck/98 2xl:bg-deck/95 border-l border-white/[0.08] backdrop-blur-2xl flex flex-col justify-between select-none flex-shrink-0 shadow-2xl animate-drawer-in-right"
      >
        {/* Drawer Header & Tab Selector */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-1 p-1 bg-white/[0.06] rounded-xl border border-white/[0.06]">
            <button
              onClick={() => setTab("queue")}
              className={`flex items-center space-x-2 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeTab === "queue"
                  ? "bg-accent-fill text-white shadow-sm shadow-accent/30"
                  : "text-textSecondary hover:text-white"
              }`}
            >
              <ListMusic className="w-3.5 h-3.5" />
              <span>Queue</span>
            </button>
            <button
              onClick={() => setTab("lyrics")}
              className={`flex items-center space-x-2 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                activeTab === "lyrics"
                  ? "bg-accent-fill text-white shadow-sm shadow-accent/30"
                  : "text-textSecondary hover:text-white"
              }`}
            >
              <Mic2 className="w-3.5 h-3.5" />
              <span>Lyrics</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={openFullscreen}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-textSecondary hover:text-white flex items-center justify-center transition"
              title="Open Fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => toggleDrawer()}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-textMuted hover:text-white flex items-center justify-center transition"
              title="Close Drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Active Track Section */}
          {currentTrack ? (
            <div
              onContextMenu={handleCurrentTrackContextMenu}
              className="space-y-4"
            >
              {/* Artwork Card with Ambient Shadow */}
              <div
                onClick={openFullscreen}
                className="relative group mx-auto aspect-square max-w-[240px] rounded-2xl bg-surfaceHover overflow-hidden border border-white/[0.08] shadow-2xl shadow-black/80 flex items-center justify-center cursor-pointer hover:border-white/20 transition-all duration-300"
                title="Click to view in Fullscreen"
              >
                {artworkUrl ? (
                  <img
                    src={artworkUrl}
                    alt={currentTrack.metadata.title || "Now Playing"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <Music className="w-16 h-16 text-textMuted/50" />
                )}
              </div>

              {/* Playing From Source Card */}
              {playbackContext && (
                <div
                  onClick={handleContextClick}
                  className="p-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] rounded-xl flex items-center justify-between cursor-pointer transition group select-none shadow-sm"
                  title={`Jump to ${playbackContext.name}`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-6 h-6 rounded-lg bg-accent/15 border border-accent/20 flex items-center justify-center flex-shrink-0">
                      <ContextIcon />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xs uppercase font-bold text-textMuted tracking-wider leading-none mb-1">
                        Playing From {playbackContext.type === "liked" ? "Liked Songs" : playbackContext.type}
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
                  className="text-base font-extrabold text-white tracking-tight truncate cursor-pointer hover:text-accent transition-colors"
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
                <span className="inline-flex items-center px-2 py-1 rounded-[4px] bg-white/[0.06] border border-white/[0.10] text-2xs font-semibold tracking-wider uppercase text-white/70">
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
                  onClick={() =>
                    selectArtist(currentTrack.metadata.artist || "Unknown Artist")
                  }
                  className="flex items-center justify-center space-x-2 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition"
                >
                  <User className="w-3.5 h-3.5 text-accent" />
                  <span className="truncate">View Artist</span>
                </button>
                {currentTrack.metadata.album ? (
                  <button
                    onClick={() =>
                      selectAlbum(
                        currentTrack.metadata.album || "",
                        currentTrack.metadata.artist || ""
                      )
                    }
                    className="flex items-center justify-center space-x-2 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition"
                  >
                    <Disc className="w-3.5 h-3.5 text-accent" />
                    <span className="truncate">View Album</span>
                  </button>
                ) : (
                  <button
                    onClick={openFullscreen}
                    className="flex items-center justify-center space-x-2 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition"
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
            <div className="pt-4 border-t border-white/[0.06] space-y-6">
              {/* SECTION A: Queued by You (Next Up / Priority Queue) */}
              {userQueue.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                        Next Up
                      </h4>
                      <span className="text-2xs font-bold text-accent bg-accent/10 border border-accent/20 px-2 py-1 rounded-[4px] font-mono">
                        {userQueue.length}
                      </span>
                      <span className="text-2xs text-textMuted">
                        Queued by you
                      </span>
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
                    <h4 className="text-xs font-bold uppercase tracking-wider text-white truncate">
                      {playbackContext ? `Next From ${playbackContext.name}` : "Next From Context"}
                    </h4>
                    <span className="text-2xs font-bold text-textMuted bg-white/[0.06] px-2 py-1 rounded-[4px] font-mono flex-shrink-0">
                      {upcomingContextTracks.length}
                    </span>
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
                  onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                  className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-white/[0.04] transition group"
                >
                  <div className="flex items-center space-x-2">
                    <History className="w-3.5 h-3.5 text-textMuted group-hover:text-accent transition-colors" />
                    <span className="text-xs font-bold uppercase tracking-wider text-textSecondary group-hover:text-white transition-colors">
                      Recently Played
                    </span>
                    <span className="text-2xs font-bold text-textMuted bg-white/[0.06] px-2 py-1 rounded-[4px] font-mono">
                      {sessionHistory.length}
                    </span>
                  </div>
                  {isHistoryExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-textMuted group-hover:text-white transition" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-textMuted group-hover:text-white transition" />
                  )}
                </button>

                {isHistoryExpanded && (
                  <div className="space-y-1 pl-1">
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
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Synchronized Lyrics View */}
          {activeTab === "lyrics" && (
            <div className="pt-4 border-t border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                  <Mic2 className="w-3.5 h-3.5 text-accent" />
                  <span>Lyrics</span>
                </h4>
                {lyrics.length > 0 && (
                  <button
                    onClick={openFullscreen}
                    className="text-2xs text-accent hover:underline font-semibold flex items-center gap-1"
                  >
                    <span>Fullscreen</span>
                    <Maximize2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              {lyrics.length === 0 ? (
                <div className="py-12 text-center text-textMuted space-y-3">
                  <Mic2 className="w-8 h-8 mx-auto opacity-30" />
                  <p className="text-xs font-semibold text-textSecondary">
                    No lyrics found for this song
                  </p>
                  <p className="text-2xs text-textMuted max-w-xs mx-auto">
                    Embedded LRC or tag lyrics will show up here during playback.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleFetchLyricsOnline}
                      disabled={isFetchingLyrics}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-accent-fill hover:bg-accentHover active:scale-95 transition shadow-lg shadow-accent/20 disabled:opacity-50"
                    >
                      {isFetchingLyrics ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Searching LRCLIB...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
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
                  className="max-h-[360px] overflow-y-auto space-y-4 py-12 scroll-smooth pr-2 select-none"
                >
                  {lyrics.map((line, idx) => {
                    const isActive = idx === activeLyricIndex;
                    const isPast = idx < activeLyricIndex;

                    return (
                      <p
                        key={`${line.time}-${idx}`}
                        onClick={() => seek(line.time)}
                        className={`cursor-pointer transition-[transform,opacity,color] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform transform origin-left select-none ${
                          isActive
                            ? "text-base font-extrabold text-white scale-105 translate-x-1.5 opacity-100"
                            : isPast
                            ? "text-xs font-semibold text-white/35 hover:text-white/80"
                            : "text-xs font-semibold text-white/50 hover:text-white/80"
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

      {/* Edit Song Metadata Modal */}
      <SongMetadataModal
        isOpen={!!trackToEdit}
        onClose={() => setTrackToEdit(null)}
        track={trackToEdit}
      />
    </>
  );
};

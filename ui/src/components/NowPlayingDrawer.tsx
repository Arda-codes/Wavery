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
import { EqualizerWave } from "./EqualizerWave";
import {
  X,
  Music,
  ListMusic,
  Disc,
  User,
  Trash2,
  Play,
  Pause,
  Sparkles,
  Mic2,
  Maximize2,
  Heart,
  Library,
  Users,
  ChevronRight,
  CornerDownRight,
  Copy,
  Infinity,
} from "lucide-react";

interface QueueItemRowProps {
  track: Track;
  actualIndex: number;
  onPlay: () => void;
  onRemove: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const QueueItemRowInner: React.FC<QueueItemRowProps> = ({
  track,
  onPlay,
  onRemove,
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
        {/* Artwork Thumbnail with Refined Hover Play Overlay */}
        <div className="w-8 h-8 rounded-lg bg-[#1C1C22] flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm relative border border-white/[0.06]">
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
            <Music className="w-3.5 h-3.5 text-[#71717A]" />
          )}

          {/* Frosted Play Overlay matching the theme */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200">
            <div className="w-5 h-5 rounded-full bg-white/20 hover:bg-[#FA586A] text-white flex items-center justify-center shadow-sm transition-all active:scale-90">
              <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold text-white truncate group-hover:text-[#FA586A] transition-colors">
            {track.metadata.title || "Untitled"}
          </p>
          <p className="text-[10.5px] text-[#A1A1AA] truncate">
            {track.metadata.artist || "Unknown Artist"}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 flex-shrink-0">
        <span className="text-[10.5px] text-[#71717A] font-mono tabular-nums">
          {formatDuration(track.metadata.duration?.secs || 0)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-md hover:bg-white/[0.08] text-[#71717A] hover:text-[#FF453A] flex items-center justify-center transition"
          title="Remove from queue"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
const QueueItemRow = React.memo(QueueItemRowInner);

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

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const jumpToQueueIndex = usePlayerStore((s) => s.jumpToQueueIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const isAutoplay = usePlayerStore((s) => s.isAutoplay);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const positionSecs = usePlayerStore((s) => s.status.position_secs || 0);
  const seek = usePlayerStore((s) => s.seek);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const insertAfterCurrent = usePlayerStore((s) => s.insertAfterCurrent);

  const playlists = useLibraryStore((s) => s.playlists);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);
  const likedTrackIds = useLibraryStore((s) => s.likedTrackIds);
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const artworkUrl = useArtwork(currentTrack?.id);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Parse real lyrics only (no placeholder fallback)
  const lyrics = useMemo(() => {
    if (!currentTrack) return [];
    const rawLyrics = (currentTrack.metadata as { lyrics?: string }).lyrics;
    if (rawLyrics && rawLyrics.trim()) {
      return parseLrc(rawLyrics);
    }
    return [];
  }, [currentTrack]);

  const activeLyricIndex = useMemo(() => {
    return getActiveLyricIndex(lyrics, positionSecs);
  }, [lyrics, positionSecs]);

  // Auto-scroll lyrics container in drawer
  useEffect(() => {
    if (!isDrawerOpen || activeTab !== "lyrics" || activeLyricIndex < 0 || !lyricsContainerRef.current) return;
    const container = lyricsContainerRef.current;
    const activeEl = container.children[activeLyricIndex] as HTMLElement;
    if (activeEl) {
      const targetScroll =
        activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: showLyricsSmoothScroll ? "smooth" : "auto",
      });
    }
  }, [activeLyricIndex, isDrawerOpen, activeTab, showLyricsSmoothScroll]);

  if (!isDrawerOpen) return null;

  const upcomingQueue = queue.slice(queueIndex + 1);

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
    if (!playbackContext) return <Disc className="w-3 h-3 text-[#FA586A]" />;
    switch (playbackContext.type) {
      case "album":
        return <Disc className="w-3 h-3 text-[#FA586A]" />;
      case "playlist":
        return <ListMusic className="w-3 h-3 text-[#FA586A]" />;
      case "liked":
        return <Heart className="w-3 h-3 text-[#FA586A]" />;
      case "artist":
        return <Users className="w-3 h-3 text-[#FA586A]" />;
      case "tracks":
      default:
        return <Library className="w-3 h-3 text-[#FA586A]" />;
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
      }
    );

    openContextMenu(e, menuItems);
  };

  const handleQueueItemContextMenu = (
    e: React.MouseEvent,
    itemTrack: Track,
    actualIndex: number
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const isLiked = likedTrackIds.has(itemTrack.id);
    const artistName = getFullTrackArtistString(itemTrack);

    const playlistSubmenu: ContextMenuItem[] = playlists.map((pl) => ({
      id: `queue-item-pl-${pl.id}`,
      label: pl.name,
      icon: ListMusic,
      onClick: () => addTracksToPlaylist(pl.id, [itemTrack.id]),
    }));

    const menuItems: ContextMenuItem[] = [
      {
        id: "jump-to-queue-item",
        label: "Play Now",
        icon: Play,
        onClick: () => jumpToQueueIndex(actualIndex),
      },
      {
        id: "play-next-queue-item",
        label: "Move to Play Next",
        icon: CornerDownRight,
        onClick: () => {
          removeFromQueue(actualIndex);
          insertAfterCurrent(itemTrack);
        },
      },
      {
        id: "remove-from-queue",
        label: "Remove from Queue",
        icon: Trash2,
        danger: true,
        onClick: () => removeFromQueue(actualIndex),
      },
      {
        id: "divider-1",
        label: "",
        divider: true,
      },
      {
        id: "toggle-like-queue-item",
        label: isLiked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: Heart,
        onClick: () => toggleLike(itemTrack.id),
      },
    ];

    if (playlistSubmenu.length > 0) {
      menuItems.push({
        id: "add-to-playlist-queue-item",
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
          id: "go-artist-queue-item",
          label: `Go to Artist (${artistName})`,
          icon: User,
          onClick: () => selectArtist(itemTrack.metadata.artist || ""),
        }
      );
    }

    if (itemTrack.metadata.album) {
      menuItems.push({
        id: "go-album-queue-item",
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
        id: "copy-queue-item-info",
        label: "Copy Title & Artist",
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(
            `${itemTrack.metadata.title || "Untitled"} - ${artistName}`
          );
        },
      }
    );

    openContextMenu(e, menuItems);
  };

  return (
    <>
      {/* Backdrop for viewports < 2xl */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 2xl:hidden"
        onClick={() => toggleDrawer()}
        aria-hidden="true"
      />
      <aside
        aria-label="Now Playing and Queue"
        className="fixed 2xl:relative inset-y-0 right-0 z-50 2xl:z-20 w-full sm:w-80 lg:w-96 max-w-[100vw] bg-[#121216]/98 2xl:bg-[#121216]/95 border-l border-white/[0.08] backdrop-blur-2xl flex flex-col justify-between select-none flex-shrink-0 shadow-2xl animate-fade-in"
      >
      {/* Drawer Header & Tab Selector */}
      <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-1 p-0.5 bg-white/[0.06] rounded-xl border border-white/[0.06]">
          <button
            onClick={() => setTab("queue")}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === "queue"
                ? "bg-[#FA586A] text-white shadow-sm shadow-[#FA586A]/30"
                : "text-[#A1A1AA] hover:text-white"
            }`}
          >
            <ListMusic className="w-3.5 h-3.5" />
            <span>Queue</span>
          </button>
          <button
            onClick={() => setTab("lyrics")}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              activeTab === "lyrics"
                ? "bg-[#FA586A] text-white shadow-sm shadow-[#FA586A]/30"
                : "text-[#A1A1AA] hover:text-white"
            }`}
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>Lyrics</span>
          </button>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={openFullscreen}
            className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-[#A1A1AA] hover:text-white flex items-center justify-center transition"
            title="Open Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => toggleDrawer()}
            className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-[#71717A] hover:text-white flex items-center justify-center transition"
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
              className="relative group mx-auto aspect-square max-w-[240px] rounded-2xl bg-[#1C1C22] overflow-hidden border border-white/[0.08] shadow-2xl shadow-black/80 flex items-center justify-center cursor-pointer hover:border-white/20 transition-all duration-300"
              title="Click to view in Fullscreen"
            >
              {artworkUrl ? (
                <img
                  src={artworkUrl}
                  alt={currentTrack.metadata.title || "Now Playing"}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              ) : (
                <Music className="w-16 h-16 text-[#71717A]/50" />
              )}
              {isPlaying && (
                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center space-x-2 shadow-lg">
                  <EqualizerWave isPlaying={true} size="xs" color="bg-[#FA586A]" />
                  <span className="text-[10px] font-bold text-white uppercase tracking-wider">
                    Playing
                  </span>
                </div>
              )}
            </div>

            {/* Playing From Source Card */}
            {playbackContext && (
              <div
                onClick={handleContextClick}
                className="p-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] rounded-xl flex items-center justify-between cursor-pointer transition group select-none shadow-sm"
                title={`Jump to ${playbackContext.name}`}
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-[#FA586A]/15 border border-[#FA586A]/20 flex items-center justify-center flex-shrink-0">
                    <ContextIcon />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9.5px] uppercase font-bold text-[#71717A] tracking-wider leading-none mb-0.5">
                      Playing From {playbackContext.type === "liked" ? "Liked Songs" : playbackContext.type}
                    </p>
                    <p className="text-xs font-semibold text-white group-hover:text-[#FA586A] transition-colors truncate">
                      {playbackContext.name}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-[#71717A] group-hover:text-white transition flex-shrink-0" />
              </div>
            )}

            {/* Song Credits & Metadata */}
            <div className="text-center space-y-1">
              <h3
                onClick={openFullscreen}
                className="text-base font-extrabold text-white tracking-tight truncate cursor-pointer hover:text-[#FA586A] transition-colors"
              >
                {currentTrack.metadata.title || "Untitled"}
              </h3>
              <div className="text-xs text-[#A1A1AA] truncate">
                <ArtistLinks
                  artistName={getFullTrackArtistString(currentTrack)}
                  onSelectArtist={selectArtist}
                  className="truncate"
                  linkClassName="hover:text-[#FA586A] hover:underline cursor-pointer transition-colors"
                  delimiterClassName="text-[#71717A]"
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
                  className="text-xs text-[#71717A] hover:text-white cursor-pointer hover:underline truncate transition"
                >
                  {currentTrack.metadata.album}
                  {currentTrack.metadata.year ? ` (${currentTrack.metadata.year})` : ""}
                </p>
              )}
            </div>

            {/* Format & Audio Quality Pill */}
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-[10.5px] font-bold text-white">
                <Sparkles className="w-3 h-3 text-[#FA586A]" />
                <span>
                  {currentTrack.metadata.format.toUpperCase() === "FLAC" ||
                  currentTrack.metadata.format.toUpperCase() === "WAV"
                    ? "Lossless"
                    : "High Quality"}
                </span>
                <span className="text-[#71717A]">
                  • {currentTrack.metadata.format.toUpperCase()}
                </span>
              </span>
            </div>

            {/* Quick Actions Bar */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() =>
                  selectArtist(currentTrack.metadata.artist || "Unknown Artist")
                }
                className="flex items-center justify-center space-x-1.5 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition"
              >
                <User className="w-3.5 h-3.5 text-[#FA586A]" />
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
                  className="flex items-center justify-center space-x-1.5 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition"
                >
                  <Disc className="w-3.5 h-3.5 text-[#FA586A]" />
                  <span className="truncate">View Album</span>
                </button>
              ) : (
                <button
                  onClick={openFullscreen}
                  className="flex items-center justify-center space-x-1.5 px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold border border-white/[0.06] transition"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-[#FA586A]" />
                  <span>Fullscreen</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-[#71717A] space-y-3">
            <Music className="w-12 h-12 mx-auto opacity-20" />
            <p className="text-xs font-semibold text-[#A1A1AA]">
              No song selected
            </p>
            <p className="text-[11px] text-[#71717A]">
              Choose a track from your library to start playback.
            </p>
          </div>
        )}

        {/* Tab 1: Queue Section */}
        {activeTab === "queue" && (
          <div className="pt-4 border-t border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                  Next In Queue
                </h4>
                <span className="text-[10px] font-bold text-[#71717A] bg-white/[0.06] px-2 py-0.5 rounded-full">
                  {upcomingQueue.length}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={toggleAutoplay}
                  className={`text-[11px] font-semibold flex items-center space-x-1 px-2 py-0.5 rounded-md transition ${
                    isAutoplay
                      ? "text-[#FA586A] bg-[#FA586A]/10 border border-[#FA586A]/20"
                      : "text-[#71717A] hover:text-white"
                  }`}
                  title={
                    isAutoplay
                      ? "Autoplay is on (continues playing after queue finishes)"
                      : "Autoplay is off"
                  }
                >
                  <Infinity className="w-3 h-3" />
                  <span>Autoplay</span>
                </button>
                {upcomingQueue.length > 0 && (
                  <button
                    onClick={clearQueue}
                    className="text-[11px] text-[#71717A] hover:text-[#FF453A] flex items-center gap-1 transition"
                    title="Clear upcoming queue"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>

            {isAutoplay && playbackContext?.type === "tracks" && (
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#FA586A]/10 border border-[#FA586A]/20 text-[11px]">
                <div className="flex items-center space-x-1.5 text-[#FA586A] font-medium">
                  <Infinity className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Autoplay enabled</span>
                </div>
                <span className="text-[10px] text-[#71717A]">Infinite</span>
              </div>
            )}

            {upcomingQueue.length === 0 ? (
              <p className="text-xs text-[#71717A] text-center py-6">
                Queue is empty. Select songs or an album to add tracks.
              </p>
            ) : (
              <div className="space-y-1">
                {upcomingQueue.map((t, idx) => {
                  const actualIndex = queueIndex + 1 + idx;
                  return (
                    <QueueItemRow
                      key={`${t.id}-${actualIndex}`}
                      track={t}
                      actualIndex={actualIndex}
                      onPlay={() => jumpToQueueIndex(actualIndex)}
                      onRemove={() => removeFromQueue(actualIndex)}
                      onContextMenu={(e) => handleQueueItemContextMenu(e, t, actualIndex)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Synchronized Lyrics View */}
        {activeTab === "lyrics" && (
          <div className="pt-4 border-t border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                <Mic2 className="w-3.5 h-3.5 text-[#FA586A]" />
                <span>Lyrics</span>
              </h4>
              {lyrics.length > 0 && (
                <button
                  onClick={openFullscreen}
                  className="text-[11px] text-[#FA586A] hover:underline font-semibold flex items-center gap-1"
                >
                  <span>Fullscreen</span>
                  <Maximize2 className="w-3 h-3" />
                </button>
              )}
            </div>

            {lyrics.length === 0 ? (
              <div className="py-12 text-center text-[#71717A] space-y-2">
                <Mic2 className="w-8 h-8 mx-auto opacity-30" />
                <p className="text-xs font-semibold text-[#A1A1AA]">
                  No lyrics found for this song
                </p>
                <p className="text-[11px] text-[#71717A] max-w-xs mx-auto">
                  Embedded LRC or tag lyrics will show up here during playback.
                </p>
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
                      className={`cursor-pointer transition-all duration-300 transform origin-left ${
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
  </>
  );
};

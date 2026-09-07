import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  Play,
  Pause,
  Square,
  Volume2,
  Volume1,
  VolumeX,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Music,
  ListMusic,
  Sparkles,
  Mic2,
  Maximize2,
  Disc,
  Users,
  Library,
  Copy,
  User,
  Infinity,
} from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { useArtwork } from "../utils/useArtwork";
import { getFullTrackArtistString } from "../utils/library";
import { ArtistLinks } from "./ArtistLinks";
import { EqualizerWave } from "./EqualizerWave";

function formatTime(secs: number = 0): string {
  if (isNaN(secs) || secs < 0) secs = 0;
  const mins = Math.floor(secs / 60);
  const remaining = Math.floor(secs % 60);
  return `${mins}:${remaining < 10 ? "0" : ""}${remaining}`;
}

function formatRemainingTime(currentSecs: number, totalSecs: number): string {
  if (isNaN(totalSecs) || totalSecs <= 0) return formatTime(currentSecs);
  const diff = Math.max(0, totalSecs - currentSecs);
  return `-${formatTime(diff)}`;
}

/**
 * 1. TrackInfo Subcomponent
 * Subscribes ONLY to currentTrack, favorites, drawer & playbackContext — does NOT re-render on 500ms polling position ticks.
 */
const TrackInfoInner: React.FC = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const isLiked = useLibraryStore(
    (s) => !!currentTrack?.id && s.likedTrackIds.has(currentTrack.id)
  );
  const toggleLike = useLibraryStore((s) => s.toggleLike);

  const selectArtist = useNavigationStore((s) => s.selectArtist);
  const selectAlbum = useNavigationStore((s) => s.selectAlbum);
  const selectPlaylist = useNavigationStore((s) => s.selectPlaylist);
  const navigate = useNavigationStore((s) => s.navigate);
  const toggleDrawer = useNavigationStore((s) => s.toggleNowPlayingDrawer);
  const artworkUrl = useArtwork(currentTrack?.id);

  const formatBadge = useMemo(() => {
    if (!currentTrack) return null;
    const fmt = currentTrack.metadata.format.toUpperCase();
    const isLossless = fmt === "FLAC" || fmt === "WAV" || fmt === "ALAC";
    return { fmt, isLossless };
  }, [currentTrack]);

  const handleContextClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
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
  }, [playbackContext, selectAlbum, selectPlaylist, selectArtist, navigate]);

  const ContextIcon = useMemo(() => {
    if (!playbackContext) return Disc;
    switch (playbackContext.type) {
      case "album":
        return Disc;
      case "playlist":
        return ListMusic;
      case "liked":
        return Heart;
      case "artist":
        return Users;
      case "tracks":
      default:
        return Library;
    }
  }, [playbackContext]);

  const playlists = useLibraryStore((s) => s.playlists);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);
  const resume = usePlayerStore((s) => s.resume);
  const pause = usePlayerStore((s) => s.pause);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);
  const toggleFullscreen = useNavigationStore((s) => s.toggleFullscreenNowPlaying);

  const handleTrackContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!currentTrack) return;
      e.preventDefault();
      e.stopPropagation();

      const artistName = getFullTrackArtistString(currentTrack);

      const playlistSubmenu: ContextMenuItem[] = playlists.map((pl) => ({
        id: `playerbar-pl-${pl.id}`,
        label: pl.name,
        icon: ListMusic,
        onClick: () => addTracksToPlaylist(pl.id, [currentTrack.id]),
      }));

      const menuItems: ContextMenuItem[] = [
        {
          id: "play-pause",
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
          id: "toggle-like",
          label: isLiked ? "Remove from Liked Songs" : "Add to Liked Songs",
          icon: Heart,
          onClick: () => toggleLike(currentTrack.id),
        },
      ];

      if (playlistSubmenu.length > 0) {
        menuItems.push({
          id: "add-to-playlist",
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
            id: "go-to-artist",
            label: `Go to Artist (${artistName})`,
            icon: User,
            onClick: () => selectArtist(currentTrack.metadata.artist || ""),
          }
        );
      }

      if (currentTrack.metadata.album) {
        menuItems.push({
          id: "go-to-album",
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
          id: "divider-views",
          label: "",
          divider: true,
        },
        {
          id: "open-drawer",
          label: "Open Now Playing Drawer",
          icon: ListMusic,
          onClick: () => toggleDrawer(),
        },
        {
          id: "open-fullscreen",
          label: "Fullscreen Lyrics",
          icon: Mic2,
          onClick: toggleFullscreen,
        },
        {
          id: "divider-copy",
          label: "",
          divider: true,
        },
        {
          id: "copy-title",
          label: "Copy Track Title",
          icon: Copy,
          onClick: () => {
            navigator.clipboard.writeText(
              currentTrack.metadata.title || "Untitled"
            );
          },
        },
        {
          id: "copy-share",
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
    },
    [
      currentTrack,
      isPlaying,
      isLiked,
      playlists,
      pause,
      resume,
      toggleLike,
      addTracksToPlaylist,
      selectArtist,
      selectAlbum,
      toggleDrawer,
      toggleFullscreen,
      openContextMenu,
    ]
  );

  return (
    <div
      onContextMenu={handleTrackContextMenu}
      className="flex items-center min-w-0 w-[30%] max-w-sm flex-shrink-0"
    >
      {currentTrack ? (
        <div className="flex items-center space-x-3 sm:space-x-3.5 truncate group min-w-0 flex-1">
          {/* Artwork Squircle with Hover Indicator & Subtle Corner Equalizer */}
          <button
            type="button"
            onClick={() => toggleDrawer()}
            aria-label="Open Now Playing drawer"
            className="w-12 h-12 sm:w-[50px] sm:h-[50px] rounded-[10px] bg-[#1A1A20] flex items-center justify-center overflow-hidden flex-shrink-0 relative border border-white/[0.08] shadow-[0_4px_12px_rgba(0,0,0,0.35)] cursor-pointer hover:border-white/25 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none transition-all duration-200 group-hover:scale-[1.02] active:scale-[0.98]"
            title="Click to open Now Playing drawer"
          >
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={currentTrack.metadata.title || "Cover"}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <Music className="w-5 h-5 text-[#71717A]" />
            )}

            {/* Subtle Corner Playing Equalizer Badge */}
            {isPlaying && (
              <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded-[4px] bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center shadow-sm">
                <EqualizerWave isPlaying={true} size="sm" color="bg-[#FA586A]" />
              </div>
            )}
          </button>

          {/* Track Metadata Hierarchy */}
          <div className="truncate min-w-0 flex-1 flex flex-col justify-center">
            {/* Top row: Track Title & Lossless / Format Badge */}
            <div className="flex items-center space-x-2 min-w-0">
              <span
                onClick={() => toggleDrawer()}
                className="text-[13px] sm:text-[13.5px] font-semibold text-white truncate tracking-tight cursor-pointer hover:text-[#FA586A] transition-colors leading-tight"
                title={`${currentTrack.metadata.title || "Untitled"} (Click to open drawer)`}
              >
                {currentTrack.metadata.title || "Untitled"}
              </span>

              {formatBadge && (
                <span
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[4px] text-[8.5px] font-bold tracking-wider uppercase flex-shrink-0 border leading-none ${
                    formatBadge.isLossless
                      ? "bg-[#FA586A]/15 text-[#FA586A] border-[#FA586A]/30"
                      : "bg-white/[0.06] text-[#A1A1AA] border-white/[0.08]"
                  }`}
                  title={`${formatBadge.fmt} ${formatBadge.isLossless ? "Lossless Audio" : "High Quality"}`}
                >
                  {formatBadge.isLossless && <Sparkles className="w-2.5 h-2.5" />}
                  {formatBadge.fmt}
                </span>
              )}
            </div>

            {/* Middle row: Artist Links & Album */}
            <div className="text-[11.5px] text-[#A1A1AA] truncate mt-0.5 flex items-center space-x-1.5 leading-snug">
              <ArtistLinks
                artistName={getFullTrackArtistString(currentTrack)}
                onSelectArtist={selectArtist}
                className="truncate block"
                linkClassName="hover:text-white hover:underline cursor-pointer transition-colors"
                delimiterClassName="text-[#71717A]"
              />
              {currentTrack.metadata.album && (
                <>
                  <span className="text-[#71717A]/60 flex-shrink-0">•</span>
                  <span
                    onClick={() =>
                      selectAlbum(
                        currentTrack.metadata.album || "",
                        currentTrack.metadata.artist || ""
                      )
                    }
                    className="text-[#71717A] hover:text-[#A1A1AA] hover:underline cursor-pointer truncate hidden sm:inline transition-colors"
                    title={currentTrack.metadata.album}
                  >
                    {currentTrack.metadata.album}
                  </span>
                </>
              )}
            </div>

            {/* Bottom micro-row: Playback Context Badge (if active context) */}
            {playbackContext && (
              <div
                onClick={handleContextClick}
                className="flex items-center space-x-1 text-[10px] text-[#71717A] hover:text-[#FA586A] cursor-pointer transition-colors truncate mt-0.5 group/ctx"
                title={`Playing from ${playbackContext.type}: ${playbackContext.name}`}
              >
                <ContextIcon className="w-2.5 h-2.5 flex-shrink-0 text-[#FA586A] group-hover/ctx:scale-110 transition-transform" />
                <span className="truncate text-[9.5px]">
                  {playbackContext.type === "liked"
                    ? "Liked Songs"
                    : playbackContext.name}
                </span>
              </div>
            )}
          </div>

          {/* Heart / Favorite Button with Springy Micro-Interaction */}
          <button
            type="button"
            aria-label={isLiked ? "Unlike song" : "Like song"}
            onClick={(e) => {
              e.stopPropagation();
              toggleLike(currentTrack.id);
            }}
            className={`p-2 rounded-full transition-all duration-200 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none ${
              isLiked
                ? "text-[#FA586A] scale-105 hover:scale-115 active:scale-90"
                : "text-[#71717A] hover:text-white hover:bg-white/[0.06] active:scale-95"
            }`}
            title={isLiked ? "Unlike song" : "Like song"}
          >
            <Heart
              className={`w-4 h-4 transition-all duration-200 ${
                isLiked ? "fill-[#FA586A] filter drop-shadow-[0_0_6px_rgba(250,88,106,0.4)]" : ""
              }`}
            />
          </button>
        </div>
      ) : (
        <div className="flex items-center space-x-3 text-[#71717A]">
          <div className="w-12 h-12 rounded-[10px] bg-[#16161A] flex items-center justify-center border border-white/[0.06] shadow-sm">
            <Music className="w-5 h-5 opacity-30" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-[#A1A1AA]">No song selected</span>
            <span className="text-[11px] text-[#71717A]">Choose a track to play</span>
          </div>
        </div>
      )}
    </div>
  );
};
const TrackInfo = React.memo(TrackInfoInner);

/**
 * 2. PlayControls Subcomponent
 * Subscribes ONLY to playback state, shuffle, loop & queue — does NOT re-render on position ticks.
 */
const PlayControlsInner: React.FC = () => {
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const loopMode = usePlayerStore((s) => s.status.loop_mode);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const isAutoplay = usePlayerStore((s) => s.isAutoplay);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const queueIndex = usePlayerStore((s) => s.queueIndex);

  const resume = usePlayerStore((s) => s.resume);
  const pause = usePlayerStore((s) => s.pause);
  const stop = usePlayerStore((s) => s.stop);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);

  const hasTrack = !!currentTrack;

  const handlePlayToggle = useCallback(() => {
    if (!hasTrack) return;
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [hasTrack, isPlaying, pause, resume]);

  const canSkipBack = hasTrack && (queueIndex > 0 || currentTrack !== undefined);
  const canSkipForward =
    hasTrack &&
    (queueIndex < queueLength - 1 ||
      isShuffle ||
      loopMode === "Queue" ||
      (isAutoplay && playbackContext?.type === "tracks"));

  return (
    <div className="flex items-center space-x-2 sm:space-x-3 md:space-x-4 mb-1">
      {/* Shuffle Button */}
      <button
        type="button"
        aria-label="Toggle Shuffle"
        onClick={toggleShuffle}
        disabled={!hasTrack}
        className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
          isShuffle && hasTrack
            ? "text-[#FA586A] bg-[#FA586A]/15 border border-[#FA586A]/25"
            : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.06] active:scale-95"
        }`}
        title={!hasTrack ? "Shuffle disabled (no track)" : isShuffle ? "Shuffle is ON" : "Shuffle is OFF"}
      >
        <Shuffle className="w-3.5 h-3.5" />
        {isShuffle && hasTrack && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#FA586A]" />
        )}
      </button>

      {/* Previous Track */}
      <button
        type="button"
        aria-label="Previous Track"
        onClick={playPrevious}
        disabled={!canSkipBack}
        className="w-8 h-8 rounded-full flex items-center justify-center text-[#D4D4D8] hover:text-white hover:bg-white/[0.08] active:scale-90 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#D4D4D8]"
        title="Previous Track"
      >
        <SkipBack className="w-4 h-4 fill-current" />
      </button>

      {/* Hero Play / Pause Button */}
      {isPlaying ? (
        <button
          type="button"
          aria-label="Pause"
          onClick={pause}
          disabled={!hasTrack}
          className="w-10 h-10 sm:w-10 sm:h-10 rounded-full bg-white hover:bg-[#F4F4F6] text-black flex items-center justify-center transition-all duration-150 shadow-[0_2px_12px_rgba(0,0,0,0.3)] hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
          title="Pause (Space)"
        >
          <Pause className="w-4 h-4 fill-black text-black" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Play"
          onClick={handlePlayToggle}
          disabled={!hasTrack}
          className="w-10 h-10 sm:w-10 sm:h-10 rounded-full bg-white hover:bg-[#F4F4F6] text-black flex items-center justify-center transition-all duration-150 shadow-[0_2px_12px_rgba(0,0,0,0.3)] hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
          title={hasTrack ? "Play (Space)" : "No song selected"}
        >
          <Play className="w-4 h-4 ml-0.5 fill-black text-black" />
        </button>
      )}

      {/* Next Track */}
      <button
        type="button"
        aria-label="Next Track"
        onClick={playNext}
        disabled={!canSkipForward}
        className="w-8 h-8 rounded-full flex items-center justify-center text-[#D4D4D8] hover:text-white hover:bg-white/[0.08] active:scale-90 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#D4D4D8]"
        title="Next Track"
      >
        <SkipForward className="w-4 h-4 fill-current" />
      </button>

      {/* Loop / Repeat Button */}
      <button
        type="button"
        aria-label="Toggle Repeat Mode"
        onClick={cycleLoopMode}
        disabled={!hasTrack}
        className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
          loopMode !== "Off" && hasTrack
            ? "text-[#FA586A] bg-[#FA586A]/15 border border-[#FA586A]/25"
            : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.06] active:scale-95"
        }`}
        title={!hasTrack ? "Repeat disabled (no track)" : `Repeat: ${loopMode}`}
      >
        {loopMode === "Track" && hasTrack ? (
          <Repeat1 className="w-3.5 h-3.5" />
        ) : (
          <Repeat className="w-3.5 h-3.5" />
        )}
        {loopMode !== "Off" && hasTrack && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#FA586A]" />
        )}
      </button>

      {/* Autoplay / Infinity Button */}
      <button
        type="button"
        aria-label="Toggle Autoplay"
        onClick={toggleAutoplay}
        className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none ${
          isAutoplay
            ? "text-[#FA586A] bg-[#FA586A]/15 border border-[#FA586A]/25"
            : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.06] active:scale-95"
        }`}
        title={
          isAutoplay
            ? playbackContext?.type === "tracks"
              ? "Autoplay is ON (Continuous playback for All Songs)"
              : "Autoplay is ON"
            : "Autoplay is OFF (Play only current track/queue)"
        }
      >
        <Infinity className="w-3.5 h-3.5" />
        {isAutoplay && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#FA586A]" />
        )}
      </button>

      {/* Stop Button */}
      <button
        type="button"
        aria-label="Stop Playback"
        onClick={stop}
        disabled={!hasTrack}
        className="w-8 h-8 rounded-lg items-center justify-center text-[#71717A] hover:text-[#FF453A] hover:bg-[#FF453A]/10 active:scale-95 transition-all duration-150 hidden md:inline-flex focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#71717A]"
        title="Stop Playback"
      >
        <Square className="w-3.5 h-3.5 fill-current" />
      </button>
    </div>
  );
};
const PlayControls = React.memo(PlayControlsInner);

/**
 * 3. Scrubber Subcomponent
 * Isolates 500ms position updates with local dragging state & hover timestamp tooltip for smooth 60fps interaction.
 */
const ScrubberInner: React.FC = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const positionSecs = usePlayerStore((s) => s.status.position_secs || 0);
  const durationSecs = usePlayerStore(
    (s) =>
      s.status.duration_secs || s.currentTrack?.metadata.duration?.secs || 0
  );
  const seek = usePlayerStore((s) => s.seek);

  const hasTrack = !!currentTrack;

  // Toggle between remaining time (-3:02) and total duration (3:57)
  const [showRemaining, setShowRemaining] = useState(true);

  // Local drag state to isolate high-speed slider sliding without thumb snapping
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState(0);

  // Hover scrub preview tooltip state
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const scrubberContainerRef = useRef<HTMLDivElement>(null);

  const displayPos = isDragging ? dragPos : positionSecs;
  const maxDuration = durationSecs > 0 ? durationSecs : 100;

  const handlePointerDown = useCallback(() => {
    if (!hasTrack) return;
    setIsDragging(true);
    setDragPos(positionSecs);
  }, [hasTrack, positionSecs]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasTrack) return;
    const val = parseFloat(e.target.value);
    setDragPos(val);
  }, [hasTrack]);

  const handlePointerUp = useCallback(() => {
    if (isDragging && hasTrack) {
      seek(dragPos);
      setIsDragging(false);
    }
  }, [isDragging, hasTrack, dragPos, seek]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!hasTrack || durationSecs <= 0 || !scrubberContainerRef.current) return;
      const rect = scrubberContainerRef.current.getBoundingClientRect();
      const relativeX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percentage = relativeX / rect.width;
      setHoverTime(percentage * durationSecs);
      setHoverX(relativeX);
    },
    [hasTrack, durationSecs]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverTime(null);
  }, []);

  return (
    <div
      className={`w-full flex items-center space-x-2 sm:space-x-3 text-xs text-[#71717A] group/scrubber select-none transition-opacity ${
        !hasTrack ? "opacity-35" : ""
      }`}
    >
      {/* Current Position Timestamp */}
      <span className="w-10 sm:w-11 text-right font-mono text-[11px] text-[#A1A1AA] tabular-nums flex-shrink-0 select-none">
        {hasTrack ? formatTime(displayPos) : "0:00"}
      </span>

      {/* Scrubber Range Bar with Hover Preview Tooltip */}
      <div
        ref={scrubberContainerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative w-full flex items-center min-w-[60px] py-1.5"
      >
        {/* Floating Timestamp Tooltip on Hover */}
        {hoverTime !== null && hasTrack && (
          <div
            className="absolute -top-6 px-1.5 py-0.5 rounded-[4px] bg-[#222228] text-white font-mono text-[10px] pointer-events-none shadow-lg border border-white/10 -translate-x-1/2 z-40 whitespace-nowrap animate-tooltip"
            style={{ left: `${hoverX}px` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}

        <input
          type="range"
          aria-label="Seek Position"
          min={0}
          max={maxDuration}
          step={0.1}
          disabled={!hasTrack}
          value={hasTrack ? displayPos : 0}
          onPointerDown={handlePointerDown}
          onChange={handleChange}
          onPointerUp={handlePointerUp}
          className="w-full wavery-slider disabled:opacity-30 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
          style={
            {
              "--slider-progress": `${
                maxDuration > 0 ? (displayPos / maxDuration) * 100 : 0
              }%`,
            } as React.CSSProperties
          }
        />
      </div>

      {/* Remaining / Total Duration Timestamp (Click to toggle) */}
      <button
        type="button"
        aria-label="Toggle remaining time or total duration"
        onClick={() => setShowRemaining((prev) => !prev)}
        disabled={!hasTrack}
        className="w-10 sm:w-11 text-left font-mono text-[11px] text-[#71717A] hover:text-[#A1A1AA] tabular-nums flex-shrink-0 cursor-pointer select-none transition-colors disabled:cursor-not-allowed disabled:hover:text-[#71717A]"
        title={showRemaining ? "Remaining time (click for total)" : "Total duration (click for remaining)"}
      >
        {hasTrack
          ? showRemaining
            ? formatRemainingTime(displayPos, durationSecs)
            : formatTime(durationSecs)
          : "0:00"}
      </button>
    </div>
  );
};
const Scrubber = React.memo(ScrubberInner);

/**
 * 4. VolumeControl Subcomponent
 * Subscribes ONLY to volume slice — does NOT re-render on position ticks.
 */
const VolumeControlInner: React.FC = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const volume = usePlayerStore((s) => s.status.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const volumeStep = useSettingsStore((s) => s.volumeStep);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const isDrawerOpen = useNavigationStore((s) => s.isNowPlayingDrawerOpen);
  const nowPlayingTab = useNavigationStore((s) => s.nowPlayingTab);
  const toggleDrawer = useNavigationStore((s) => s.toggleNowPlayingDrawer);
  const toggleFullscreen = useNavigationStore((s) => s.toggleFullscreenNowPlaying);
  const [prevVolume, setPrevVolume] = useState(1);

  const hasTrack = !!currentTrack;

  const handleToggleMute = useCallback(() => {
    if (volume > 0) {
      setPrevVolume(volume);
      setVolume(0);
    } else {
      setVolume(prevVolume || 0.8);
    }
  }, [volume, prevVolume, setVolume]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setVolume(Math.min(1, volume + volumeStep));
    } else if (e.deltaY > 0) {
      setVolume(Math.max(0, volume - volumeStep));
    }
  }, [volume, volumeStep, setVolume]);

  const VolumeIcon = useMemo(() => {
    if (volume === 0) return VolumeX;
    if (volume < 0.5) return Volume1;
    return Volume2;
  }, [volume]);

  const isLyricsActive = isDrawerOpen && nowPlayingTab === "lyrics";
  const isQueueActive = isDrawerOpen && nowPlayingTab === "queue";

  return (
    <div
      onWheel={handleWheel}
      className="flex items-center justify-end space-x-1.5 sm:space-x-2 md:space-x-2.5 min-w-0 w-[30%] max-w-sm flex-shrink-0"
    >
      {/* Lyrics Toggle Button */}
      <button
        type="button"
        aria-label="Lyrics"
        disabled={!hasTrack}
        onClick={() => toggleDrawer("lyrics")}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
          isLyricsActive
            ? "bg-[#FA586A]/20 text-[#FA586A] border border-[#FA586A]/30 shadow-sm"
            : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.06] active:scale-95"
        }`}
        title={hasTrack ? "Synchronized Lyrics" : "Lyrics unavailable"}
      >
        <Mic2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {/* Queue Drawer Trigger */}
      <button
        type="button"
        aria-label="Queue"
        onClick={() => toggleDrawer("queue")}
        className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none ${
          isQueueActive
            ? "bg-[#FA586A]/20 text-[#FA586A] border border-[#FA586A]/30 shadow-sm"
            : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.06] active:scale-95"
        }`}
        title="Queue"
      >
        <ListMusic className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        {queueLength > 0 && !isQueueActive && (
          <span className="absolute -top-1 -right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-[#FA586A] text-white font-bold font-mono text-[8.5px] flex items-center justify-center shadow-sm leading-none">
            {queueLength > 99 ? "99+" : queueLength}
          </span>
        )}
      </button>

      {/* Fullscreen Player Trigger */}
      <button
        type="button"
        aria-label="Fullscreen"
        disabled={!hasTrack}
        onClick={toggleFullscreen}
        className="w-8 h-8 rounded-lg items-center justify-center text-[#A1A1AA] hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all duration-150 flex-shrink-0 hidden sm:inline-flex focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        title={hasTrack ? "Fullscreen Player" : "Fullscreen unavailable"}
      >
        <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {/* Subtle Vertical Separator */}
      <div className="h-4 w-[1px] bg-white/[0.08] mx-0.5 flex-shrink-0" />

      {/* Volume Icon Button */}
      <button
        type="button"
        aria-label={volume === 0 ? "Unmute" : "Mute"}
        onClick={handleToggleMute}
        className="w-8 h-8 rounded-full flex items-center justify-center text-[#A1A1AA] hover:text-white hover:bg-white/[0.06] active:scale-90 transition-all duration-150 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
        title={volume === 0 ? "Unmute" : `Mute (${Math.round(volume * 100)}%)`}
      >
        <VolumeIcon
          className={`w-4 h-4 ${volume === 0 ? "text-[#FA586A]" : ""}`}
        />
      </button>

      {/* Volume Slider */}
      <div className="flex items-center min-w-[56px] max-w-[96px] w-16 sm:w-20 md:w-24">
        <input
          type="range"
          aria-label="Volume Slider"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full wavery-slider flex-shrink focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
          title={`Volume: ${Math.round(volume * 100)}%`}
          style={
            {
              "--slider-progress": `${volume * 100}%`,
            } as React.CSSProperties
          }
        />
      </div>
    </div>
  );
};
const VolumeControl = React.memo(VolumeControlInner);

/**
 * Mobile Miniplayer Subcomponent (< 640px)
 * Provides a touch-friendly, compact miniplayer with progress hairline,
 * artwork thumbnail, stacked title/artist, and primary playback controls.
 */
const MobilePlayerBarInner: React.FC = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const positionSecs = usePlayerStore((s) => s.status.position_secs || 0);
  const durationSecs = usePlayerStore(
    (s) => s.status.duration_secs || s.currentTrack?.metadata.duration?.secs || 0
  );
  const resume = usePlayerStore((s) => s.resume);
  const pause = usePlayerStore((s) => s.pause);
  const playNext = usePlayerStore((s) => s.playNext);
  const isLiked = useLibraryStore(
    (s) => !!currentTrack?.id && s.likedTrackIds.has(currentTrack.id)
  );
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const toggleDrawer = useNavigationStore((s) => s.toggleNowPlayingDrawer);
  const artworkUrl = useArtwork(currentTrack?.id);

  const progress =
    durationSecs > 0
      ? Math.min(100, Math.max(0, (positionSecs / durationSecs) * 100))
      : 0;
  const hasTrack = !!currentTrack;

  return (
    <div className="relative h-14 w-full flex items-center justify-between px-3 select-none">
      {/* Hairline Progress Bar */}
      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-white/[0.08] overflow-hidden pointer-events-none">
        <div
          className="h-full bg-[#FA586A] transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Track Info (Tappable to open Now Playing drawer) */}
      <div
        onClick={() => toggleDrawer()}
        className="flex items-center space-x-2.5 min-w-0 flex-1 pr-2 cursor-pointer group"
      >
        <div className="w-10 h-10 rounded-lg bg-[#1A1A20] flex items-center justify-center overflow-hidden flex-shrink-0 relative border border-white/[0.08] shadow-sm">
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <Music className="w-4 h-4 text-[#71717A]" />
          )}
          {isPlaying && (
            <div className="absolute bottom-0.5 right-0.5 px-0.5 py-0.5 rounded-[3px] bg-black/60 backdrop-blur-sm">
              <EqualizerWave isPlaying={true} size="xs" color="bg-[#FA586A]" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate leading-tight group-hover:text-[#FA586A] transition-colors">
            {currentTrack?.metadata.title || "No song selected"}
          </p>
          <p className="text-[11px] text-[#A1A1AA] truncate leading-tight mt-0.5">
            {currentTrack
              ? getFullTrackArtistString(currentTrack)
              : "Choose a track to play"}
          </p>
        </div>
      </div>

      {/* Mobile Action Controls */}
      <div className="flex items-center space-x-1 flex-shrink-0">
        {/* Like Button */}
        {hasTrack && (
          <button
            type="button"
            aria-label={isLiked ? "Unlike song" : "Like song"}
            onClick={(e) => {
              e.stopPropagation();
              toggleLike(currentTrack.id);
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition active:scale-90 ${
              isLiked ? "text-[#FA586A]" : "text-[#71717A] hover:text-white"
            }`}
          >
            <Heart className={`w-4 h-4 ${isLiked ? "fill-[#FA586A]" : ""}`} />
          </button>
        )}

        {/* Hero Play/Pause Button */}
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={!hasTrack}
          onClick={(e) => {
            e.stopPropagation();
            if (isPlaying) pause();
            else resume();
          }}
          className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-md active:scale-90 transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-black text-black" />
          ) : (
            <Play className="w-4 h-4 fill-black text-black ml-0.5" />
          )}
        </button>

        {/* Next Track Button */}
        <button
          type="button"
          aria-label="Next Track"
          disabled={!hasTrack}
          onClick={(e) => {
            e.stopPropagation();
            playNext();
          }}
          className="w-8 h-8 rounded-full flex items-center justify-center text-[#D4D4D8] hover:text-white active:scale-90 transition disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <SkipForward className="w-4 h-4 fill-current" />
        </button>
      </div>
    </div>
  );
};
const MobilePlayerBar = React.memo(MobilePlayerBarInner);

/**
 * Bottom-pinned playback bar decomposed into memoized subcomponents.
 * Follows Apple HIG surface design & Impeccable contrast rhythm.
 * Fluidly adapts between mobile miniplayer (<640px) and full desktop deck.
 */
const PlayerBarInner: React.FC = () => {
  return (
    <footer className="relative bg-[#101014]/98 border-t border-white/[0.08] backdrop-blur-3xl select-none z-30 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] flex-shrink-0">
      {/* Mobile Miniplayer Layout (< sm: 640px) */}
      <div className="sm:hidden flex flex-col w-full">
        <MobilePlayerBar />
      </div>

      {/* Tablet & Desktop Deck (>= sm: 640px) */}
      <div className="hidden sm:flex h-20 sm:h-[80px] px-3 sm:px-5 lg:px-6 items-center justify-between gap-2 sm:gap-4 w-full">
        <TrackInfo />
        <div className="flex flex-col items-center justify-center flex-1 max-w-xl px-1 sm:px-3 min-w-0">
          <PlayControls />
          <Scrubber />
        </div>
        <VolumeControl />
      </div>
    </footer>
  );
};

export const PlayerBar = React.memo(PlayerBarInner);

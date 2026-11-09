import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Play,
  Pause,
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
  Mic2,
  Maximize2,
  Disc,
  Users,
  Library,
  Copy,
  User,
  Infinity as InfinityIcon,
  EyeOff,
  Eye,
} from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { useArtwork } from "../utils/useArtwork";
import { getFullTrackArtistString } from "../utils/library";
import { ArtistLinks } from "./ArtistLinks";
import { useVsyncScrubber, formatTime, formatRemainingTime } from "../hooks/useVsyncScrubber";
import { VolumeSlider } from "./VolumeSlider";
import { generateWaveformBarHeights, FLAT_BAR_HEIGHT, DEFAULT_WAVEFORM_BAR_COUNT } from "../utils/waveform";

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
  const isArtistHidden = useSettingsStore((s) => s.isArtistHidden);
  const toggleHideArtist = useSettingsStore((s) => s.toggleHideArtist);

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
        const isHidden = isArtistHidden(currentTrack.metadata.artist);
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
          },
          {
            id: "toggle-hide-artist",
            label: isHidden ? `Unhide Artist (${artistName})` : `Hide Artist (${artistName})`,
            icon: isHidden ? Eye : EyeOff,
            onClick: () => {
              toggleHideArtist(currentTrack.metadata.artist || "");
            },
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
      isArtistHidden,
      toggleHideArtist,
    ]
  );

  return (
    <div
      onContextMenu={handleTrackContextMenu}
      className="flex items-center min-w-0 w-48 sm:w-56 md:w-64 lg:w-72 xl:w-80 flex-shrink min-w-[140px]"
    >
      {currentTrack ? (
        <div className="flex items-center space-x-2 sm:space-x-3 md:space-x-4 truncate group min-w-0 flex-1">
          {/* Artwork Squircle with Hover Indicator & Subtle Corner Equalizer */}
          <button
            type="button"
            onClick={() => toggleDrawer()}
            aria-label="Open Now Playing drawer"
            className="w-11 h-11 sm:w-12 sm:h-12 md:w-[48px] md:h-[48px] rounded-[10px] bg-surfaceHover flex items-center justify-center overflow-hidden flex-shrink-0 relative border border-white/[0.08] shadow-[0_4px_12px_rgba(0,0,0,0.35)] cursor-pointer hover:border-white/25 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none transition-all duration-200 group-hover:scale-[1.02] active:scale-[0.98]"
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
              <Music className="w-5 h-5 text-textMuted" />
            )}
          </button>

          {/* Track Metadata Hierarchy */}
          <div className="truncate min-w-0 flex-1 flex flex-col justify-center">
            {/* Top row: Track Title, Format Badge & Like Button */}
            <div className="flex items-center space-x-2 min-w-0">
              <span
                onClick={() => toggleDrawer()}
                className="text-xs sm:text-sm font-semibold text-white truncate tracking-tight cursor-pointer hover:text-accent transition-colors leading-tight"
                title={`${currentTrack.metadata.title || "Untitled"} (Click to open drawer)`}
              >
                {currentTrack.metadata.title || "Untitled"}
              </span>

              {formatBadge && (
                <span
                  className={`inline-flex items-center px-2 py-1 rounded-[4px] text-2xs font-semibold flex-shrink-0 border leading-none hidden xl:inline-flex ${
                    formatBadge.isLossless
                      ? "bg-accent/15 text-accent border-accent/30"
                      : "bg-white/[0.06] text-textSecondary border-white/[0.08]"
                  }`}
                  title={`${formatBadge.fmt} ${formatBadge.isLossless ? "Lossless Audio" : "High Quality"}`}
                >
                  {formatBadge.fmt}
                </span>
              )}

              {/* Heart / Favorite Button */}
              <button
                type="button"
                aria-label={isLiked ? "Unlike song" : "Like song"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLike(currentTrack.id);
                }}
                className={`p-1 rounded-full transition-all duration-200 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none ${
                  isLiked
                    ? "text-accent scale-105 hover:scale-115 active:scale-90"
                    : "text-textMuted hover:text-white hover:bg-white/[0.06] active:scale-95"
                }`}
                title={isLiked ? "Unlike song" : "Like song"}
              >
                <Heart
                  className={`w-3.5 h-3.5 transition-all duration-200 ${
                    isLiked ? "fill-accent filter drop-shadow-[0_0_6px_rgba(250,88,106,0.4)]" : ""
                  }`}
                />
              </button>
            </div>

            {/* Middle row: Artist Links & Album (Artist prioritized) */}
            <div className="text-2xs text-textSecondary truncate mt-1 flex items-center space-x-2 leading-snug">
              <ArtistLinks
                artistName={getFullTrackArtistString(currentTrack)}
                onSelectArtist={selectArtist}
                className="truncate block flex-shrink-0 max-w-[75%]"
                linkClassName="text-textSecondary hover:text-white hover:underline cursor-pointer transition-colors font-medium"
                delimiterClassName="text-textMuted"
              />
              {currentTrack.metadata.album &&
                playbackContext?.type !== "album" &&
                playbackContext?.name !== currentTrack.metadata.album && (
                  <>
                    <span className="text-textMuted/60 flex-shrink-0 hidden xl:inline">•</span>
                    <span
                      onClick={() =>
                        selectAlbum(
                          currentTrack.metadata.album || "",
                          currentTrack.metadata.artist || ""
                        )
                      }
                      className="text-textMuted hover:text-textSecondary hover:underline cursor-pointer truncate hidden xl:inline min-w-0 flex-1 transition-colors"
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
                className="hidden xl:flex items-center space-x-1 text-2xs text-textMuted hover:text-accent cursor-pointer transition-colors truncate mt-1 group/ctx"
                title={`Playing from ${playbackContext.type}: ${playbackContext.name}`}
              >
                <ContextIcon className="w-2.5 h-2.5 flex-shrink-0 text-accent group-hover/ctx:scale-110 transition-transform" />
                <span className="truncate text-2xs">
                  {playbackContext.type === "liked"
                    ? "Liked Songs"
                    : playbackContext.name}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center space-x-3 text-textMuted">
          <div className="w-12 h-12 rounded-[10px] bg-surface flex items-center justify-center border border-white/[0.06] shadow-sm">
            <Music className="w-5 h-5 opacity-30" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-textSecondary">No song selected</span>
            <span className="text-2xs text-textMuted">Choose a track to play</span>
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
  const loopMode = usePlayerStore((s) => s.loopMode);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const isAutoplay = usePlayerStore((s) => s.isAutoplay);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const userQueueLength = usePlayerStore((s) => s.userQueue.length);
  const shuffleIndices = usePlayerStore((s) => s.shuffleIndices);
  const shufflePos = usePlayerStore((s) => s.shufflePos);

  const resume = usePlayerStore((s) => s.resume);
  const pause = usePlayerStore((s) => s.pause);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);

  const libraryTracks = useLibraryStore((s) => s.tracks);
  const hasTrack = !!currentTrack;
  const canPlay = hasTrack || queueLength > 0 || libraryTracks.length > 0;

  const handlePlayToggle = useCallback(() => {
    if (isPlaying) {
      pause();
      return;
    }
    if (hasTrack) {
      resume();
      return;
    }
    const q = usePlayerStore.getState().queue;
    if (q.length > 0) {
      usePlayerStore.getState().playTrack(q[0]);
      return;
    }
    const libTracks = useLibraryStore.getState().tracks;
    if (libTracks.length > 0) {
      usePlayerStore.getState().playTrack(libTracks[0]);
    }
  }, [hasTrack, isPlaying, pause, resume]);

  const canSkipBack = hasTrack && (queueIndex > 0 || currentTrack !== undefined);
  const canSkipForward =
    hasTrack &&
    (userQueueLength > 0 ||
      loopMode === "Track" ||
      loopMode === "Queue" ||
      (isShuffle
        ? (shuffleIndices.length > 0 ? shufflePos < shuffleIndices.length - 1 : queueLength > 1)
        : queueIndex < queueLength - 1) ||
      isAutoplay);

  return (
    <div className="flex items-center space-x-1 sm:space-x-2 md:space-x-3 lg:space-x-4 mb-1">
      {/* Shuffle Button */}
      <button
        type="button"
        aria-label="Toggle Shuffle"
        onClick={toggleShuffle}
        disabled={!hasTrack}
        className={`relative w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:active:scale-100 ${
          isShuffle && hasTrack
            ? "text-accent bg-accent/15 border border-accent/25"
            : "text-textSecondary hover:text-white hover:bg-white/[0.06]"
        }`}
        title={!hasTrack ? "Shuffle disabled (no track)" : isShuffle ? "Shuffle is ON" : "Shuffle is OFF"}
      >
        <Shuffle className="w-3.5 h-3.5" />
        {isShuffle && hasTrack && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent-fill" />
        )}
      </button>

      {/* Previous Track */}
      <button
        type="button"
        aria-label="Previous Track"
        onClick={playPrevious}
        disabled={!canSkipBack}
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-textSecondary hover:text-textPrimary hover:bg-white/[0.08] active:scale-[0.88] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-textSecondary disabled:active:scale-100"
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
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white hover:bg-white/90 text-black flex items-center justify-center transition-[transform,background-color,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_2px_10px_rgba(0,0,0,0.3)] active:scale-[0.92] active:shadow-[0_1px_4px_rgba(0,0,0,0.25)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus:outline-none disabled:opacity-25 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none"
          title="Pause (Space)"
        >
          <Pause className="w-4 h-4 fill-black text-black" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Play"
          onClick={handlePlayToggle}
          disabled={!canPlay}
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white hover:bg-white/90 text-black flex items-center justify-center transition-[transform,background-color,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_2px_10px_rgba(0,0,0,0.3)] active:scale-[0.92] active:shadow-[0_1px_4px_rgba(0,0,0,0.25)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus:outline-none disabled:opacity-25 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none"
          title={hasTrack ? "Play (Space)" : canPlay ? "Play" : "No songs in library"}
        >
          <Play className="w-4 h-4 fill-black text-black" />
        </button>
      )}

      {/* Next Track */}
      <button
        type="button"
        aria-label="Next Track"
        onClick={playNext}
        disabled={!canSkipForward}
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-textSecondary hover:text-textPrimary hover:bg-white/[0.08] active:scale-[0.88] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-textSecondary disabled:active:scale-100"
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
        className={`relative w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:active:scale-100 ${
          loopMode !== "Off" && hasTrack
            ? "text-accent bg-accent/15 border border-accent/25"
            : "text-textSecondary hover:text-white hover:bg-white/[0.06]"
        }`}
        title={!hasTrack ? "Repeat disabled (no track)" : `Repeat: ${loopMode}`}
      >
        {loopMode === "Track" && hasTrack ? (
          <Repeat1 className="w-3.5 h-3.5" />
        ) : (
          <Repeat className="w-3.5 h-3.5" />
        )}
        {loopMode !== "Off" && hasTrack && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent-fill" />
        )}
      </button>
    </div>
  );
};
const PlayControls = React.memo(PlayControlsInner);

/**
 * 3. Scrubber Subcomponent
 * Uses useVsyncScrubber for display-refresh-rate (VSync: 60Hz/120Hz/144Hz) continuous progress
 * with zero-jank direct DOM updates and zero React re-render overhead during playback.
 */
const ScrubberInner: React.FC = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const positionSecs = usePlayerStore((s) => s.status.position_secs || 0);
  const durationSecs = usePlayerStore(
    (s) =>
      s.status.duration_secs || s.currentTrack?.metadata.duration?.secs || 0
  );
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const seek = usePlayerStore((s) => s.seek);

  const hasTrack = !!currentTrack;

  // Toggle between remaining time (-3:02) and total duration (3:57)
  const [showRemaining, setShowRemaining] = useState(true);

  // Scrubber container ref (used for both pointer events and VSync CSS variable updates)
  const scrubberContainerRef = useRef<HTMLDivElement>(null);

  // VSync 144Hz continuous interpolation hook
  const {
    sliderRef,
    currentTimeRef,
    remainingTimeRef,
    handlePointerDown,
    handleChange,
    handlePointerUp,
    handleContainerPointerDown,
    displayPos,
    isDragging,
  } = useVsyncScrubber({
    positionSecs,
    durationSecs,
    isPlaying,
    hasTrack,
    showRemaining,
    containerRef: scrubberContainerRef,
    onSeek: seek,
  });

  // Measure container width for responsive waveform bar density
  const [containerWidth, setContainerWidth] = useState<number>(0);

  useEffect(() => {
    const el = scrubberContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) {
          setContainerWidth((prev) => (Math.abs(prev - w) > 6 ? w : prev));
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute adaptive bar count to maintain ~3.5px-4px bar pitch
  const barCount = useMemo(() => {
    if (containerWidth <= 0) return DEFAULT_WAVEFORM_BAR_COUNT;
    // Each bar + gap is ~5.2px. Clamp between 24 and 96 bars
    return Math.max(24, Math.min(96, Math.floor(containerWidth / 5.2)));
  }, [containerWidth]);

  // Hover scrub preview tooltip state
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);

  const maxDuration = durationSecs > 0 ? durationSecs : 100;

  // Compute deterministic on-the-go waveform bar heights for the track (flat 3px if no track)
  const waveformBars = useMemo(
    () => generateWaveformBarHeights(currentTrack, barCount),
    [
      currentTrack?.id,
      currentTrack?.metadata?.title,
      currentTrack?.metadata?.artist,
      currentTrack?.metadata?.duration?.secs,
      barCount,
    ]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!hasTrack || durationSecs <= 0 || !scrubberContainerRef.current) return;
      const rect = scrubberContainerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
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

  const currentProgressPct = useMemo(() => {
    if (!hasTrack || maxDuration <= 0 || isNaN(displayPos)) return 0;
    return Math.max(0, Math.min(100, (displayPos / maxDuration) * 100));
  }, [hasTrack, maxDuration, displayPos]);

  return (
    <div
      className={`w-full flex items-center space-x-2 sm:space-x-3 text-xs text-textMuted group/scrubber select-none transition-opacity ${
        !hasTrack ? "opacity-35" : ""
      }`}
    >
      {/* Current Position Timestamp (interpolated on rAF) */}
      <span
        ref={currentTimeRef}
        className="w-9 sm:w-10 text-right font-mono text-2xs text-textSecondary tabular-nums flex-shrink-0 select-none"
      >
        {hasTrack ? formatTime(displayPos) : "0:00"}
      </span>

      {/* Scrubber Range Bar with Hover Preview Tooltip & Morphing Waveform */}
      <div
        ref={scrubberContainerRef}
        onPointerDown={handleContainerPointerDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative w-full flex items-center min-w-0 flex-1 h-8 py-1 cursor-pointer group/waveform group-focus-within/waveform:ring-1 group-focus-within/waveform:ring-accent/40 rounded-sm"
        style={
          {
            "--slider-progress": `${currentProgressPct}%`,
          } as React.CSSProperties
        }
      >
        {/* Floating Timestamp Tooltip on Hover */}
        {hoverTime !== null && hasTrack && (
          <div
            className="absolute -top-7 px-2 py-1 rounded-[4px] bg-surfaceHover text-white font-mono text-2xs pointer-events-none shadow-lg border border-white/10 -translate-x-1/2 z-40 whitespace-nowrap animate-tooltip"
            style={{ left: `clamp(24px, ${hoverX}px, calc(100% - 24px))` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}

        {/* Hover ghost playhead line */}
        {hoverTime !== null && hasTrack && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-[1.5px] h-4 rounded-full bg-white/40 pointer-events-none -translate-x-1/2 z-20 transition-opacity duration-100"
            style={{ left: `clamp(1px, ${hoverX}px, calc(100% - 1px))` }}
          />
        )}

        {/* Waveform Bar Track Visualizer (Starts flat at 3px, morphs into waveform peaks when track opened) */}
        <div className="relative w-full h-full flex items-center overflow-hidden rounded-sm">
          {/* Base Unplayed Layer (Dimmed Inactive Bars) */}
          <div
            className="absolute inset-0 flex items-center justify-between pointer-events-none"
            style={{ gap: "1.5px" }}
          >
            {waveformBars.map((height, idx) => (
              <div
                key={idx}
                className="flex-1 rounded-full wavery-waveform-bar-inactive transition-[height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] min-w-0"
                style={{
                  height: `${hasTrack ? height : FLAT_BAR_HEIGHT}px`,
                }}
              />
            ))}
          </div>

          {/* Active Played Layer (Accent Color / Gradient Morphing Waveform) */}
          <div
            className="absolute inset-0 flex items-center justify-between pointer-events-none overflow-hidden"
            style={{
              gap: "1.5px",
              clipPath:
                "inset(0 calc(100% - clamp(0%, var(--slider-progress, 0%), 100%)) 0 0)",
            }}
          >
            {waveformBars.map((height, idx) => (
              <div
                key={idx}
                className="flex-1 rounded-full wavery-waveform-bar-active transition-[height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] min-w-0"
                style={{
                  height: `${hasTrack ? height : FLAT_BAR_HEIGHT}px`,
                }}
              />
            ))}
          </div>

          {/* Sleek Apple HIG Scrubber Thumb Indicator */}
          {hasTrack && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)] border border-black/10 pointer-events-none transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] z-20 ${
                isDragging
                  ? "opacity-100 scale-125 shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                  : "opacity-0 group-hover/waveform:opacity-100"
              }`}
              style={{
                left: "clamp(5px, var(--slider-progress, 0%), calc(100% - 5px))",
              }}
            />
          )}

          {/* Accessible Native Range Input */}
          <input
            ref={sliderRef}
            type="range"
            aria-label="Seek Position"
            min={0}
            max={maxDuration}
            step={0.05}
            disabled={!hasTrack}
            defaultValue={hasTrack ? displayPos : 0}
            onPointerDown={handlePointerDown}
            onInput={handleChange}
            onChange={handleChange}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-30 focus:outline-none"
          />
        </div>
      </div>

      {/* Remaining / Total Duration Timestamp (Click to toggle) */}
      <button
        type="button"
        aria-label="Toggle remaining time or total duration"
        onClick={() => setShowRemaining((prev) => !prev)}
        disabled={!hasTrack}
        className="w-9 sm:w-10 text-left font-mono text-2xs text-textMuted hover:text-textSecondary tabular-nums flex-shrink-0 cursor-pointer select-none transition-colors disabled:cursor-not-allowed disabled:hover:text-textMuted"
        title={showRemaining ? "Remaining time (click for total)" : "Total duration (click for remaining)"}
      >
        <span ref={remainingTimeRef}>
          {hasTrack
            ? showRemaining
              ? formatRemainingTime(displayPos, durationSecs)
              : formatTime(durationSecs)
            : "0:00"}
        </span>
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
  const isAutoplay = usePlayerStore((s) => s.isAutoplay);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
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
      className="flex items-center justify-end space-x-1 sm:space-x-2 md:space-x-2 lg:space-x-3 flex-shrink-0 min-w-fit"
    >
      {/* Autoplay Toggle Button */}
      <button
        type="button"
        aria-label="Toggle Autoplay"
        onClick={toggleAutoplay}
        className={`relative w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92] flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none ${
          isAutoplay
            ? "bg-accent/20 text-accent border border-accent/30 shadow-sm"
            : "text-textSecondary hover:text-white hover:bg-white/[0.06]"
        }`}
        title={
          isAutoplay
            ? "Autoplay is ON (similar songs will play when queue ends)"
            : "Autoplay is OFF (playback will stop when queue ends)"
        }
      >
        <InfinityIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        {isAutoplay && (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent-fill" />
        )}
      </button>

      {/* Lyrics Toggle Button */}
      <button
        type="button"
        aria-label="Lyrics"
        disabled={!hasTrack}
        onClick={() => toggleDrawer("lyrics")}
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92] flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:active:scale-100 ${
          isLyricsActive
            ? "bg-accent/20 text-accent border border-accent/30 shadow-sm"
            : "text-textSecondary hover:text-white hover:bg-white/[0.06]"
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
        className={`relative w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92] flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none ${
          isQueueActive
            ? "bg-accent/20 text-accent border border-accent/30 shadow-sm"
            : "text-textSecondary hover:text-white hover:bg-white/[0.06]"
        }`}
        title="Queue"
      >
        <ListMusic className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        {queueLength > 0 && !isQueueActive && (
          <span className="absolute -top-1 -right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-accent-fill text-white font-bold font-mono text-2xs flex items-center justify-center shadow-sm leading-none">
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
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg items-center justify-center text-textSecondary hover:text-white hover:bg-white/[0.06] active:scale-[0.92] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] flex-shrink-0 hidden xl:inline-flex focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:active:scale-100"
        title={hasTrack ? "Fullscreen Player" : "Fullscreen unavailable"}
      >
        <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      </button>

      {/* Subtle Vertical Separator */}
      <div className="hidden lg:block h-4 w-[1px] bg-white/[0.08] mx-1 flex-shrink-0" />

      {/* Volume Icon Button */}
      <button
        type="button"
        aria-label={volume === 0 ? "Unmute" : "Mute"}
        onClick={handleToggleMute}
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-textSecondary hover:text-white hover:bg-white/[0.06] active:scale-[0.88] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
        title={volume === 0 ? "Unmute" : `Mute (${Math.round(volume * 100)}%)`}
      >
        <VolumeIcon
          className={`w-4 h-4 ${volume === 0 ? "text-accent" : ""}`}
        />
      </button>

      {/* Volume Slider */}
      <div className="group/volume items-center min-w-[48px] max-w-[96px] w-14 sm:w-16 md:w-20 lg:w-24 hidden md:flex">
        <VolumeSlider
          className="w-full flex-shrink focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
          ariaLabel="Volume Slider"
        />
      </div>
    </div>
  );
};
const VolumeControl = React.memo(VolumeControlInner);

/**
 * Bottom-pinned playback bar decomposed into memoized subcomponents.
 * Follows Apple HIG surface design & Impeccable contrast rhythm.
 *
 * Tablet and desktop only. Below the `sm` breakpoint the mobile
 * MobileNowPlayingSheet takes over, so the two surfaces never coexist.
 */
const PlayerBarInner: React.FC = () => {
  return (
    <footer className="relative hidden sm:flex bg-deck/98 border-t border-white/[0.08] backdrop-blur-3xl select-none z-30 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] flex-shrink-0 safe-player-bottom">
      <div className="flex h-20 sm:h-[80px] px-3 sm:px-4 md:px-5 lg:px-6 items-center justify-between gap-2 sm:gap-3 md:gap-4 w-full overflow-hidden">
        <TrackInfo />
        <div className="flex flex-col items-center justify-center flex-1 max-w-xl mx-auto px-2 min-w-[160px] relative">
          <PlayControls />
          <Scrubber />
        </div>
        <VolumeControl />
      </div>
    </footer>
  );
};

export const PlayerBar = React.memo(PlayerBarInner);

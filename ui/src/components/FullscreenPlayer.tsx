import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Music,
  Minimize2,
  Volume2,
  Volume1,
  VolumeX,
  Mic2,
  Search,
  Loader2,
  Disc,
} from "lucide-react";
import { fetchLyrics } from "../services/lyrics";
import { playerAdapter } from "../services/adapter";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useArtwork } from "../utils/useArtwork";
import { getFullTrackArtistString } from "../utils/library";
import { parseLrc, getActiveLyricIndex, hasLrcTimestamps } from "../utils/lyrics";
import { ArtistLinks } from "./ArtistLinks";
import { useVsyncScrubber, formatTime, formatRemainingTime } from "../hooks/useVsyncScrubber";
import { VolumeSlider } from "./VolumeSlider";
import { windowService } from "../services/windowService";

/**
 * Isolated volume control subcomponent for FullscreenPlayer.
 * Prevents re-rendering the heavy lyrics canvas and cover art during 60fps/120fps volume drags.
 */
const FullscreenVolumeControl: React.FC = React.memo(() => {
  const volume = usePlayerStore((s) => s.status.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const [prevVolume, setPrevVolume] = useState<number>(0.8);

  const handleToggleMute = useCallback(() => {
    if (volume > 0) {
      setPrevVolume(volume);
      setVolume(0);
    } else {
      setVolume(prevVolume || 0.8);
    }
  }, [volume, prevVolume, setVolume]);

  const VolumeIcon = useMemo(() => {
    if (volume === 0) return VolumeX;
    if (volume < 0.5) return Volume1;
    return Volume2;
  }, [volume]);

  return (
    <div className="group/volume hidden sm:flex items-center space-x-2 w-1/4">
      <button
        type="button"
        onClick={handleToggleMute}
        className="text-textMuted hover:text-textPrimary hover:bg-surfaceHover active:scale-[0.88] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
        title={volume === 0 ? "Unmute" : `Mute (${Math.round(volume * 100)}%)`}
      >
        <VolumeIcon className="w-4 h-4" />
      </button>
      <VolumeSlider className="w-20 sm:w-24" ariaLabel="Fullscreen Volume Slider" />
    </div>
  );
});
FullscreenVolumeControl.displayName = "FullscreenVolumeControl";

export const FullscreenPlayer: React.FC = () => {
  const isOpen = useNavigationStore((s) => s.isFullscreenNowPlayingOpen);
  const closeFullscreen = useNavigationStore((s) => s.toggleFullscreenNowPlaying);
  const selectArtist = useNavigationStore((s) => s.selectArtist);
  const selectAlbum = useNavigationStore((s) => s.selectAlbum);
  const selectPlaylist = useNavigationStore((s) => s.selectPlaylist);
  const navigate = useNavigationStore((s) => s.navigate);
  const showLyricsSmoothScroll = useSettingsStore((s) => s.showLyricsSmoothScroll);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const positionSecs = usePlayerStore((s) => s.status.position_secs || 0);
  const durationSecs = usePlayerStore(
    (s) =>
      s.status.duration_secs || s.currentTrack?.metadata.duration?.secs || 0
  );
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const loopMode = usePlayerStore((s) => s.status.loop_mode);
  const isLiked = useLibraryStore(
    (s) => !!currentTrack?.id && s.likedTrackIds.has(currentTrack.id)
  );
  const toggleLike = useLibraryStore((s) => s.toggleLike);

  const resume = usePlayerStore((s) => s.resume);
  const pause = usePlayerStore((s) => s.pause);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const seek = usePlayerStore((s) => s.seek);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);

  const artworkUrl = useArtwork(currentTrack?.id);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Transition lifecycle for smooth interruptible stage enter/exit
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isExiting, setIsExiting] = useState(false);
  const lastActiveTrackRef = useRef(currentTrack);
  const exitTimeoutRef = useRef<number | null>(null);

  if (currentTrack) {
    lastActiveTrackRef.current = currentTrack;
  }
  const activeTrack = currentTrack || lastActiveTrackRef.current;

  useEffect(() => {
    if (isOpen) {
      if (exitTimeoutRef.current !== null) {
        window.clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
      setIsRendered(true);
      setIsExiting(false);
    } else if (isRendered && !isExiting) {
      setIsExiting(true);
      exitTimeoutRef.current = window.setTimeout(() => {
        setIsRendered(false);
        setIsExiting(false);
        exitTimeoutRef.current = null;
      }, 220); // Matches .fullscreen-stage-exiting animation duration (200ms + buffer)
    }

    return () => {
      if (exitTimeoutRef.current !== null) {
        window.clearTimeout(exitTimeoutRef.current);
      }
    };
  }, [isOpen, isRendered, isExiting]);

  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [lyricsFetchError, setLyricsFetchError] = useState<string | null>(null);

  const isSyncedLyrics = useMemo(
    () => hasLrcTimestamps(activeTrack?.metadata.lyrics),
    [activeTrack?.metadata.lyrics]
  );

  const handleFetchLyricsOnline = async (forceRefresh: boolean = false) => {
    if (!activeTrack) return;
    setIsFetchingLyrics(true);
    setLyricsFetchError(null);
    try {
      const res = await fetchLyrics(
        activeTrack.metadata.artist || "",
        activeTrack.metadata.title || "",
        activeTrack.metadata.album,
        activeTrack.metadata.duration.secs,
        forceRefresh
      );
      if (res?.bestLyrics) {
        const updated = await playerAdapter.updateTrackMetadata({
          track_id: activeTrack.id,
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

  // VSync continuous interpolation hook for scrubber
  const {
    sliderRef,
    currentTimeRef,
    remainingTimeRef,
    handlePointerDown,
    handleChange,
    handlePointerUp,
    handleContainerPointerDown,
    displayPos,
  } = useVsyncScrubber({
    positionSecs,
    durationSecs,
    isPlaying: isRendered && isPlaying,
    hasTrack: isRendered && !!activeTrack,
    showRemaining: true,
    onSeek: seek,
  });

  const maxDuration = durationSecs > 0 ? durationSecs : 100;

  // Keyboard Shortcuts (Esc to close, Space to toggle play)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeFullscreen();
      } else if (e.key === " " && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        e.stopPropagation();
        if (isPlaying) pause();
        else resume();
      } else if (e.key === "ArrowRight" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        e.stopPropagation();
        seek(Math.min(durationSecs, positionSecs + 5));
      } else if (e.key === "ArrowLeft" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        e.stopPropagation();
        seek(Math.max(0, positionSecs - 5));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isPlaying, positionSecs, durationSecs, closeFullscreen, pause, resume, seek]);

  // Parse real lyrics only (no placeholder fallback)
  const lyrics = useMemo(() => {
    if (!activeTrack) return [];
    let rawLyrics = activeTrack.metadata?.lyrics;
    if (!rawLyrics || !rawLyrics.trim()) {
      const libraryTrack = useLibraryStore.getState().tracks.find((t) => t.id === activeTrack.id);
      if (libraryTrack?.metadata?.lyrics) {
        rawLyrics = libraryTrack.metadata.lyrics;
      }
    }
    if (rawLyrics && rawLyrics.trim()) {
      return parseLrc(rawLyrics);
    }
    return [];
  }, [activeTrack]);

  const activeLyricIndex = useMemo(() => {
    return getActiveLyricIndex(lyrics, displayPos);
  }, [lyrics, displayPos]);

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
    // Programmatic auto-scroll from playback will never have isPointerDownRef.current === true.
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

  // Reset browsing state on unmount or track switch
  useEffect(() => {
    setIsLyricsBrowsing(false);
    if (browsingTimeoutRef.current !== null) {
      window.clearTimeout(browsingTimeoutRef.current);
      browsingTimeoutRef.current = null;
    }
  }, [activeTrack?.id]);

  // Auto-scroll lyrics container to active line, re-centering immediately on window state change
  useEffect(() => {
    if (!isRendered || activeLyricIndex < 0 || !lyricsContainerRef.current) return;
    if (isLyricsBrowsing) return;

    scrollActiveLyric();
    return windowService.onWindowStateChange(scrollActiveLyric);
  }, [activeLyricIndex, isRendered, isLyricsBrowsing, scrollActiveLyric]);



  const handleContextClick = () => {
    if (!playbackContext) return;
    closeFullscreen();
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

  const enableGradients = useSettingsStore((s) => s.enableGradients);

  if (!isRendered || !activeTrack) return null;

  return (
    <div
      className={`fixed inset-0 z-50 bg-background text-textPrimary flex flex-col justify-between overflow-hidden select-none ${
        isExiting ? "fullscreen-stage-exiting" : "fullscreen-stage-entering"
      }`}
    >
      {/* Calm Ambient Background Depth */}
      {enableGradients && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-25">
          {artworkUrl && (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-30 blur-[120px] scale-110 transition-opacity duration-700 ease-out"
              style={{ backgroundImage: `url(${artworkUrl})` }}
            />
          )}
          <div
            className={`absolute -top-1/4 -left-1/4 w-[90vw] h-[90vw] rounded-full bg-gradient-to-br from-accent/15 via-accent/5 to-transparent blur-[160px] ${
              isPlaying ? "animate-ambient-drift" : ""
            }`}
          />
          <div
            className={`absolute -bottom-1/4 -right-1/4 w-[80vw] h-[80vw] rounded-full bg-gradient-to-tl from-surfaceHover/30 via-transparent to-transparent blur-[180px] ${
              isPlaying ? "animate-ambient-drift-reverse" : ""
            }`}
          />
        </div>
      )}

      {/* Top Bar */}
      <header className="fullscreen-header-choreo relative z-10 px-4 py-4 safe-fullscreen-header sm:px-8 sm:py-6 flex items-center justify-between flex-shrink-0">
        {/* Left: View Identifier (Clean typography without W icon) */}
        <div className="flex items-center">
          <span className="text-xs font-medium text-textMuted select-none">
            Now Playing
          </span>
        </div>

        {/* Center: Playback Context (Apple Music Subdued Header) */}
        {playbackContext ? (
          <button
            onClick={handleContextClick}
            className="flex flex-col items-center group transition text-center focus:outline-none max-w-[200px] sm:max-w-sm truncate"
            title={`Jump to ${playbackContext.name}`}
          >
            <span className="text-2xs sm:text-2xs text-textMuted font-medium transition-colors group-hover:text-textSecondary truncate">
              {playbackContext.type === "liked" ? "Playing from Liked Songs" : `Playing from ${playbackContext.type}`}
            </span>
            <span className="text-xs sm:text-sm font-medium text-textSecondary group-hover:text-textPrimary transition-colors truncate">
              {playbackContext.name}
            </span>
          </button>
        ) : (
          <div />
        )}

        {/* Right: Exit / Dismiss Button */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <span className="text-xs text-textMuted hidden md:inline font-medium">
            Press <kbd className="px-2 py-1 rounded bg-surfaceHover border border-borderSubtle text-textSecondary font-mono text-2xs">Esc</kbd> to exit
          </span>
          <button
            onClick={closeFullscreen}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-surfaceHover hover:bg-surfaceActive active:scale-95 text-textSecondary hover:text-textPrimary flex items-center justify-center transition shadow-sm border border-border focus:outline-none"
            title="Exit Fullscreen (Esc)"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Split Screen Area */}
      <main className="relative z-10 flex-1 flex flex-col lg:flex-row items-center justify-center px-4 sm:px-8 md:px-16 lg:px-24 gap-6 sm:gap-10 lg:gap-20 overflow-y-auto lg:overflow-hidden max-w-7xl mx-auto w-full">
        {/* Left Column: Huge Album Art & Credits */}
        <div className="fullscreen-artwork-choreo flex flex-col items-center lg:items-start text-center lg:text-left space-y-4 sm:space-y-6 max-w-lg w-full flex-shrink-0">
          <div
            key={`art-${activeTrack.id}`}
            className={`relative aspect-square w-48 sm:w-64 md:w-80 lg:w-96 rounded-2xl bg-surfaceActive/40 overflow-hidden border border-border group animate-track-switch transition-[transform,opacity,box-shadow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isPlaying
                ? "scale-100 shadow-2xl shadow-black/80"
                : "scale-95 shadow-xl shadow-black/50 opacity-90"
            }`}
          >
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={activeTrack.metadata.title || "Artwork"}
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500 ease-out"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-surfaceActive/40">
                <Music className="w-16 h-16 sm:w-24 sm:h-24 text-textMuted/40" />
              </div>
            )}
          </div>

          <div key={`meta-${activeTrack.id}`} className="space-y-2 w-full animate-track-switch">
            <div className="flex items-start justify-center lg:justify-start gap-3">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-textPrimary tracking-tight leading-snug line-clamp-2">
                {activeTrack.metadata.title || "Untitled"}
              </h1>
              <button
                onClick={() => toggleLike(activeTrack.id)}
                className={`p-2 mt-1 rounded-lg transition-transform active:scale-75 focus:outline-none ${
                  isLiked ? "text-accent scale-110" : "text-textMuted hover:text-textPrimary"
                }`}
                title={isLiked ? "Unlike song" : "Like song"}
              >
                <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
              </button>
            </div>

            <div className="text-base text-textSecondary font-medium truncate">
              <ArtistLinks
                artistName={getFullTrackArtistString(activeTrack)}
                onSelectArtist={(name) => {
                  closeFullscreen();
                  selectArtist(name);
                }}
                className="truncate"
                linkClassName="hover:text-textPrimary hover:underline cursor-pointer transition-colors"
                delimiterClassName="text-textMuted"
              />
            </div>

            {activeTrack.metadata.album && (
              <p
                onClick={() => {
                  closeFullscreen();
                  selectAlbum(
                    activeTrack.metadata.album || "",
                    activeTrack.metadata.artist || ""
                  );
                }}
                className="text-xs text-textMuted hover:text-textPrimary cursor-pointer hover:underline truncate transition inline-block"
              >
                {activeTrack.metadata.album}
                {activeTrack.metadata.year ? ` • ${activeTrack.metadata.year}` : ""}
              </p>
            )}

            <div className="pt-1 flex items-center justify-center lg:justify-start">
              <span className="inline-flex items-center px-2 py-1 rounded-[4px] bg-surfaceHover border border-border text-2xs font-medium text-textSecondary">
                {activeTrack.metadata.format.toUpperCase() === "FLAC" ||
                activeTrack.metadata.format.toUpperCase() === "WAV"
                  ? "Lossless"
                  : "High Quality"}{" "}
                • {activeTrack.metadata.format.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Time-Synchronized Live Lyrics */}
        <div className="fullscreen-lyrics-choreo flex-1 w-full h-80 sm:h-96 lg:h-[500px] flex flex-col overflow-hidden relative">
          {lyrics.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
              <Mic2 className="w-10 h-10 text-textMuted/40 stroke-[1.5]" />
              <p className="text-sm font-semibold text-textSecondary">
                No lyrics available for this track
              </p>
              <p className="text-xs text-textMuted max-w-xs">
                Search online or place an .lrc file in your track folder.
              </p>
              <button
                type="button"
                onClick={() => handleFetchLyricsOnline(true)}
                disabled={isFetchingLyrics}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-accent-fill hover:bg-accentHover active:scale-95 transition shadow-lg shadow-accent/20 disabled:opacity-50"
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
                <p className="text-2xs text-rose-400">{lyricsFetchError}</p>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {!isSyncedLyrics && (
                <div className="flex items-center justify-between pb-3 border-b border-border/40 mb-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-medium text-textMuted bg-surface px-2 py-1 rounded border border-border/50">
                      Plain Lyrics
                    </span>
                    <span className="text-2xs text-textMuted">Not synced to audio</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFetchLyricsOnline(true)}
                    disabled={isFetchingLyrics}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-semibold text-textPrimary bg-surfaceHover hover:bg-border/60 border border-border active:scale-95 transition disabled:opacity-50"
                    title="Search LRCLIB for time-synced lyrics"
                  >
                    {isFetchingLyrics ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Searching...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5 text-accent" />
                        <span>Search Synced Lyrics</span>
                      </>
                    )}
                  </button>
                </div>
              )}
              <div
                ref={lyricsContainerRef}
                key={`lyrics-${activeTrack.id}`}
                data-lyrics-browsing={isLyricsBrowsing ? "true" : "false"}
                onWheel={handleUserScroll}
                onTouchMove={handleUserScroll}
                onPointerDown={handleLyricsPointerDown}
                onScroll={handleContainerScroll}
                className="wavery-lyrics-mask flex-1 overflow-y-auto space-y-6 py-20 scroll-smooth pr-4 relative"
              >
                {lyrics.map((line, idx) => {
                  if (!isSyncedLyrics) {
                    return (
                      <p
                        key={`plain-${idx}`}
                        className="text-xl sm:text-2xl md:text-3xl font-semibold text-textSecondary select-text leading-relaxed hover:text-textPrimary transition"
                      >
                        {line.text}
                      </p>
                    );
                  }

                  const isActive = idx === activeLyricIndex;
                  const isPast = idx < activeLyricIndex;
                  const distance = Math.abs(idx - activeLyricIndex);
                  const distanceAttr = isActive ? "0" : distance === 1 ? "1" : distance === 2 ? "2" : "far";
                  const stateAttr = isActive ? "active" : isPast ? "past" : "upcoming";

                  return (
                    <p
                      key={`${line.time}-${idx}`}
                      onClick={() => {
                        seek(line.time);
                        handleFocusLyrics();
                      }}
                      data-lyric-state={stateAttr}
                      data-lyric-distance={distanceAttr}
                      style={{ "--lyric-stagger": Math.min(idx, 12) } as React.CSSProperties}
                      className={`wavery-lyric-line lyric-line-cascade cursor-pointer transition-[transform,opacity,color,filter] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform transform origin-left select-none ${
                        isActive
                          ? "text-2xl sm:text-3xl md:text-4xl font-bold text-textPrimary scale-105 translate-x-2 text-shadow-lg opacity-100"
                          : isPast
                          ? "text-lg sm:text-xl md:text-2xl font-bold text-textMuted/40 hover:text-textSecondary hover:translate-x-1"
                          : "text-lg sm:text-xl md:text-2xl font-bold text-textMuted hover:text-textPrimary hover:translate-x-1"
                      }`}
                    >
                      {line.text}
                    </p>
                  );
                })}
              </div>

              {/* Floating Return-to-Sync Pill (Apple Music style) */}
              {isLyricsBrowsing && isSyncedLyrics && (
                <button
                  type="button"
                  onClick={handleFocusLyrics}
                  className="absolute bottom-6 right-8 z-20 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface/90 hover:bg-surfaceActive text-textPrimary text-xs font-medium border border-border shadow-lg backdrop-blur-md active:scale-95 transition-all duration-200 animate-fade-in"
                  title="Resume auto-scroll and focus current lyric"
                >
                  <Disc className="w-3.5 h-3.5 text-accent animate-spin" style={{ animationDuration: "3s" }} />
                  <span>Sync with Song</span>
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bottom Transport Controls & Scrubber */}
      <footer className="fullscreen-transport-choreo relative z-10 px-4 py-4 safe-fullscreen-footer sm:px-8 sm:py-6 max-w-5xl mx-auto w-full flex-shrink-0 space-y-3 sm:space-y-4">
        {/* Scrubber Bar */}
        <div className="w-full flex items-center space-x-2 sm:space-x-4 text-xs select-none">
          <span
            ref={currentTimeRef}
            className="w-10 sm:w-12 text-right font-mono text-xs sm:text-sm text-textMuted tabular-nums"
          >
            {formatTime(displayPos)}
          </span>
          <div
            onPointerDown={handleContainerPointerDown}
            className="relative w-full flex items-center py-2 cursor-pointer"
          >
            <input
              ref={sliderRef}
              type="range"
              aria-label="Seek Position"
              min={0}
              max={maxDuration}
              step={0.05}
              defaultValue={displayPos}
              onPointerDown={handlePointerDown}
              onInput={handleChange}
              onChange={handleChange}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="w-full wavery-slider focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
              style={{ "--slider-progress": `${maxDuration > 0 ? (displayPos / maxDuration) * 100 : 0}%` } as React.CSSProperties}
            />
          </div>
          <span
            ref={remainingTimeRef}
            className="w-10 sm:w-12 text-left font-mono text-xs sm:text-sm text-textMuted tabular-nums"
          >
            {formatRemainingTime(displayPos, durationSecs)}
          </span>
        </div>

        {/* Transport Controls & Volume */}
        <div className="flex items-center justify-between w-full pt-1">
          {/* Left Volume */}
          <FullscreenVolumeControl />

          {/* Center Main Transport */}
          <div className="flex items-center space-x-2 sm:space-x-6 justify-center flex-1">
            <button
              type="button"
              onClick={toggleShuffle}
              className={`p-2 rounded-xl transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92] ${
                isShuffle ? "text-accent bg-accent/15 hover:bg-accent/20" : "text-textMuted hover:text-textPrimary hover:bg-surfaceHover"
              }`}
              title="Shuffle"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={playPrevious}
              className="text-textSecondary hover:text-textPrimary active:scale-[0.88] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] p-2 rounded-xl hover:bg-surfaceHover"
              title="Previous"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={isPlaying ? pause : resume}
              className="w-12 h-12 rounded-full bg-white text-black hover:bg-white/90 active:scale-[0.92] flex items-center justify-center transition-[transform,background-color,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={playNext}
              className="text-textSecondary hover:text-textPrimary active:scale-[0.88] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] p-2 rounded-xl hover:bg-surfaceHover"
              title="Next"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={cycleLoopMode}
              className={`p-2 rounded-xl transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92] ${
                loopMode !== "Off"
                  ? "text-accent bg-accent/15 hover:bg-accent/20"
                  : "text-textMuted hover:text-textPrimary hover:bg-surfaceHover"
              }`}
              title={`Repeat: ${loopMode}`}
            >
              {loopMode === "Track" ? (
                <Repeat1 className="w-4 h-4" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Right Balanced Spacer (No redundant Exit button) */}
          <div className="hidden sm:block w-1/4" />
        </div>
      </footer>
    </div>
  );
};

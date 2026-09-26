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
  Infinity,
} from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useArtwork } from "../utils/useArtwork";
import { getFullTrackArtistString } from "../utils/library";
import { parseLrc, getActiveLyricIndex } from "../utils/lyrics";
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
    <div className="hidden sm:flex items-center space-x-2 w-1/4">
      <button
        type="button"
        onClick={handleToggleMute}
        className="text-textMuted hover:text-textPrimary hover:bg-surfaceHover transition p-1.5 focus:outline-none rounded-lg"
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
  const isAutoplay = usePlayerStore((s) => s.isAutoplay);
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
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);

  const artworkUrl = useArtwork(currentTrack?.id);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

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
    isPlaying: isOpen && isPlaying,
    hasTrack: isOpen && !!currentTrack,
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
    return getActiveLyricIndex(lyrics, displayPos);
  }, [lyrics, displayPos]);

  // Auto-scroll lyrics container to active line, re-centering immediately on window state change
  useEffect(() => {
    if (!isOpen || activeLyricIndex < 0 || !lyricsContainerRef.current) return;
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
  }, [activeLyricIndex, isOpen, showLyricsSmoothScroll]);



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

  if (!isOpen || !currentTrack) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background text-textPrimary flex flex-col justify-between overflow-hidden select-none animate-fade-in">
      {/* Calm Ambient Background Depth */}
      {enableGradients && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-25">
          <div className="absolute -top-1/4 -left-1/4 w-[90vw] h-[90vw] rounded-full bg-gradient-to-br from-accent/15 via-accent/5 to-transparent blur-[160px]" />
          <div className="absolute -bottom-1/4 -right-1/4 w-[80vw] h-[80vw] rounded-full bg-gradient-to-tl from-surfaceHover/30 via-transparent to-transparent blur-[180px]" />
        </div>
      )}

      {/* Top Bar */}
      <header className="relative z-10 px-4 py-4 sm:px-8 sm:py-6 flex items-center justify-between flex-shrink-0">
        {/* Left: View Identifier (Clean typography without W icon) */}
        <div className="flex items-center">
          <span className="text-xs font-semibold text-textMuted uppercase tracking-widest select-none">
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
            <span className="text-[10px] sm:text-[10.5px] text-textMuted uppercase font-semibold tracking-wider transition-colors group-hover:text-textSecondary truncate">
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
            Press <kbd className="px-1.5 py-0.5 rounded bg-surfaceHover border border-borderSubtle text-textSecondary font-mono text-[10px]">Esc</kbd> to exit
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
        <div className="flex flex-col items-center lg:items-start text-center lg:text-left space-y-4 sm:space-y-6 max-w-lg w-full flex-shrink-0">
          <div className="relative aspect-square w-48 sm:w-64 md:w-80 lg:w-96 rounded-2xl bg-surfaceActive/40 overflow-hidden shadow-2xl shadow-black/25 dark:shadow-black/90 border border-border group">
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={currentTrack.metadata.title || "Artwork"}
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500 ease-out"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-surfaceActive/40">
                <Music className="w-16 h-16 sm:w-24 sm:h-24 text-textMuted/40" />
              </div>
            )}
          </div>

          <div className="space-y-2 w-full">
            <div className="flex items-start justify-center lg:justify-start gap-3">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-textPrimary tracking-tight leading-snug line-clamp-2">
                {currentTrack.metadata.title || "Untitled"}
              </h1>
              <button
                onClick={() => toggleLike(currentTrack.id)}
                className={`p-1.5 mt-1 rounded-lg transition-transform active:scale-75 focus:outline-none ${
                  isLiked ? "text-accent scale-110" : "text-textMuted hover:text-textPrimary"
                }`}
                title={isLiked ? "Unlike song" : "Like song"}
              >
                <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
              </button>
            </div>

            <div className="text-base text-textSecondary font-medium truncate">
              <ArtistLinks
                artistName={getFullTrackArtistString(currentTrack)}
                onSelectArtist={(name) => {
                  closeFullscreen();
                  selectArtist(name);
                }}
                className="truncate"
                linkClassName="hover:text-textPrimary hover:underline cursor-pointer transition-colors"
                delimiterClassName="text-textMuted"
              />
            </div>

            {currentTrack.metadata.album && (
              <p
                onClick={() => {
                  closeFullscreen();
                  selectAlbum(
                    currentTrack.metadata.album || "",
                    currentTrack.metadata.artist || ""
                  );
                }}
                className="text-xs text-textMuted hover:text-textPrimary cursor-pointer hover:underline truncate transition inline-block"
              >
                {currentTrack.metadata.album}
                {currentTrack.metadata.year ? ` • ${currentTrack.metadata.year}` : ""}
              </p>
            )}

            <div className="pt-1 flex items-center justify-center lg:justify-start">
              <span className="inline-flex items-center px-2 py-0.5 rounded-[4px] bg-surfaceHover border border-border text-[10px] font-semibold tracking-wider uppercase text-textSecondary">
                {currentTrack.metadata.format.toUpperCase() === "FLAC" ||
                currentTrack.metadata.format.toUpperCase() === "WAV"
                  ? "Lossless"
                  : "High Quality"}{" "}
                • {currentTrack.metadata.format.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Time-Synchronized Live Lyrics */}
        <div className="flex-1 w-full h-80 sm:h-96 lg:h-[500px] flex flex-col overflow-hidden relative">
          {lyrics.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-surfaceHover border border-border flex items-center justify-center shadow-lg">
                <Mic2 className="w-6 h-6 text-textMuted/50" />
              </div>
              <p className="text-sm font-semibold text-textSecondary">
                No lyrics found for this song
              </p>
              <p className="text-xs text-textMuted max-w-xs">
                Embedded LRC or tag lyrics will appear here during playback.
              </p>
            </div>
          ) : (
            <div
              ref={lyricsContainerRef}
              className="flex-1 overflow-y-auto space-y-6 py-24 scroll-smooth pr-4"
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
                        ? "text-2xl sm:text-3xl md:text-4xl font-extrabold text-textPrimary scale-105 translate-x-2 text-shadow-lg opacity-100"
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
          )}
        </div>
      </main>

      {/* Bottom Transport Controls & Scrubber */}
      <footer className="relative z-10 px-4 py-4 sm:px-8 sm:py-6 max-w-5xl mx-auto w-full flex-shrink-0 space-y-3 sm:space-y-4">
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
            className="relative w-full flex items-center py-1.5 cursor-pointer"
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
              className={`p-2 rounded-xl transition ${
                isShuffle ? "text-accent bg-accent/15 hover:bg-accent/20" : "text-textMuted hover:text-textPrimary hover:bg-surfaceHover"
              }`}
              title="Shuffle"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={playPrevious}
              className="text-textSecondary hover:text-textPrimary hover:scale-110 active:scale-95 transition p-2 rounded-xl hover:bg-surfaceHover"
              title="Previous"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={isPlaying ? pause : resume}
              className="w-12 h-12 rounded-full bg-textPrimary text-background hover:scale-105 active:scale-95 flex items-center justify-center transition shadow-xl"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 ml-0.5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={playNext}
              className="text-textSecondary hover:text-textPrimary hover:scale-110 active:scale-95 transition p-2 rounded-xl hover:bg-surfaceHover"
              title="Next"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={cycleLoopMode}
              className={`p-2 rounded-xl transition ${
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

            <button
              type="button"
              onClick={toggleAutoplay}
              className={`p-2 rounded-xl transition ${
                isAutoplay
                  ? "text-accent bg-accent/15 hover:bg-accent/20"
                  : "text-textMuted hover:text-textPrimary hover:bg-surfaceHover"
              }`}
              title={
                isAutoplay
                  ? "Autoplay is on (continues playing after queue finishes)"
                  : "Autoplay is off"
              }
            >
              <Infinity className="w-4 h-4" />
            </button>
          </div>

          {/* Right Balanced Spacer (No redundant Exit button) */}
          <div className="hidden sm:block w-1/4" />
        </div>
      </footer>
    </div>
  );
};

import React, { useEffect, useRef, useMemo, useState } from "react";
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
  Sparkles,
  Disc,
  Mic2,
  ListMusic,
  Library,
  Users,
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
  const volume = usePlayerStore((s) => s.status.volume);
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
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);

  const artworkUrl = useArtwork(currentTrack?.id);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Local drag state for scrubber
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState(0);

  const displayPos = isDragging ? dragPos : positionSecs;
  const maxDuration = durationSecs > 0 ? durationSecs : 100;

  // Keyboard Shortcuts (Esc to close, Space to toggle play)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeFullscreen();
      } else if (e.key === " " && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        if (isPlaying) pause();
        else resume();
      } else if (e.key === "ArrowRight" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        seek(Math.min(durationSecs, positionSecs + 5));
      } else if (e.key === "ArrowLeft" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        seek(Math.max(0, positionSecs - 5));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isPlaying, positionSecs, durationSecs, closeFullscreen, pause, resume, seek]);

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
    return getActiveLyricIndex(lyrics, displayPos);
  }, [lyrics, displayPos]);

  // Auto-scroll lyrics container to active line
  useEffect(() => {
    if (!isOpen || activeLyricIndex < 0 || !lyricsContainerRef.current) return;
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
  }, [activeLyricIndex, isOpen, showLyricsSmoothScroll]);

  const VolumeIcon = useMemo(() => {
    if (volume === 0) return VolumeX;
    if (volume < 0.5) return Volume1;
    return Volume2;
  }, [volume]);

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

  if (!isOpen || !currentTrack) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0A0D] text-white flex flex-col justify-between overflow-hidden select-none animate-fade-in">
      {/* Dynamic Ambient Background Blur */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
        <div className="absolute -top-1/4 -left-1/4 w-[90vw] h-[90vw] rounded-full bg-gradient-to-br from-[#FA586A]/30 via-[#E0284F]/15 to-transparent blur-[140px] animate-pulse" />
        <div className="absolute -bottom-1/4 -right-1/4 w-[80vw] h-[80vw] rounded-full bg-gradient-to-tl from-[#5856D6]/20 via-[#FA586A]/10 to-transparent blur-[160px]" />
      </div>

      {/* Top Bar */}
      <header className="relative z-10 px-8 py-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FA586A] to-[#E0284F] flex items-center justify-center font-bold text-white shadow-lg shadow-[#FA586A]/30">
            <span className="text-xs font-black tracking-tighter">W</span>
          </div>
          <span className="text-sm font-bold text-[#A1A1AA] uppercase tracking-widest">
            Now Playing
          </span>
        </div>

        {/* Center: Playing From Pill */}
        {playbackContext && (
          <button
            onClick={handleContextClick}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/10 backdrop-blur-md transition group shadow-sm"
            title={`Jump to ${playbackContext.name}`}
          >
            <ContextIcon className="w-3.5 h-3.5 text-[#FA586A]" />
            <span className="text-[11px] text-[#A1A1AA] uppercase font-bold tracking-wider">
              {playbackContext.type === "liked" ? "Liked Songs" : `Playing from ${playbackContext.type}`}:
            </span>
            <span className="text-xs font-bold text-white group-hover:text-[#FA586A] transition-colors truncate max-w-[240px]">
              {playbackContext.name}
            </span>
          </button>
        )}

        <div className="flex items-center space-x-3">
          <span className="text-xs text-[#71717A] hidden sm:inline font-medium">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white font-mono text-[11px]">ESC</kbd> to exit
          </span>
          <button
            onClick={closeFullscreen}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition hover:scale-105 active:scale-95 shadow-md"
            title="Exit Fullscreen"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Split Screen Area */}
      <main className="relative z-10 flex-1 flex flex-col lg:flex-row items-center justify-center px-8 md:px-16 lg:px-24 gap-12 lg:gap-20 overflow-hidden max-w-7xl mx-auto w-full">
        {/* Left Column: Huge Album Art & Credits */}
        <div className="flex flex-col items-center lg:items-start text-center lg:text-left space-y-6 max-w-md w-full flex-shrink-0">
          <div className="relative aspect-square w-64 sm:w-80 md:w-96 rounded-3xl bg-[#18181F] overflow-hidden shadow-2xl shadow-black/90 border border-white/10 group">
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={currentTrack.metadata.title || "Artwork"}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#18181F]">
                <Music className="w-24 h-24 text-[#71717A]/40" />
              </div>
            )}
            {isPlaying && (
              <div className="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center space-x-2 shadow-xl">
                <EqualizerWave isPlaying={true} size="xs" color="bg-[#FA586A]" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Live
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2 w-full">
            <div className="flex items-center justify-center lg:justify-start gap-3">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight truncate">
                {currentTrack.metadata.title || "Untitled"}
              </h1>
              <button
                onClick={() => toggleLike(currentTrack.id)}
                className={`p-1.5 rounded-full transition-transform active:scale-75 ${
                  isLiked ? "text-[#FA586A] scale-110" : "text-[#71717A] hover:text-white"
                }`}
                title={isLiked ? "Unlike song" : "Like song"}
              >
                <Heart className={`w-5 h-5 ${isLiked ? "fill-[#FA586A]" : ""}`} />
              </button>
            </div>

            <div className="text-base text-[#A1A1AA] font-medium truncate">
              <ArtistLinks
                artistName={getFullTrackArtistString(currentTrack)}
                onSelectArtist={(name) => {
                  closeFullscreen();
                  selectArtist(name);
                }}
                className="truncate"
                linkClassName="hover:text-white hover:underline cursor-pointer transition-colors"
                delimiterClassName="text-[#71717A]"
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
                className="text-xs text-[#71717A] hover:text-white cursor-pointer hover:underline truncate transition inline-flex items-center gap-1.5"
              >
                <Disc className="w-3.5 h-3.5 text-[#FA586A]" />
                <span>
                  {currentTrack.metadata.album}
                  {currentTrack.metadata.year ? ` • ${currentTrack.metadata.year}` : ""}
                </span>
              </p>
            )}

            <div className="pt-2 flex items-center justify-center lg:justify-start gap-2">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-xs font-bold text-white">
                <Sparkles className="w-3.5 h-3.5 text-[#FA586A]" />
                <span>
                  {currentTrack.metadata.format.toUpperCase() === "FLAC" ||
                  currentTrack.metadata.format.toUpperCase() === "WAV"
                    ? "Lossless"
                    : "High Quality"}
                </span>
                <span className="text-[#A1A1AA]">
                  • {currentTrack.metadata.format.toUpperCase()}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Time-Synchronized Live Lyrics */}
        <div className="flex-1 w-full h-80 sm:h-96 lg:h-[500px] flex flex-col overflow-hidden relative">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 flex-shrink-0">
            <span className="text-xs font-bold uppercase tracking-wider text-[#FA586A] flex items-center gap-2">
              <Mic2 className="w-4 h-4" /> Lyrics
            </span>
            {lyrics.length > 0 && (
              <span className="text-xs text-[#71717A]">Click any line to jump</span>
            )}
          </div>

          {lyrics.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-lg">
                <Mic2 className="w-7 h-7 text-[#71717A]/50" />
              </div>
              <p className="text-sm font-bold text-[#A1A1AA]">
                No lyrics found for this song
              </p>
              <p className="text-xs text-[#71717A] max-w-xs">
                Embedded LRC or tag lyrics will show up here during playback.
              </p>
            </div>
          ) : (
            <div
              ref={lyricsContainerRef}
              className="flex-1 overflow-y-auto space-y-5 py-24 scroll-smooth pr-4"
            >
              {lyrics.map((line, idx) => {
                const isActive = idx === activeLyricIndex;
                const isPast = idx < activeLyricIndex;

                return (
                  <p
                    key={`${line.time}-${idx}`}
                    onClick={() => seek(line.time)}
                    className={`cursor-pointer transition-all duration-300 transform origin-left select-none ${
                      isActive
                        ? "text-2xl sm:text-3xl md:text-4xl font-extrabold text-white scale-105 translate-x-2 text-shadow-lg opacity-100"
                        : isPast
                        ? "text-lg sm:text-xl md:text-2xl font-bold text-white/35 hover:text-white/80 hover:translate-x-1"
                        : "text-lg sm:text-xl md:text-2xl font-bold text-white/50 hover:text-white/80 hover:translate-x-1"
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

      {/* Floating Bottom Transport Bar */}
      <footer className="relative z-10 px-8 py-6 max-w-4xl mx-auto w-full flex flex-col items-center space-y-3 flex-shrink-0">
        {/* Scrubber Timeline */}
        <div className="w-full flex items-center space-x-4 text-xs select-none">
          <span className="w-12 text-right font-mono text-sm text-[#A1A1AA] tabular-nums">
            {formatTime(displayPos)}
          </span>
          <input
            type="range"
            min={0}
            max={maxDuration}
            step={0.1}
            value={displayPos}
            onPointerDown={() => {
              setIsDragging(true);
              setDragPos(positionSecs);
            }}
            onChange={(e) => setDragPos(parseFloat(e.target.value))}
            onPointerUp={() => {
              if (isDragging) {
                seek(dragPos);
                setIsDragging(false);
              }
            }}
            className="w-full wavery-slider"
            style={{ "--slider-progress": `${maxDuration > 0 ? (displayPos / maxDuration) * 100 : 0}%` } as React.CSSProperties}
          />
          <span className="w-12 text-left font-mono text-sm text-[#71717A] tabular-nums">
            {formatRemainingTime(displayPos, durationSecs)}
          </span>
        </div>

        {/* Transport Controls & Volume */}
        <div className="flex items-center justify-between w-full pt-1">
          {/* Left spacer / Volume */}
          <div className="flex items-center space-x-2 w-1/4">
            <button
              onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
              className="text-[#A1A1AA] hover:text-white transition p-1.5"
            >
              <VolumeIcon className="w-4 h-4" />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20 sm:w-24 wavery-slider"
              style={{ "--slider-progress": `${volume * 100}%` } as React.CSSProperties}
            />
          </div>

          {/* Center Main Transport */}
          <div className="flex items-center space-x-6">
            <button
              type="button"
              onClick={toggleShuffle}
              className={`p-2 rounded-xl transition ${
                isShuffle ? "text-[#FA586A] bg-[#FA586A]/20" : "text-[#A1A1AA] hover:text-white"
              }`}
              title="Shuffle"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={playPrevious}
              className="text-white hover:scale-110 active:scale-95 transition p-2"
              title="Previous"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={isPlaying ? pause : resume}
              className="w-12 h-12 rounded-full bg-white hover:scale-105 active:scale-95 text-black flex items-center justify-center transition shadow-2xl shadow-white/30"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-black text-black" />
              ) : (
                <Play className="w-5 h-5 ml-0.5 fill-black text-black" />
              )}
            </button>

            <button
              type="button"
              onClick={playNext}
              className="text-white hover:scale-110 active:scale-95 transition p-2"
              title="Next"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={cycleLoopMode}
              className={`p-2 rounded-xl transition ${
                loopMode !== "Off"
                  ? "text-[#FA586A] bg-[#FA586A]/20"
                  : "text-[#A1A1AA] hover:text-white"
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
                  ? "text-[#FA586A] bg-[#FA586A]/20"
                  : "text-[#A1A1AA] hover:text-white"
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

          {/* Right Exit Fullscreen Shortcut */}
          <div className="flex items-center justify-end w-1/4">
            <button
              onClick={closeFullscreen}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Exit</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

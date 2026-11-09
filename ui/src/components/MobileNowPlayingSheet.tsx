/**
 * MobileNowPlayingSheet
 *
 * The mobile (< 640px) playback surface, mounted instead of the desktop
 * FullscreenPlayer. One persistent component with two presentation states:
 *
 *   collapsed — a floating mini card docked above the bottom navigation
 *   expanded  — a full-viewport now-playing sheet
 *
 * The two states live in a single fixed surface whose visible region is an
 * interpolated clip-path rect driven by the CSS custom property `--p`
 * (0 = card, 1 = fullscreen). The artwork is a separate fixed layer whose
 * frame interpolates between the measured mini slot and the expanded slot,
 * so the cover visibly grows out of the bar into the hero cover instead of
 * cross-dissolving. Everything else fades within the shared progress window.
 *
 * Gestures are driven by pointer events and write `--p` directly to the DOM
 * via requestAnimationFrame, so a 60fps drag never re-renders React:
 *   - tap or swipe up on the card expands it
 *   - swipe down anywhere on the sheet collapses it
 *   - tapping or flicking mid-transition retargets from the current frame
 *
 * Playback state comes from the player store; the queue and lyrics drawer
 * remain reachable from the quiet row under the transport controls.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
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
  ChevronDown,
  ListMusic,
  Mic2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useSettingsStore } from "../stores/settingsStore";
import { windowService, useWindowState } from "../services/windowService";
import { useArtwork } from "../utils/useArtwork";
import { getFullTrackArtistString } from "../utils/library";
import {
  useVsyncScrubber,
  formatTime,
  formatRemainingTime,
} from "../hooks/useVsyncScrubber";

/* ------------------------------------------------------------------ */
/* Geometry & motion                                                   */
/* ------------------------------------------------------------------ */

/** Docked mini card height. */
const CARD_HEIGHT = 60;
/** Docked mini card corner radius. */
const CARD_RADIUS = 14;
/** Horizontal inset of the floating card. */
const CARD_MARGIN = 8;
/** Artwork edge in the mini card (also the shared-element start size). */
const ART_SIZE = 44;
/** Docked play button edge (matches the `w-11` transport button). */
const MINI_PLAY_SIZE = 44;
/** Docked previous/next edge when the card shows button transport. */
const MINI_SKIP_SIZE = 36;
/** Gap between the three docked transport buttons. */
const MINI_SKIP_GAP = 4;
/** Interior padding on the card's trailing edge. */
const CARD_PAD_RIGHT = 4;
/** Gap between the title block and the docked transport cluster. */
const CARD_GAP = 8;
/** Nested radius: outer 14 minus the 8px card inset. */
const ART_RADIUS_MINI = 6;
/** Corner radius of the expanded hero cover. */
const ART_RADIUS_FULL = 10;
const EXPAND_MS = 420;
const COLLAPSE_MS = 380;
/** A full expand drag spans this fraction of the viewport height. */
const DRAG_RANGE_FACTOR = 0.55;
/** Movement before the gesture commits to an axis. */
const AXIS_LOCK_PX = 12;
const TAP_SLOP_PX = 8;
const TAP_MS = 300;
const FLICK_VELOCITY = 500;
/** Horizontal travel on the card that commits a track skip in swipe mode. */
const SWIPE_COMMIT_PX = 56;
/** Rubber-band cap for the card's horizontal follow while dragging. */
const SWIPE_MAX_PX = 96;
/**
 * How far the card contents follow the finger (0–1 of the drag). The cover is
 * a separate fixed layer that must stay locked to the card frame, so the
 * follow is deliberately short enough to stay inside the rounded clip.
 */
const SWIPE_FOLLOW = 0.35;

/** Standard cubic-bezier interpreter (bisection solve on x, evaluate y). */
function createCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): (t: number) => number {
  const sampleX = (u: number): number =>
    3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const sampleY = (u: number): number =>
    3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let u = t;
    for (let i = 0; i < 20; i += 1) {
      if (Math.abs(sampleX(u) - t) < 1e-5) break;
      if (sampleX(u) < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sampleY(u);
  };
}

/** The iOS sheet curve: a strong, slightly delayed ease-out. */
const SHEET_EASE = createCubicBezier(0.32, 0.72, 0, 1);

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startP: number;
  startT: number;
  lastY: number;
  lastT: number;
  /** Smoothed vertical velocity in px/s; positive is downward. */
  velY: number;
  /** Smoothed horizontal velocity in px/s; positive is rightward. */
  velX: number;
  lastX: number;
  axis: "undecided" | "vertical" | "horizontal";
}

/* ------------------------------------------------------------------ */
/* Presentational leaves                                               */
/* ------------------------------------------------------------------ */

/**
 * Hairline elapsed-progress line across the card's top edge. Subscribes to
 * position on its own so playback ticks never re-render the sheet shell.
 */
const MiniProgressLine: React.FC = React.memo(() => {
  const positionSecs = usePlayerStore((s) => s.status.position_secs || 0);
  const durationSecs = usePlayerStore(
    (s) => s.status.duration_secs || s.currentTrack?.metadata.duration?.secs || 0
  );
  const pct =
    durationSecs > 0
      ? Math.min(100, Math.max(0, (positionSecs / durationSecs) * 100))
      : 0;

  return (
    <div className="absolute top-0 left-2 right-2 h-[2px] rounded-full bg-textMuted/25 overflow-hidden pointer-events-none">
      <div
        className="h-full rounded-full bg-accent-fill"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});
MiniProgressLine.displayName = "MiniProgressLine";

/** Primary transport action on the docked card. */
const MiniPlayButton: React.FC = React.memo(() => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const resume = usePlayerStore((s) => s.resume);
  const pause = usePlayerStore((s) => s.pause);

  return (
    <button
      type="button"
      aria-label={isPlaying ? "Pause" : "Play"}
      disabled={!currentTrack}
      onClick={(e) => {
        e.stopPropagation();
        if (isPlaying) pause();
        else resume();
      }}
      className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-textPrimary hover:bg-white/[0.06] active:scale-95 transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-25 disabled:cursor-not-allowed disabled:active:scale-100"
    >
      {isPlaying ? (
        <Pause className="w-5 h-5 fill-current" />
      ) : (
        <Play className="w-5 h-5 fill-current" />
      )}
    </button>
  );
});
MiniPlayButton.displayName = "MiniPlayButton";

/**
 * Secondary transport action on the docked card, shown only while the
 * `miniPlayerControls` setting is `"buttons"`. The expanded sheet keeps its
 * own larger transport row, so this stays deliberately compact.
 */
const MiniSkipButton: React.FC<{ direction: "prev" | "next" }> = React.memo(
  ({ direction }) => {
    const hasTrack = usePlayerStore((s) => !!s.currentTrack);
    const playNext = usePlayerStore((s) => s.playNext);
    const playPrevious = usePlayerStore((s) => s.playPrevious);

    const isNext = direction === "next";
    const Icon = isNext ? SkipForward : SkipBack;

    return (
      <button
        type="button"
        aria-label={isNext ? "Next track" : "Previous track"}
        disabled={!hasTrack}
        onClick={(e) => {
          e.stopPropagation();
          if (isNext) void playNext();
          else void playPrevious();
        }}
        className="rounded-full flex items-center justify-center flex-shrink-0 text-textSecondary hover:text-textPrimary hover:bg-white/[0.06] active:scale-90 transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-25 disabled:cursor-not-allowed disabled:active:scale-100"
        style={{ width: MINI_SKIP_SIZE, height: MINI_SKIP_SIZE }}
      >
        <Icon className="w-4 h-4 fill-current" />
      </button>
    );
  }
);
MiniSkipButton.displayName = "MiniSkipButton";

/**
 * Full-width scrubber for the expanded sheet. Reuses the VSync scrubber hook
 * so progress interpolates at the display refresh rate without re-rendering.
 */
const SheetScrubber: React.FC = React.memo(() => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const positionSecs = usePlayerStore((s) => s.status.position_secs || 0);
  const durationSecs = usePlayerStore(
    (s) => s.status.duration_secs || s.currentTrack?.metadata.duration?.secs || 0
  );
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const seek = usePlayerStore((s) => s.seek);

  const hasTrack = !!currentTrack;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const {
    sliderRef,
    currentTimeRef,
    remainingTimeRef,
    isDragging,
    handlePointerDown,
    handleChange,
    handlePointerUp,
    handleContainerPointerDown,
    displayPos,
  } = useVsyncScrubber({
    positionSecs,
    durationSecs,
    isPlaying,
    hasTrack,
    showRemaining: true,
    containerRef,
    onSeek: seek,
  });

  const maxDuration = durationSecs > 0 ? durationSecs : 100;
  const initialPct =
    hasTrack && maxDuration > 0
      ? Math.min(100, Math.max(0, (displayPos / maxDuration) * 100))
      : 0;

  return (
    <div
      className={`w-full select-none transition-opacity ${hasTrack ? "" : "opacity-30"}`}
    >
      <div
        ref={containerRef}
        data-no-sheet-drag
        onPointerDown={handleContainerPointerDown}
        className="relative h-8 flex items-center touch-none rounded-full group/scrub focus-within:ring-2 focus-within:ring-accent/40"
        style={
          { "--slider-progress": `${initialPct}%` } as React.CSSProperties
        }
      >
        <div className="absolute inset-x-0 h-1 rounded-full bg-textMuted/25" />
        <div
          className="absolute left-0 h-1 rounded-full bg-accent-fill"
          style={{ width: "var(--slider-progress, 0%)" }}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border border-black/10 shadow-[0_1px_4px_rgba(0,0,0,0.4)] pointer-events-none transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isDragging ? "scale-100" : "scale-[0.35]"
          }`}
          style={{ left: "clamp(6px, var(--slider-progress, 0%), calc(100% - 6px))" }}
        />
        <input
          ref={sliderRef}
          type="range"
          aria-label="Seek position"
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
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none disabled:cursor-not-allowed z-10 focus:outline-none"
        />
      </div>
      <div className="flex items-center justify-between font-mono text-xs text-textMuted tabular-nums mt-1">
        <span ref={currentTimeRef}>
          {hasTrack ? formatTime(displayPos) : "0:00"}
        </span>
        <span ref={remainingTimeRef}>
          {hasTrack ? formatRemainingTime(displayPos, durationSecs) : "0:00"}
        </span>
      </div>
    </div>
  );
});
SheetScrubber.displayName = "SheetScrubber";

/** Shuffle · previous · play/pause · next · repeat. */
const TransportRow: React.FC = React.memo(() => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const loopMode = usePlayerStore((s) => s.status.loop_mode);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const userQueueLength = usePlayerStore((s) => s.userQueue.length);
  const shuffleIndices = usePlayerStore((s) => s.shuffleIndices);
  const shufflePos = usePlayerStore((s) => s.shufflePos);
  const isAutoplay = usePlayerStore((s) => s.isAutoplay);

  const resume = usePlayerStore((s) => s.resume);
  const pause = usePlayerStore((s) => s.pause);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleLoopMode = usePlayerStore((s) => s.cycleLoopMode);

  const hasTrack = !!currentTrack;
  const canSkipForward =
    hasTrack &&
    (userQueueLength > 0 ||
      loopMode !== "Off" ||
      (isShuffle
        ? shuffleIndices.length > 0
          ? shufflePos < shuffleIndices.length - 1
          : queueLength > 1
        : queueIndex < queueLength - 1) ||
      isAutoplay);

  const quietButton =
    "w-12 h-12 rounded-full flex items-center justify-center text-textSecondary active:scale-95 transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed disabled:active:scale-100";

  return (
    <div className="h-[68px] flex items-center justify-between px-2">
      <button
        type="button"
        aria-label="Toggle shuffle"
        aria-pressed={isShuffle}
        disabled={!hasTrack}
        onClick={toggleShuffle}
        className={`${quietButton} ${isShuffle && hasTrack ? "text-accent" : "hover:text-textPrimary"}`}
        title={isShuffle ? "Shuffle on" : "Shuffle off"}
      >
        <Shuffle className="w-6 h-6" />
      </button>

      <button
        type="button"
        aria-label="Previous track"
        disabled={!hasTrack}
        onClick={playPrevious}
        className={`${quietButton} hover:text-textPrimary`}
      >
        <SkipBack className="w-7 h-7 fill-current" />
      </button>

      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        disabled={!hasTrack}
        onClick={() => (isPlaying ? pause() : resume())}
        className="w-[68px] h-[68px] rounded-full bg-accent-fill text-onAccent flex items-center justify-center shadow-[0_4px_16px_rgba(0,0,0,0.25)] active:scale-95 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus:outline-none disabled:opacity-25 disabled:cursor-not-allowed disabled:active:scale-100"
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause className="w-8 h-8 fill-current" />
        ) : (
          <Play className="w-8 h-8 fill-current" />
        )}
      </button>

      <button
        type="button"
        aria-label="Next track"
        disabled={!canSkipForward}
        onClick={playNext}
        className={`${quietButton} hover:text-textPrimary`}
      >
        <SkipForward className="w-7 h-7 fill-current" />
      </button>

      <button
        type="button"
        aria-label={
          loopMode === "Track"
            ? "Repeat one"
            : loopMode === "Queue"
              ? "Repeat queue"
              : "Repeat off"
        }
        aria-pressed={loopMode !== "Off"}
        disabled={!hasTrack}
        onClick={cycleLoopMode}
        className={`${quietButton} ${loopMode !== "Off" && hasTrack ? "text-accent" : "hover:text-textPrimary"}`}
        title={`Repeat: ${loopMode}`}
      >
        {loopMode === "Track" ? (
          <Repeat1 className="w-6 h-6" />
        ) : (
          <Repeat className="w-6 h-6" />
        )}
      </button>
    </div>
  );
});
TransportRow.displayName = "TransportRow";

/** Heart toggle beside the expanded title block. */
const LikeButton: React.FC<{ trackId?: string }> = React.memo(({ trackId }) => {
  const isLiked = useLibraryStore(
    (s) => !!trackId && s.likedTrackIds.has(trackId)
  );
  const toggleLike = useLibraryStore((s) => s.toggleLike);

  return (
    <button
      type="button"
      aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
      aria-pressed={isLiked}
      disabled={!trackId}
      onClick={() => {
        if (trackId) toggleLike(trackId);
      }}
      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 active:scale-95 transition-[color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none disabled:opacity-25 disabled:cursor-not-allowed disabled:active:scale-100 ${
        isLiked ? "text-accent" : "text-textMuted hover:text-textPrimary"
      }`}
    >
      <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
    </button>
  );
});
LikeButton.displayName = "LikeButton";

/** Quiet queue / lyrics entries, the mobile replacements for the drawer tap. */
const QueueRow: React.FC<{ onOpen: (tab: "queue" | "lyrics") => void }> =
  React.memo(({ onOpen }) => {
    const quiet =
      "h-11 px-4 rounded-full flex items-center gap-2 text-textMuted hover:text-textPrimary active:scale-[0.96] transition-[color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none";

    return (
      <div className="h-11 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => onOpen("queue")}
          className={quiet}
        >
          <ListMusic className="w-4 h-4" />
          <span className="text-xs font-medium">Queue</span>
        </button>
        <button
          type="button"
          onClick={() => onOpen("lyrics")}
          className={quiet}
        >
          <Mic2 className="w-4 h-4" />
          <span className="text-xs font-medium">Lyrics</span>
        </button>
      </div>
    );
  });
QueueRow.displayName = "QueueRow";

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export const MobileNowPlayingSheet: React.FC = () => {
  const { isFullscreen } = useWindowState();
  const isOpen = useNavigationStore((s) => s.isFullscreenNowPlayingOpen);
  const setOpen = useNavigationStore((s) => s.setFullscreenNowPlayingOpen);
  const toggleDrawer = useNavigationStore((s) => s.toggleNowPlayingDrawer);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const artworkUrl = useArtwork(currentTrack?.id);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);

  // Docked transport is either visible buttons or a horizontal swipe gesture.
  const miniPlayerControls = useSettingsStore((s) => s.miniPlayerControls);
  const swipeToSkip = miniPlayerControls === "swipe";
  const swipeToSkipRef = useRef(swipeToSkip);
  swipeToSkipRef.current = swipeToSkip;

  /** Width the docked transport cluster reserves on the card's trailing edge. */
  const miniControlsWidth = swipeToSkip
    ? MINI_PLAY_SIZE
    : MINI_SKIP_SIZE * 2 + MINI_SKIP_GAP * 2 + MINI_PLAY_SIZE;

  // Keep showing the last track while the sheet animates closed or the
  // backend clears the queue between tracks.
  const lastActiveTrackRef = useRef(currentTrack);
  if (currentTrack) lastActiveTrackRef.current = currentTrack;
  const activeTrack = currentTrack || lastActiveTrackRef.current;

  const title = activeTrack?.metadata.title || "Untitled";
  const artist = activeTrack ? getFullTrackArtistString(activeTrack) : "";
  const trackId = activeTrack?.id;

  /* --- Refs ------------------------------------------------------- */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const expandedRef = useRef<HTMLDivElement | null>(null);
  const miniLayerRef = useRef<HTMLDivElement | null>(null);
  const miniRowRef = useRef<HTMLDivElement | null>(null);
  const miniArtSlotRef = useRef<HTMLDivElement | null>(null);
  const expandedArtSlotRef = useRef<HTMLDivElement | null>(null);

  const pRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const swipeRafRef = useRef<number | null>(null);
  const swipeXRef = useRef(0);

  /* --- Progress driver -------------------------------------------- */

  /** Write the sheet progress to the DOM; never triggers a React render. */
  const setP = useCallback((value: number) => {
    const p = Math.max(0, Math.min(1, value));
    pRef.current = p;
    rootRef.current?.style.setProperty("--p", p.toFixed(4));
  }, []);

  const cancelAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /* --- Swipe-to-skip feedback ------------------------------------- */

  /** Translate the docked card text; never triggers a React render. */
  const setSwipeX = useCallback((x: number) => {
    swipeXRef.current = x;
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty("--swipe-x", `${x.toFixed(2)}px`);
    // Fade in step with the travel so a committed skip reads as a hand-off.
    const fade = Math.max(0.25, 1 - Math.abs(x) / (SWIPE_MAX_PX * 1.6));
    root.style.setProperty("--swipe-o", fade.toFixed(3));
  }, []);

  const cancelSwipeAnimation = useCallback(() => {
    if (swipeRafRef.current !== null) {
      cancelAnimationFrame(swipeRafRef.current);
      swipeRafRef.current = null;
    }
  }, []);

  /** Snap the card back to rest after a commit or a cancelled drag. */
  const releaseSwipe = useCallback(() => {
    cancelSwipeAnimation();
    const from = swipeXRef.current;
    if (Math.abs(from) < 0.5) {
      setSwipeX(0);
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setSwipeX(0);
      return;
    }
    const start = performance.now();
    const duration = 180;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setSwipeX(from * (1 - eased));
      if (t >= 1) {
        swipeRafRef.current = null;
        setSwipeX(0);
      } else {
        swipeRafRef.current = requestAnimationFrame(step);
      }
    };
    swipeRafRef.current = requestAnimationFrame(step);
  }, [cancelSwipeAnimation, setSwipeX]);

  useEffect(() => () => cancelSwipeAnimation(), [cancelSwipeAnimation]);

  const animateTo = useCallback(
    (target: number, durationMs: number, onDone?: () => void) => {
      cancelAnimation();
      const reduced =
        typeof window !== "undefined" &&
        !!window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = reduced ? 160 : durationMs;
      const from = pRef.current;

      if (Math.abs(target - from) < 0.0005 || duration <= 0) {
        setP(target);
        onDone?.();
        return;
      }

      const start = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / duration);
        setP(from + (target - from) * SHEET_EASE(t));
        if (t >= 1) {
          rafRef.current = null;
          onDone?.();
        } else {
          rafRef.current = requestAnimationFrame(step);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancelAnimation, setP]
  );

  /* --- Shared-element measurement --------------------------------- */

  const measureMiniSlot = useCallback(() => {
    const el = miniArtSlotRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    root.style.setProperty("--ma-x1", `${rect.left}px`);
    root.style.setProperty("--ma-y1", `${rect.top}px`);
    root.style.setProperty("--ma-s1", `${rect.width}px`);
  }, []);

  const measureExpandedSlot = useCallback(() => {
    const el = expandedArtSlotRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    root.style.setProperty("--ma-x2", `${rect.left}px`);
    root.style.setProperty("--ma-y2", `${rect.top}px`);
    root.style.setProperty("--ma-s2", `${rect.width}px`);
  }, []);

  const measureSlots = useCallback(() => {
    measureExpandedSlot();
    // The mini slot lives inside the morphing surface; it is only stable
    // while the card is docked.
    if (pRef.current < 0.01) measureMiniSlot();
  }, [measureExpandedSlot, measureMiniSlot]);

  useLayoutEffect(() => {
    measureSlots();
  }, [measureSlots]);

  useEffect(() => {
    const onResize = () => measureSlots();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [measureSlots]);

  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  /* --- Open / close lifecycle ------------------------------------- */

  useEffect(() => {
    const expanded = expandedRef.current;
    const miniRow = miniRowRef.current;
    // The whole docked card (row + play button) goes inert as one unit.
    const miniLayer = miniLayerRef.current;

    if (isOpen) {
      measureSlots();
      expanded?.removeAttribute("inert");
      expanded?.setAttribute("aria-hidden", "false");
      miniLayer?.setAttribute("inert", "");
      animateTo(1, EXPAND_MS);
      expanded?.focus({ preventScroll: true });
      return;
    }

    if (pRef.current > 0.001 || rafRef.current !== null) {
      animateTo(0, COLLAPSE_MS, () => {
        if (useNavigationStore.getState().isFullscreenNowPlayingOpen) return;
        expanded?.setAttribute("inert", "");
        expanded?.setAttribute("aria-hidden", "true");
        miniLayer?.removeAttribute("inert");
        measureMiniSlot();
        miniRow?.focus({ preventScroll: true });
      });
    } else {
      expanded?.setAttribute("inert", "");
      expanded?.setAttribute("aria-hidden", "true");
      miniLayer?.removeAttribute("inert");
    }
  }, [isOpen, animateTo, measureSlots, measureMiniSlot]);

  /* --- Keyboard --------------------------------------------------- */

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, setOpen]);

  const openSheet = useCallback(() => setOpen(true), [setOpen]);
  const closeSheet = useCallback(() => setOpen(false), [setOpen]);

  const handleMiniKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openSheet();
        return;
      }
      // Keyboard parity for the swipe gesture: arrows always skip, whether
      // the docked transport renders buttons or not.
      if (e.key === "ArrowRight") {
        e.preventDefault();
        void playNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        void playPrevious();
      }
    },
    [openSheet, playNext, playPrevious]
  );

  /* --- Gestures --------------------------------------------------- */

  /**
   * One pointer grammar for both states. The direction of travel decides
   * the outcome; the axis lock keeps a diagonal seek from collapsing the
   * sheet and keeps horizontal swipes inert.
   */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button, input, a, [data-no-sheet-drag]")) return;

      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startP: pRef.current,
        startT: performance.now(),
        lastY: e.clientY,
        lastT: performance.now(),
        velY: 0,
        velX: 0,
        lastX: e.clientX,
        axis: "undecided",
      };
      // Retarget: a touch during a settle animation takes over from the
      // current frame instead of waiting for it to finish.
      cancelAnimation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort.
      }
    },
    [cancelAnimation]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      const now = performance.now();
      const dt = now - drag.lastT;
      if (dt > 0) {
        const sampleY = ((e.clientY - drag.lastY) / dt) * 1000;
        drag.velY = drag.velY === 0 ? sampleY : drag.velY * 0.7 + sampleY * 0.3;
        const sampleX = ((e.clientX - drag.lastX) / dt) * 1000;
        drag.velX = drag.velX === 0 ? sampleX : drag.velX * 0.7 + sampleX * 0.3;
      }
      drag.lastY = e.clientY;
      drag.lastX = e.clientX;
      drag.lastT = now;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.axis === "undecided") {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        drag.axis = Math.abs(dy) >= Math.abs(dx) ? "vertical" : "horizontal";
      }

      if (drag.axis === "horizontal") {
        // Swipe-to-skip only applies to the docked card, and only while the
        // setting asks for gestures instead of buttons.
        if (!swipeToSkipRef.current || drag.startP > 0.001) return;
        const clamped = Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, dx));
        setSwipeX(clamped * SWIPE_FOLLOW);
        return;
      }

      const range = Math.max(1, window.innerHeight * DRAG_RANGE_FACTOR);
      setP(drag.startP + -dy / range);
    },
    [setP, setSwipeX]
  );

  const settleByPosition = useCallback(() => {
    setOpen(pRef.current >= 0.5);
  }, [setOpen]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (surfaceRef.current?.hasPointerCapture(e.pointerId)) {
        try {
          surfaceRef.current.releasePointerCapture(e.pointerId);
        } catch {
          // Capture may already be released.
        }
      }

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const isTap =
        drag.axis === "undecided" &&
        Math.hypot(dx, dy) < TAP_SLOP_PX &&
        performance.now() - drag.startT < TAP_MS;

      if (isTap) {
        if (pRef.current < 0.5) openSheet();
        return;
      }

      if (drag.axis === "horizontal") {
        if (swipeToSkipRef.current && drag.startP < 0.001) {
          // Distance or a genuine flick commits; a short fast twitch does not,
          // so a slightly jittery tap never skips a track.
          const committed =
            Math.abs(dx) >= SWIPE_COMMIT_PX ||
            (Math.abs(dx) >= SWIPE_COMMIT_PX * 0.6 &&
              Math.abs(drag.velX) >= FLICK_VELOCITY);
          if (committed) {
            if (dx < 0) void playNext();
            else void playPrevious();
          }
        }
        releaseSwipe();
        return;
      }

      if (drag.axis !== "vertical") return;

      if (drag.velY <= -FLICK_VELOCITY) {
        openSheet();
        return;
      }
      if (drag.velY >= FLICK_VELOCITY + 100) {
        closeSheet();
        return;
      }
      settleByPosition();
    },
    [closeSheet, openSheet, playNext, playPrevious, releaseSwipe, settleByPosition]
  );

  const handlePointerCancel = useCallback(() => {
    dragRef.current = null;
    releaseSwipe();
    settleByPosition();
  }, [releaseSwipe, settleByPosition]);

  const handleOpenDrawer = useCallback(
    (tab: "queue" | "lyrics") => {
      setOpen(false);
      toggleDrawer(tab);
    },
    [setOpen, toggleDrawer]
  );

  /* --- Render ------------------------------------------------------ */

  if (!activeTrack) return null;

  return (
    <div ref={rootRef} className="mobile-nps">
      {/* Dim behind the sheet while it is open or mid-drag. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/30 pointer-events-none"
        style={{ opacity: "var(--p)" }}
      />

      {/*
        The morphing surface. At --p:0 its clip is exactly the floating card;
        at --p:1 it is the full viewport. clip-path also constrains hit
        testing, so the collapsed card never blocks the content behind it.
      */}
      <div
        ref={surfaceRef}
        className="fixed inset-0 z-40 bg-background touch-none select-none"
        style={{
          clipPath: `inset(calc((100dvh - ${CARD_HEIGHT}px - var(--dock)) * (1 - var(--p))) calc(${CARD_MARGIN}px * (1 - var(--p))) calc(var(--dock) * (1 - var(--p))) calc(${CARD_MARGIN}px * (1 - var(--p))) round calc(${CARD_RADIUS}px * (1 - var(--p))))`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {/*
          Card material: deck surface + hairline + contact shadow. It stays
          opaque for most of the travel so the surface reads as one card
          growing into the sheet, then hands off to the sheet background in
          the last tenth. Its radius tracks the clip so the corners never
          double up.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-deck/95 backdrop-blur-2xl border border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          style={{
            opacity: "clamp(0, calc((1 - var(--p)) * 10), 1)",
            borderRadius: `calc(${CARD_RADIUS}px * (1 - var(--p)))`,
          }}
        />

        {/*
          Collapsed card. One layer holds the tappable row and the play
          control side by side, so the whole card fades and goes inert as a
          unit while the play button stays a top-level control instead of a
          button nested inside the row's button role.
        */}
        <div
          ref={miniLayerRef}
          className="absolute inset-0"
          style={{ opacity: "clamp(0, calc(1 - var(--p) * 2.5), 1)" }}
        >
          <div
            ref={miniRowRef}
            role="button"
            tabIndex={0}
            aria-label={`Now playing: ${title} by ${artist}. Expand player.`}
            onKeyDown={handleMiniKeyDown}
            className="absolute inset-x-2 flex items-center gap-2 pl-2 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{
              height: CARD_HEIGHT,
              bottom: "var(--dock)",
              borderRadius: CARD_RADIUS,
              /* Leave room for the transport cluster, which is a sibling. */
              paddingRight: miniControlsWidth + CARD_GAP + CARD_PAD_RIGHT,
            }}
          >
            <MiniProgressLine />

            {/* Shared-element start slot; the artwork layer paints over it. */}
            <div
              ref={miniArtSlotRef}
              className="bg-surfaceHover flex-shrink-0"
              style={{
                width: ART_SIZE,
                height: ART_SIZE,
                borderRadius: ART_RADIUS_MINI,
              }}
            />

            {/*
              Only the text block follows a horizontal swipe. The cover is a
              separate fixed layer pinned to the card frame, so sliding the
              row as a whole would tear the artwork away from its clip.

              The clip lives on the untransformed wrapper and the movement on
              the inner block: putting `overflow-hidden` on the moving element
              would drag its own edge across the cover and spill text over it.
            */}
            <div className="min-w-0 flex-1 overflow-hidden">
              <div
                className="flex flex-col justify-center will-change-transform"
                style={{
                  transform: "translateX(var(--swipe-x, 0px))",
                  opacity: "var(--swipe-o, 1)",
                }}
              >
                <p className="text-sm font-medium text-textPrimary truncate leading-tight">
                  {title}
                </p>
                <p className="text-xs text-textSecondary truncate leading-tight mt-1">
                  {artist}
                </p>
              </div>
            </div>
          </div>

          <div
            className="absolute flex items-center"
            style={{
              right: CARD_MARGIN + CARD_PAD_RIGHT,
              bottom: `calc(var(--dock) + ${(CARD_HEIGHT - MINI_PLAY_SIZE) / 2}px)`,
              height: MINI_PLAY_SIZE,
              gap: MINI_SKIP_GAP,
            }}
          >
            {!swipeToSkip && <MiniSkipButton direction="prev" />}
            <MiniPlayButton />
            {!swipeToSkip && <MiniSkipButton direction="next" />}
          </div>
        </div>

        {/* Expanded now-playing sheet. */}
        <div
          ref={expandedRef}
          role="dialog"
          aria-modal="true"
          aria-label="Now playing"
          tabIndex={-1}
          className="absolute inset-0 flex flex-col outline-none"
          style={{
            opacity: "clamp(0, calc((var(--p) - 0.25) * 2), 1)",
          }}
        >
          {/* Top bar with dismiss chevron and fullscreen toggle */}
          <div className="min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] flex items-center justify-between px-4">
            <div className="w-10" />
            <button
              type="button"
              aria-label="Collapse player"
              onClick={closeSheet}
              className="w-11 h-11 rounded-full flex items-center justify-center text-textSecondary hover:text-textPrimary hover:bg-white/[0.06] active:scale-95 transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
            <button
              type="button"
              aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen (Hide Browser Bar)"}
              onClick={() => windowService.toggleFullscreen()}
              className="w-10 h-10 rounded-full flex items-center justify-center text-textSecondary hover:text-textPrimary hover:bg-white/[0.06] active:scale-95 transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen (Hide Browser Bar)"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 text-accent" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Hero cover: the shared artwork layer lands on this slot. */}
          <div className="flex-1 min-h-0 flex items-center justify-center px-6">
            <div
              ref={expandedArtSlotRef}
              className="aspect-square"
              style={{
                width: "min(100%, calc(100dvh - 360px))",
                borderRadius: ART_RADIUS_FULL,
              }}
            />
          </div>

          {/* Title, scrubber, transport, quiet drawer entries. */}
          <div
            className="px-6 safe-sheet-bottom"
            style={{
              opacity: "clamp(0, calc((var(--p) - 0.5) * 2.857), 1)",
              transform:
                "translateY(calc((1 - clamp(0, calc((var(--p) - 0.5) * 2.857), 1)) * 12px))",
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2
                  className="text-xl font-semibold text-textPrimary truncate leading-tight"
                  title={title}
                >
                  {title}
                </h2>
                <p
                  className="text-sm text-textSecondary truncate leading-tight mt-1"
                  title={artist}
                >
                  {artist}
                </p>
              </div>
              <LikeButton trackId={trackId} />
            </div>

            <div className="mt-4">
              <SheetScrubber />
            </div>

            <TransportRow />
            <QueueRow onOpen={handleOpenDrawer} />
          </div>
        </div>
      </div>

      {/*
        The shared element. One image, always mounted, its frame interpolated
        between the measured mini slot and the expanded slot. This is what
        makes the transition read as continuous instead of as two screens.
      */}
      <div
        aria-hidden="true"
        className="fixed z-40 pointer-events-none overflow-hidden bg-surfaceHover"
        style={{
          left: "calc(var(--ma-x1) + (var(--ma-x2) - var(--ma-x1)) * var(--p))",
          top: "calc(var(--ma-y1) + (var(--ma-y2) - var(--ma-y1)) * var(--p))",
          width:
            "calc(var(--ma-s1) + (var(--ma-s2) - var(--ma-s1)) * var(--p))",
          aspectRatio: "1 / 1",
          borderRadius: `calc(${ART_RADIUS_MINI}px + ${ART_RADIUS_FULL - ART_RADIUS_MINI}px * var(--p))`,
        }}
      >
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt=""
            draggable={false}
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Music className="w-[42%] h-[42%] text-textMuted" />
          </div>
        )}
      </div>
    </div>
  );
};

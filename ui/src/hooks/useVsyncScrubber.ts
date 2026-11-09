import { useEffect, useRef, useState, useCallback } from "react";

export function formatTime(secs: number = 0): string {
  if (isNaN(secs) || secs < 0) secs = 0;
  const mins = Math.floor(secs / 60);
  const remaining = Math.floor(secs % 60);
  return `${mins}:${remaining < 10 ? "0" : ""}${remaining}`;
}

export function formatRemainingTime(currentSecs: number, totalSecs: number): string {
  if (isNaN(totalSecs) || totalSecs <= 0) return formatTime(currentSecs);
  const safeCurrent = isNaN(currentSecs) || currentSecs < 0 ? 0 : currentSecs;
  const diff = Math.max(0, totalSecs - safeCurrent);
  return `-${formatTime(diff)}`;
}

interface UseVsyncScrubberOptions {
  positionSecs: number;
  durationSecs: number;
  isPlaying: boolean;
  hasTrack: boolean;
  showRemaining?: boolean;
  containerRef?: React.RefObject<HTMLElement | null>;
  onSeek: (positionSecs: number) => void;
}

export interface UseVsyncScrubberResult {
  sliderRef: React.RefObject<HTMLInputElement>;
  currentTimeRef: React.RefObject<HTMLSpanElement>;
  remainingTimeRef: React.RefObject<HTMLSpanElement>;
  isDragging: boolean;
  dragPos: number;
  handlePointerDown: (e: React.PointerEvent<HTMLInputElement>) => void;
  handleChange: (e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => void;
  handlePointerUp: (e?: React.PointerEvent<HTMLInputElement>) => void;
  handleContainerPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  displayPos: number;
}

/**
 * useVsyncScrubber
 *
 * Synchronizes playback progress with the display's native refresh rate (VSync: 60Hz/120Hz/144Hz)
 * via requestAnimationFrame.
 *
 * To achieve perfectly fluid, zero-jank progress without causing React component re-renders
 * during playback or dragging, this hook directly updates the CSS variable (--slider-progress),
 * native slider value, and DOM text nodes.
 */
export function useVsyncScrubber({
  positionSecs,
  durationSecs,
  isPlaying,
  hasTrack,
  showRemaining = true,
  containerRef,
  onSeek,
}: UseVsyncScrubberOptions): UseVsyncScrubberResult {
  const sliderRef = useRef<HTMLInputElement>(null);
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const remainingTimeRef = useRef<HTMLSpanElement>(null);

  const basePosRef = useRef(positionSecs);
  const baseTimeRef = useRef(performance.now());
  const isPlayingRef = useRef(isPlaying);
  const durationRef = useRef(durationSecs);
  const hasTrackRef = useRef(hasTrack);
  const showRemainingRef = useRef(showRemaining);

  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragPosRef = useRef(positionSecs);

  // Keep refs synchronized with props
  useEffect(() => {
    durationRef.current = durationSecs;
  }, [durationSecs]);

  useEffect(() => {
    hasTrackRef.current = hasTrack;
  }, [hasTrack]);

  useEffect(() => {
    showRemainingRef.current = showRemaining;
  }, [showRemaining]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    baseTimeRef.current = performance.now();
  }, [isPlaying]);

  // Direct DOM update: 0 React re-renders, 144Hz VSync locked
  const updateDOM = useCallback((pos: number) => {
    const dur = durationRef.current;
    const maxDur = dur > 0 ? dur : 100;
    const safePos = isNaN(pos) || pos < 0 ? 0 : pos;
    const clampedPos = Math.max(0, Math.min(safePos, maxDur));
    const progressPct = maxDur > 0 ? Math.max(0, Math.min(100, (clampedPos / maxDur) * 100)) : 0;

    if (sliderRef.current) {
      sliderRef.current.style.setProperty("--slider-progress", `${progressPct}%`);
      if (!isDraggingRef.current) {
        sliderRef.current.value = String(clampedPos);
      }
    }
    if (containerRef?.current) {
      containerRef.current.style.setProperty("--slider-progress", `${progressPct}%`);
    }
    if (currentTimeRef.current) {
      currentTimeRef.current.textContent = formatTime(clampedPos);
    }
    if (remainingTimeRef.current) {
      remainingTimeRef.current.textContent = showRemainingRef.current
        ? formatRemainingTime(clampedPos, dur)
        : formatTime(dur);
    }
  }, [containerRef]);

  // Sync when status arrives from backend
  useEffect(() => {
    basePosRef.current = positionSecs;
    baseTimeRef.current = performance.now();

    if (!isDraggingRef.current) {
      updateDOM(positionSecs);
    }
  }, [positionSecs, updateDOM]);

  // Compute interpolated position at any instant
  const getInterpolatedPos = useCallback(() => {
    if (!hasTrackRef.current) return 0;
    if (isDraggingRef.current) return dragPosRef.current;
    if (!isPlayingRef.current) return basePosRef.current;

    const elapsed = (performance.now() - baseTimeRef.current) / 1000;
    const dur = durationRef.current;
    const pos = (basePosRef.current || 0) + elapsed;
    return dur > 0 ? Math.max(0, Math.min(pos, dur)) : Math.max(0, pos);
  }, []);

  // VSync Animation Frame Loop
  useEffect(() => {
    let animId: number | null = null;

    const tick = () => {
      if (!isDraggingRef.current && hasTrackRef.current && isPlayingRef.current) {
        const currentPos = getInterpolatedPos();
        updateDOM(currentPos);
      }
      if (isPlayingRef.current) {
        animId = requestAnimationFrame(tick);
      }
    };

    if (isPlaying && hasTrack) {
      animId = requestAnimationFrame(tick);
    } else {
      updateDOM(basePosRef.current);
    }

    return () => {
      if (animId !== null) {
        cancelAnimationFrame(animId);
      }
    };
  }, [isPlaying, hasTrack, getInterpolatedPos, updateDOM]);

  // Pointer drag interactions on the range input
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
    if (!hasTrackRef.current) return;
    isDraggingRef.current = true;
    setIsDragging(true);

    const dur = durationRef.current;
    const rect = containerRef?.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
    if (rect.width > 0 && dur > 0) {
      const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
      const targetPos = pct * dur;
      dragPosRef.current = targetPos;
      if (sliderRef.current) {
        sliderRef.current.value = String(targetPos);
      }
      updateDOM(targetPos);
    }
  }, [containerRef, updateDOM]);

  // Native range slider onInput: fires continuously while user drags slider
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => {
    if (!hasTrackRef.current) return;
    const val = parseFloat(e.currentTarget.value);
    if (!isNaN(val)) {
      dragPosRef.current = val;
      updateDOM(val);
    }
  }, [updateDOM]);

  // Pointer up on slider: commit seek
  const handlePointerUp = useCallback((_e?: React.PointerEvent<HTMLInputElement>) => {
    if (isDraggingRef.current && hasTrackRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);

      const targetPos = sliderRef.current ? parseFloat(sliderRef.current.value) : dragPosRef.current;
      const safePos = isNaN(targetPos) ? dragPosRef.current : targetPos;
      basePosRef.current = safePos;
      baseTimeRef.current = performance.now();
      updateDOM(safePos);
      onSeek(safePos);
    }
  }, [onSeek, updateDOM]);

  // Window-level pointerup / pointercancel safety to catch mouse release outside window
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isDraggingRef.current && hasTrackRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);

        const targetPos = sliderRef.current ? parseFloat(sliderRef.current.value) : dragPosRef.current;
        const safePos = isNaN(targetPos) ? dragPosRef.current : targetPos;
        basePosRef.current = safePos;
        baseTimeRef.current = performance.now();
        updateDOM(safePos);
        onSeek(safePos);
      }
    };

    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [onSeek, updateDOM]);

  // Container pointer down to allow clicking anywhere on the scrubber bar to seek instantly
  const handleContainerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasTrackRef.current) return;
    if (e.target === sliderRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const dur = durationRef.current;
    if (rect.width > 0 && dur > 0) {
      const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
      const targetPos = pct * dur;
      dragPosRef.current = targetPos;
      basePosRef.current = targetPos;
      baseTimeRef.current = performance.now();
      if (sliderRef.current) {
        sliderRef.current.value = String(targetPos);
      }
      updateDOM(targetPos);
      onSeek(targetPos);
    }
  }, [onSeek, updateDOM]);

  return {
    sliderRef,
    currentTimeRef,
    remainingTimeRef,
    isDragging,
    dragPos: dragPosRef.current,
    handlePointerDown,
    handleChange,
    handlePointerUp,
    handleContainerPointerDown,
    displayPos: positionSecs,
  };
}

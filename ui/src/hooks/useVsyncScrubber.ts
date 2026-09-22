import { useEffect, useRef, useState, useCallback } from "react";

export function formatTime(secs: number = 0): string {
  if (isNaN(secs) || secs < 0) secs = 0;
  const mins = Math.floor(secs / 60);
  const remaining = Math.floor(secs % 60);
  return `${mins}:${remaining < 10 ? "0" : ""}${remaining}`;
}

export function formatRemainingTime(currentSecs: number, totalSecs: number): string {
  if (isNaN(totalSecs) || totalSecs <= 0) return formatTime(currentSecs);
  const diff = Math.max(0, totalSecs - currentSecs);
  return `-${formatTime(diff)}`;
}

interface UseVsyncScrubberOptions {
  positionSecs: number;
  durationSecs: number;
  isPlaying: boolean;
  hasTrack: boolean;
  showRemaining?: boolean;
  onSeek: (positionSecs: number) => void;
}

export interface UseVsyncScrubberResult {
  sliderRef: React.RefObject<HTMLInputElement>;
  currentTimeRef: React.RefObject<HTMLSpanElement>;
  remainingTimeRef: React.RefObject<HTMLSpanElement>;
  isDragging: boolean;
  dragPos: number;
  handlePointerDown: (e: React.PointerEvent<HTMLInputElement>) => void;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
 * every 7-16ms, this hook directly updates the CSS variable (--slider-progress) and DOM text nodes.
 */
export function useVsyncScrubber({
  positionSecs,
  durationSecs,
  isPlaying,
  hasTrack,
  showRemaining = true,
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
  const [dragPos, setDragPos] = useState(0);
  const isDraggingRef = useRef(false);
  const dragPosRef = useRef(0);

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
    // When playing state transitions, re-anchor base timestamp
    baseTimeRef.current = performance.now();
  }, [isPlaying]);

  // Direct DOM update: 0 React re-renders, 144Hz VSync locked
  const updateDOM = useCallback((pos: number) => {
    const dur = durationRef.current;
    const maxDur = dur > 0 ? dur : 100;
    const clampedPos = Math.max(0, Math.min(pos, maxDur));
    const progressPct = maxDur > 0 ? (clampedPos / maxDur) * 100 : 0;

    if (sliderRef.current) {
      sliderRef.current.style.setProperty("--slider-progress", `${progressPct}%`);
      if (!isDraggingRef.current) {
        sliderRef.current.value = String(clampedPos);
      }
    }
    if (currentTimeRef.current) {
      currentTimeRef.current.textContent = formatTime(clampedPos);
    }
    if (remainingTimeRef.current) {
      remainingTimeRef.current.textContent = showRemainingRef.current
        ? formatRemainingTime(clampedPos, dur)
        : formatTime(dur);
    }
  }, []);

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
    const pos = basePosRef.current + elapsed;
    return dur > 0 ? Math.min(pos, dur) : pos;
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

  // Pointer drag interactions
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
    if (!hasTrackRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if setPointerCapture is unsupported
    }

    const dur = durationRef.current;
    let targetPos: number;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width > 0 && dur > 0) {
      const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
      targetPos = pct * dur;
    } else {
      const val = parseFloat(e.currentTarget.value);
      targetPos = !isNaN(val) ? val : getInterpolatedPos();
    }

    isDraggingRef.current = true;
    dragPosRef.current = targetPos;
    setIsDragging(true);
    setDragPos(targetPos);
    updateDOM(targetPos);
  }, [getInterpolatedPos, updateDOM]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasTrackRef.current) return;
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      dragPosRef.current = val;
      setDragPos(val);
      updateDOM(val);
    }
  }, [updateDOM]);

  const handlePointerUp = useCallback((e?: React.PointerEvent<HTMLInputElement>) => {
    if (e) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore pointer release errors
      }
    }

    if (isDraggingRef.current && hasTrackRef.current) {
      const sliderVal = sliderRef.current ? parseFloat(sliderRef.current.value) : NaN;
      const targetPos = !isNaN(sliderVal) ? sliderVal : dragPosRef.current;
      onSeek(targetPos);
      basePosRef.current = targetPos;
      baseTimeRef.current = performance.now();
      isDraggingRef.current = false;
      setIsDragging(false);
      updateDOM(targetPos);
    }
  }, [onSeek, updateDOM]);

  // Window-level safety listener to ensure dragging state is never orphaned
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isDraggingRef.current && hasTrackRef.current) {
        const sliderVal = sliderRef.current ? parseFloat(sliderRef.current.value) : NaN;
        const targetPos = !isNaN(sliderVal) ? sliderVal : dragPosRef.current;
        onSeek(targetPos);
        basePosRef.current = targetPos;
        baseTimeRef.current = performance.now();
        isDraggingRef.current = false;
        setIsDragging(false);
        updateDOM(targetPos);
      }
    };

    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [onSeek, updateDOM]);

  // Container pointer down to allow clicking anywhere on the scrubber bar to seek
  const handleContainerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasTrackRef.current) return;
    if (e.target === sliderRef.current) return; // Handled by input's handlePointerDown

    const rect = e.currentTarget.getBoundingClientRect();
    const dur = durationRef.current;
    if (rect.width > 0 && dur > 0) {
      const pct = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
      const targetPos = pct * dur;
      onSeek(targetPos);
      basePosRef.current = targetPos;
      baseTimeRef.current = performance.now();
      dragPosRef.current = targetPos;
      updateDOM(targetPos);
    }
  }, [onSeek, updateDOM]);

  return {
    sliderRef,
    currentTimeRef,
    remainingTimeRef,
    isDragging,
    dragPos,
    handlePointerDown,
    handleChange,
    handlePointerUp,
    handleContainerPointerDown,
    displayPos: isDragging ? dragPos : positionSecs,
  };
}

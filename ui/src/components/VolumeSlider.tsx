import React, { useRef, useEffect, useCallback } from "react";
import { usePlayerStore } from "../stores/playerStore";
import { useSettingsStore } from "../stores/settingsStore";

export interface VolumeSliderProps {
  className?: string;
  ariaLabel?: string;
}

/**
 * VolumeSlider
 *
 * Hardware-accelerated, high-framerate (60fps/120fps/144fps) volume range slider.
 * Employs direct DOM CSS variable updating (--slider-progress) during drag gestures,
 * optimistic Zustand state synchronization, and coalesced backend IPC dispatching.
 */
export const VolumeSlider: React.FC<VolumeSliderProps> = React.memo(
  ({ className = "", ariaLabel = "Volume Slider" }) => {
    const volume = usePlayerStore((s) => s.status.volume);
    const setVolume = usePlayerStore((s) => s.setVolume);
    const volumeStep = useSettingsStore((s) => s.volumeStep) || 0.05;

    const inputRef = useRef<HTMLInputElement>(null);
    const isDraggingRef = useRef(false);

    // Sync input DOM element with external state updates when not actively dragging
    useEffect(() => {
      if (!isDraggingRef.current && inputRef.current) {
        inputRef.current.value = String(volume);
        inputRef.current.style.setProperty(
          "--slider-progress",
          `${Math.max(0, Math.min(1, volume)) * 100}%`
        );
      }
    }, [volume]);

    const handlePointerDown = useCallback(() => {
      isDraggingRef.current = true;
    }, []);

    const handlePointerUp = useCallback(() => {
      isDraggingRef.current = false;
      if (inputRef.current) {
        const val = parseFloat(inputRef.current.value);
        if (!isNaN(val)) {
          const clamped = Math.max(0, Math.min(1, val));
          inputRef.current.style.setProperty(
            "--slider-progress",
            `${clamped * 100}%`
          );
          setVolume(clamped);
        }
      }
    }, [setVolume]);

    const handleInput = useCallback(
      (e: React.FormEvent<HTMLInputElement>) => {
        const val = parseFloat(e.currentTarget.value);
        if (!isNaN(val)) {
          const clamped = Math.max(0, Math.min(1, val));
          // Instant direct DOM update without waiting for React render loop
          e.currentTarget.style.setProperty(
            "--slider-progress",
            `${clamped * 100}%`
          );
          setVolume(clamped);
        }
      },
      [setVolume]
    );

    const handleWheel = useCallback(
      (e: React.WheelEvent<HTMLInputElement>) => {
        const delta = e.deltaY < 0 ? volumeStep : -volumeStep;
        const next = Math.max(0, Math.min(1, volume + delta));
        if (inputRef.current) {
          inputRef.current.value = String(next);
          inputRef.current.style.setProperty(
            "--slider-progress",
            `${next * 100}%`
          );
        }
        setVolume(next);
      },
      [volume, volumeStep, setVolume]
    );

    return (
      <input
        ref={inputRef}
        type="range"
        aria-label={ariaLabel}
        min={0}
        max={1}
        step={0.005}
        defaultValue={volume}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onInput={handleInput}
        onChange={handleInput}
        onWheel={handleWheel}
        className={`wavery-slider ${className}`}
        title={`Volume: ${Math.round(volume * 100)}%`}
        style={
          {
            "--slider-progress": `${Math.max(0, Math.min(1, volume)) * 100}%`,
          } as React.CSSProperties
        }
      />
    );
  }
);

VolumeSlider.displayName = "VolumeSlider";

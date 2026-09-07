import React from "react";
import { useSettingsStore } from "../stores/settingsStore";

interface EqualizerWaveProps {
  isPlaying?: boolean;
  bars?: number;
  size?: "xs" | "sm" | "md" | "lg";
  color?: string;
  className?: string;
}

const SIZE_MAP = {
  xs: {
    container: "h-3 gap-[1.5px]",
    bar: "w-[2px] h-3 rounded-full",
  },
  sm: {
    container: "h-3.5 gap-[2px]",
    bar: "w-[2.5px] h-3.5 rounded-full",
  },
  md: {
    container: "h-5 gap-[3px]",
    bar: "w-[3px] h-5 rounded-full",
  },
  lg: {
    container: "h-6 gap-1",
    bar: "w-1 h-6 rounded-full",
  },
};

const ANIMATION_CLASSES = [
  "animate-wavery-eq-1",
  "animate-wavery-eq-2",
  "animate-wavery-eq-3",
  "animate-wavery-eq-4",
];

export const EqualizerWave: React.FC<EqualizerWaveProps> = ({
  isPlaying = true,
  bars = 4,
  size = "sm",
  color = "bg-[#FA586A]",
  className = "",
}) => {
  const showVisualizer = useSettingsStore((s) => s.showVisualizer);
  const cfg = SIZE_MAP[size] || SIZE_MAP.sm;
  const count = Math.min(Math.max(bars, 3), 4);

  return (
    <div
      className={`inline-flex items-end justify-center ${cfg.container} ${className}`}
      aria-label={isPlaying ? "Audio playing" : "Audio paused"}
    >
      {Array.from({ length: count }).map((_, idx) => {
        const animClass = isPlaying && showVisualizer ? ANIMATION_CLASSES[idx % ANIMATION_CLASSES.length] : "";
        return (
          <span
            key={idx}
            className={`${cfg.bar} ${color} ${animClass} transition-transform duration-300 origin-bottom`}
            style={!isPlaying || !showVisualizer ? { transform: `scaleY(${0.3 + (idx % 2) * 0.3})` } : undefined}
          />
        );
      })}
    </div>
  );
};

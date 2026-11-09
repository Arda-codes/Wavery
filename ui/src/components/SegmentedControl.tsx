import React, { useCallback } from "react";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[] | SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  variant?: "accent" | "subtle";
  size?: "sm" | "md";
  pillShape?: "rounded" | "pill";
  className?: string;
}

/**
 * Apple HIG Segmented Control with a sliding capsule indicator,
 * 5-state completeness, accessible keyboard arrow navigation, and zero layout thrashing.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = "accent",
  size = "sm",
  pillShape = "rounded",
  className = "",
}: SegmentedControlProps<T>): React.ReactElement {
  const count = options.length;
  const selectedIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value)
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let nextIndex = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % count;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + count) % count;
      }

      if (nextIndex >= 0 && nextIndex < count) {
        onChange(options[nextIndex].value);
      }
    },
    [count, onChange, options]
  );

  const containerRadius = pillShape === "pill" ? "rounded-full" : "rounded-xl";
  const pillRadius = pillShape === "pill" ? "rounded-full" : "rounded-lg";

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative inline-flex items-center bg-deck p-1 ${containerRadius} border border-white/[0.08] select-none ${className}`}
    >
      {/* Sliding Capsule Indicator */}
      {count > 0 && (
        <div
          className={`absolute top-1 bottom-1 left-1 ${pillRadius} pointer-events-none transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none will-change-transform ${
            variant === "accent"
              ? "bg-accent-fill text-white shadow-sm"
              : "bg-white/[0.14] text-white shadow-sm border border-white/10"
          }`}
          style={{
            width: `calc((100% - 8px) / ${count})`,
            transform: `translate3d(${selectedIndex * 100}%, 0, 0)`,
          }}
          aria-hidden="true"
        />
      )}

      {/* Segment Options */}
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`relative z-10 flex-1 flex items-center justify-center gap-2 ${
              size === "md" ? "py-2 px-3 text-xs" : "py-1 px-3 text-xs"
            } font-semibold capitalize transition-colors duration-150 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${pillRadius} ${
              isSelected
                ? "text-white"
                : "text-textMuted hover:text-white"
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

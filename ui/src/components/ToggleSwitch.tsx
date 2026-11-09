import React, { useCallback } from "react";

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  className?: string;
}

/**
 * ToggleSwitch
 *
 * Apple HIG tactile hardware-accelerated toggle switch.
 * Features 5-state completeness (default, hover, active tactile stretch, focused, disabled),
 * authentic physics (knob stretches horizontally on click/press down), WCAG AA contrast,
 * and seamless keyboard accessibility (Space / Enter).
 */
export const ToggleSwitch: React.FC<ToggleSwitchProps> = React.memo(
  ({ checked, onChange, disabled = false, label, id, className = "" }) => {
    const handleClick = useCallback(() => {
      if (!disabled) {
        onChange(!checked);
      }
    }, [disabled, onChange, checked]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      },
      [disabled, onChange, checked]
    );

    return (
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`wavery-toggle ${className}`}
      >
        <span aria-hidden="true" className="wavery-toggle-knob" />
      </button>
    );
  }
);

ToggleSwitch.displayName = "ToggleSwitch";

import React, { useState } from "react";
import { windowService, useWindowState } from "../services/windowService";
import { isTauri } from "../services/adapter";
import { isMacPlatform } from "../utils/keybindings";
import { Minus, Square, X } from "lucide-react";

export interface WindowControlsProps {
  /**
   * Layout variant.
   * - "auto": dynamically chooses "mac" on macOS, "windows" on Windows/Linux.
   * - "mac": renders macOS traffic lights (Close, Minimize, Fullscreen).
   * - "windows": renders Windows/Linux controls (Minimize, Maximize/Restore, Close).
   */
  variant?: "mac" | "windows" | "auto";
  className?: string;
}

export const WindowControls: React.FC<WindowControlsProps> = ({
  variant = "auto",
  className = "",
}) => {
  // If running in a web browser, do not render window management controls
  if (!isTauri) {
    return null;
  }

  const isMac = variant === "mac" || (variant === "auto" && isMacPlatform());
  const { isFullscreen, isMaximized } = useWindowState();
  const [isMacHovered, setIsMacHovered] = useState(false);

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await windowService.minimize();
  };

  const handleToggleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await windowService.toggleMaximize();
  };

  const handleToggleFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await windowService.toggleFullscreen();
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await windowService.close();
  };

  // ---------------------------------------------------------------------------
  // macOS Traffic Light Variant (Apple HIG)
  // ---------------------------------------------------------------------------
  if (isMac) {
    return (
      <div
        data-tauri-drag-region="none"
        className={`flex items-center space-x-2 select-none z-40 pointer-events-auto ${className}`}
        onMouseEnter={() => setIsMacHovered(true)}
        onMouseLeave={() => setIsMacHovered(false)}
        role="group"
        aria-label="Window Controls"
      >
        {/* Close Button (Red) */}
        <button
          type="button"
          data-tauri-drag-region="none"
          onClick={handleClose}
          className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/50 flex items-center justify-center transition-transform duration-100 hover:scale-105 active:brightness-90 focus:outline-none focus:ring-1 focus:ring-red-400"
          title="Close (⌘W)"
          aria-label="Close Window"
        >
          {isMacHovered && (
            <svg
              viewBox="0 0 10 10"
              className="w-1.5 h-1.5 text-[#4D0000] stroke-current stroke-[2]"
              fill="none"
            >
              <path d="M2 2L8 8M8 2L2 8" />
            </svg>
          )}
        </button>

        {/* Minimize Button (Yellow) */}
        <button
          type="button"
          data-tauri-drag-region="none"
          onClick={handleMinimize}
          className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/50 flex items-center justify-center transition-transform duration-100 hover:scale-105 active:brightness-90 focus:outline-none focus:ring-1 focus:ring-yellow-400"
          title="Minimize (⌘M)"
          aria-label="Minimize Window"
        >
          {isMacHovered && (
            <svg
              viewBox="0 0 10 10"
              className="w-1.5 h-1.5 text-[#5B3F00] stroke-current stroke-[2]"
              fill="none"
            >
              <path d="M2 5H8" />
            </svg>
          )}
        </button>

        {/* Fullscreen Button (Green) */}
        <button
          type="button"
          data-tauri-drag-region="none"
          onClick={handleToggleFullscreen}
          className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/50 flex items-center justify-center transition-transform duration-100 hover:scale-105 active:brightness-90 focus:outline-none focus:ring-1 focus:ring-green-400"
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen (⌃⌘F)"}
          aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {isMacHovered && (
            <svg
              viewBox="0 0 10 10"
              className="w-1.5 h-1.5 text-[#0A4D12] fill-current"
            >
              <polygon points="2,2 5,2 2,5" />
              <polygon points="8,8 5,8 8,5" />
            </svg>
          )}
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Windows & Linux Controls Variant (Windows 11 / Linux Desktop HIG)
  // ---------------------------------------------------------------------------
  return (
    <div
      data-tauri-drag-region="none"
      className={`flex items-center space-x-1 select-none z-40 pointer-events-auto ${className}`}
      role="group"
      aria-label="Window Controls"
    >
      {/* Minimize Button */}
      <button
        type="button"
        data-tauri-drag-region="none"
        onClick={handleMinimize}
        className="w-8 h-8 rounded-md bg-transparent hover:bg-white/[0.08] active:bg-white/[0.14] text-textMuted hover:text-white flex items-center justify-center transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-accent/40"
        title="Minimize"
        aria-label="Minimize"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      {/* Maximize / Restore Button */}
      <button
        type="button"
        data-tauri-drag-region="none"
        onClick={handleToggleMaximize}
        className="w-8 h-8 rounded-md bg-transparent hover:bg-white/[0.08] active:bg-white/[0.14] text-textMuted hover:text-white flex items-center justify-center transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-accent/40"
        title={isMaximized ? "Restore Down" : "Maximize"}
        aria-label={isMaximized ? "Restore Down" : "Maximize"}
      >
        {isMaximized ? (
          <svg viewBox="0 0 10 10" className="w-3 h-3 fill-none stroke-current stroke-[1.2]">
            <rect x="2.5" y="0.5" width="7" height="7" rx="0.5" />
            <polyline points="0.5,2.5 0.5,9.5 7.5,9.5" />
          </svg>
        ) : (
          <Square className="w-3 h-3 stroke-[1.4]" />
        )}
      </button>

      {/* Close Button */}
      <button
        type="button"
        data-tauri-drag-region="none"
        onClick={handleClose}
        className="w-8 h-8 rounded-md bg-transparent hover:bg-[#E81123] active:bg-[#C4101F] text-textMuted hover:text-white flex items-center justify-center transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-red-400"
        title="Close"
        aria-label="Close"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

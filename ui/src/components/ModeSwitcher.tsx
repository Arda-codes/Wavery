import React, { useState } from "react";
import { playerAdapter } from "../services/adapter";
import { Monitor, Globe, Loader2 } from "lucide-react";

import { usePlayerStore } from "../stores/playerStore";

interface ModeSwitcherProps {
  onSwitchStart?: (targetMode: "native" | "web") => void;
}

export const ModeSwitcher: React.FC<ModeSwitcherProps> = ({ onSwitchStart }) => {
  const isNative = playerAdapter.isTauri();
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<"native" | "web" | null>(null);

  const handleSwitch = async (target: "native" | "web") => {
    if (isSwitching) return;
    if ((target === "native" && isNative) || (target === "web" && !isNative)) {
      return;
    }

    setIsSwitching(true);
    setSwitchingTo(target);
    onSwitchStart?.(target);

    try {
      if (target === "web") {
        await usePlayerStore.getState().switchToWeb();
      } else {
        await playerAdapter.switchToNative();
      }
    } catch (err) {
      console.error("Failed to switch mode:", err);
    } finally {
      setIsSwitching(false);
      setSwitchingTo(null);
    }
  };

  return (
    <div
      className="relative inline-flex items-center p-1 rounded-full select-none ml-2 wavery-segment-track"
      role="radiogroup"
      aria-label="Application Mode"
    >
      {/* Sliding Active Pill Capsule */}
      <div
        aria-hidden="true"
        className="absolute top-1 bottom-1 w-24 rounded-full wavery-segment-active pointer-events-none will-change-transform transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{
          left: 4,
          transform: isNative ? "translate3d(0, 0, 0)" : "translate3d(100%, 0, 0)",
        }}
      />

      {/* Native Desktop Option */}
      <button
        type="button"
        role="radio"
        aria-checked={isNative}
        disabled={isSwitching}
        onClick={() => handleSwitch("native")}
        title="Desktop App: Native Rodio audio engine with system tray and media keys"
        className={`relative z-10 w-24 flex items-center justify-center space-x-2 py-1 rounded-full text-xs transition-[color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed ${
          isNative
            ? "text-white font-bold"
            : "text-textSecondary hover:text-white font-medium"
        }`}
      >
        {isSwitching && switchingTo === "native" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
        ) : (
          <Monitor className={`w-3.5 h-3.5 transition-colors duration-150 ${isNative ? "text-accent" : "text-textMuted"}`} />
        )}
        <span>Native</span>
        {isNative && !isSwitching && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
        )}
      </button>

      {/* Web Browser Option */}
      <button
        type="button"
        role="radio"
        aria-checked={!isNative}
        disabled={isSwitching}
        onClick={() => handleSwitch("web")}
        title="Web Client: In-browser streaming from the local server"
        className={`relative z-10 w-24 flex items-center justify-center space-x-2 py-1 rounded-full text-xs transition-[color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed ${
          !isNative
            ? "text-white font-bold"
            : "text-textSecondary hover:text-white font-medium"
        }`}
      >
        {isSwitching && switchingTo === "web" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
        ) : (
          <Globe className={`w-3.5 h-3.5 transition-colors duration-150 ${!isNative ? "text-accent" : "text-textMuted"}`} />
        )}
        <span>Web</span>
        {!isNative && !isSwitching && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
        )}
      </button>
    </div>
  );
};

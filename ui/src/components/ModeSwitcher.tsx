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
        if (typeof window !== "undefined") {
          window.close();
        }
      }
    } catch (err) {
      console.error("Failed to switch mode:", err);
      setIsSwitching(false);
      setSwitchingTo(null);
    }
  };

  return (
    <div
      className="inline-flex items-center p-0.5 bg-[#18181D] border border-white/[0.08] rounded-full shadow-inner select-none ml-2"
      role="radiogroup"
      aria-label="Application Mode"
    >
      {/* Native Desktop Option */}
      <button
        type="button"
        role="radio"
        aria-checked={isNative}
        disabled={isSwitching}
        onClick={() => handleSwitch("native")}
        title="Desktop App: Native Rodio audio engine with system tray and media keys"
        className={`relative flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs transition-all duration-200 focus:outline-none ${
          isNative
            ? "bg-white/[0.12] text-white font-bold shadow-sm border border-white/[0.12]"
            : "text-[#71717A] hover:text-white hover:bg-white/[0.04] font-medium"
        } ${isSwitching && switchingTo === "native" ? "animate-pulse" : ""}`}
      >
        {isSwitching && switchingTo === "native" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA586A]" />
        ) : (
          <Monitor className={`w-3.5 h-3.5 ${isNative ? "text-[#FA586A]" : "text-[#71717A]"}`} />
        )}
        <span>Native</span>
        {isNative && !isSwitching && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#FA586A] shadow-sm shadow-[#FA586A]/50" />
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
        className={`relative flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs transition-all duration-200 focus:outline-none ${
          !isNative
            ? "bg-white/[0.12] text-white font-bold shadow-sm border border-white/[0.12]"
            : "text-[#71717A] hover:text-white hover:bg-white/[0.04] font-medium"
        } ${isSwitching && switchingTo === "web" ? "animate-pulse" : ""}`}
      >
        {isSwitching && switchingTo === "web" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA586A]" />
        ) : (
          <Globe className={`w-3.5 h-3.5 ${!isNative ? "text-[#FA586A]" : "text-[#71717A]"}`} />
        )}
        <span>Web</span>
        {!isNative && !isSwitching && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#FA586A] shadow-sm shadow-[#FA586A]/50" />
        )}
      </button>
    </div>
  );
};

import React from "react";
import { WifiOff, RefreshCw, ChevronDown, Radio } from "lucide-react";
import { useTransitionMount } from "../utils/useTransitionMount";

export interface OfflineCoverProps {
  /** True when the streaming server is disconnected */
  isOffline: boolean;
  /** True while an active probe is executing */
  isChecking: boolean;
  /** Countdown until next automatic probe */
  retryCountdown: number;
  /** Server address being targeted */
  serverAddress: string;
  /** True if the cover is minimized into the compact top indicator pill */
  isCoverMinimized: boolean;
  /** Toggle minimized state */
  setIsCoverMinimized: (minimized: boolean) => void;
  /** Explicit trigger to recheck immediately */
  onRetry: () => void;
}

export const OfflineCover: React.FC<OfflineCoverProps> = ({
  isOffline,
  isChecking,
  retryCountdown,
  serverAddress,
  isCoverMinimized,
  setIsCoverMinimized,
  onRetry,
}) => {
  const { isRendered, isExiting } = useTransitionMount(isOffline, 160);

  if (!isRendered) return null;

  // Minimized compact floating status indicator pill
  if (isCoverMinimized) {
    return (
      <div
        role="status"
        aria-live="polite"
        onClick={() => setIsCoverMinimized(false)}
        className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-2 px-3 py-2 rounded-full bg-surface/95 border border-danger/40 backdrop-blur-xl shadow-xl cursor-pointer hover:bg-surfaceActive active:scale-95 transition-all select-none group"
        title="Wavery server is offline. Click to view status."
      >
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
        </span>
        <span className="text-2xs font-semibold text-white tracking-tight">Wavery Offline</span>
        <span className="text-2xs text-textMuted font-mono">({retryCountdown}s)</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          disabled={isChecking}
          className="p-1 rounded-full hover:bg-white/[0.1] text-textMuted hover:text-white transition disabled:opacity-50"
          title="Retry now"
          aria-label="Retry connection now"
        >
          <RefreshCw className={`w-3 h-3 ${isChecking ? "animate-spin text-accent" : ""}`} />
        </button>
      </div>
    );
  }

  // Full Immersive Offline Cover
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offline-cover-title"
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-2xl select-none ${
        isExiting ? "animate-backdrop-out pointer-events-none" : "animate-backdrop-in"
      }`}
    >
      <div
        className={`bg-surface/95 border border-white/[0.12] w-full max-w-md rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6 ${
          isExiting ? "animate-scale-down" : "animate-scale-up"
        }`}
      >
        {/* Animated Offline Beacon */}
        <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
          <span className="animate-ping absolute inline-flex h-12 w-12 rounded-2xl bg-danger/20 opacity-60" />
          <div className="relative w-16 h-16 rounded-2xl bg-danger/15 border border-danger/30 text-danger flex items-center justify-center shadow-lg shadow-danger/10">
            <WifiOff className="w-8 h-8" />
          </div>
        </div>

        {/* Text Details */}
        <div className="space-y-2">
          <h2
            id="offline-cover-title"
            className="text-xl sm:text-2xl font-bold text-white tracking-tight"
          >
            Wavery is Offline
          </h2>
          <p className="text-xs text-textSecondary leading-relaxed px-2">
            Cannot reach the Wavery audio server. Verify your host desktop app is open and your device is connected to the same network.
          </p>
        </div>

        {/* Target Host Information */}
        <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between text-2xs font-mono text-textMuted">
          <div className="flex items-center space-x-2 truncate">
            <Radio className="w-3.5 h-3.5 text-danger flex-shrink-0" />
            <span className="truncate">{serverAddress}</span>
          </div>
          <span className="flex-shrink-0 text-textMuted ml-2">
            Retry in <span className="text-white font-semibold">{retryCountdown}s</span>
          </span>
        </div>

        {/* Action Controls */}
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={isChecking}
            className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-accent text-white font-semibold text-xs hover:bg-accentHover active:scale-95 disabled:opacity-50 transition shadow-lg shadow-accent/20"
          >
            <RefreshCw className={`w-4 h-4 ${isChecking ? "animate-spin" : ""}`} />
            <span>{isChecking ? "Checking Connection..." : "Retry Connection"}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCoverMinimized(true)}
            className="w-full py-2 px-3 rounded-xl text-2xs font-semibold text-textMuted hover:text-white bg-white/[0.04] hover:bg-white/[0.08] active:scale-95 transition flex items-center justify-center space-x-1"
          >
            <span>Minimize to background banner</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

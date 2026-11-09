import React from "react";
import {
  Download,
  X,
  Share2,
  PlusSquare,
  MoreVertical,
  Sparkles,
  Smartphone,
  Laptop,
  Maximize2,
} from "lucide-react";
import { useTransitionMount } from "../utils/useTransitionMount";
import { usePwaInstall } from "../hooks/usePwaInstall";
import { windowService } from "../services/windowService";

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({ isOpen, onClose }) => {
  const { isRendered, isExiting } = useTransitionMount(isOpen, 160);
  const { canPromptNative, isIos, isAndroid, isChrome, promptNativeInstall } = usePwaInstall();

  if (!isRendered) return null;

  const handleNativeInstall = async () => {
    const installed = await promptNativeInstall();
    if (installed) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-app-title"
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md ${
        isExiting ? "animate-backdrop-out" : "animate-backdrop-in"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`bg-surface border border-white/[0.12] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden ${
          isExiting ? "animate-scale-down pointer-events-none" : "animate-scale-up"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-accent/15 text-accent flex items-center justify-center flex-shrink-0 border border-accent/20">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h2 id="install-app-title" className="text-sm font-bold text-white">
                Install Wavery
              </h2>
              <p className="text-2xs text-textMuted">Standalone mobile &amp; desktop playback</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 text-textMuted hover:text-white flex items-center justify-center transition focus:outline-none"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Hero Feature Callout */}
          <div className="p-4 rounded-xl bg-accent/5 border border-accent/20 space-y-2">
            <div className="flex items-center space-x-2 text-xs font-semibold text-white">
              <Sparkles className="w-4 h-4 text-accent" />
              <span>Full Screen &amp; Zero Browser Clutter</span>
            </div>
            <p className="text-2xs text-textSecondary leading-relaxed">
              Installing Wavery removes the browser URL bar, top navigation header (✕, URL, three
              dots), and lets you launch directly from your home screen or app drawer.
            </p>
          </div>

          {/* Native 1-Tap Install Option (Chrome/Edge/Android) */}
          {canPromptNative ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleNativeInstall}
                className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-accent-fill hover:bg-accentHover active:scale-98 text-white font-semibold text-xs shadow-lg shadow-accent/20 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Install Wavery App</span>
              </button>
              <p className="text-2xs text-textMuted text-center">
                Adds Wavery to your home screen or system app menu in 1 tap.
              </p>
            </div>
          ) : isIos ? (
            /* iOS Safari Step-by-Step Instructions */
            <div className="space-y-3">
              <div className="flex items-center space-x-2 text-xs font-semibold text-white">
                <Smartphone className="w-4 h-4 text-accent" />
                <span>Add to Home Screen on iOS (Safari)</span>
              </div>
              <ol className="space-y-2 text-xs text-textSecondary">
                <li className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-2xs flex items-center justify-center flex-shrink-0 mt-1">
                    1
                  </span>
                  <div className="flex-1 text-2xs leading-relaxed">
                    Tap the <span className="font-semibold text-white">Share button</span>{" "}
                    <Share2 className="w-3.5 h-3.5 inline mx-1 text-accent" /> in Safari&apos;s bottom bar.
                  </div>
                </li>
                <li className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-2xs flex items-center justify-center flex-shrink-0 mt-1">
                    2
                  </span>
                  <div className="flex-1 text-2xs leading-relaxed">
                    Scroll down and tap{" "}
                    <span className="font-semibold text-white">Add to Home Screen</span>{" "}
                    <PlusSquare className="w-3.5 h-3.5 inline mx-1 text-accent" />.
                  </div>
                </li>
                <li className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-2xs flex items-center justify-center flex-shrink-0 mt-1">
                    3
                  </span>
                  <div className="flex-1 text-2xs leading-relaxed">
                    Tap <span className="font-semibold text-white">Add</span> in the top right. Wavery
                    will now launch full screen with no browser controls.
                  </div>
                </li>
              </ol>
            </div>
          ) : isAndroid ? (
            /* Android / In-App Browser (Custom Tab) Instructions */
            <div className="space-y-3">
              <div className="flex items-center space-x-2 text-xs font-semibold text-white">
                <Smartphone className="w-4 h-4 text-accent" />
                <span>Add to Home Screen on Android</span>
              </div>
              <ol className="space-y-2 text-xs text-textSecondary">
                <li className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-2xs flex items-center justify-center flex-shrink-0 mt-1">
                    1
                  </span>
                  <div className="flex-1 text-2xs leading-relaxed">
                    Tap the <span className="font-semibold text-white">menu button</span> (
                    <MoreVertical className="w-3.5 h-3.5 inline text-accent" /> three dots) in the top
                    bar.
                  </div>
                </li>
                <li className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-2xs flex items-center justify-center flex-shrink-0 mt-1">
                    2
                  </span>
                  <div className="flex-1 text-2xs leading-relaxed">
                    Select <span className="font-semibold text-white">Add to Home screen</span> or{" "}
                    <span className="font-semibold text-white">Install app</span>.
                  </div>
                </li>
              </ol>
            </div>
          ) : (
            /* Desktop Web Browser (Chrome, Edge, etc.) */
            <div className="space-y-3">
              <div className="flex items-center space-x-2 text-xs font-semibold text-white">
                <Laptop className="w-4 h-4 text-accent" />
                <span>Install on {isChrome ? "Google Chrome" : "Desktop Browser"}</span>
              </div>
              <ol className="space-y-2 text-xs text-textSecondary">
                <li className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-2xs flex items-center justify-center flex-shrink-0 mt-1">
                    1
                  </span>
                  <div className="flex-1 text-2xs leading-relaxed">
                    Look for the <span className="font-semibold text-white">Install icon</span> in Chrome&apos;s address bar (on the right, next to the star).
                  </div>
                </li>
                <li className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-2xs flex items-center justify-center flex-shrink-0 mt-1">
                    2
                  </span>
                  <div className="flex-1 text-2xs leading-relaxed">
                    Or click Chrome&apos;s menu (<MoreVertical className="w-3.5 h-3.5 inline text-accent" /> three dots) &rarr;{" "}
                    <span className="font-semibold text-white">Save and share</span> &rarr;{" "}
                    <span className="font-semibold text-white">Install Wavery...</span>
                  </div>
                </li>
                <li className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent font-bold text-2xs flex items-center justify-center flex-shrink-0 mt-1">
                    3
                  </span>
                  <div className="flex-1 text-2xs leading-relaxed">
                    Click <span className="font-semibold text-white">Install</span> to run Wavery in a dedicated standalone window with zero browser chrome.
                  </div>
                </li>
              </ol>
            </div>
          )}

          {/* Local Wi-Fi / Private IP Callout */}
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-2">
            <div className="text-2xs font-semibold text-white">
              Why Chrome says &ldquo;Can&apos;t install this&rdquo; on local Wi-Fi:
            </div>
            <p className="text-2xs text-textMuted leading-relaxed">
              Chrome on Android requires a public HTTPS address to compile an app package via Google Play Services. Since local network streaming runs on a private Wi-Fi IP, Google&apos;s cloud cannot reach it.
            </p>
            <button
              type="button"
              onClick={async () => {
                await windowService.toggleFullscreen();
                onClose();
              }}
              className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-98 text-white font-semibold text-2xs transition"
            >
              <Maximize2 className="w-3.5 h-3.5 text-accent" />
              <span>Use Fullscreen Mode (Hides Browser Bar)</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-white/[0.02] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-textSecondary hover:text-white bg-white/[0.06] hover:bg-white/[0.1] active:scale-95 transition"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

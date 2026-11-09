import { useState, useEffect, useCallback } from "react";
import { isTauri } from "../services/adapter";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export interface PwaInstallState {
  /** True when the app is running in a browser that supports 1-tap native prompt. */
  canPromptNative: boolean;
  /** True when running as an installed standalone app or in the Tauri native shell. */
  isInstalledOrStandalone: boolean;
  /** True when running on an iOS device (iPhone/iPad). */
  isIos: boolean;
  /** True when running on an Android device. */
  isAndroid: boolean;
  /** True when running on a Chrome/Chromium desktop or mobile browser. */
  isChrome: boolean;
  /** Triggers the native browser install prompt if available. Returns true if accepted. */
  promptNativeInstall: () => Promise<boolean>;
}

// Module-level cache for beforeinstallprompt event in case hook re-mounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
  });
}

export function usePwaInstall(): PwaInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => globalDeferredPrompt
  );
  const [isStandalone, setIsStandalone] = useState<boolean>(() => isRunningStandalone());

  const isIos =
    typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  const isAndroid = typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);
  const isChrome =
    typeof navigator !== "undefined" &&
    /Chrome|Chromium|CriOS/.test(navigator.userAgent) &&
    !/Edg/.test(navigator.userAgent);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      globalDeferredPrompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(globalDeferredPrompt);
    };

    const handleAppInstalled = () => {
      globalDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptNativeInstall = useCallback(async (): Promise<boolean> => {
    const prompt = deferredPrompt || globalDeferredPrompt;
    if (!prompt) return false;

    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        globalDeferredPrompt = null;
        setDeferredPrompt(null);
        return true;
      }
    } catch (err) {
      console.warn("[PWA] Install prompt failed:", err);
    }
    return false;
  }, [deferredPrompt]);

  return {
    canPromptNative: !isTauri && !isStandalone && Boolean(deferredPrompt || globalDeferredPrompt),
    isInstalledOrStandalone: isTauri || isStandalone,
    isIos,
    isAndroid,
    isChrome,
    promptNativeInstall,
  };
}

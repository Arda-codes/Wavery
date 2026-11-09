import { useState, useEffect, useCallback, useRef } from "react";
import { isTauri } from "../services/adapter";

export interface ServerConnectionState {
  /** True when the web streaming server is unreachable */
  isOffline: boolean;
  /** True while an active probe is in flight */
  isChecking: boolean;
  /** Countdown in seconds until the next automatic reconnection attempt */
  retryCountdown: number;
  /** Target server origin address being reached */
  serverAddress: string;
  /** Whether the full cover has been minimized into a compact top banner */
  isCoverMinimized: boolean;
  /** Minimize or maximize the offline cover */
  setIsCoverMinimized: (minimized: boolean) => void;
  /** Explicitly re-check connectivity immediately */
  checkConnection: () => Promise<boolean>;
}

export function useServerConnection(): ServerConnectionState {
  const [isOffline, setIsOffline] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(4);
  const [isCoverMinimized, setIsCoverMinimized] = useState(false);
  const consecutiveFailuresRef = useRef(0);
  const isPreviouslyOfflineRef = useRef(false);

  const serverAddress =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host}`
      : "http://127.0.0.1:4242";

  const checkConnection = useCallback(async (): Promise<boolean> => {
    // Desktop Tauri native shell manages its own in-process runtime
    if (isTauri) {
      setIsOffline(false);
      return true;
    }

    setIsChecking(true);
    let healthy = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch("/api/health", {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        healthy = true;
      }
    } catch {
      healthy = false;
    } finally {
      setIsChecking(false);
    }

    if (healthy) {
      consecutiveFailuresRef.current = 0;
      if (isPreviouslyOfflineRef.current) {
        isPreviouslyOfflineRef.current = false;
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("wavery:server-reconnected"));
        }
      }
      setIsOffline(false);
      setRetryCountdown(4);
      return true;
    } else {
      consecutiveFailuresRef.current += 1;
      const navOffline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (consecutiveFailuresRef.current >= 2 || navOffline) {
        setIsOffline(true);
        isPreviouslyOfflineRef.current = true;
      }
      return false;
    }
  }, []);

  // Poll loop
  useEffect(() => {
    if (isTauri) return;

    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (!active) return;

      if (isOffline) {
        setRetryCountdown((prev) => {
          if (prev <= 1) {
            void checkConnection();
            return 4;
          }
          return prev - 1;
        });
      }

      timerId = setTimeout(tick, 1000);
    };

    // Heartbeat probe every 8s when connected
    const heartbeatInterval = setInterval(() => {
      if (!isOffline && active) {
        void checkConnection();
      }
    }, 8000);

    timerId = setTimeout(tick, 1000);

    const handleWindowOnline = () => {
      void checkConnection();
    };

    const handleWindowOffline = () => {
      consecutiveFailuresRef.current = 2;
      setIsOffline(true);
      isPreviouslyOfflineRef.current = true;
    };

    window.addEventListener("online", handleWindowOnline);
    window.addEventListener("offline", handleWindowOffline);

    return () => {
      active = false;
      if (timerId !== null) clearTimeout(timerId);
      clearInterval(heartbeatInterval);
      window.removeEventListener("online", handleWindowOnline);
      window.removeEventListener("offline", handleWindowOffline);
    };
  }, [isOffline, checkConnection]);

  return {
    isOffline,
    isChecking,
    retryCountdown,
    serverAddress,
    isCoverMinimized,
    setIsCoverMinimized,
    checkConnection,
  };
}

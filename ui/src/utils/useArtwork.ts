import { useState, useEffect } from "react";
import { playerAdapter } from "../services/adapter";
import { useSettingsStore } from "../stores/settingsStore";

function getCachedArtworkSync(trackId?: string): string | null {
  const simplifyMode = useSettingsStore.getState().simplifyMode;
  if (simplifyMode || !trackId) return null;
  const url = playerAdapter.getArtworkUrl(trackId);
  return url || null;
}

export function useArtwork(trackId?: string): string | null {
  const simplifyMode = useSettingsStore((s) => s.simplifyMode);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(() => {
    if (simplifyMode || !trackId) return null;
    return getCachedArtworkSync(trackId);
  });

  useEffect(() => {
    if (simplifyMode || !trackId) {
      setArtworkUrl(null);
      return;
    }

    let isMounted = true;
    const cached = getCachedArtworkSync(trackId);
    if (cached) {
      setArtworkUrl(cached);
    }

    playerAdapter
      .getArtwork(trackId)
      .then((url) => {
        if (isMounted && url) {
          setArtworkUrl(url);
        }
      })
      .catch(() => {
        // Graceful fallback on missing or failed artwork
      });

    return () => {
      isMounted = false;
    };
  }, [trackId, simplifyMode]);

  if (simplifyMode || !trackId) return null;
  return artworkUrl;
}

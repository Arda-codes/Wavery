import { playerAdapter } from "../services/adapter";
import { useSettingsStore } from "../stores/settingsStore";

export function getCachedArtworkSync(trackId?: string): string | null {
  const simplifyMode = useSettingsStore.getState().simplifyMode;
  if (simplifyMode || !trackId) return null;
  return playerAdapter.getArtworkUrl(trackId);
}

export function useArtwork(trackId?: string): string | null {
  const simplifyMode = useSettingsStore((s) => s.simplifyMode);
  if (simplifyMode || !trackId) return null;
  return playerAdapter.getArtworkUrl(trackId);
}

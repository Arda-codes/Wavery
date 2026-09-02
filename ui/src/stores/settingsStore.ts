import { create } from "zustand";
import { playerAdapter } from "../services/adapter";

export type ThemeMode = "dark" | "light" | "oled" | "midnight";
export type ReplayGainMode = "off" | "track" | "album";
export type AlbumGridSize = "compact" | "medium" | "spacious";
export type RowDensity = "comfortable" | "compact";

export interface Keybindings {
  togglePlay: string;
  nextTrack: string;
  prevTrack: string;
  volumeUp: string;
  volumeDown: string;
  seekForward: string;
  seekBackward: string;
  openSearch: string;
  toggleMute: string;
  toggleFullscreen: string;
  toggleLyrics: string;
}

export interface SettingsData {
  // General
  autoScanOnStartup: boolean;
  notificationsEnabled: boolean;
  minimizeToTray: boolean;
  enableMpris: boolean;
  autoResumePlayback: boolean;

  // Audio & Playback
  defaultVolume: number; // 0.0 to 1.0
  volumeStep: number; // e.g. 0.05
  crossfadeDurationMs: number; // 0 to 10000 ms
  gaplessPlayback: boolean;
  replayGainMode: ReplayGainMode;

  // Appearance & Theme
  themeMode: ThemeMode;
  accentColor: string;
  albumGridSize: AlbumGridSize;
  rowDensity: RowDensity;
  showVisualizer: boolean;
  showLyricsSmoothScroll: boolean;
  simplifyMode: boolean;
  isLinuxBannerDismissed: boolean;

  // Keybindings
  keybindings: Keybindings;
}

export interface SettingsState extends SettingsData {
  toggleSimplifyMode: () => void;
  setSimplifyMode: (enabled: boolean) => void;
  dismissLinuxBanner: () => void;
  setLinuxBannerDismissed: (dismissed: boolean) => void;
  setSetting: <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => void;
  resetToDefaults: () => void;
  exportConfigJson: () => string;
  importConfigJson: (jsonStr: string) => boolean;
  loadSettingsFromBackend: () => Promise<void>;
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  togglePlay: "Space",
  nextTrack: "Ctrl+Right",
  prevTrack: "Ctrl+Left",
  volumeUp: "Up",
  volumeDown: "Down",
  seekForward: "Right",
  seekBackward: "Left",
  openSearch: "Ctrl+K",
  toggleMute: "M",
  toggleFullscreen: "F",
  toggleLyrics: "L",
};

export const DEFAULT_SETTINGS: SettingsData = {
  autoScanOnStartup: true,
  notificationsEnabled: true,
  minimizeToTray: false,
  enableMpris: true,
  autoResumePlayback: false,

  defaultVolume: 0.8,
  volumeStep: 0.05,
  crossfadeDurationMs: 0,
  gaplessPlayback: true,
  replayGainMode: "off",

  themeMode: "dark",
  accentColor: "#FA586A",
  albumGridSize: "medium",
  rowDensity: "comfortable",
  showVisualizer: true,
  showLyricsSmoothScroll: true,
  simplifyMode: false,
  isLinuxBannerDismissed: false,

  keybindings: DEFAULT_KEYBINDINGS,
};

const STORAGE_KEY_SETTINGS = "wavery_user_settings";
const STORAGE_KEY_SIMPLIFY = "wavery_simplify_mode";
const STORAGE_KEY_LINUX_DISMISSED = "wavery_linux_banner_dismissed";

let cachedBackendConfig: any = null;

export function mapBackendConfigToSettings(backendCfg: any): Partial<SettingsData> {
  if (!backendCfg || typeof backendCfg !== "object") return {};
  cachedBackendConfig = backendCfg;
  const s: Partial<SettingsData> = {};

  if (backendCfg.general) {
    if (typeof backendCfg.general.notifications_enabled === "boolean") {
      s.notificationsEnabled = backendCfg.general.notifications_enabled;
    }
    if (typeof backendCfg.general.minimize_to_tray === "boolean") {
      s.minimizeToTray = backendCfg.general.minimize_to_tray;
    }
    if (typeof backendCfg.general.enable_mpris === "boolean") {
      s.enableMpris = backendCfg.general.enable_mpris;
    }
    if (typeof backendCfg.general.auto_resume_playback === "boolean") {
      s.autoResumePlayback = backendCfg.general.auto_resume_playback;
    }
  }

  if (backendCfg.library) {
    if (typeof backendCfg.library.scan_on_startup === "boolean") {
      s.autoScanOnStartup = backendCfg.library.scan_on_startup;
    }
  }

  if (backendCfg.audio) {
    if (typeof backendCfg.audio.default_volume === "number") {
      s.defaultVolume = backendCfg.audio.default_volume;
    }
    if (typeof backendCfg.audio.volume_step === "number") {
      s.volumeStep = backendCfg.audio.volume_step;
    }
    if (typeof backendCfg.audio.crossfade_duration_ms === "number") {
      s.crossfadeDurationMs = backendCfg.audio.crossfade_duration_ms;
    }
    if (typeof backendCfg.audio.gapless_playback === "boolean") {
      s.gaplessPlayback = backendCfg.audio.gapless_playback;
    }
    if (typeof backendCfg.audio.replay_gain_mode === "string") {
      s.replayGainMode = backendCfg.audio.replay_gain_mode as ReplayGainMode;
    }
  }

  if (backendCfg.theme) {
    if (typeof backendCfg.theme.mode === "string") {
      const mode = backendCfg.theme.mode.toLowerCase();
      if (mode === "dark" || mode === "light" || mode === "oled" || mode === "midnight") {
        s.themeMode = mode;
      }
    }
    if (typeof backendCfg.theme.accent === "string" && backendCfg.theme.accent.length > 0) {
      s.accentColor = backendCfg.theme.accent;
    } else if (typeof backendCfg.theme.primary === "string" && backendCfg.theme.primary.length > 0) {
      s.accentColor = backendCfg.theme.primary;
    }
  }

  if (backendCfg.ui) {
    if (typeof backendCfg.ui.album_grid_size === "string") {
      s.albumGridSize = backendCfg.ui.album_grid_size as AlbumGridSize;
    }
    if (typeof backendCfg.ui.row_density === "string") {
      s.rowDensity = backendCfg.ui.row_density as RowDensity;
    }
    if (typeof backendCfg.ui.show_visualizer === "boolean") {
      s.showVisualizer = backendCfg.ui.show_visualizer;
    }
    if (typeof backendCfg.ui.show_lyrics_smooth_scroll === "boolean") {
      s.showLyricsSmoothScroll = backendCfg.ui.show_lyrics_smooth_scroll;
    }
    if (typeof backendCfg.ui.simplify_mode === "boolean") {
      s.simplifyMode = backendCfg.ui.simplify_mode;
    }
    if (typeof backendCfg.ui.is_linux_banner_dismissed === "boolean") {
      s.isLinuxBannerDismissed = backendCfg.ui.is_linux_banner_dismissed;
    }
  }

  if (backendCfg.keybinds) {
    s.keybindings = {
      togglePlay: backendCfg.keybinds.toggle_play || DEFAULT_KEYBINDINGS.togglePlay,
      nextTrack: backendCfg.keybinds.next_track || DEFAULT_KEYBINDINGS.nextTrack,
      prevTrack: backendCfg.keybinds.prev_track || DEFAULT_KEYBINDINGS.prevTrack,
      volumeUp: backendCfg.keybinds.volume_up || DEFAULT_KEYBINDINGS.volumeUp,
      volumeDown: backendCfg.keybinds.volume_down || DEFAULT_KEYBINDINGS.volumeDown,
      seekForward: backendCfg.keybinds.seek_forward || backendCfg.keybinds.seek_forward_5s || DEFAULT_KEYBINDINGS.seekForward,
      seekBackward: backendCfg.keybinds.seek_backward || backendCfg.keybinds.seek_backward_5s || DEFAULT_KEYBINDINGS.seekBackward,
      openSearch: backendCfg.keybinds.open_search || DEFAULT_KEYBINDINGS.openSearch,
      toggleMute: backendCfg.keybinds.toggle_mute || DEFAULT_KEYBINDINGS.toggleMute,
      toggleFullscreen: backendCfg.keybinds.toggle_fullscreen || DEFAULT_KEYBINDINGS.toggleFullscreen,
      toggleLyrics: backendCfg.keybinds.toggle_lyrics || DEFAULT_KEYBINDINGS.toggleLyrics,
    };
  }

  return s;
}

export function mapSettingsToBackendConfig(data: SettingsData): any {
  return {
    general: {
      language: "en",
      check_updates: false,
      enable_mpris: data.enableMpris,
      minimize_to_tray: data.minimizeToTray,
      notifications_enabled: data.notificationsEnabled,
      auto_resume_playback: data.autoResumePlayback,
    },
    audio: {
      backend: "rodio",
      default_volume: data.defaultVolume,
      volume_step: data.volumeStep,
      buffer_size_frames: 2048,
      crossfade_duration_ms: data.crossfadeDurationMs,
      output_device: null,
      gapless_playback: data.gaplessPlayback,
      replay_gain_mode: data.replayGainMode,
    },
    library: {
      managed_directory: cachedBackendConfig?.library?.managed_directory || "",
      database_path: cachedBackendConfig?.library?.database_path || "",
      cache_directory: cachedBackendConfig?.library?.cache_directory || "",
      supported_extensions: cachedBackendConfig?.library?.supported_extensions || [
        "flac",
        "wav",
        "mp3",
        "ogg",
        "m4a",
        "aac",
        "opus",
      ],
      scan_on_startup: data.autoScanOnStartup,
    },
    server: {
      host: cachedBackendConfig?.server?.host || "127.0.0.1",
      port: cachedBackendConfig?.server?.port || 4242,
      enable_browser_client: cachedBackendConfig?.server?.enable_browser_client ?? true,
    },
    ui: {
      window_width: 1080.0,
      window_height: 720.0,
      min_width: 800.0,
      min_height: 500.0,
      scale_factor: 1.0,
      album_art_size: 160,
      show_wave_visualizer: data.showVisualizer,
      album_grid_size: data.albumGridSize,
      row_density: data.rowDensity,
      show_visualizer: data.showVisualizer,
      show_lyrics_smooth_scroll: data.showLyricsSmoothScroll,
      simplify_mode: data.simplifyMode,
      is_linux_banner_dismissed: data.isLinuxBannerDismissed,
    },
    theme: {
      mode: data.themeMode,
      background: "#121214",
      accent: data.accentColor,
      surface: "#1a1a1e",
      surface_hover: "#26262b",
      primary: data.accentColor,
      text_primary: "#f4f4f5",
      text_muted: "#71717a",
      error: "#ef4444",
    },
    keybinds: {
      toggle_play: data.keybindings.togglePlay,
      next_track: data.keybindings.nextTrack,
      prev_track: data.keybindings.prevTrack,
      volume_up: data.keybindings.volumeUp,
      volume_down: data.keybindings.volumeDown,
      seek_forward: data.keybindings.seekForward,
      seek_backward: data.keybindings.seekBackward,
      open_search: data.keybindings.openSearch,
      toggle_mute: data.keybindings.toggleMute,
      toggle_fullscreen: data.keybindings.toggleFullscreen,
      toggle_lyrics: data.keybindings.toggleLyrics,
    },
  };
}

function loadPersistedSettings(): SettingsData {
  let settings: SettingsData = { ...DEFAULT_SETTINGS };

  if (typeof localStorage === "undefined") {
    return settings;
  }

  // 1. Try to load structured settings bundle
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      settings = {
        ...settings,
        ...parsed,
        keybindings: {
          ...DEFAULT_KEYBINDINGS,
          ...(parsed.keybindings || {}),
        },
      };
    }
  } catch {
    // Ignore JSON parse errors and fallback to defaults
  }

  // 2. Overlay standalone legacy keys for backwards-compatibility
  try {
    const legacySimplify = localStorage.getItem(STORAGE_KEY_SIMPLIFY);
    if (legacySimplify !== null) {
      settings.simplifyMode = legacySimplify === "true";
    }

    const legacyDismissed = localStorage.getItem(STORAGE_KEY_LINUX_DISMISSED);
    if (legacyDismissed !== null) {
      settings.isLinuxBannerDismissed = legacyDismissed === "true";
    }
  } catch {
    // Ignore storage errors
  }

  return settings;
}

function syncToBackend(data: SettingsData) {
  if (playerAdapter.saveConfig) {
    const backendConfig = mapSettingsToBackendConfig(data);
    playerAdapter.saveConfig(backendConfig).catch(() => {});
  }
}


function persistSettings(data: SettingsData) {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(data));
      localStorage.setItem(STORAGE_KEY_SIMPLIFY, String(data.simplifyMode));
      localStorage.setItem(STORAGE_KEY_LINUX_DISMISSED, String(data.isLinuxBannerDismissed));
    } catch {
      // Ignore storage write errors (e.g. quota exceeded)
    }
  }
  syncToBackend(data);
}


function applyDomClasses(simplify: boolean, theme: ThemeMode, accent: string) {
  if (typeof document === "undefined" || !document.documentElement) return;

  if (document.documentElement.classList) {
    if (simplify) {
      document.documentElement.classList.add("simplify-mode");
    } else {
      document.documentElement.classList.remove("simplify-mode");
    }
  }

  if (typeof document.documentElement.setAttribute === "function") {
    document.documentElement.setAttribute("data-theme", theme);
  }

  if (document.documentElement.style && typeof document.documentElement.style.setProperty === "function") {
    document.documentElement.style.setProperty("--accent-color", accent);
    document.documentElement.style.setProperty("--color-accent", accent);
    document.documentElement.style.setProperty("--color-primary", accent);
    document.documentElement.style.setProperty("--color-accent-hover", `color-mix(in srgb, ${accent} 85%, black)`);
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initial = loadPersistedSettings();
  applyDomClasses(initial.simplifyMode, initial.themeMode, initial.accentColor);

  return {
    ...initial,

    toggleSimplifyMode: () => {
      const next = !get().simplifyMode;
      const updated: SettingsData = { ...get(), simplifyMode: next };
      persistSettings(updated);
      applyDomClasses(next, updated.themeMode, updated.accentColor);
      set({ simplifyMode: next });
    },

    setSimplifyMode: (enabled: boolean) => {
      const updated: SettingsData = { ...get(), simplifyMode: enabled };
      persistSettings(updated);
      applyDomClasses(enabled, updated.themeMode, updated.accentColor);
      set({ simplifyMode: enabled });
    },

    dismissLinuxBanner: () => {
      const updated: SettingsData = { ...get(), isLinuxBannerDismissed: true };
      persistSettings(updated);
      set({ isLinuxBannerDismissed: true });
    },

    setLinuxBannerDismissed: (dismissed: boolean) => {
      const updated: SettingsData = { ...get(), isLinuxBannerDismissed: dismissed };
      persistSettings(updated);
      set({ isLinuxBannerDismissed: dismissed });
    },

    setSetting: <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
      const current = get();
      const updated: SettingsData = {
        ...current,
        [key]: value,
      };
      persistSettings(updated);

      if (key === "simplifyMode" || key === "themeMode" || key === "accentColor") {
        applyDomClasses(updated.simplifyMode, updated.themeMode, updated.accentColor);
      }

      set({ [key]: value } as unknown as Partial<SettingsState>);
    },

    resetToDefaults: () => {
      const reset = { ...DEFAULT_SETTINGS };
      persistSettings(reset);
      applyDomClasses(reset.simplifyMode, reset.themeMode, reset.accentColor);
      set({ ...reset });
    },

    exportConfigJson: () => {
      const state = get();
      const exportable: SettingsData = {
        autoScanOnStartup: state.autoScanOnStartup,
        notificationsEnabled: state.notificationsEnabled,
        minimizeToTray: state.minimizeToTray,
        enableMpris: state.enableMpris,
        autoResumePlayback: state.autoResumePlayback,
        defaultVolume: state.defaultVolume,
        volumeStep: state.volumeStep,
        crossfadeDurationMs: state.crossfadeDurationMs,
        gaplessPlayback: state.gaplessPlayback,
        replayGainMode: state.replayGainMode,
        themeMode: state.themeMode,
        accentColor: state.accentColor,
        albumGridSize: state.albumGridSize,
        rowDensity: state.rowDensity,
        showVisualizer: state.showVisualizer,
        showLyricsSmoothScroll: state.showLyricsSmoothScroll,
        simplifyMode: state.simplifyMode,
        isLinuxBannerDismissed: state.isLinuxBannerDismissed,
        keybindings: state.keybindings,
      };
      return JSON.stringify(exportable, null, 2);
    },

    importConfigJson: (jsonStr: string) => {
      try {
        const parsed = JSON.parse(jsonStr);
        if (typeof parsed !== "object" || parsed === null) return false;

        const merged: SettingsData = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          keybindings: {
            ...DEFAULT_KEYBINDINGS,
            ...(parsed.keybindings || {}),
          },
        };

        persistSettings(merged);
        applyDomClasses(merged.simplifyMode, merged.themeMode, merged.accentColor);
        set({ ...merged });
        return true;
      } catch {
        return false;
      }
    },

    loadSettingsFromBackend: async () => {
      try {
        if (playerAdapter.getConfig) {
          const backendConfig = await playerAdapter.getConfig();
          if (backendConfig && typeof backendConfig === "object") {
            const mapped = mapBackendConfigToSettings(backendConfig);
            const current = get();
            const merged: SettingsData = {
              ...current,
              ...mapped,
              keybindings: {
                ...current.keybindings,
                ...(mapped.keybindings || {}),
              },
            };
            applyDomClasses(merged.simplifyMode, merged.themeMode, merged.accentColor);
            if (typeof localStorage !== "undefined") {
              try {
                localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(merged));
                localStorage.setItem(STORAGE_KEY_SIMPLIFY, String(merged.simplifyMode));
                localStorage.setItem(STORAGE_KEY_LINUX_DISMISSED, String(merged.isLinuxBannerDismissed));
              } catch {}
            }
            set({ ...merged });
          }
        }
      } catch (e) {
        console.warn("Failed to load settings from backend:", e);
      }
    },
  };
});

import { create } from "zustand";
import { playerAdapter } from "../services/adapter";
import {
  DEFAULT_PROTECTED_ARTISTS,
  DEFAULT_GENRE_MAPPINGS,
  setProtectedArtists as setLibProtectedArtists,
  setHiddenArtists as setLibHiddenArtists,
  setGenreMappings as setLibGenreMappings,
} from "../utils/library";
import { useLibraryStore } from "./libraryStore";

export type ThemeMode =
  | "dark"
  | "light"
  | "oled"
  | "midnight"
  | "ocean"
  | "purple"
  | "forest"
  | "mocha"
  | "macchiato"
  | "frappe"
  | "latte"
  | "nord"
  | "snow"
  | "solarized"
  | "sand"
  | "tokyo"
  | "dawn"
  | "gruvbox"
  | "parchment"
  | "rosepine"
  | "bloom"
  | "system"
  | "custom";

export type ReplayGainMode = "off" | "track" | "album";
export type AlbumGridSize = "compact" | "medium" | "spacious";
export type RowDensity = "comfortable" | "compact";
/**
 * How the collapsed mobile mini player exposes track skipping:
 * `"buttons"` shows previous/next either side of play, `"swipe"` hides them
 * and a horizontal swipe on the card skips instead.
 */
export type MiniPlayerControls = "buttons" | "swipe";

export interface CustomTheme {
  id: string;
  name: string;
  isLight: boolean;
  bg: string;
  surface: string;
  surfaceHover?: string;
  surfaceActive?: string;
  deck: string;
  sidebar: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentColor: string;
}

export type ThemeCategory = "Standard" | "Atmospheric" | "Catppuccin" | "Ecosystem" | "Special";

export interface ThemePresetDefinition {
  id: ThemeMode;
  name: string;
  desc: string;
  category: ThemeCategory;
  isLight: boolean;
  bg: string;
  surface: string;
  deck: string;
  sidebar: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentColor: string;
}

export const THEME_PRESETS: Record<string, ThemePresetDefinition> = {
  system: {
    id: "system",
    name: "System",
    desc: "Follows operating system dark/light appearance",
    category: "Standard",
    isLight: false,
    bg: "#0D0D10",
    surface: "#16161A",
    deck: "rgba(18, 18, 22, 0.94)",
    sidebar: "rgba(15, 15, 19, 0.96)",
    border: "rgba(255, 255, 255, 0.08)",
    textPrimary: "#FFFFFF",
    textSecondary: "#A1A1AA",
    textMuted: "#71717A",
    accentColor: "#0A84FF",
  },
  oled: {
    id: "oled",
    name: "Black",
    desc: "True pitch black for OLED displays",
    category: "Standard",
    isLight: false,
    bg: "#000000",
    surface: "#0A0A0C",
    deck: "rgba(5, 5, 6, 0.96)",
    sidebar: "#000000",
    border: "rgba(255, 255, 255, 0.12)",
    textPrimary: "#FFFFFF",
    textSecondary: "#B4B4BC",
    textMuted: "#80808C",
    accentColor: "#FF375F",
  },
  light: {
    id: "light",
    name: "White",
    desc: "Crisp, high-contrast Apple light theme",
    category: "Standard",
    isLight: true,
    bg: "#F4F4F6",
    surface: "#FFFFFF",
    deck: "rgba(235, 236, 240, 0.96)",
    sidebar: "rgba(240, 241, 245, 0.98)",
    border: "rgba(0, 0, 0, 0.10)",
    textPrimary: "#18181B",
    textSecondary: "#3F3F46",
    textMuted: "#5A5A62",
    accentColor: "#0A84FF",
  },
  dark: {
    id: "dark",
    name: "Dark",
    desc: "Deep graphite interface with soft contrast",
    category: "Standard",
    isLight: false,
    bg: "#0D0D10",
    surface: "#16161A",
    deck: "rgba(18, 18, 22, 0.94)",
    sidebar: "rgba(15, 15, 19, 0.96)",
    border: "rgba(255, 255, 255, 0.08)",
    textPrimary: "#FFFFFF",
    textSecondary: "#A1A1AA",
    textMuted: "#71717A",
    accentColor: "#FA586A",
  },
  ocean: {
    id: "ocean",
    name: "Ocean",
    desc: "Deep oceanic marine navy palette",
    category: "Atmospheric",
    isLight: false,
    bg: "#08131E",
    surface: "#0E1D2D",
    deck: "rgba(10, 24, 38, 0.94)",
    sidebar: "rgba(8, 19, 30, 0.96)",
    border: "rgba(14, 165, 233, 0.20)",
    textPrimary: "#F0F9FF",
    textSecondary: "#7DD3FC",
    textMuted: "#38BDF8",
    accentColor: "#0EA5E9",
  },
  purple: {
    id: "purple",
    name: "Purple",
    desc: "Nocturnal electric amethyst vibes",
    category: "Atmospheric",
    isLight: false,
    bg: "#0F0919",
    surface: "#191029",
    deck: "rgba(18, 11, 30, 0.94)",
    sidebar: "rgba(15, 9, 25, 0.96)",
    border: "rgba(168, 85, 247, 0.20)",
    textPrimary: "#FAF5FF",
    textSecondary: "#C084FC",
    textMuted: "#9333EA",
    accentColor: "#A855F7",
  },
  forest: {
    id: "forest",
    name: "Forest",
    desc: "Deep evergreen pine and Nordic emerald",
    category: "Atmospheric",
    isLight: false,
    bg: "#0A130E",
    surface: "#122018",
    deck: "rgba(12, 23, 16, 0.94)",
    sidebar: "rgba(10, 19, 14, 0.96)",
    border: "rgba(16, 185, 129, 0.20)",
    textPrimary: "#F0FDF4",
    textSecondary: "#6EE7B7",
    textMuted: "#34D399",
    accentColor: "#10B981",
  },
  midnight: {
    id: "midnight",
    name: "Midnight",
    desc: "Velvet midnight blue with rich indigo glow",
    category: "Atmospheric",
    isLight: false,
    bg: "#080C14",
    surface: "#0F172A",
    deck: "rgba(13, 20, 36, 0.94)",
    sidebar: "rgba(11, 16, 28, 0.96)",
    border: "rgba(99, 102, 241, 0.20)",
    textPrimary: "#F1F5F9",
    textSecondary: "#94A3B8",
    textMuted: "#64748B",
    accentColor: "#6366F1",
  },
  mocha: {
    id: "mocha",
    name: "Mocha",
    desc: "Catppuccin dark palette with Lavender accent",
    category: "Catppuccin",
    isLight: false,
    bg: "#1E1E2E",
    surface: "#252538",
    deck: "rgba(24, 24, 37, 0.95)",
    sidebar: "rgba(17, 17, 27, 0.96)",
    border: "rgba(203, 166, 247, 0.18)",
    textPrimary: "#CDD6F4",
    textSecondary: "#A6ADC8",
    textMuted: "#6C7086",
    accentColor: "#CBA6F7",
  },
  macchiato: {
    id: "macchiato",
    name: "Macchiato",
    desc: "Catppuccin rich midnight with Peach accent",
    category: "Catppuccin",
    isLight: false,
    bg: "#24273A",
    surface: "#2D3149",
    deck: "rgba(30, 32, 48, 0.95)",
    sidebar: "rgba(24, 25, 38, 0.96)",
    border: "rgba(245, 169, 127, 0.18)",
    textPrimary: "#CAD3F5",
    textSecondary: "#A5ADCB",
    textMuted: "#6E738D",
    accentColor: "#F5A97F",
  },
  frappe: {
    id: "frappe",
    name: "Frappé",
    desc: "Catppuccin balanced dark pastel with Sapphire accent",
    category: "Catppuccin",
    isLight: false,
    bg: "#303446",
    surface: "#393D52",
    deck: "rgba(41, 44, 60, 0.95)",
    sidebar: "rgba(35, 38, 52, 0.96)",
    border: "rgba(140, 170, 238, 0.18)",
    textPrimary: "#C6D0F5",
    textSecondary: "#A5ADCE",
    textMuted: "#737994",
    accentColor: "#8CAAEE",
  },
  latte: {
    id: "latte",
    name: "Latte",
    desc: "Catppuccin soothing warm light with Blue accent",
    category: "Catppuccin",
    isLight: true,
    bg: "#EFF1F5",
    surface: "#FFFFFF",
    deck: "rgba(230, 233, 239, 0.96)",
    sidebar: "rgba(239, 241, 245, 0.98)",
    border: "rgba(30, 102, 245, 0.16)",
    textPrimary: "#4C4F69",
    textSecondary: "#43465D",
    textMuted: "#565970",
    accentColor: "#1E66F5",
  },
  nord: {
    id: "nord",
    name: "Nord",
    desc: "Arctic nocturnal slate with Frost cyan glow",
    category: "Ecosystem",
    isLight: false,
    bg: "#2E3440",
    surface: "#3B4252",
    deck: "rgba(46, 52, 64, 0.95)",
    sidebar: "rgba(36, 41, 51, 0.98)",
    border: "rgba(136, 192, 208, 0.18)",
    textPrimary: "#ECEFF4",
    textSecondary: "#D8DEE9",
    textMuted: "#81A1C1",
    accentColor: "#88C0D0",
  },
  snow: {
    id: "snow",
    name: "Snowstorm",
    desc: "Pure Scandinavian polar winter frost with Ice blue",
    category: "Ecosystem",
    isLight: true,
    bg: "#ECEFF4",
    surface: "#FFFFFF",
    deck: "rgba(229, 233, 240, 0.96)",
    sidebar: "rgba(236, 239, 244, 0.98)",
    border: "rgba(94, 129, 172, 0.18)",
    textPrimary: "#2E3440",
    textSecondary: "#3B4252",
    textMuted: "#4C566A",
    accentColor: "#5E81AC",
  },
  solarized: {
    id: "solarized",
    name: "Solarized Dark",
    desc: "Ethan Schoonover's calibrated deep teal with Solar amber",
    category: "Ecosystem",
    isLight: false,
    bg: "#002B36",
    surface: "#073642",
    deck: "rgba(0, 38, 48, 0.95)",
    sidebar: "rgba(0, 31, 39, 0.98)",
    border: "rgba(42, 161, 152, 0.20)",
    textPrimary: "#93A1A1",
    textSecondary: "#839496",
    textMuted: "#586E75",
    accentColor: "#2AA198",
  },
  sand: {
    id: "sand",
    name: "Solarized Sand",
    desc: "Warm ivory parchment paper with calibrated amber",
    category: "Ecosystem",
    isLight: true,
    bg: "#FDF6E3",
    surface: "#FFFFFF",
    deck: "rgba(238, 232, 213, 0.96)",
    sidebar: "rgba(247, 241, 226, 0.98)",
    border: "rgba(181, 137, 0, 0.20)",
    textPrimary: "#073642",
    textSecondary: "#2A4B54",
    textMuted: "#476068",
    accentColor: "#B58900",
  },
  tokyo: {
    id: "tokyo",
    name: "Tokyo Night",
    desc: "Shibuya metropolitan midnight with electric cyan & neon violet",
    category: "Ecosystem",
    isLight: false,
    bg: "#1A1B26",
    surface: "#24283B",
    deck: "rgba(26, 27, 38, 0.95)",
    sidebar: "rgba(19, 20, 29, 0.98)",
    border: "rgba(122, 162, 247, 0.20)",
    textPrimary: "#C0CAF5",
    textSecondary: "#9AA5CE",
    textMuted: "#565F89",
    accentColor: "#7AA2F7",
  },
  dawn: {
    id: "dawn",
    name: "Tokyo Dawn",
    desc: "Crisp early daylight in Tokyo with deep azure accents",
    category: "Ecosystem",
    isLight: true,
    bg: "#E1E2E7",
    surface: "#FFFFFF",
    deck: "rgba(220, 222, 229, 0.96)",
    sidebar: "rgba(229, 230, 236, 0.98)",
    border: "rgba(46, 125, 233, 0.18)",
    textPrimary: "#2E303E",
    textSecondary: "#3B4058",
    textMuted: "#525875",
    accentColor: "#2E7DE9",
  },
  gruvbox: {
    id: "gruvbox",
    name: "Gruvbox Dark",
    desc: "Retro groove warm charcoal basalt with golden ember orange",
    category: "Ecosystem",
    isLight: false,
    bg: "#282828",
    surface: "#32302F",
    deck: "rgba(37, 35, 34, 0.95)",
    sidebar: "rgba(29, 27, 26, 0.98)",
    border: "rgba(254, 128, 25, 0.18)",
    textPrimary: "#EBDBB2",
    textSecondary: "#D5C4A1",
    textMuted: "#928374",
    accentColor: "#FE8019",
  },
  parchment: {
    id: "parchment",
    name: "Parchment",
    desc: "Warm retro linen paper with burnt terracotta accent",
    category: "Ecosystem",
    isLight: true,
    bg: "#FBF1C7",
    surface: "#FFFFFF",
    deck: "rgba(242, 229, 188, 0.96)",
    sidebar: "rgba(247, 238, 203, 0.98)",
    border: "rgba(175, 58, 3, 0.18)",
    textPrimary: "#3C3836",
    textSecondary: "#504945",
    textMuted: "#665C54",
    accentColor: "#AF3A03",
  },
  rosepine: {
    id: "rosepine",
    name: "Rosé Pine",
    desc: "All-natural pine needles with soothing warm dusty rose",
    category: "Ecosystem",
    isLight: false,
    bg: "#191724",
    surface: "#1F1D2E",
    deck: "rgba(25, 23, 36, 0.95)",
    sidebar: "rgba(18, 16, 26, 0.98)",
    border: "rgba(235, 188, 186, 0.18)",
    textPrimary: "#E0DEF4",
    textSecondary: "#908CAA",
    textMuted: "#6E6A86",
    accentColor: "#EBBCBA",
  },
  bloom: {
    id: "bloom",
    name: "Bloom",
    desc: "Delicate morning dawn pastel with blooming rose coral",
    category: "Ecosystem",
    isLight: true,
    bg: "#FAF4ED",
    surface: "#FFFFFF",
    deck: "rgba(242, 233, 222, 0.96)",
    sidebar: "rgba(247, 240, 231, 0.98)",
    border: "rgba(215, 130, 126, 0.20)",
    textPrimary: "#575279",
    textSecondary: "#484358",
    textMuted: "#656075",
    accentColor: "#D7827E",
  },
};

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

export interface GradientAccentPreset {
  name: string;
  gradient: string;
  primary: string;
}

export const GRADIENT_ACCENT_PRESETS: GradientAccentPreset[] = [
  {
    name: "Sunset Coral",
    gradient: "linear-gradient(135deg, #FA586A 0%, #FF7E40 100%)",
    primary: "#FA586A",
  },
  {
    name: "Neon Violet",
    gradient: "linear-gradient(135deg, #8A2387 0%, #E94057 50%, #F27121 100%)",
    primary: "#E94057",
  },
  {
    name: "Cyber Cyan",
    gradient: "linear-gradient(135deg, #00D2D3 0%, #0A84FF 100%)",
    primary: "#00D2D3",
  },
  {
    name: "Aurora Emerald",
    gradient: "linear-gradient(135deg, #10B981 0%, #06B6D4 100%)",
    primary: "#10B981",
  },
  {
    name: "Royal Indigo",
    gradient: "linear-gradient(135deg, #6366F1 0%, #A855F7 100%)",
    primary: "#6366F1",
  },
  {
    name: "Golden Sun",
    gradient: "linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)",
    primary: "#F59E0B",
  },
  {
    name: "Electric Fuchsia",
    gradient: "linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)",
    primary: "#EC4899",
  },
  {
    name: "Deep Cosmic",
    gradient: "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)",
    primary: "#3B82F6",
  },
  {
    name: "Nordic Borealis",
    gradient: "linear-gradient(135deg, #88C0D0 0%, #5E81AC 100%)",
    primary: "#88C0D0",
  },
  {
    name: "Solar Flare",
    gradient: "linear-gradient(135deg, #B58900 0%, #CB4B16 100%)",
    primary: "#B58900",
  },
  {
    name: "Tokyo Shibuya",
    gradient: "linear-gradient(135deg, #7AA2F7 0%, #BB9AF7 100%)",
    primary: "#7AA2F7",
  },
  {
    name: "Rosé Dawn",
    gradient: "linear-gradient(135deg, #EBBCBA 0%, #D7827E 50%, #908CAA 100%)",
    primary: "#EBBCBA",
  },
];

interface SettingsData {
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
  accentGradient?: string;
  customColors: string[];
  customTheme: CustomTheme | null;
  savedCustomThemes: CustomTheme[];
  albumGridSize: AlbumGridSize;
  rowDensity: RowDensity;
  miniPlayerControls: MiniPlayerControls;
  showVisualizer: boolean;
  showLyricsSmoothScroll: boolean;
  simplifyMode: boolean;
  isLinuxBannerDismissed: boolean;
  enableGradients: boolean;

  // Library & Metadata
  protectedArtists: string[];
  hiddenArtists: string[];
  genreMappings: Record<string, string>;
  managedDirectory: string;
  databasePath: string;

  // Server & Network
  allowLanStreaming: boolean;

  // Integrations
  enableMediaSession: boolean;
  enableDiscordRpc: boolean;
  discordAppId: string;

  // Keybindings
  keybindings: Keybindings;
}

interface SettingsState extends SettingsData {
  toggleSimplifyMode: () => void;
  setSimplifyMode: (enabled: boolean) => void;
  setEnableGradients: (enabled: boolean) => void;
  dismissLinuxBanner: () => void;
  setLinuxBannerDismissed: (dismissed: boolean) => void;
  setSetting: <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => void;
  setThemePreset: (presetId: ThemeMode) => void;
  saveCustomTheme: (theme: CustomTheme) => void;
  deleteCustomTheme: (id: string) => void;
  applyCustomTheme: (theme: CustomTheme) => void;
  setProtectedArtists: (artists: string[]) => void;
  addProtectedArtist: (artist: string) => void;
  removeProtectedArtist: (artist: string) => void;
  resetProtectedArtists: () => void;
  setHiddenArtists: (artists: string[]) => void;
  hideArtist: (artist: string) => void;
  unhideArtist: (artist: string) => void;
  toggleHideArtist: (artist: string) => void;
  isArtistHidden: (artist: string) => boolean;
  setGenreMappings: (mappings: Record<string, string>) => void;
  setGenreMapping: (alias: string, canonical: string) => void;
  removeGenreMapping: (alias: string) => void;
  resetGenreMappings: () => void;
  addCustomColor: (color: string) => void;
  removeCustomColor: (color: string) => void;
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
  customColors: [],
  customTheme: null,
  savedCustomThemes: [],
  albumGridSize: "medium",
  rowDensity: "comfortable",
  miniPlayerControls: "buttons",
  showVisualizer: true,
  showLyricsSmoothScroll: true,
  simplifyMode: false,
  isLinuxBannerDismissed: false,
  enableGradients: true,

  protectedArtists: [...DEFAULT_PROTECTED_ARTISTS],
  hiddenArtists: [],
  genreMappings: { ...DEFAULT_GENRE_MAPPINGS },
  managedDirectory: "",
  databasePath: "",

  allowLanStreaming: false,

  enableMediaSession: true,
  enableDiscordRpc: false,
  discordAppId: "",

  keybindings: DEFAULT_KEYBINDINGS,
};

const STORAGE_KEY_SETTINGS = "wavery_user_settings";
const STORAGE_KEY_SIMPLIFY = "wavery_simplify_mode";
const STORAGE_KEY_LINUX_DISMISSED = "wavery_linux_banner_dismissed";
const STORAGE_KEY_GRADIENTS = "wavery_enable_gradients";

export interface BackendConfig {
  general?: {
    language?: string;
    check_updates?: boolean;
    enable_mpris?: boolean;
    minimize_to_tray?: boolean;
    notifications_enabled?: boolean;
    auto_resume_playback?: boolean;
  };
  audio?: {
    backend?: string;
    default_volume?: number;
    volume_step?: number;
    buffer_size_frames?: number;
    crossfade_duration_ms?: number;
    output_device?: string | null;
    gapless_playback?: boolean;
    replay_gain_mode?: string;
  };
  library?: {
    managed_directory?: string;
    database_path?: string;
    cache_directory?: string;
    supported_extensions?: string[];
    scan_on_startup?: boolean;
    protected_artists?: string[];
    hidden_artists?: string[];
    genre_mappings?: Record<string, string>;
  };
  server?: {
    host?: string;
    port?: number;
    enable_browser_client?: boolean;
  };
  ui?: {
    window_width?: number;
    window_height?: number;
    min_width?: number;
    min_height?: number;
    scale_factor?: number;
    album_art_size?: number;
    show_wave_visualizer?: boolean;
    album_grid_size?: string;
    row_density?: string;
    mini_player_controls?: string;
    show_visualizer?: boolean;
    show_lyrics_smooth_scroll?: boolean;
    simplify_mode?: boolean;
    is_linux_banner_dismissed?: boolean;
    enable_gradients?: boolean;
  };
  theme?: {
    mode?: string;
    background?: string;
    accent?: string;
    surface?: string;
    surface_hover?: string;
    primary?: string;
    text_primary?: string;
    text_muted?: string;
    error?: string;
    custom_colors?: string[];
    custom_theme_json?: string;
  };
  keybinds?: Record<string, string>;
  integrations?: {
    enable_media_session?: boolean;
    enable_discord_rpc?: boolean;
    discord_app_id?: string;
  };
}

let cachedBackendConfig: BackendConfig | null = null;

function mapBackendConfigToSettings(backendCfg: BackendConfig | null | undefined): Partial<SettingsData> {
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
    if (Array.isArray(backendCfg.library.protected_artists)) {
      s.protectedArtists = backendCfg.library.protected_artists.filter(
        (a: unknown) => typeof a === "string" && (a as string).trim().length > 0
      );
    }
    if (Array.isArray(backendCfg.library.hidden_artists)) {
      s.hiddenArtists = backendCfg.library.hidden_artists.filter(
        (a: unknown) => typeof a === "string" && (a as string).trim().length > 0
      );
    }
    if (backendCfg.library.genre_mappings && typeof backendCfg.library.genre_mappings === "object") {
      s.genreMappings = { ...backendCfg.library.genre_mappings };
      setLibGenreMappings(s.genreMappings);
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
      const validModes: ThemeMode[] = [
        "dark", "light", "oled", "midnight", "ocean",
        "purple", "forest", "mocha", "macchiato",
        "frappe", "latte", "nord", "snow", "solarized",
        "sand", "tokyo", "dawn", "gruvbox", "parchment",
        "rosepine", "bloom", "system", "custom"
      ];
      if (validModes.includes(mode as ThemeMode)) {
        s.themeMode = mode as ThemeMode;
      }
    }
    if (typeof backendCfg.theme.accent === "string" && backendCfg.theme.accent.length > 0) {
      s.accentColor = backendCfg.theme.accent;
    } else if (typeof backendCfg.theme.primary === "string" && backendCfg.theme.primary.length > 0) {
      s.accentColor = backendCfg.theme.primary;
    }
    if (Array.isArray(backendCfg.theme.custom_colors)) {
      s.customColors = backendCfg.theme.custom_colors.filter(
        (c: unknown) => typeof c === "string" && (c as string).startsWith("#")
      );
    }
    if (typeof backendCfg.theme.custom_theme_json === "string") {
      try {
        s.customTheme = JSON.parse(backendCfg.theme.custom_theme_json);
      } catch {}
    }
  }

  if (backendCfg.ui) {
    if (typeof backendCfg.ui.album_grid_size === "string") {
      s.albumGridSize = backendCfg.ui.album_grid_size as AlbumGridSize;
    }
    if (typeof backendCfg.ui.row_density === "string") {
      s.rowDensity = backendCfg.ui.row_density as RowDensity;
    }
    if (
      backendCfg.ui.mini_player_controls === "buttons" ||
      backendCfg.ui.mini_player_controls === "swipe"
    ) {
      s.miniPlayerControls = backendCfg.ui.mini_player_controls;
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
    if (typeof backendCfg.ui.enable_gradients === "boolean") {
      s.enableGradients = backendCfg.ui.enable_gradients;
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

  if (backendCfg.integrations) {
    if (typeof backendCfg.integrations.enable_media_session === "boolean") {
      s.enableMediaSession = backendCfg.integrations.enable_media_session;
    }
    if (typeof backendCfg.integrations.enable_discord_rpc === "boolean") {
      s.enableDiscordRpc = backendCfg.integrations.enable_discord_rpc;
    }
    if (typeof backendCfg.integrations.discord_app_id === "string") {
      s.discordAppId = backendCfg.integrations.discord_app_id;
    }
  }

  if (backendCfg.library) {
    if (typeof backendCfg.library.managed_directory === "string") {
      s.managedDirectory = backendCfg.library.managed_directory;
    }
    if (typeof backendCfg.library.database_path === "string") {
      s.databasePath = backendCfg.library.database_path;
    }
  }

  if (backendCfg.server) {
    if (typeof backendCfg.server.host === "string") {
      const h = backendCfg.server.host.trim();
      s.allowLanStreaming = h === "0.0.0.0" || h === "::";
    }
  }

  return s;
}

function mapSettingsToBackendConfig(data: SettingsData): BackendConfig {
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
      protected_artists: data.protectedArtists || [...DEFAULT_PROTECTED_ARTISTS],
      hidden_artists: data.hiddenArtists || [],
      genre_mappings: data.genreMappings || { ...DEFAULT_GENRE_MAPPINGS },
    },
    server: {
      host: data.allowLanStreaming ? "0.0.0.0" : "127.0.0.1",
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
      mini_player_controls: data.miniPlayerControls,
      show_visualizer: data.showVisualizer,
      show_lyrics_smooth_scroll: data.showLyricsSmoothScroll,
      simplify_mode: data.simplifyMode,
      is_linux_banner_dismissed: data.isLinuxBannerDismissed,
      enable_gradients: data.enableGradients ?? true,
    },
    theme: {
      mode: data.themeMode,
      background: data.customTheme?.bg || (THEME_PRESETS[data.themeMode]?.bg ?? "#121214"),
      accent: data.accentColor,
      surface: data.customTheme?.surface || (THEME_PRESETS[data.themeMode]?.surface ?? "#1a1a1e"),
      surface_hover: data.customTheme?.surfaceHover || "#26262b",
      primary: data.accentColor,
      text_primary: data.customTheme?.textPrimary || (THEME_PRESETS[data.themeMode]?.textPrimary ?? "#f4f4f5"),
      text_muted: data.customTheme?.textMuted || (THEME_PRESETS[data.themeMode]?.textMuted ?? "#71717a"),
      error: "#ef4444",
      custom_colors: data.customColors || [],
      custom_theme_json: data.customTheme ? JSON.stringify(data.customTheme) : undefined,
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
    integrations: {
      enable_media_session: data.enableMediaSession,
      enable_discord_rpc: data.enableDiscordRpc,
      discord_app_id: data.discordAppId || undefined,
    },
  };
}

function loadPersistedSettings(): SettingsData {
  let settings: SettingsData = { ...DEFAULT_SETTINGS };

  if (typeof localStorage === "undefined") {
    setLibProtectedArtists(settings.protectedArtists);
    setLibHiddenArtists(settings.hiddenArtists || []);
    setLibGenreMappings(settings.genreMappings || { ...DEFAULT_GENRE_MAPPINGS });
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

    const legacyGradients = localStorage.getItem(STORAGE_KEY_GRADIENTS);
    if (legacyGradients !== null) {
      settings.enableGradients = legacyGradients === "true";
    }
  } catch {
    // Ignore storage errors
  }

  setLibProtectedArtists(settings.protectedArtists || [...DEFAULT_PROTECTED_ARTISTS]);
  setLibHiddenArtists(settings.hiddenArtists || []);
  setLibGenreMappings(settings.genreMappings || { ...DEFAULT_GENRE_MAPPINGS });
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
      localStorage.setItem(STORAGE_KEY_GRADIENTS, String(data.enableGradients));
    } catch {
      // Ignore storage write errors (e.g. quota exceeded)
    }
  }
  syncToBackend(data);
}


let mediaListenerAttached = false;
function ensureSystemMediaListener() {
  if (typeof window === "undefined" || !window.matchMedia || mediaListenerAttached) return;
  mediaListenerAttached = true;
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    const s = useSettingsStore.getState();
    if (s.themeMode === "system") {
      applyDomClasses(s.simplifyMode, s.themeMode, s.accentColor, s.customTheme, s.enableGradients);
    }
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
  } else if (typeof (mql as unknown as { addListener: (cb: () => void) => void }).addListener === "function") {
    (mql as unknown as { addListener: (cb: () => void) => void }).addListener(handler);
  }
}

let isInitialBoot = true;
let themeTransitionTimer: ReturnType<typeof setTimeout> | null = null;

function applyDomClasses(
  simplify: boolean,
  theme: ThemeMode,
  accent: string,
  customTheme?: CustomTheme | null,
  enableGradients: boolean = true,
  accentGradient?: string,
  onCommit?: () => void
) {
  if (typeof document === "undefined" || !document.documentElement) {
    if (onCommit) onCommit();
    return;
  }

  ensureSystemMediaListener();

  const performDomUpdate = () => {
    if (document.documentElement.classList) {
      if (simplify) {
        document.documentElement.classList.add("simplify-mode");
      } else {
        document.documentElement.classList.remove("simplify-mode");
      }
      if (enableGradients) {
        document.documentElement.classList.remove("no-gradients");
      } else {
        document.documentElement.classList.add("no-gradients");
      }
    }

    let effectiveTheme: string = theme;
    let isLight = false;

    if (theme === "system") {
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      effectiveTheme = prefersDark ? "dark" : "light";
      isLight = !prefersDark;
    } else if (THEME_PRESETS[theme]) {
      isLight = THEME_PRESETS[theme].isLight;
    } else if (theme === "light" || theme === "latte") {
      isLight = true;
    } else if (theme === "custom" && customTheme) {
      isLight = !!customTheme.isLight;
    }

    if (typeof document.documentElement.setAttribute === "function") {
      document.documentElement.setAttribute("data-theme", effectiveTheme);
      document.documentElement.setAttribute("data-light-mode", isLight ? "true" : "false");
    }

    const style = document.documentElement.style;
    if (style && typeof style.setProperty === "function") {
      let baseColor = accent;
      if (baseColor && baseColor.includes("gradient")) {
        const hexMatch = baseColor.match(/#(?:[0-9a-fA-F]{3,8})/);
        baseColor = hexMatch ? hexMatch[0] : "#FA586A";
      }

      style.setProperty("--accent-color", baseColor);
      style.setProperty("--color-accent", baseColor);
      style.setProperty("--color-primary", baseColor);
      style.setProperty("--color-accent-hover", `color-mix(in srgb, ${baseColor} 85%, black)`);

      const toLinear = (c: number) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      const hexClean = baseColor.replace("#", "").trim();
      let onAccent = "#FFFFFF";
      if (hexClean.length >= 6) {
        const r = parseInt(hexClean.substring(0, 2), 16) / 255;
        const g = parseInt(hexClean.substring(2, 4), 16) / 255;
        const b = parseInt(hexClean.substring(4, 6), 16) / 255;
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
          onAccent = lum > 0.45 ? "#18181B" : "#FFFFFF";
        }
      }
      style.setProperty("--color-on-accent", onAccent);

      const grad = accentGradient || (accent && accent.includes("gradient") ? accent : "");
      if (grad && enableGradients) {
        style.setProperty("--accent-gradient", grad);
      } else {
        style.removeProperty("--accent-gradient");
      }

      if (theme === "custom" && customTheme) {
        style.setProperty("--color-bg", customTheme.bg);
        style.setProperty("--color-surface", customTheme.surface);
        style.setProperty(
          "--color-surface-hover",
          customTheme.surfaceHover ||
            `color-mix(in srgb, ${customTheme.surface} 85%, ${customTheme.isLight ? "black" : "white"})`
        );
        style.setProperty(
          "--color-surface-active",
          customTheme.surfaceActive ||
            `color-mix(in srgb, ${customTheme.surface} 75%, ${customTheme.isLight ? "black" : "white"})`
        );
        style.setProperty("--color-deck", customTheme.deck);
        style.setProperty("--color-sidebar", customTheme.sidebar);
        style.setProperty("--color-border", customTheme.border);
        style.setProperty(
          "--color-border-subtle",
          `color-mix(in srgb, ${customTheme.border} 50%, transparent)`
        );
        style.setProperty("--color-text-primary", customTheme.textPrimary);
        style.setProperty("--color-text-secondary", customTheme.textSecondary);
        style.setProperty("--color-text-muted", customTheme.textMuted);
      } else {
        style.removeProperty("--color-bg");
        style.removeProperty("--color-surface");
        style.removeProperty("--color-surface-hover");
        style.removeProperty("--color-surface-active");
        style.removeProperty("--color-deck");
        style.removeProperty("--color-sidebar");
        style.removeProperty("--color-border");
        style.removeProperty("--color-border-subtle");
        style.removeProperty("--color-text-primary");
        style.removeProperty("--color-text-secondary");
        style.removeProperty("--color-text-muted");
      }
    }

    if (onCommit) {
      onCommit();
    }
  };

  // If initial application or reduced motion requested, apply synchronously without transition
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  if (isInitialBoot || prefersReducedMotion) {
    isInitialBoot = false;
    performDomUpdate();
    return;
  }

  // Cross-fade transitions via theme-transitioning CSS class.
  // Note: document.startViewTransition is intentionally avoided because WebKitGTK 2.45+ (libwebkit2gtk-4.1)
  // crashes WebKitWebProcess with FrameRenderer::graphicsLayerFactory assertion failures.
  if (typeof document !== "undefined" && document.documentElement?.classList) {
    document.documentElement.classList.add("theme-transitioning");
    performDomUpdate();
    if (themeTransitionTimer) clearTimeout(themeTransitionTimer);
    themeTransitionTimer = setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
    }, 240);
  } else {
    performDomUpdate();
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initial = loadPersistedSettings();
  applyDomClasses(initial.simplifyMode, initial.themeMode, initial.accentColor, initial.customTheme, initial.enableGradients, initial.accentGradient);

  return {
    ...initial,

    toggleSimplifyMode: () => {
      const next = !get().simplifyMode;
      const updated: SettingsData = { ...get(), simplifyMode: next };
      persistSettings(updated);
      applyDomClasses(
        next,
        updated.themeMode,
        updated.accentColor,
        updated.customTheme,
        updated.enableGradients,
        undefined,
        () => {
          set({ simplifyMode: next });
        }
      );
    },

    setSimplifyMode: (enabled: boolean) => {
      const updated: SettingsData = { ...get(), simplifyMode: enabled };
      persistSettings(updated);
      applyDomClasses(
        enabled,
        updated.themeMode,
        updated.accentColor,
        updated.customTheme,
        updated.enableGradients,
        undefined,
        () => {
          set({ simplifyMode: enabled });
        }
      );
    },

    setEnableGradients: (enabled: boolean) => {
      const updated: SettingsData = { ...get(), enableGradients: enabled };
      persistSettings(updated);
      applyDomClasses(
        updated.simplifyMode,
        updated.themeMode,
        updated.accentColor,
        updated.customTheme,
        enabled,
        undefined,
        () => {
          set({ enableGradients: enabled });
        }
      );
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
      if (current[key] === value) return;
      const updated: SettingsData = {
        ...current,
        [key]: value,
      };
      persistSettings(updated);

      if (
        key === "simplifyMode" ||
        key === "themeMode" ||
        key === "accentColor" ||
        key === "accentGradient" ||
        key === "customTheme" ||
        key === "enableGradients"
      ) {
        applyDomClasses(
          updated.simplifyMode,
          updated.themeMode,
          updated.accentColor,
          updated.customTheme,
          updated.enableGradients,
          updated.accentGradient,
          () => {
            set({ [key]: value } as unknown as Partial<SettingsState>);
          }
        );
      } else {
        set({ [key]: value } as unknown as Partial<SettingsState>);
      }
    },

    setThemePreset: (presetId: ThemeMode) => {
      const preset = THEME_PRESETS[presetId];
      const current = get();
      if (preset) {
        if (current.themeMode === preset.id && current.accentColor === preset.accentColor) {
          return;
        }
        const updated: SettingsData = {
          ...current,
          themeMode: preset.id,
          accentColor: preset.accentColor,
          accentGradient: "",
        };
        persistSettings(updated);
        applyDomClasses(
          updated.simplifyMode,
          updated.themeMode,
          updated.accentColor,
          updated.customTheme,
          updated.enableGradients,
          updated.accentGradient,
          () => {
            set({
              themeMode: preset.id,
              accentColor: preset.accentColor,
              accentGradient: "",
            });
          }
        );
      } else if (presetId === "custom") {
        const customAccent = current.customTheme?.accentColor || current.accentColor;
        if (current.themeMode === "custom" && current.accentColor === customAccent) {
          return;
        }
        const updated: SettingsData = {
          ...current,
          themeMode: "custom",
          accentColor: customAccent,
        };
        persistSettings(updated);
        applyDomClasses(
          updated.simplifyMode,
          "custom",
          customAccent,
          updated.customTheme,
          updated.enableGradients,
          undefined,
          () => {
            set({
              themeMode: "custom",
              accentColor: customAccent,
            });
          }
        );
      }
    },

    saveCustomTheme: (theme: CustomTheme) => {
      const current = get();
      const existingIndex = (current.savedCustomThemes || []).findIndex((t) => t.id === theme.id);
      let updatedSaved: CustomTheme[];
      if (existingIndex >= 0) {
        updatedSaved = [...current.savedCustomThemes];
        updatedSaved[existingIndex] = theme;
      } else {
        updatedSaved = [...(current.savedCustomThemes || []), theme];
      }

      const updated: SettingsData = {
        ...current,
        customTheme: theme,
        savedCustomThemes: updatedSaved,
        themeMode: "custom",
        accentColor: theme.accentColor,
      };
      persistSettings(updated);
      applyDomClasses(
        updated.simplifyMode,
        "custom",
        theme.accentColor,
        theme,
        updated.enableGradients,
        undefined,
        () => {
          set({
            customTheme: theme,
            savedCustomThemes: updatedSaved,
            themeMode: "custom",
            accentColor: theme.accentColor,
          });
        }
      );
    },

    deleteCustomTheme: (id: string) => {
      const current = get();
      const updatedSaved = (current.savedCustomThemes || []).filter((t) => t.id !== id);
      const isCurrentActive = current.customTheme?.id === id;
      const nextCustom = isCurrentActive
        ? updatedSaved.length > 0
          ? updatedSaved[0]
          : null
        : current.customTheme;
      const nextMode = isCurrentActive && !nextCustom ? "dark" : current.themeMode;
      const nextAccent = nextCustom ? nextCustom.accentColor : current.accentColor;

      const updated: SettingsData = {
        ...current,
        customTheme: nextCustom,
        savedCustomThemes: updatedSaved,
        themeMode: nextMode,
        accentColor: nextAccent,
      };
      persistSettings(updated);
      applyDomClasses(
        updated.simplifyMode,
        nextMode,
        nextAccent,
        nextCustom,
        updated.enableGradients,
        undefined,
        () => {
          set({
            customTheme: nextCustom,
            savedCustomThemes: updatedSaved,
            themeMode: nextMode,
            accentColor: nextAccent,
          });
        }
      );
    },

    applyCustomTheme: (theme: CustomTheme) => {
      const current = get();
      const updated: SettingsData = {
        ...current,
        customTheme: theme,
        themeMode: "custom",
        accentColor: theme.accentColor,
      };
      persistSettings(updated);
      applyDomClasses(
        updated.simplifyMode,
        "custom",
        theme.accentColor,
        theme,
        updated.enableGradients,
        undefined,
        () => {
          set({
            customTheme: theme,
            themeMode: "custom",
            accentColor: theme.accentColor,
          });
        }
      );
    },

    setProtectedArtists: (artists: string[]) => {
      setLibProtectedArtists(artists);
      const updated: SettingsData = { ...get(), protectedArtists: artists };
      persistSettings(updated);
      set({ protectedArtists: artists });
      const lib = useLibraryStore.getState();
      if (lib.tracks && lib.tracks.length > 0) {
        lib.setTracks(lib.tracks);
      }
    },

    addProtectedArtist: (artist: string) => {
      const trimmed = artist.trim();
      if (!trimmed) return;
      const current = get().protectedArtists || [];
      const lower = trimmed.toLowerCase();
      if (!current.some((a) => a.toLowerCase() === lower)) {
        const next = [...current, trimmed];
        get().setProtectedArtists(next);
      }
    },

    removeProtectedArtist: (artist: string) => {
      const trimmed = artist.trim().toLowerCase();
      const current = get().protectedArtists || [];
      const next = current.filter((a) => a.trim().toLowerCase() !== trimmed);
      get().setProtectedArtists(next);
    },

    resetProtectedArtists: () => {
      get().setProtectedArtists([...DEFAULT_PROTECTED_ARTISTS]);
    },

    setHiddenArtists: (artists: string[]) => {
      setLibHiddenArtists(artists);
      const updated: SettingsData = { ...get(), hiddenArtists: artists };
      persistSettings(updated);
      set({ hiddenArtists: artists });
      const lib = useLibraryStore.getState();
      if (lib.tracks && lib.tracks.length > 0) {
        lib.setTracks(lib.tracks);
      }
    },

    hideArtist: (artist: string) => {
      const trimmed = artist.trim();
      if (!trimmed) return;
      const current = get().hiddenArtists || [];
      const lower = trimmed.toLowerCase();
      if (!current.some((a) => a.toLowerCase() === lower)) {
        const next = [...current, trimmed];
        get().setHiddenArtists(next);
      }
    },

    unhideArtist: (artist: string) => {
      const trimmed = artist.trim().toLowerCase();
      const current = get().hiddenArtists || [];
      const next = current.filter((a) => a.trim().toLowerCase() !== trimmed);
      get().setHiddenArtists(next);
    },

    toggleHideArtist: (artist: string) => {
      const trimmed = artist.trim();
      if (!trimmed) return;
      if (get().isArtistHidden(trimmed)) {
        get().unhideArtist(trimmed);
      } else {
        get().hideArtist(trimmed);
      }
    },

    isArtistHidden: (artist: string) => {
      if (!artist) return false;
      const lower = artist.trim().toLowerCase();
      return (get().hiddenArtists || []).some((a) => a.toLowerCase() === lower);
    },

    setGenreMappings: (mappings: Record<string, string>) => {
      setLibGenreMappings(mappings);
      const updated: SettingsData = { ...get(), genreMappings: mappings };
      persistSettings(updated);
      set({ genreMappings: mappings });
      const lib = useLibraryStore.getState();
      if (lib.tracks && lib.tracks.length > 0) {
        lib.setTracks(lib.tracks);
      }
    },

    setGenreMapping: (alias: string, canonical: string) => {
      const a = alias.trim().toLowerCase();
      const c = canonical.trim();
      if (!a || !c) return;
      const current = { ...(get().genreMappings || DEFAULT_GENRE_MAPPINGS) };
      current[a] = c;
      get().setGenreMappings(current);
    },

    removeGenreMapping: (alias: string) => {
      const a = alias.trim().toLowerCase();
      const current = { ...(get().genreMappings || DEFAULT_GENRE_MAPPINGS) };
      delete current[a];
      get().setGenreMappings(current);
    },

    resetGenreMappings: () => {
      get().setGenreMappings({ ...DEFAULT_GENRE_MAPPINGS });
    },

    addCustomColor: (color: string) => {
      const normalized = color.trim().toUpperCase();
      if (!/^#[0-9A-F]{6}$/i.test(normalized)) return;
      const current = get().customColors || [];
      if (!current.includes(normalized)) {
        const next = [...current, normalized];
        const updated: SettingsData = { ...get(), customColors: next, accentColor: normalized };
        persistSettings(updated);
        applyDomClasses(updated.simplifyMode, updated.themeMode, normalized, updated.customTheme, updated.enableGradients);
        set({ customColors: next, accentColor: normalized });
      } else {
        get().setSetting("accentColor", normalized);
      }
    },

    removeCustomColor: (color: string) => {
      const normalized = color.trim().toUpperCase();
      const current = get().customColors || [];
      const next = current.filter((c) => c.toUpperCase() !== normalized);
      const updated: SettingsData = { ...get(), customColors: next };
      persistSettings(updated);
      set({ customColors: next });
    },

    resetToDefaults: () => {
      const reset = { ...DEFAULT_SETTINGS };
      setLibProtectedArtists(reset.protectedArtists);
      setLibHiddenArtists(reset.hiddenArtists);
      setLibGenreMappings(reset.genreMappings);
      persistSettings(reset);
      applyDomClasses(reset.simplifyMode, reset.themeMode, reset.accentColor, reset.customTheme, reset.enableGradients);
      set({ ...reset });
      const lib = useLibraryStore.getState();
      if (lib.tracks && lib.tracks.length > 0) {
        lib.setTracks(lib.tracks);
      }
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
        customColors: state.customColors || [],
        customTheme: state.customTheme,
        savedCustomThemes: state.savedCustomThemes || [],
        albumGridSize: state.albumGridSize,
        rowDensity: state.rowDensity,
        miniPlayerControls: state.miniPlayerControls,
        showVisualizer: state.showVisualizer,
        showLyricsSmoothScroll: state.showLyricsSmoothScroll,
        simplifyMode: state.simplifyMode,
        isLinuxBannerDismissed: state.isLinuxBannerDismissed,
        enableGradients: state.enableGradients,
        protectedArtists: state.protectedArtists,
        hiddenArtists: state.hiddenArtists || [],
        genreMappings: state.genreMappings || { ...DEFAULT_GENRE_MAPPINGS },
        managedDirectory: state.managedDirectory || "",
        databasePath: state.databasePath || "",
        allowLanStreaming: state.allowLanStreaming,
        enableMediaSession: state.enableMediaSession,
        enableDiscordRpc: state.enableDiscordRpc,
        discordAppId: state.discordAppId,
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

        if (merged.protectedArtists) {
          setLibProtectedArtists(merged.protectedArtists);
        }
        if (merged.hiddenArtists) {
          setLibHiddenArtists(merged.hiddenArtists);
        }
        if (merged.genreMappings) {
          setLibGenreMappings(merged.genreMappings);
        }

        persistSettings(merged);
        applyDomClasses(merged.simplifyMode, merged.themeMode, merged.accentColor, merged.customTheme, merged.enableGradients);
        set({ ...merged });

        const lib = useLibraryStore.getState();
        if (lib.tracks && lib.tracks.length > 0) {
          lib.setTracks(lib.tracks);
        }

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
            if (merged.protectedArtists) {
              setLibProtectedArtists(merged.protectedArtists);
            }
            if (merged.hiddenArtists) {
              setLibHiddenArtists(merged.hiddenArtists);
            }
            applyDomClasses(merged.simplifyMode, merged.themeMode, merged.accentColor, merged.customTheme, merged.enableGradients);
            if (typeof localStorage !== "undefined") {
              try {
                localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(merged));
                localStorage.setItem(STORAGE_KEY_SIMPLIFY, String(merged.simplifyMode));
                localStorage.setItem(STORAGE_KEY_LINUX_DISMISSED, String(merged.isLinuxBannerDismissed));
                localStorage.setItem(STORAGE_KEY_GRADIENTS, String(merged.enableGradients));
              } catch {}
            }
            set({ ...merged });

            const lib = useLibraryStore.getState();
            if (lib.tracks && lib.tracks.length > 0) {
              lib.setTracks(lib.tracks);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to load settings from backend:", e);
      }
    },
  };
});

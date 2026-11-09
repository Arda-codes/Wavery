import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import {
  useSettingsStore,
  THEME_PRESETS,
  CustomTheme,
  GRADIENT_ACCENT_PRESETS,
} from "../stores/settingsStore";
import { CustomThemeModal } from "./CustomThemeModal";
import { playerAdapter, isTauri, ServerStatus } from "../services/adapter";
import {
  requestNotificationPermission,
  showTrackNotification,
} from "../utils/notifications";
import { isMediaSessionSupported } from "../utils/mediaSession";
import { getDiscordStatus, updateDiscordPresence, clearDiscordPresence, DiscordStatusResponse } from "../utils/discordRpc";
import { formatKeyCombo } from "../utils/keybindings";
import { ModeSwitcher } from "./ModeSwitcher";
import { ToggleSwitch } from "./ToggleSwitch";
import { useTransitionMount } from "../utils/useTransitionMount";
import { SegmentedControl } from "./SegmentedControl";
import {
  Settings,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Zap,
  Volume2,
  Palette,
  Sliders,
  Keyboard,
  Radio,
  Info,
  Download,
  Upload,
  RotateCcw,
  Check,
  ExternalLink,
  Shield,
  Music,
  Activity,
  Bell,
  Tv,
  Monitor,
  Plus,
  X,
  Link2,
  MonitorSpeaker,
  MessageSquare,
  Search,
  CloudDownload,
  Globe,
  EyeOff,
  Eye,
  Tags,
  Wifi,
  Copy,
  Smartphone,
  Archive,
  FolderOpen,
  ShieldCheck,
} from "lucide-react";
import { useEnrichmentStore } from "../stores/enrichmentStore";
import type {
  DatabaseBackup,
  DatabaseHealth,
  DatabaseLocation,
  DatabaseStats,
} from "../types";
import { formatBytes } from "../utils/library";

type SettingsTab =
  | "general"
  | "audio"
  | "appearance"
  | "keybindings"
  | "storage"
  | "network"
  | "integrations"
  | "about";

const ACCENT_PALETTE = [
  { name: "Coral Crimson", value: "#FA586A" },
  { name: "Cyan Neon", value: "#00D2D3" },
  { name: "Purple Velvet", value: "#6C5CE7" },
  { name: "Emerald Spring", value: "#10B981" },
  { name: "Amber Flame", value: "#F59E0B" },
  { name: "Electric Blue", value: "#3B82F6" },
  { name: "Blossom Pink", value: "#EC4899" },
  { name: "Indigo Night", value: "#6366F1" },
  { name: "Nordic Frost", value: "#88C0D0" },
  { name: "Polar Blue", value: "#5E81AC" },
  { name: "Solar Amber", value: "#B58900" },
  { name: "Burnt Terracotta", value: "#AF3A03" },
  { name: "Tokyo Azure", value: "#7AA2F7" },
  { name: "Dusty Rose", value: "#EBBCBA" },
  { name: "Sunset Orange", value: "#FE8019" },
  { name: "Rose Coral", value: "#D7827E" },
  { name: "Mint Jade", value: "#059669" },
  { name: "Ruby Crimson", value: "#E11D48" },
];

const PRESET_OPTIONS = Object.values(THEME_PRESETS);

/**
 * Generates a deterministic 21x21 QR-style matrix (Version 1 layout with finder & timing patterns)
 * derived from the given streaming endpoint URL.
 */
function buildDeterministicQrMatrix(payload: string): boolean[][] {
  const size = 21;
  const grid: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false)
  );

  const placeFinder = (rowOffset: number, colOffset: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = rowOffset + r;
        const cc = colOffset + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[rr][cc] = isBorder || isCenter;
        } else {
          grid[rr][cc] = false;
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Deterministic hash from URL payload
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  let state = hash || 0x12345678;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const charByte = payload.charCodeAt((r * size + c) % Math.max(1, payload.length)) || 0;
      grid[r][c] = ((state >>> 0) ^ charByte) % 2 === 0;
    }
  }

  return grid;
}

interface SettingsViewProps {
  onOpenInstall?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onOpenInstall }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [storageSection, setStorageSection] = useState<"database" | "curation">(
    "database"
  );

  // Library Store
  const tracks = useLibraryStore((s) => s.tracks);
  const albums = useLibraryStore((s) => s.albums);
  const rebuildDatabase = useLibraryStore((s) => s.rebuildDatabase);
  const vacuumDatabase = useLibraryStore((s) => s.vacuumDatabase);
  const playlists = useLibraryStore((s) => s.playlists);

  const missingLyricsCount = useMemo(() => {
    return tracks.filter((t) => !t.metadata.lyrics || !t.metadata.lyrics.trim()).length;
  }, [tracks]);

  const missingYearCount = useMemo(() => {
    return tracks.filter((t) => !t.metadata.year).length;
  }, [tracks]);

  // Settings Store
  const settings = useSettingsStore();
  const setSetting = useSettingsStore((s) => s.setSetting);
  const setThemePreset = useSettingsStore((s) => s.setThemePreset);
  const customTheme = useSettingsStore((s) => s.customTheme);
  const savedCustomThemes = useSettingsStore((s) => s.savedCustomThemes);
  const applyCustomTheme = useSettingsStore((s) => s.applyCustomTheme);
  const deleteCustomTheme = useSettingsStore((s) => s.deleteCustomTheme);
  const addCustomColor = useSettingsStore((s) => s.addCustomColor);
  const removeCustomColor = useSettingsStore((s) => s.removeCustomColor);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const exportConfigJson = useSettingsStore((s) => s.exportConfigJson);
  const importConfigJson = useSettingsStore((s) => s.importConfigJson);

  // Theme Maker Modal State
  const [isCustomThemeModalOpen, setIsCustomThemeModalOpen] = useState(false);
  const [customThemeToEdit, setCustomThemeToEdit] = useState<CustomTheme | null>(null);
  const [themeCategoryFilter, setThemeCategoryFilter] = useState<string>("all");

  // Server & LAN Streaming State
  const allowLanStreaming = useSettingsStore((s) => s.allowLanStreaming);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (activeTab === "network") {
      playerAdapter.getServerStatus?.().then((status) => {
        if (status) setServerStatus(status);
      });
    }
  }, [activeTab, allowLanStreaming]);

  const handleToggleLanMode = useCallback(
    async (enabled: boolean) => {
      setSetting("allowLanStreaming", enabled);
      try {
        if (playerAdapter.setServerLanMode) {
          const updated = await playerAdapter.setServerLanMode(enabled);
          if (updated) {
            setServerStatus(updated);
          }
        } else if (playerAdapter.getServerStatus) {
          const updated = await playerAdapter.getServerStatus();
          if (updated) {
            setServerStatus(updated);
          }
        }
      } catch (err: unknown) {
        setSetting("allowLanStreaming", !enabled);
        const msg = err instanceof Error ? err.message : String(err);
        setFeedbackMessage({
          type: "error",
          text: msg || "Failed to switch local network streaming mode.",
        });
      }
    },
    [setSetting]
  );

  const activeLanUrl = useMemo(() => {
    const port = serverStatus?.port || 4242;
    if (allowLanStreaming) {
      return (
        serverStatus?.lan_url ||
        (serverStatus?.local_ip ? `http://${serverStatus.local_ip}:${port}` : `http://0.0.0.0:${port}`)
      );
    }
    return `http://127.0.0.1:${port}`;
  }, [allowLanStreaming, serverStatus]);

  const qrMatrix = useMemo(() => buildDeterministicQrMatrix(activeLanUrl), [activeLanUrl]);

  const handleCopyUrl = useCallback((url: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
    }
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }, []);

  // Protected Artists Store
  const protectedArtists = useSettingsStore((s) => s.protectedArtists);
  const addProtectedArtist = useSettingsStore((s) => s.addProtectedArtist);
  const removeProtectedArtist = useSettingsStore((s) => s.removeProtectedArtist);
  const resetProtectedArtists = useSettingsStore((s) => s.resetProtectedArtists);
  const [newProtectedArtistInput, setNewProtectedArtistInput] = useState("");
  const [protectedArtistSearch, setProtectedArtistSearch] = useState("");

  const filteredProtectedArtists = React.useMemo(() => {
    const list = protectedArtists || [];
    if (!protectedArtistSearch.trim()) return list;
    const q = protectedArtistSearch.trim().toLowerCase();
    return list.filter((a) => a.toLowerCase().includes(q));
  }, [protectedArtists, protectedArtistSearch]);

  // Hidden Artists Store
  const hiddenArtists = useSettingsStore((s) => s.hiddenArtists);
  const hideArtist = useSettingsStore((s) => s.hideArtist);
  const unhideArtist = useSettingsStore((s) => s.unhideArtist);
  const setHiddenArtists = useSettingsStore((s) => s.setHiddenArtists);
  const [newHiddenArtistInput, setNewHiddenArtistInput] = useState("");
  const [hiddenArtistSearch, setHiddenArtistSearch] = useState("");

  const filteredHiddenArtists = React.useMemo(() => {
    const list = hiddenArtists || [];
    if (!hiddenArtistSearch.trim()) return list;
    const q = hiddenArtistSearch.trim().toLowerCase();
    return list.filter((a) => a.toLowerCase().includes(q));
  }, [hiddenArtists, hiddenArtistSearch]);

  // Genre Mappings Store (Zero Hardcoding)
  const genreMappings = useSettingsStore((s) => s.genreMappings || {});
  const setGenreMapping = useSettingsStore((s) => s.setGenreMapping);
  const removeGenreMapping = useSettingsStore((s) => s.removeGenreMapping);
  const resetGenreMappings = useSettingsStore((s) => s.resetGenreMappings);
  const [newGenreAliasInput, setNewGenreAliasInput] = useState("");
  const [newGenreCanonicalInput, setNewGenreCanonicalInput] = useState("");
  const [genreMappingSearch, setGenreMappingSearch] = useState("");

  const filteredGenreMappings = React.useMemo(() => {
    const entries = Object.entries(genreMappings);
    if (!genreMappingSearch.trim()) return entries;
    const q = genreMappingSearch.trim().toLowerCase();
    return entries.filter(([alias, canonical]) =>
      alias.toLowerCase().includes(q) || canonical.toLowerCase().includes(q)
    );
  }, [genreMappings, genreMappingSearch]);

  // Custom Color State
  const [customHexInput, setCustomHexInput] = useState("#FA586A");
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Maintenance States
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isPruning, setIsPruning] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);

  // Database control center diagnostics
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [dbHealth, setDbHealth] = useState<DatabaseHealth | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<DatabaseBackup | null>(null);

  const loadDatabaseDiagnostics = useCallback(async () => {
    setDbLoading(true);
    setDbError(null);
    try {
      const [stats, health] = await Promise.all([
        playerAdapter.getDatabaseStats(),
        playerAdapter.checkDatabaseHealth(),
      ]);
      setDbStats(stats);
      setDbHealth(health);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDbError(msg || "Unable to read database diagnostics.");
    } finally {
      setDbLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "storage" || storageSection !== "database") return;
    void loadDatabaseDiagnostics();
  }, [activeTab, storageSection, loadDatabaseDiagnostics]);

  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const { isRendered: isFeedbackRendered, isExiting: isFeedbackExiting } = useTransitionMount(!!feedbackMessage, 140);
  const lastFeedbackRef = useRef(feedbackMessage);
  if (feedbackMessage) {
    lastFeedbackRef.current = feedbackMessage;
  }
  const currentFeedback = feedbackMessage || lastFeedbackRef.current;

  // Discord RPC status — polled when the Integrations tab is active
  const [discordStatus, setDiscordStatus] = useState<DiscordStatusResponse | null>(null);
  const [discordStatusLoading, setDiscordStatusLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== "integrations") return;
    let cancelled = false;
    const poll = async () => {
      setDiscordStatusLoading(true);
      const status = await getDiscordStatus();
      if (!cancelled) {
        setDiscordStatus(status);
        setDiscordStatusLoading(false);
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab]);

  const handleRebuild = async () => {
    setShowConfirmModal(false);
    setIsRebuilding(true);
    setFeedbackMessage(null);

    try {
      await rebuildDatabase();
      const updatedTracks = useLibraryStore.getState().tracks;
      const updatedAlbums = useLibraryStore.getState().albums;
      setFeedbackMessage({
        type: "success",
        text: `Database successfully rebuilt! Indexed ${updatedTracks.length} tracks across ${updatedAlbums.length} albums.`,
      });
      void loadDatabaseDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedbackMessage({
        type: "error",
        text: msg || "Failed to rebuild database.",
      });
    } finally {
      setIsRebuilding(false);
    }
  };

  const handleVacuum = async () => {
    setIsVacuuming(true);
    setFeedbackMessage(null);

    try {
      await vacuumDatabase();
      setFeedbackMessage({
        type: "success",
        text: "Database compacted, checkpointed, and search indexes rebuilt.",
      });
      void loadDatabaseDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedbackMessage({
        type: "error",
        text: msg || "Failed to optimize database.",
      });
    } finally {
      setIsVacuuming(false);
    }
  };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    setFeedbackMessage(null);

    try {
      await playerAdapter.clearArtworkCache();
      setFeedbackMessage({
        type: "success",
        text: "Artwork memory and disk caches cleared.",
      });
      void loadDatabaseDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedbackMessage({
        type: "error",
        text: msg || "Failed to clear artwork cache.",
      });
    } finally {
      setIsClearingCache(false);
    }
  };

  const handlePrune = async () => {
    setIsPruning(true);
    setFeedbackMessage(null);

    try {
      const removed = await playerAdapter.pruneMissingTracks();
      if (removed > 0) {
        await useLibraryStore.getState().loadTracks();
      }
      setFeedbackMessage({
        type: "success",
        text:
          removed > 0
            ? `Removed ${removed} missing ${removed === 1 ? "track" : "tracks"} from the index.`
            : "No missing files found. The index is up to date.",
      });
      void loadDatabaseDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedbackMessage({
        type: "error",
        text: msg || "Failed to prune missing tracks.",
      });
    } finally {
      setIsPruning(false);
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    setFeedbackMessage(null);

    try {
      const backup = await playerAdapter.backupDatabase();
      if (!backup) return;
      setLastBackup(backup);
      setFeedbackMessage({
        type: "success",
        text: `Database backed up to ${backup.path}.`,
      });
      void loadDatabaseDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedbackMessage({
        type: "error",
        text: msg || "Failed to back up the database.",
      });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRevealLocation = async (location: DatabaseLocation) => {
    try {
      await playerAdapter.revealDatabaseLocation(location);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedbackMessage({
        type: "error",
        text: msg || "Unable to open the folder.",
      });
    }
  };

  const handleExport = async () => {
    const jsonStr = exportConfigJson();

    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const saved = await invoke<boolean>("export_config_to_file", { content: jsonStr });
        if (saved) {
          setFeedbackMessage({
            type: "success",
            text: "Configuration JSON exported successfully.",
          });
        }
        return;
      } catch (e) {
        console.error("Native export failed, falling back to blob:", e);
      }
    }

    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wavery_config_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedbackMessage({
      type: "success",
      text: "Configuration JSON exported successfully.",
    });
  };

  const handleImportSubmit = () => {
    if (!importJsonText.trim()) return;
    const ok = importConfigJson(importJsonText);
    setShowImportModal(false);
    setImportJsonText("");
    if (ok) {
      setFeedbackMessage({
        type: "success",
        text: "Configuration successfully imported and applied.",
      });
    } else {
      setFeedbackMessage({
        type: "error",
        text: "Failed to parse imported configuration JSON. Please check syntax.",
      });
    }
  };

  const handleResetConfirm = () => {
    setShowResetModal(false);
    resetToDefaults();
    setFeedbackMessage({
      type: "success",
      text: "All application settings have been restored to defaults.",
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background animate-fade-in min-h-0 w-full h-full">
      {/* Top Header */}
      <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-5 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Settings className="w-5 h-5 text-accent" />
          <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Settings
          </h1>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleExport}
            className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.96] text-white rounded-xl text-xs font-semibold flex items-center space-x-2 transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] border border-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Export settings to JSON file"
          >
            <Download className="w-3.5 h-3.5 text-textSecondary" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] active:scale-[0.96] text-white rounded-xl text-xs font-semibold flex items-center space-x-2 transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] border border-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Import settings from JSON"
          >
            <Upload className="w-3.5 h-3.5 text-textSecondary" />
            <span className="hidden sm:inline">Import</span>
          </button>
          <button
            onClick={() => setShowResetModal(true)}
            className="px-3 py-2 bg-white/[0.06] hover:bg-danger/20 active:scale-[0.96] text-textSecondary hover:text-danger rounded-xl text-xs font-semibold flex items-center space-x-2 transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] border border-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Reset all settings to factory defaults"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* Global Feedback Banner */}
      {isFeedbackRendered && currentFeedback && (
        <div
          className={`mx-4 sm:mx-8 mt-4 flex items-center space-x-3 p-4 rounded-xl border text-xs font-semibold flex-shrink-0 transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isFeedbackExiting ? "opacity-0 -translate-y-2 pointer-events-none" : "animate-fade-in"
          } ${
            currentFeedback.type === "success"
              ? "bg-success/10 border-success/30 text-success"
              : "bg-danger/10 border-danger/30 text-danger"
          }`}
        >
          {currentFeedback.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-success" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger" />
          )}
          <span className="flex-1">{currentFeedback.text}</span>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="ml-auto text-xs opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Settings Navigation & Content Layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Left Settings Tabs Navigation (Horizontal on mobile, vertical on md+) */}
        <aside className="w-full md:w-56 border-b md:border-b-0 md:border-r border-white/[0.06] p-2 sm:p-3 md:p-4 flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto space-x-1 md:space-x-0 md:space-y-1 flex-shrink-0 select-none bg-sidebar/60 min-h-0">
          {[
            { id: "general" as const, label: "General", icon: Settings, desc: "App & startup behavior" },
            { id: "audio" as const, label: "Audio & Playback", icon: Volume2, desc: "Volume, crossfade & gain" },
            { id: "appearance" as const, label: "Appearance", icon: Palette, desc: "Themes, accents & layout" },
            { id: "keybindings" as const, label: "Shortcuts", icon: Keyboard, desc: "Key combinations" },
            { id: "storage" as const, label: "Library & Database", icon: Database, desc: "Database health & backups" },
            { id: "network" as const, label: "Server & Streaming", icon: Radio, desc: "Local streaming & web client" },
            { id: "integrations" as const, label: "Integrations", icon: Link2, desc: "Discord, Media Controls" },
            { id: "about" as const, label: "About & Info", icon: Info, desc: "Version & diagnostics" },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap md:w-full text-left px-3 py-2 md:px-4 md:py-3 rounded-xl text-xs font-semibold flex items-center space-x-2 md:space-x-3 transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0 ${
                  isActive
                    ? "bg-surfaceActive text-white border border-white/10 shadow-sm"
                    : "text-textSecondary hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-accent" : "text-textMuted"}`} />
                <div className="truncate">
                  <div className="leading-tight">{tab.label}</div>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Right Settings Pane Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6 min-h-0 pb-32 sm:pb-24">
          {/* TAB 1: GENERAL */}
          {activeTab === "general" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">General Preferences</h2>
                <p className="text-xs text-textMuted mt-1">
                  Startup behavior, notifications, and desktop integration.
                </p>
              </div>

              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Setting: Application Runtime Mode */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Monitor className="w-3.5 h-3.5 text-accent" />
                      <span>Application Mode</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Switch between the native desktop window and a web browser session.
                    </p>
                  </div>
                  <ModeSwitcher />
                </div>

                {/* Setting: Simplify / Low-Resource (Fast) Mode */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Zap className="w-3.5 h-3.5 text-warning" />
                      <span>Low-Resource Mode</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Turns off blur effects and heavy animations to save CPU and GPU power.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.simplifyMode}
                    onChange={(val) => setSetting("simplifyMode", val)}
                  />
                </div>

                {/* Setting: Auto-scan on startup */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <RefreshCw className="w-3.5 h-3.5 text-accent" />
                      <span>Scan Library on Startup</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Check your music folder for new files and tag changes on launch.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.autoScanOnStartup}
                    onChange={(val) => setSetting("autoScanOnStartup", val)}
                  />
                </div>

                {/* Setting: Track change notifications */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Bell className="w-3.5 h-3.5 text-accent" />
                      <span>Track Change Notifications</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Show a desktop alert with track title and artwork when songs change.
                    </p>
                    {settings.notificationsEnabled && (
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const granted = await requestNotificationPermission();
                            if (granted) {
                              showTrackNotification({
                                id: "test",
                                source: { Managed: "/dummy/path" },
                                metadata: {
                                  title: "Wavery Notification Test",
                                  artist: "Wavery Audio Engine",
                                  album: "Audio Engine",
                                  format: "FLAC",
                                  duration: { secs: 180, nanos: 0 },
                                },
                                date_added: Date.now(),
                              });
                              setFeedbackMessage({
                                type: "success",
                                text: "Desktop test notification sent.",
                              });
                            } else {
                              setFeedbackMessage({
                                type: "error",
                                text: "Desktop notifications permission was blocked by your browser or system.",
                              });
                            }
                          }}
                          className="px-3 py-1 bg-accent/10 hover:bg-accent/20 active:scale-95 text-xs text-accent rounded-lg border border-accent/20 font-semibold transition"
                        >
                          Send Test Notification
                        </button>
                      </div>
                    )}
                  </div>
                  <ToggleSwitch
                    checked={settings.notificationsEnabled}
                    onChange={async (val) => {
                      if (val) {
                        await requestNotificationPermission();
                      }
                      setSetting("notificationsEnabled", val);
                    }}
                  />
                </div>

                {/* Setting: MPRIS D-Bus Linux Integration */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Tv className="w-3.5 h-3.5 text-accent" />
                      <span>Linux MPRIS Integration</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Control playback through keyboard media keys, lock screen widgets, and desktop sound applets.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.enableMpris}
                    onChange={(val) => setSetting("enableMpris", val)}
                  />
                </div>

                {/* Setting: Auto-Resume Playback */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Activity className="w-3.5 h-3.5 text-accent" />
                      <span>Resume Playback on Launch</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Restore your last played song and position when opening the app.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.autoResumePlayback}
                    onChange={(val) => setSetting("autoResumePlayback", val)}
                  />
                </div>

                {/* Setting: Minimize to tray */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Shield className="w-3.5 h-3.5 text-accent" />
                      <span>Minimize to System Tray</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Keep audio playing in the background when closing the main window.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.minimizeToTray}
                    onChange={(val) => setSetting("minimizeToTray", val)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AUDIO & PLAYBACK */}
          {activeTab === "audio" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">Audio & Playback</h2>
                <p className="text-xs text-textMuted mt-1">
                  Volume settings, crossfade transitions, and loudness normalization.
                </p>
              </div>

              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Setting: Default Volume */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-white">Default Volume</div>
                      <p className="text-2xs text-textMuted">
                        Starting volume level when the app opens.
                      </p>
                    </div>
                    <span className="font-mono text-xs text-white font-bold bg-white/[0.06] px-3 py-1 rounded-lg border border-white/[0.08]">
                      {Math.round(settings.defaultVolume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Default Volume"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.defaultVolume}
                    onChange={(e) => setSetting("defaultVolume", parseFloat(e.target.value))}
                    className="w-full wavery-slider cursor-pointer active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
                    style={{ "--slider-progress": `${settings.defaultVolume * 100}%` } as React.CSSProperties}
                  />
                </div>

                {/* Setting: Volume Step Increment */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-white">Volume Step</div>
                      <p className="text-2xs text-textMuted">
                        Volume adjustment per scroll wheel step or arrow key press.
                      </p>
                    </div>
                    <span className="font-mono text-xs text-white font-bold bg-white/[0.06] px-3 py-1 rounded-lg border border-white/[0.08]">
                      {Math.round(settings.volumeStep * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Volume Step"
                    min={0.01}
                    max={0.1}
                    step={0.01}
                    value={settings.volumeStep}
                    onChange={(e) => setSetting("volumeStep", parseFloat(e.target.value))}
                    className="w-full wavery-slider cursor-pointer active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
                    style={{ "--slider-progress": `${((settings.volumeStep - 0.01) / (0.1 - 0.01)) * 100}%` } as React.CSSProperties}
                  />
                </div>

                {/* Setting: Crossfade Duration */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-white">Crossfade</div>
                      <p className="text-2xs text-textMuted">
                        Fade time between consecutive songs. Set to 0s to cut directly.
                      </p>
                    </div>
                    <span className="font-mono text-xs text-white font-bold bg-white/[0.06] px-3 py-1 rounded-lg border border-white/[0.08]">
                      {settings.crossfadeDurationMs === 0
                        ? "Off (0s)"
                        : `${(settings.crossfadeDurationMs / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Crossfade Duration"
                    min={0}
                    max={10000}
                    step={500}
                    value={settings.crossfadeDurationMs}
                    onChange={(e) => setSetting("crossfadeDurationMs", parseInt(e.target.value, 10))}
                    className="w-full wavery-slider cursor-pointer active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
                    style={{ "--slider-progress": `${(settings.crossfadeDurationMs / 10000) * 100}%` } as React.CSSProperties}
                  />
                </div>

                {/* Setting: Gapless Playback */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Music className="w-3.5 h-3.5 text-accent" />
                      <span>Gapless Playback</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Preloads the upcoming audio stream to eliminate silence between tracks.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.gaplessPlayback}
                    onChange={(val) => setSetting("gaplessPlayback", val)}
                  />
                </div>

                {/* Setting: ReplayGain Normalization */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Sliders className="w-3.5 h-3.5 text-accent" />
                      <span>ReplayGain Normalization</span>
                    </div>
                    <p className="text-2xs text-textMuted leading-relaxed">
                      Balance track loudness automatically using embedded ReplayGain tags.
                    </p>
                  </div>
                  <SegmentedControl
                    value={settings.replayGainMode}
                    onChange={(mode) => setSetting("replayGainMode", mode)}
                    options={[
                      { value: "off", label: "off" },
                      { value: "track", label: "track" },
                      { value: "album", label: "album" },
                    ]}
                    ariaLabel="ReplayGain Normalization Mode"
                    className="w-56 sm:w-64"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: APPEARANCE */}
          {activeTab === "appearance" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">Appearance</h2>
                <p className="text-xs text-textMuted mt-1">
                  Theme selection, accent color, and layout density.
                </p>
              </div>

              {/* Theme Mode Selector Cards */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-white">
                      Theme Presets
                    </div>
                    <p className="text-2xs text-textMuted">
                      Presets synchronize canvas, surfaces, typography, and signature accent color.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setCustomThemeToEdit(customTheme || null);
                      setIsCustomThemeModalOpen(true);
                    }}
                    className="self-start sm:self-auto flex items-center space-x-2 px-3 py-2 text-xs font-semibold rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white transition-all shadow-sm active:scale-95"
                  >
                    <Palette className="w-3.5 h-3.5" />
                    <span>Theme Maker</span>
                  </button>
                </div>

                {/* Category Filters */}
                <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                  {[
                    { id: "all", label: "All Presets" },
                    { id: "dark", label: "Dark" },
                    { id: "light", label: "Light" },
                    { id: "Standard", label: "Standard" },
                    { id: "Atmospheric", label: "Atmospheric" },
                    { id: "Catppuccin", label: "Catppuccin" },
                    { id: "Ecosystem", label: "Ecosystem" },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setThemeCategoryFilter(filter.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                        themeCategoryFilter === filter.id
                          ? "bg-white/[0.12] text-white shadow-sm"
                          : "text-textMuted hover:text-white hover:bg-white/[0.04]"
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                {/* Presets Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {PRESET_OPTIONS.filter((p) => {
                    if (themeCategoryFilter === "all") return true;
                    if (themeCategoryFilter === "dark") return !p.isLight;
                    if (themeCategoryFilter === "light") return p.isLight;
                    return p.category === themeCategoryFilter;
                  }).map((theme) => {
                    const isSelected = settings.themeMode === theme.id;
                    const accent = isSelected ? (settings.accentColor || theme.accentColor) : theme.accentColor;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => setThemePreset(theme.id)}
                        style={{
                          backgroundColor: theme.bg,
                          borderColor: isSelected ? accent : theme.border,
                          boxShadow: isSelected
                            ? `0 0 0 1px ${accent}, 0 8px 24px -8px ${accent}30`
                            : undefined,
                        }}
                        className={`p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between group ${
                          isSelected ? "" : "hover:brightness-110"
                        }`}
                      >
                        {/* Header: Theme Name + Checkmark */}
                        <div className="flex items-center justify-between w-full">
                          <span
                            className="text-xs font-semibold tracking-tight transition-colors"
                            style={{ color: theme.textPrimary }}
                          >
                            {theme.name}
                          </span>
                          {isSelected && (
                            <span
                              className="w-4 h-4 rounded-full flex items-center justify-center shadow-sm flex-shrink-0"
                              style={{ backgroundColor: accent, color: "#FFFFFF" }}
                            >
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </span>
                          )}
                        </div>

                        {/* Mini UI Window Preview */}
                        <div
                          className="w-full h-12 rounded-lg overflow-hidden flex border mt-3 transition-transform duration-200 group-hover:scale-[1.01]"
                          style={{
                            backgroundColor: theme.bg,
                            borderColor: theme.isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.08)",
                          }}
                        >
                          {/* Mini Sidebar */}
                          <div
                            className="w-1/4 h-full p-1 flex flex-col justify-between border-r"
                            style={{
                              backgroundColor: theme.sidebar || theme.surface,
                              borderColor: theme.isLight ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.06)",
                            }}
                          >
                            <div className="space-y-1">
                              <div className="w-3/4 h-1 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                              <div className="w-1/2 h-1 rounded-full opacity-30" style={{ backgroundColor: theme.textPrimary }} />
                              <div className="w-2/3 h-1 rounded-full opacity-30" style={{ backgroundColor: theme.textPrimary }} />
                            </div>
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                          </div>

                          {/* Mini Canvas & Shelf */}
                          <div className="flex-1 h-full flex flex-col justify-between p-1" style={{ backgroundColor: theme.bg }}>
                            <div className="space-y-1">
                              <div className="w-2/5 h-1 rounded-sm opacity-80" style={{ backgroundColor: theme.textPrimary }} />
                              <div className="flex space-x-1 pt-1">
                                <div className="w-4 h-3 rounded-sm" style={{ backgroundColor: theme.surface }} />
                                <div className="w-4 h-3 rounded-sm" style={{ backgroundColor: theme.surface }} />
                                <div className="w-4 h-3 rounded-sm" style={{ backgroundColor: theme.surface }} />
                              </div>
                            </div>

                            {/* Mini Player */}
                            <div
                              className="w-full h-2 rounded flex items-center justify-between px-1"
                              style={{ backgroundColor: theme.surface }}
                            >
                              <div className="w-1/3 h-0.5 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                              <div className="w-1 h-1 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {/* Custom Theme Card */}
                  {(themeCategoryFilter === "all" ||
                    themeCategoryFilter === "Custom" ||
                    (themeCategoryFilter === "light" && customTheme?.isLight) ||
                    (themeCategoryFilter === "dark" && !customTheme?.isLight)) && (
                    <div
                      style={{
                        backgroundColor: customTheme?.bg || "#121216",
                        borderColor:
                          settings.themeMode === "custom"
                            ? settings.accentColor
                            : customTheme?.border || "rgba(255, 255, 255, 0.12)",
                        boxShadow:
                          settings.themeMode === "custom"
                            ? `0 0 0 1px ${settings.accentColor}, 0 8px 24px -8px ${settings.accentColor}30`
                            : undefined,
                      }}
                      className={`p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between group ${
                        settings.themeMode === "custom" ? "" : "hover:brightness-110"
                      }`}
                    >
                      {/* Header: Name + Checkmark / Edit */}
                      <div className="flex items-center justify-between w-full">
                        <span
                          className="text-xs font-semibold tracking-tight transition-colors cursor-pointer"
                          style={{ color: customTheme?.textPrimary || "#FFFFFF" }}
                          onClick={() => {
                            if (customTheme) {
                              applyCustomTheme(customTheme);
                            } else {
                              setCustomThemeToEdit(null);
                              setIsCustomThemeModalOpen(true);
                            }
                          }}
                        >
                          {customTheme ? customTheme.name : "Custom Theme"}
                        </span>
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setCustomThemeToEdit(customTheme || null);
                              setIsCustomThemeModalOpen(true);
                            }}
                            className="text-2xs font-semibold text-textSecondary hover:text-white transition-colors"
                          >
                            {customTheme ? "Edit" : "Create"}
                          </button>
                          {settings.themeMode === "custom" && (
                            <span
                              className="w-4 h-4 rounded-full flex items-center justify-center shadow-sm flex-shrink-0"
                              style={{
                                backgroundColor: settings.accentColor,
                                color: "#FFFFFF",
                              }}
                            >
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Mini Preview or Empty Placeholder */}
                      <div
                        className="w-full h-12 rounded-lg overflow-hidden flex border mt-3 transition-transform duration-200 group-hover:scale-[1.01] cursor-pointer"
                        onClick={() => {
                          if (customTheme) {
                            applyCustomTheme(customTheme);
                          } else {
                            setCustomThemeToEdit(null);
                            setIsCustomThemeModalOpen(true);
                          }
                        }}
                        style={{
                          backgroundColor: customTheme?.bg || "#121216",
                          borderColor: customTheme?.border || "rgba(255, 255, 255, 0.08)",
                        }}
                      >
                        {customTheme ? (
                          <>
                            {/* Mini Sidebar */}
                            <div
                              className="w-1/4 h-full p-1 flex flex-col justify-between border-r"
                              style={{
                                backgroundColor: customTheme.sidebar || customTheme.surface,
                                borderColor: customTheme.border || "rgba(255, 255, 255, 0.06)",
                              }}
                            >
                              <div className="space-y-1">
                                <div className="w-3/4 h-1 rounded-full" style={{ backgroundColor: customTheme.accentColor }} />
                                <div className="w-1/2 h-1 rounded-full opacity-30" style={{ backgroundColor: customTheme.textPrimary }} />
                              </div>
                              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: customTheme.accentColor }} />
                            </div>

                            {/* Mini Canvas */}
                            <div className="flex-1 h-full flex flex-col justify-between p-1" style={{ backgroundColor: customTheme.bg }}>
                              <div className="space-y-1">
                                <div className="w-2/5 h-1 rounded-sm opacity-80" style={{ backgroundColor: customTheme.textPrimary }} />
                                <div className="flex space-x-1 pt-1">
                                  <div className="w-4 h-3 rounded-sm" style={{ backgroundColor: customTheme.surface }} />
                                  <div className="w-4 h-3 rounded-sm" style={{ backgroundColor: customTheme.surface }} />
                                </div>
                              </div>

                              <div
                                className="w-full h-2 rounded flex items-center justify-between px-1"
                                style={{ backgroundColor: customTheme.surface }}
                              >
                                <div className="w-1/3 h-0.5 rounded-full" style={{ backgroundColor: customTheme.accentColor }} />
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xs text-textMuted border border-dashed border-white/10 rounded-lg">
                            Click to design palette
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Saved Custom Themes Drawer / List (if any) */}
                {savedCustomThemes && savedCustomThemes.length > 0 && (
                  <div className="mt-3 p-4 rounded-xl bg-surface/60 border border-white/[0.06] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">
                        Saved Custom Themes
                      </span>
                      <button
                        onClick={() => {
                          setCustomThemeToEdit(null);
                          setIsCustomThemeModalOpen(true);
                        }}
                        className="text-2xs font-semibold text-textSecondary hover:text-white flex items-center space-x-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>New Custom Theme</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {savedCustomThemes.map((st) => {
                        const isCurrent =
                          settings.themeMode === "custom" &&
                          settings.customTheme?.id === st.id;
                        return (
                          <div
                            key={st.id}
                            className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
                              isCurrent
                                ? "bg-white/[0.08] border-white/20"
                                : "bg-black/20 border-white/[0.04] hover:border-white/10"
                            }`}
                          >
                            <div
                              className="flex items-center space-x-3 cursor-pointer flex-1 min-w-0"
                              onClick={() => applyCustomTheme(st)}
                            >
                              <div className="flex items-center -space-x-1">
                                <div
                                  className="w-3.5 h-3.5 rounded-full border border-black/20"
                                  style={{ backgroundColor: st.bg }}
                                />
                                <div
                                  className="w-3.5 h-3.5 rounded-full border border-black/20"
                                  style={{ backgroundColor: st.surface }}
                                />
                                <div
                                  className="w-3.5 h-3.5 rounded-full border border-black/20"
                                  style={{ backgroundColor: st.accentColor }}
                                />
                              </div>
                              <span className="text-xs font-semibold text-white truncate">
                                {st.name}
                              </span>
                              {isCurrent && (
                                <span className="text-2xs font-bold text-success">
                                  (Active)
                                </span>
                              )}
                            </div>

                            <div className="flex items-center space-x-2 ml-2">
                              <button
                                onClick={() => {
                                  setCustomThemeToEdit(st);
                                  setIsCustomThemeModalOpen(true);
                                }}
                                className="px-2 py-1 text-2xs font-medium text-textSecondary hover:text-white bg-white/[0.04] hover:bg-white/[0.08] rounded transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteCustomTheme(st.id)}
                                className="p-1 text-textMuted hover:text-danger rounded transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Accent Color Picker */}
              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl p-5 space-y-4 shadow-xl">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-white">Accent Color</div>
                  <p className="text-2xs text-textMuted">
                    Color used for active buttons, sliders, and selection highlights.
                  </p>
                </div>

                {/* Gradient Accents */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-textSecondary">
                    Gradient Accents
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    {GRADIENT_ACCENT_PRESETS.map((grad) => {
                      const isSelected =
                        settings.accentGradient === grad.gradient;
                      return (
                        <button
                          key={grad.name}
                          type="button"
                          onClick={() => {
                            setSetting("accentGradient", grad.gradient);
                            setSetting("accentColor", grad.primary);
                          }}
                          className={`flex items-center space-x-3 p-2 rounded-xl transition-all border text-left ${
                            isSelected
                              ? "bg-white/[0.08] border-white/20 shadow-md ring-1 ring-white/20"
                              : "bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.06] hover:border-white/[0.08]"
                          }`}
                        >
                          <div
                            style={{ background: grad.gradient }}
                            className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm"
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                          </div>
                          <span className="text-2xs font-medium text-white/90 truncate">
                            {grad.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Preset Palettes */}
                <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                  <div className="text-xs font-semibold text-textSecondary">
                    Solid Colors
                  </div>
                  <div className="flex flex-wrap gap-3 pt-1">
                    {ACCENT_PALETTE.map((color) => {
                      const isSelected =
                        !settings.accentGradient &&
                        (settings.accentColor || "#FA586A").toLowerCase() === color.value.toLowerCase();
                      return (
                        <button
                          key={color.value}
                          type="button"
                          onClick={() => {
                            setSetting("accentGradient", "");
                            setSetting("accentColor", color.value);
                          }}
                          style={{ backgroundColor: color.value }}
                          className={`w-8 h-8 rounded-full transition-all flex items-center justify-center shadow-md relative ${
                            isSelected
                              ? "ring-4 ring-white/30 scale-110 shadow-lg"
                              : "opacity-85 hover:opacity-100 hover:scale-105"
                          }`}
                          title={color.name}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Colors */}
                <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-textSecondary">
                      Custom Colors
                    </div>
                    <span className="text-2xs text-textMuted font-mono">
                      Current: {settings.accentGradient ? "Gradient Active" : (settings.accentColor || "#FA586A")}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {/* User saved custom colors */}
                    {(settings.customColors || []).map((color) => {
                      const isSelected =
                        !settings.accentGradient &&
                        (settings.accentColor || "#FA586A").toLowerCase() === color.toLowerCase();
                      return (
                        <div key={color} className="relative group">
                          <button
                            type="button"
                            onClick={() => {
                              setSetting("accentGradient", "");
                              setSetting("accentColor", color);
                            }}
                            style={{ backgroundColor: color }}
                            className={`w-8 h-8 rounded-full transition-all flex items-center justify-center shadow-md ${
                              isSelected
                                ? "ring-4 ring-white/30 scale-110 shadow-lg"
                                : "opacity-85 hover:opacity-100 hover:scale-105"
                            }`}
                            title={`Custom: ${color}`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCustomColor(color);
                            }}
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-surface text-textSecondary hover:text-white border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-2xs"
                            title="Remove color"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      );
                    })}

                    {/* Active accent if not in presets and not in customColors */}
                    {!(settings.customColors || []).some(
                      (c) => c.toLowerCase() === (settings.accentColor || "#FA586A").toLowerCase()
                    ) &&
                      !ACCENT_PALETTE.some(
                        (p) => p.value.toLowerCase() === (settings.accentColor || "#FA586A").toLowerCase()
                      ) && (
                        <div className="relative group">
                          <button
                            style={{ backgroundColor: settings.accentColor }}
                            className="w-8 h-8 rounded-full ring-4 ring-white/30 scale-110 shadow-lg flex items-center justify-center transition-all"
                            title={`Current custom: ${settings.accentColor}`}
                          >
                            <Check className="w-3.5 h-3.5 text-white drop-shadow" />
                          </button>
                        </div>
                      )}

                    {/* Native Color Picker Trigger */}
                    <button
                      onClick={() => colorInputRef.current?.click()}
                      className="w-8 h-8 rounded-full border border-dashed border-white/30 hover:border-white/60 bg-white/[0.04] hover:bg-white/[0.08] text-white flex items-center justify-center transition-all hover:scale-105"
                      title="Open Color Picker"
                    >
                      <Plus className="w-3.5 h-3.5 text-white/70" />
                    </button>
                    <input
                      ref={colorInputRef}
                      type="color"
                      value={settings.accentColor || "#FA586A"}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        addCustomColor(val);
                        setCustomHexInput(val);
                      }}
                      className="sr-only"
                    />

                    {/* Hex input & quick add */}
                    <div className="flex items-center space-x-2 ml-auto">
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-xs text-textMuted font-mono">#</span>
                        <input
                          type="text"
                          value={customHexInput.replace(/^#/, "")}
                          maxLength={6}
                          onChange={(e) => {
                            const clean = e.target.value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
                            setCustomHexInput(`#${clean}`);
                          }}
                          placeholder="FA586A"
                          className="w-24 pl-6 pr-2 py-1 text-xs bg-sidebar border border-white/10 rounded-lg text-white font-mono focus:outline-none focus:border-white/30"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const hex = customHexInput.trim();
                          if (/^#[0-9A-F]{6}$/i.test(hex)) {
                            addCustomColor(hex);
                          }
                        }}
                        disabled={!/^#[0-9A-F]{6}$/i.test(customHexInput.trim())}
                        className="px-3 py-1 text-xs font-semibold bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 text-white rounded-lg transition-all"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Layout & Visual Density */}
              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Album Grid Card Size */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white">Album Grid Size</div>
                    <p className="text-2xs text-textMuted">
                      Card dimension scaling in album and artist views.
                    </p>
                  </div>
                  <SegmentedControl
                    value={settings.albumGridSize}
                    onChange={(size) => setSetting("albumGridSize", size)}
                    options={[
                      { value: "compact", label: "compact" },
                      { value: "medium", label: "medium" },
                      { value: "spacious", label: "spacious" },
                    ]}
                    ariaLabel="Album Grid Card Size"
                    className="w-64 sm:w-72"
                  />
                </div>

                {/* Track Row Density */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white">Track List Density</div>
                    <p className="text-2xs text-textMuted">
                      Controls vertical spacing in track tables.
                    </p>
                  </div>
                  <SegmentedControl
                    value={settings.rowDensity}
                    onChange={(density) => setSetting("rowDensity", density)}
                    options={[
                      { value: "comfortable", label: "comfortable" },
                      { value: "compact", label: "compact" },
                    ]}
                    ariaLabel="Track Row Density"
                    className="w-56 sm:w-64"
                  />
                </div>

                {/* Mobile Mini Player Transport */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Smartphone className="w-3.5 h-3.5 text-accent" />
                      <span>Mini Player Controls</span>
                    </div>
                    <p className="text-2xs text-textMuted">
                      How the collapsed mobile player skips tracks: visible previous/next
                      buttons, or a horizontal swipe across the card.
                    </p>
                  </div>
                  <SegmentedControl
                    value={settings.miniPlayerControls}
                    onChange={(mode) => setSetting("miniPlayerControls", mode)}
                    options={[
                      { value: "buttons", label: "buttons" },
                      { value: "swipe", label: "swipe" },
                    ]}
                    ariaLabel="Mini Player Controls"
                    className="w-56 sm:w-64"
                  />
                </div>

                {/* Waveform Visualizer Toggle */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Activity className="w-3.5 h-3.5 text-accent" />
                      <span>Playing Waveform Animation</span>
                    </div>
                    <p className="text-2xs text-textMuted">
                      Show small animated waveform bars next to playing songs.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.showVisualizer}
                    onChange={(val) => setSetting("showVisualizer", val)}
                  />
                </div>

                {/* Smooth Lyrics Scrolling */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Music className="w-3.5 h-3.5 text-accent" />
                      <span>Smooth Lyrics Auto-Scroll</span>
                    </div>
                    <p className="text-2xs text-textMuted">
                      Center the active line smoothly as songs progress in fullscreen.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.showLyricsSmoothScroll}
                    onChange={(val) => setSetting("showLyricsSmoothScroll", val)}
                  />
                </div>

                {/* Interface Gradients */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Palette className="w-3.5 h-3.5 text-accent" />
                      <span>Interface Gradients</span>
                    </div>
                    <p className="text-2xs text-textMuted">
                      Enable subtle surface lighting and hover washes. When off, all surfaces stay solid.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.enableGradients}
                    onChange={(val) => setSetting("enableGradients", val)}
                  />
                </div>

                {/* Simplify Low Resource Mode */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Zap className="w-3.5 h-3.5 text-warning" />
                      <span>Low-Resource Mode</span>
                    </div>
                    <p className="text-2xs text-textMuted">
                      Disables glass blur and transition effects for better battery life or slower GPUs.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.simplifyMode}
                    onChange={(val) => setSetting("simplifyMode", val)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: KEYBOARD SHORTCUTS */}
          {activeTab === "keybindings" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">Keyboard Shortcuts</h2>
                <p className="text-xs text-textMuted mt-1">
                  Hotkeys for playback, search, and window navigation.
                </p>
              </div>

              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {[
                  { label: "Play / Pause", key: settings.keybindings?.togglePlay || "Space", desc: "Toggle playback" },
                  { label: "Next Track", key: settings.keybindings?.nextTrack || "Ctrl+Right", desc: "Skip to next song in queue" },
                  { label: "Previous Track", key: settings.keybindings?.prevTrack || "Ctrl+Left", desc: "Restart song or jump to previous" },
                  { label: "Volume Up", key: settings.keybindings?.volumeUp || "Up", desc: "Raise volume by step amount" },
                  { label: "Volume Down", key: settings.keybindings?.volumeDown || "Down", desc: "Lower volume by step amount" },
                  { label: "Seek Forward (+5s)", key: settings.keybindings?.seekForward || "Right", desc: "Jump 5 seconds ahead" },
                  { label: "Seek Backward (-5s)", key: settings.keybindings?.seekBackward || "Left", desc: "Rewind 5 seconds" },
                  { label: "Search", key: settings.keybindings?.openSearch || "Ctrl+K", desc: "Focus top search bar" },
                  { label: "Mute", key: settings.keybindings?.toggleMute || "M", desc: "Mute or unmute audio" },
                  { label: "Fullscreen Player", key: settings.keybindings?.toggleFullscreen || "F", desc: "Toggle fullscreen view" },
                  { label: "Lyrics Panel", key: settings.keybindings?.toggleLyrics || "L", desc: "Open or close drawer lyrics" },
                ].map((item, idx) => (
                  <div key={idx} className="p-4 flex items-center justify-between hover:bg-white/[0.02] transition">
                    <div>
                      <div className="text-xs font-bold text-white">{item.label}</div>
                      <p className="text-2xs text-textMuted">{item.desc}</p>
                    </div>
                    <kbd className="px-3 py-1 bg-white/[0.08] border border-white/[0.12] rounded-lg font-mono text-xs text-white font-semibold shadow-inner">
                      {formatKeyCombo(item.key)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: STORAGE & DATABASE */}
          {activeTab === "storage" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              {/* Header & section switch */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">Library & Database</h2>
                  <p className="text-xs text-textMuted mt-1">
                    Local SQLite index, storage health, and maintenance.
                  </p>
                </div>
                <SegmentedControl
                  options={[
                    { value: "database" as const, label: "Database", icon: Database },
                    { value: "curation" as const, label: "Curation", icon: Tags },
                  ]}
                  value={storageSection}
                  onChange={setStorageSection}
                  ariaLabel="Library settings section"
                  variant="subtle"
                  size="md"
                  className="self-start sm:self-auto"
                />
              </div>

              {storageSection === "database" && (
                <div className="space-y-6">
                  {/* Status overview */}
                  <div className="bg-surface/80 border border-white/[0.06] rounded-2xl shadow-xl overflow-hidden">
                    <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className={`mt-2 h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                            dbLoading
                              ? "bg-textMuted animate-pulse"
                              : dbHealth?.isHealthy
                                ? "bg-success"
                                : "bg-warning"
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-white">
                            {dbLoading
                              ? "Reading database…"
                              : dbHealth?.isHealthy
                                ? "Database healthy"
                                : dbHealth
                                  ? "Needs attention"
                                  : "Status unavailable"}
                          </h3>
                          <p className="text-2xs text-textMuted mt-1">
                            {dbHealth
                              ? `${dbHealth.quickCheck === "ok" ? "Integrity check passed" : "Integrity check reported issues"} · ${dbHealth.journalMode.toUpperCase()} journal · ${new Date(dbHealth.checkedAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                              : "Inspect integrity, search index coverage, and file references."}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadDatabaseDiagnostics()}
                        disabled={dbLoading}
                        className="inline-flex items-center justify-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] active:scale-[0.96] text-xs font-semibold text-textSecondary hover:text-white border border-white/[0.08] transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0 self-start sm:self-auto"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${dbLoading ? "animate-spin" : ""}`} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-white/[0.06] divide-x divide-white/[0.06]">
                      {[
                        { label: "Tracks", value: (dbStats?.trackCount ?? tracks.length).toLocaleString() },
                        { label: "Albums", value: (dbStats?.albumCount ?? albums.length).toLocaleString() },
                        { label: "Playlists", value: (dbStats?.playlistCount ?? playlists.length).toLocaleString() },
                        {
                          label: "On disk",
                          value: formatBytes(
                            (dbStats?.databaseBytes ?? 0) +
                              (dbStats?.walBytes ?? 0) +
                              (dbStats?.sharedMemoryBytes ?? 0)
                          ),
                        },
                      ].map((metric) => (
                        <div key={metric.label} className="px-5 py-4 min-w-0">
                          <p className="text-2xs text-textMuted">{metric.label}</p>
                          <p className="text-lg font-bold text-white tabular-nums mt-1 truncate" title={metric.value}>
                            {metric.value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.02] flex items-center gap-2">
                      <Database className="w-3.5 h-3.5 text-textMuted flex-shrink-0" />
                      <span
                        className="font-mono text-2xs text-textSecondary truncate select-all"
                        title={dbStats?.databasePath || settings.databasePath || undefined}
                      >
                        {dbStats?.databasePath || settings.databasePath || "~/.local/share/wavery/library.db"}
                      </span>
                      {isTauri && (
                        <button
                          type="button"
                          onClick={() => void handleRevealLocation("database")}
                          className="ml-auto p-2 rounded-lg text-textMuted hover:text-white hover:bg-white/[0.06] active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          title="Show database in file manager"
                          aria-label="Show database in file manager"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {dbError && (
                    <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-2xs text-warning">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{dbError}</span>
                    </div>
                  )}

                  {/* Integrity checks */}
                  {dbHealth && (
                    <section className="space-y-3">
                      <h3 className="text-xs font-bold text-white">Integrity checks</h3>
                      <div className="rounded-2xl border border-white/[0.06] bg-surface/80 divide-y divide-white/[0.06] overflow-hidden shadow-md">
                        {[
                          {
                            label: "B-tree integrity",
                            ok: dbHealth.quickCheck.toLowerCase() === "ok",
                            detail: dbHealth.quickCheck === "ok" ? "No page corruption detected" : dbHealth.quickCheck,
                          },
                          {
                            label: "Foreign keys",
                            ok: dbHealth.foreignKeyViolations === 0,
                            detail:
                              dbHealth.foreignKeyViolations === 0
                                ? "All references resolve"
                                : `${dbHealth.foreignKeyViolations} orphaned references`,
                          },
                          {
                            label: "Search index",
                            ok: dbHealth.ftsMissingTracks === 0,
                            detail:
                              dbHealth.ftsMissingTracks === 0
                                ? `${dbHealth.ftsIndexedTracks.toLocaleString()} documents indexed`
                                : `${dbHealth.ftsMissingTracks} tracks missing`,
                          },
                          {
                            label: "File references",
                            ok: dbHealth.missingFileCount === 0,
                            detail:
                              dbHealth.missingFileCount === 0
                                ? "Every indexed file exists"
                                : `${dbHealth.missingFileCount} files missing`,
                          },
                        ].map((check) => (
                          <div key={check.label} className="px-5 py-3 flex items-center justify-between gap-4">
                            <span className="text-xs text-textSecondary">{check.label}</span>
                            <span className={`text-2xs font-semibold text-right ${check.ok ? "text-success" : "text-warning"}`}>
                              {check.detail}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Storage */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-bold text-white">Storage</h3>
                    <div className="rounded-2xl border border-white/[0.06] bg-surface/80 divide-y divide-white/[0.06] overflow-hidden shadow-md">
                      {[
                        {
                          label: "Database file",
                          path: dbStats?.databasePath || settings.databasePath,
                          bytes: dbStats?.databaseBytes,
                          location: "database" as DatabaseLocation,
                        },
                        {
                          label: "Write-ahead log",
                          path: dbStats?.databasePath ? `${dbStats.databasePath}-wal` : undefined,
                          bytes: dbStats?.walBytes,
                          location: undefined,
                        },
                        {
                          label: "Music folder",
                          path: dbStats?.libraryPath || settings.managedDirectory,
                          bytes: dbStats?.libraryBytes,
                          location: "library" as DatabaseLocation,
                        },
                        {
                          label: "Artwork cache",
                          path: dbStats?.artworkCachePath,
                          bytes: dbStats?.artworkCacheBytes,
                          location: "artwork" as DatabaseLocation,
                        },
                      ].map((row) => (
                        <div key={row.label} className="px-5 py-4 flex items-center gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white">{row.label}</p>
                            <p
                              className="font-mono text-2xs text-textMuted truncate mt-1"
                              title={row.path || undefined}
                            >
                              {row.path || "Not configured"}
                            </p>
                          </div>
                          <span className="font-mono text-xs text-textSecondary tabular-nums flex-shrink-0">
                            {typeof row.bytes === "number" ? formatBytes(row.bytes) : "—"}
                          </span>
                          {isTauri && row.location && (
                            <button
                              type="button"
                              onClick={() => void handleRevealLocation(row.location!)}
                              className="p-2 rounded-lg text-textMuted hover:text-white hover:bg-white/[0.06] active:scale-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0"
                              title={`Show ${row.label.toLowerCase()} in file manager`}
                              aria-label={`Show ${row.label.toLowerCase()} in file manager`}
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Maintenance */}
                  <section className="space-y-3">
                    <h3 className="text-xs font-bold text-white">Maintenance</h3>
                    <div className="rounded-2xl border border-white/[0.06] bg-surface/80 divide-y divide-white/[0.06] overflow-hidden shadow-md">
                      <div className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white">Optimize database</p>
                          <p className="text-2xs text-textMuted mt-1 leading-relaxed">
                            {dbStats && dbStats.freeBytes > 0
                              ? `${formatBytes(dbStats.freeBytes)} of free space can be reclaimed.`
                              : "Compact the file and rebuild the full-text index."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleVacuum()}
                          disabled={isVacuuming}
                          className="inline-flex items-center justify-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] active:scale-[0.96] text-xs font-semibold text-white border border-white/[0.08] transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0 self-start sm:self-auto"
                        >
                          {isVacuuming ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Zap className="w-3.5 h-3.5 text-accent" />
                          )}
                          <span>{isVacuuming ? "Optimizing…" : "Optimize"}</span>
                        </button>
                      </div>

                      <div className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white">Prune missing files</p>
                          <p className="text-2xs text-textMuted mt-1 leading-relaxed">
                            {dbStats
                              ? dbStats.missingFileCount > 0
                                ? `${dbStats.missingFileCount.toLocaleString()} indexed ${dbStats.missingFileCount === 1 ? "file is" : "files are"} no longer on disk.`
                                : "Every indexed file is present."
                              : "Remove index rows whose audio files were deleted outside Wavery."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handlePrune()}
                          disabled={isPruning || dbStats?.missingFileCount === 0}
                          className="inline-flex items-center justify-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] active:scale-[0.96] text-xs font-semibold text-white border border-white/[0.08] transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0 self-start sm:self-auto"
                        >
                          {isPruning ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 text-textMuted" />
                          )}
                          <span>{isPruning ? "Pruning…" : "Prune"}</span>
                        </button>
                      </div>

                      <div className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white">Rebuild index</p>
                          <p className="text-2xs text-textMuted mt-1 leading-relaxed">
                            Rescan every audio file from disk. Metadata edits that were not written to tags are replaced.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowConfirmModal(true)}
                          disabled={isRebuilding}
                          className="inline-flex items-center justify-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] active:scale-[0.96] text-xs font-semibold text-white border border-white/[0.08] transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0 self-start sm:self-auto"
                        >
                          {isRebuilding ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5 text-textMuted" />
                          )}
                          <span>{isRebuilding ? "Rebuilding…" : "Rebuild…"}</span>
                        </button>
                      </div>

                      <div className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white">Clear artwork cache</p>
                          <p className="text-2xs text-textMuted mt-1 leading-relaxed">
                            {dbStats ? `${formatBytes(dbStats.artworkCacheBytes)} of cached covers.` : "Remove cached covers so artwork is extracted fresh."}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleClearCache()}
                          disabled={isClearingCache}
                          className="inline-flex items-center justify-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] active:scale-[0.96] text-xs font-semibold text-white border border-white/[0.08] transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0 self-start sm:self-auto"
                        >
                          {isClearingCache ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5 text-textMuted" />
                          )}
                          <span>{isClearingCache ? "Clearing…" : "Clear cache"}</span>
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Backup */}
                  <section className="rounded-2xl border border-white/[0.06] bg-surface/80 p-5 shadow-md flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <Archive className="w-4 h-4 text-textMuted flex-shrink-0 mt-1" />
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold text-white">Backup</h3>
                        <p className="text-2xs text-textMuted mt-1 leading-relaxed break-all" title={lastBackup?.path}>
                          {lastBackup
                            ? `Last backup: ${formatBytes(lastBackup.bytes)} · ${lastBackup.path}`
                            : "Save a consistent copy of the index, playlists, and liked tracks."}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleBackup()}
                      disabled={isBackingUp}
                      className="inline-flex items-center justify-center space-x-2 px-4 py-2 rounded-xl bg-accent-fill hover:bg-accentHover active:scale-[0.96] text-xs font-bold text-white shadow-sm transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0 self-start sm:self-auto"
                    >
                      {isBackingUp ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Archive className="w-3.5 h-3.5" />
                      )}
                      <span>{isBackingUp ? "Backing up…" : "Back up…"}</span>
                    </button>
                  </section>
                </div>
              )}

              {storageSection === "curation" && (
                <>
                  {/* Online Metadata & Lyrics Mass Fill Card */}
              <div className="p-5 bg-surface/80 border border-white/[0.06] rounded-2xl space-y-4 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <Globe className="w-5 h-5 text-accent flex-shrink-0" />
                    <div>
                      <h3 className="text-xs font-bold text-white">Online Metadata & Lyrics Enrichment</h3>
                      <p className="text-2xs text-textMuted mt-1">
                        Batch enrich track tags, high-res artwork, release year, genre, and time-synced lyrics from Apple Music & LRCLIB.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => useEnrichmentStore.getState().openModal()}
                    className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-accent-fill hover:bg-accentHover active:scale-[0.96] text-xs font-semibold text-white shadow-sm transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent flex-shrink-0 self-start sm:self-auto"
                  >
                    <CloudDownload className="w-3.5 h-3.5" />
                    <span>Batch Enrich Library</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="px-4 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-2xs flex items-center justify-between">
                    <span className="text-textSecondary">Missing Lyrics</span>
                    <span className="font-mono font-bold text-accent">{missingLyricsCount} tracks</span>
                  </div>
                  <div className="px-4 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-2xs flex items-center justify-between">
                    <span className="text-textSecondary">Missing Release Year</span>
                    <span className="font-mono font-bold text-textSecondary">{missingYearCount} tracks</span>
                  </div>
                </div>
              </div>

              {/* Protected Artists Management Card */}
              <div className="p-5 bg-surface/80 border border-white/[0.06] rounded-2xl space-y-4 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <Shield className="w-4 h-4 text-accent flex-shrink-0" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-xs font-bold text-white">Protected Artist Names</h3>
                        <span className="px-2 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-2xs font-semibold text-textSecondary">
                          {filteredProtectedArtists.length}{" "}
                          {filteredProtectedArtists.length === protectedArtists.length
                            ? "artists"
                            : `of ${protectedArtists.length}`}
                        </span>
                      </div>
                      <p className="text-2xs text-textMuted mt-1">
                        Artist names containing commas, ampersands, or slashes that should never be split into separate artists.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      resetProtectedArtists();
                      setProtectedArtistSearch("");
                    }}
                    className="inline-flex items-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] active:scale-95 text-xs text-textSecondary hover:text-white border border-white/[0.08] transition flex-shrink-0 self-start sm:self-auto"
                    title="Restore default list of protected artists"
                  >
                    <RotateCcw className="w-3 h-3 text-textMuted" />
                    <span>Reset Defaults</span>
                  </button>
                </div>

                {/* Add New Protected Artist Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newProtectedArtistInput.trim()) {
                      addProtectedArtist(newProtectedArtistInput.trim());
                      setNewProtectedArtistInput("");
                    }
                  }}
                  className="flex items-center space-x-2"
                >
                  <input
                    type="text"
                    value={newProtectedArtistInput}
                    onChange={(e) => setNewProtectedArtistInput(e.target.value)}
                    placeholder="Add protected artist (e.g. Tyler, The Creator or Earth, Wind & Fire)..."
                    className="flex-1 bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-4 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                  />
                  <button
                    type="submit"
                    disabled={!newProtectedArtistInput.trim()}
                    className="inline-flex items-center space-x-2 px-4 py-2 bg-accent-fill hover:bg-accent/90 active:scale-[0.96] text-white rounded-xl text-xs font-semibold shadow-sm transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Artist</span>
                  </button>
                </form>

                {/* Filter Search Input (shown when list > 6) */}
                {protectedArtists.length > 6 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-textMuted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={protectedArtistSearch}
                      onChange={(e) => setProtectedArtistSearch(e.target.value)}
                      placeholder="Search protected artists list..."
                      className="w-full bg-deck/60 border border-white/[0.06] focus:border-white/[0.15] rounded-xl pl-8 pr-8 py-2 text-xs text-white placeholder-textMuted focus:outline-none transition"
                    />
                    {protectedArtistSearch && (
                      <button
                        type="button"
                        onClick={() => setProtectedArtistSearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textMuted hover:text-white transition"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Protected Artists Chips Container */}
                <div className="p-3 bg-deck border border-white/[0.06] rounded-xl max-h-56 overflow-y-auto custom-scrollbar">
                  {filteredProtectedArtists.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {filteredProtectedArtists.map((artist) => (
                        <span
                          key={artist}
                          className="inline-flex items-center space-x-2 px-3 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-xs text-white/90 group transition"
                        >
                          <span className="select-text">{artist}</span>
                          <button
                            type="button"
                            onClick={() => removeProtectedArtist(artist)}
                            className="text-textMuted hover:text-danger p-1 rounded transition"
                            title={`Remove "${artist}" from protected list`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-textMuted">
                      {protectedArtistSearch
                        ? `No protected artists matching "${protectedArtistSearch}"`
                        : "No protected artists configured. Click 'Reset Defaults' to restore."}
                    </div>
                  )}
                </div>
              </div>

              {/* Hidden Artists Management Card */}
              <div className="p-6 bg-surface border border-white/[0.06] rounded-2xl space-y-4 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <EyeOff className="w-4 h-4 text-warning flex-shrink-0" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-xs font-bold text-white">Hidden Artists</h3>
                        <span className="px-2 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-2xs font-semibold text-textSecondary">
                          {filteredHiddenArtists.length}{" "}
                          {filteredHiddenArtists.length === hiddenArtists.length
                            ? "hidden"
                            : `of ${hiddenArtists.length}`}
                        </span>
                      </div>
                      <p className="text-2xs text-textMuted mt-1">
                        Artists hidden from your Artists library view. Their songs remain playable and recommended.
                      </p>
                    </div>
                  </div>

                  {hiddenArtists.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setHiddenArtists([]);
                        setHiddenArtistSearch("");
                      }}
                      className="inline-flex items-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] active:scale-95 text-xs text-textSecondary hover:text-white border border-white/[0.08] transition flex-shrink-0 self-start sm:self-auto"
                      title="Unhide all artists"
                    >
                      <Eye className="w-3 h-3 text-textMuted" />
                      <span>Unhide All</span>
                    </button>
                  )}
                </div>

                {/* Add New Hidden Artist Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newHiddenArtistInput.trim()) {
                      hideArtist(newHiddenArtistInput.trim());
                      setNewHiddenArtistInput("");
                    }
                  }}
                  className="flex items-center space-x-2"
                >
                  <input
                    type="text"
                    value={newHiddenArtistInput}
                    onChange={(e) => setNewHiddenArtistInput(e.target.value)}
                    placeholder="Type artist name to hide (e.g. Nickelback)..."
                    className="flex-1 bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-4 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                  />
                  <button
                    type="submit"
                    disabled={!newHiddenArtistInput.trim()}
                    className="inline-flex items-center space-x-2 px-4 py-2 bg-surfaceActive hover:bg-white/[0.12] active:scale-95 text-white rounded-xl text-xs font-semibold border border-white/[0.08] transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Hide Artist</span>
                  </button>
                </form>

                {/* Filter Search Input (shown when list > 6) */}
                {hiddenArtists.length > 6 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-textMuted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={hiddenArtistSearch}
                      onChange={(e) => setHiddenArtistSearch(e.target.value)}
                      placeholder="Search hidden artists list..."
                      className="w-full bg-deck/60 border border-white/[0.06] focus:border-white/[0.15] rounded-xl pl-8 pr-8 py-2 text-xs text-white placeholder-textMuted focus:outline-none transition"
                    />
                    {hiddenArtistSearch && (
                      <button
                        type="button"
                        onClick={() => setHiddenArtistSearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textMuted hover:text-white transition"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Hidden Artists Chips Container */}
                <div className="p-3 bg-deck border border-white/[0.06] rounded-xl max-h-56 overflow-y-auto custom-scrollbar">
                  {filteredHiddenArtists.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {filteredHiddenArtists.map((artist) => (
                        <span
                          key={artist}
                          className="inline-flex items-center space-x-2 px-3 py-1 bg-warning/10 hover:bg-warning/15 border border-warning/20 rounded-lg text-xs text-warning group transition"
                        >
                          <span className="select-text">{artist}</span>
                          <button
                            type="button"
                            onClick={() => unhideArtist(artist)}
                            className="text-warning/70 hover:text-white p-1 rounded transition"
                            title={`Unhide "${artist}"`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-textMuted">
                      {hiddenArtistSearch
                        ? `No hidden artists matching "${hiddenArtistSearch}"`
                        : "No artists are currently hidden. Right-click any track or artist card to hide them."}
                    </div>
                  )}
                </div>
              </div>

              {/* Genre Normalization & Mappings Card (Zero Hardcoding) */}
              <div className="p-6 bg-surface border border-white/[0.06] rounded-2xl space-y-4 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <Tags className="w-4 h-4 text-accent flex-shrink-0" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-xs font-bold text-white">Genre Normalization & Mappings</h3>
                        <span className="px-2 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-2xs font-semibold text-textSecondary">
                          {filteredGenreMappings.length}{" "}
                          {filteredGenreMappings.length === Object.keys(genreMappings).length
                            ? "rules"
                            : `of ${Object.keys(genreMappings).length}`}
                        </span>
                      </div>
                      <p className="text-2xs text-textMuted mt-1">
                        Configurable rules that map multilingual, Cyrillic, and abbreviation genre tags into clean canonical groups.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => resetGenreMappings()}
                    className="inline-flex items-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] active:scale-95 text-xs text-textSecondary hover:text-white border border-white/[0.08] transition flex-shrink-0 self-start sm:self-auto"
                    title="Reset genre mappings to defaults"
                  >
                    <RotateCcw className="w-3 h-3 text-textMuted" />
                    <span>Reset Defaults</span>
                  </button>
                </div>

                {/* Add New Genre Mapping Form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newGenreAliasInput.trim() && newGenreCanonicalInput.trim()) {
                      setGenreMapping(newGenreAliasInput.trim(), newGenreCanonicalInput.trim());
                      setNewGenreAliasInput("");
                      setNewGenreCanonicalInput("");
                    }
                  }}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <input
                    type="text"
                    value={newGenreAliasInput}
                    onChange={(e) => setNewGenreAliasInput(e.target.value)}
                    placeholder="Raw tag / alias (e.g. Альтернатива, Electro)..."
                    className="flex-1 bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-4 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                  />
                  <span className="hidden sm:inline-block text-xs text-textMuted font-mono">→</span>
                  <input
                    type="text"
                    value={newGenreCanonicalInput}
                    onChange={(e) => setNewGenreCanonicalInput(e.target.value)}
                    placeholder="Canonical genre (e.g. Alternative)..."
                    className="flex-1 bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-4 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                  />
                  <button
                    type="submit"
                    disabled={!newGenreAliasInput.trim() || !newGenreCanonicalInput.trim()}
                    className="inline-flex items-center justify-center space-x-2 px-4 py-2 bg-surfaceActive hover:bg-white/[0.12] active:scale-95 text-white rounded-xl text-xs font-semibold border border-white/[0.08] transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Rule</span>
                  </button>
                </form>

                {/* Filter Search Input (shown when list > 6) */}
                {Object.keys(genreMappings).length > 6 && (
                  <div className="relative">
                    <Search className="w-3 h-3 text-textMuted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={genreMappingSearch}
                      onChange={(e) => setGenreMappingSearch(e.target.value)}
                      placeholder="Search genre mapping rules..."
                      className="w-full bg-deck/60 border border-white/[0.06] focus:border-white/[0.15] rounded-xl pl-8 pr-8 py-2 text-xs text-white placeholder-textMuted focus:outline-none transition"
                    />
                    {genreMappingSearch && (
                      <button
                        type="button"
                        onClick={() => setGenreMappingSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-textMuted hover:text-white transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Genre Mappings Container */}
                <div className="p-3 bg-deck border border-white/[0.06] rounded-xl max-h-56 overflow-y-auto custom-scrollbar">
                  {filteredGenreMappings.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {filteredGenreMappings.map(([alias, canonical]) => (
                        <span
                          key={alias}
                          className="inline-flex items-center space-x-2 px-3 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-xs text-white group transition"
                        >
                          <span className="text-textSecondary select-text">{alias}</span>
                          <span className="text-accent select-none font-bold">→</span>
                          <span className="font-semibold select-text">{canonical}</span>
                          <button
                            type="button"
                            onClick={() => removeGenreMapping(alias)}
                            className="text-textMuted hover:text-danger p-1 rounded transition ml-1"
                            title={`Remove rule "${alias} → ${canonical}"`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-textMuted">
                      {genreMappingSearch
                        ? `No genre mapping rules matching "${genreMappingSearch}"`
                        : "No genre mappings configured. Add a rule above or click 'Reset Defaults'."}
                    </div>
                  )}
                </div>
              </div>

                </>
              )}
            </div>
          )}

          {/* TAB 6: SERVER & STREAMING */}
          {activeTab === "network" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">Local Web Server</h2>
                <p className="text-xs text-textMuted mt-1">
                  Stream audio and load the web player on this PC or across your local Wi-Fi.
                </p>
              </div>

              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Allow Local Network (LAN) Switch */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <Wifi className="w-3.5 h-3.5 text-accent" />
                      <span>Allow Local Network Access (Phone / Tablet Streaming)</span>
                    </div>
                    <p className="text-2xs text-textMuted mt-1">
                      Allows phones, tablets, or other laptops on the same Wi-Fi network to connect and stream music directly from your library.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={allowLanStreaming}
                    onChange={(val) => {
                      void handleToggleLanMode(val);
                    }}
                    label="Allow Local Network Access"
                  />
                </div>

                {/* Server Address */}
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white">Streaming Endpoint</div>
                    <p className="text-2xs text-textMuted mt-1">
                      {allowLanStreaming
                        ? "Open this URL in Safari or Chrome on your phone to stream."
                        : "Loopback endpoint restricted to web browsers on this machine only."}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-2 bg-white/[0.06] px-3 py-2 rounded-xl border border-white/[0.08]">
                      <span className={`w-2 h-2 rounded-full ${allowLanStreaming ? "bg-accent animate-pulse" : "bg-success"}`} />
                      <span className="font-mono text-xs text-white font-bold">
                        {activeLanUrl}
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopyUrl(activeLanUrl)}
                      className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-textMuted hover:text-white transition active:scale-95 border border-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      title="Copy streaming URL"
                      aria-label="Copy streaming URL"
                    >
                      {copiedUrl ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Mobile Guide & QR Code Indicator when LAN is Enabled */}
                {allowLanStreaming && (
                  <div className="p-5 bg-accent/5 border-l-2 border-accent flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <Smartphone className="w-4 h-4 text-accent mt-1 flex-shrink-0" />
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-white">
                          Mobile Web &amp; PWA Ready
                        </div>
                        <div className="text-2xs text-textSecondary leading-relaxed">
                          Connect your phone or tablet to the same Wi-Fi network and visit{" "}
                          <span className="font-mono font-bold text-white">
                            {activeLanUrl}
                          </span>{" "}
                          in Safari or Chrome.
                        </div>
                        <div className="text-2xs text-accent/90 font-medium pt-1">
                          Tip: To hide the browser bar (X, URL, three dots), tap ⋮ (or Safari Share) and select &ldquo;Add to Home Screen&rdquo; to run as a standalone app, or tap the Fullscreen button.
                        </div>
                        {onOpenInstall && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={onOpenInstall}
                              className="px-3 py-2 rounded-xl bg-accent text-white hover:bg-accentHover active:scale-95 text-2xs font-semibold flex items-center space-x-2 transition shadow-sm"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Install App Instructions</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className="p-2 bg-white rounded-xl border border-white/20 shadow-md flex-shrink-0 self-center sm:self-auto"
                      title={`Connection matrix for ${activeLanUrl}`}
                    >
                      <svg
                        viewBox="0 0 21 21"
                        className="w-20 h-20 block"
                        shapeRendering="crispEdges"
                        role="img"
                        aria-label={`QR code for ${activeLanUrl}`}
                      >
                        {qrMatrix.map((row, rIdx) =>
                          row.map((cell, cIdx) =>
                            cell ? (
                              <rect
                                key={`${rIdx}-${cIdx}`}
                                x={cIdx}
                                y={rIdx}
                                width={1}
                                height={1}
                                fill="#09090b"
                              />
                            ) : null
                          )
                        )}
                      </svg>
                    </div>
                  </div>
                )}

                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div>
                    <div className="text-xs font-bold text-white">HTTP Range Requests</div>
                    <p className="text-2xs text-textMuted mt-1">
                      Supports partial content requests (HTTP 206) for instant seeking in browsers.
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-success/10 text-success border border-success/20 text-2xs font-bold rounded-lg">
                    Active (64KB Chunks)
                  </span>
                </div>

                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between [&>*:last-child]:self-end sm:[&>*:last-child]:self-auto">
                  <div className="space-y-1 sm:pr-4">
                    <div className="text-xs font-bold text-white">Browser Client</div>
                    <p className="text-2xs text-textMuted mt-1">
                      Open Wavery directly in your default web browser on this PC.
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <ModeSwitcher />
                    <button
                      onClick={() => {
                        usePlayerStore.getState().switchToWeb();
                      }}
                      className="px-3 py-2 bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 rounded-xl text-xs font-bold flex items-center space-x-2 transition"
                      title="Open in default browser"
                    >
                      <span>Open Browser</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: INTEGRATIONS */}
          {activeTab === "integrations" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">Integrations</h2>
                <p className="text-xs text-textSecondary mt-1">
                  System media controls and connected desktop services.
                </p>
              </div>

              {/* ── System Media Controls ── */}
              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center space-x-3 min-w-0">
                    <MonitorSpeaker className="w-5 h-5 text-accent flex-shrink-0" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-semibold text-white">System Media Controls</span>
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-2xs font-medium border ${
                            isMediaSessionSupported()
                              ? "bg-success/10 text-success border-success/20"
                              : "bg-white/[0.05] text-textSecondary border-white/[0.08]"
                          }`}
                        >
                          {isMediaSessionSupported() ? "Supported" : "Unsupported"}
                        </span>
                      </div>
                      <p className="text-2xs text-textSecondary mt-1 leading-relaxed">
                        Sync playback, metadata, and hardware media keys with your OS media overlay and lock screen.
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <ToggleSwitch
                      checked={settings.enableMediaSession}
                      onChange={(val) => setSetting("enableMediaSession", val)}
                    />
                  </div>
                </div>
              </div>

              {/* ── Discord Rich Presence ── */}
              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center space-x-3 min-w-0">
                    <MessageSquare className="w-5 h-5 text-[#5865F2] flex-shrink-0" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-semibold text-white">Discord Rich Presence</span>
                        {discordStatusLoading && !discordStatus ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-2xs font-medium border bg-white/[0.05] border-white/[0.08] text-textSecondary">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>Checking</span>
                          </span>
                        ) : discordStatus?.connected ? (
                          <span className="inline-flex items-center space-x-2 px-2 py-1 rounded-full text-2xs font-medium border bg-success/10 text-success border-success/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                            <span>Connected</span>
                          </span>
                        ) : discordStatus && !discordStatus.discord_running ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-2xs font-medium border bg-warning/10 text-warning border-warning/20">
                            Discord Not Running
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-2xs font-medium border bg-white/[0.05] border-white/[0.08] text-textSecondary">
                            Offline
                          </span>
                        )}
                      </div>
                      <p className="text-2xs text-textSecondary mt-1 leading-relaxed">
                        Display the current song and artist in your Discord status as you listen.
                      </p>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <ToggleSwitch
                      checked={settings.enableDiscordRpc}
                      onChange={(val) => {
                        setSetting("enableDiscordRpc", val);
                        if (val) {
                          const ps = usePlayerStore.getState();
                          if (ps.currentTrack && ps.status.state !== "Stopped") {
                            updateDiscordPresence({
                              title: ps.currentTrack.metadata.title ?? "Unknown Title",
                              artist: ps.currentTrack.metadata.artist ?? "Unknown Artist",
                              album: ps.currentTrack.metadata.album ?? "",
                              position_secs: ps.status.position_secs,
                              duration_secs: ps.status.duration_secs ?? ps.currentTrack.metadata.duration.secs,
                              is_playing: ps.status.state === "Playing",
                            });
                          }
                        } else {
                          clearDiscordPresence();
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Optional Custom App ID field when Discord RPC is enabled */}
                {settings.enableDiscordRpc && (
                  <div className="pt-3 border-t border-white/[0.06] space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-2xs font-medium text-textSecondary">
                        Custom Application ID <span className="text-textMuted font-normal">(Optional)</span>
                      </label>
                      <a
                        href="https://discord.com/developers/applications"
                        target="_blank"
                        rel="noreferrer"
                        className="text-2xs text-textSecondary hover:text-white transition flex items-center space-x-1"
                      >
                        <span>Discord Developer Portal</span>
                        <ExternalLink className="w-3 h-3 text-textMuted" />
                      </a>
                    </div>
                    <input
                      type="text"
                      value={settings.discordAppId || ""}
                      onChange={(e) => setSetting("discordAppId", e.target.value.trim())}
                      placeholder="1565571268797931641 (Default: Wavery)"
                      className="w-full bg-surfaceHover border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:border-white/20 transition font-mono"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: ABOUT & DIAGNOSTICS */}
          {activeTab === "about" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">About Wavery</h2>
                <p className="text-xs text-textMuted mt-1">
                  Version, dependencies, and subsystem components.
                </p>
              </div>

              <div className="bg-surface/80 border border-white/[0.06] rounded-2xl p-6 space-y-5 shadow-xl">
                <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center font-bold text-2xl text-white shadow-xl border border-white/10">
                    W
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white tracking-tight">Wavery</h3>
                    <p className="text-xs text-accent font-semibold">Version 0.2.1 • Beta</p>
                    <p className="text-2xs text-textMuted mt-1">
                      Local-first music player built with Rust, Tauri v2, and React. No accounts, no telemetry, no internet required.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                  <div className="p-3 bg-deck border border-white/[0.06] rounded-xl space-y-1">
                    <p className="text-2xs text-textMuted font-medium">Audio Engine</p>
                    <p className="font-semibold text-white">Rodio + cpal</p>
                  </div>
                  <div className="p-3 bg-deck border border-white/[0.06] rounded-xl space-y-1">
                    <p className="text-2xs text-textMuted font-medium">Database</p>
                    <p className="font-semibold text-white">SQLite + FTS5</p>
                  </div>
                  <div className="p-3 bg-deck border border-white/[0.06] rounded-xl space-y-1">
                    <p className="text-2xs text-textMuted font-medium">Tag Parser</p>
                    <p className="font-semibold text-white">Lofty</p>
                  </div>
                  <div className="p-3 bg-deck border border-white/[0.06] rounded-xl space-y-1">
                    <p className="text-2xs text-textMuted font-medium">Streaming</p>
                    <p className="font-semibold text-white">Axum + Tokio</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-deck border border-white/[0.06] rounded-xl space-y-1">
                    <p className="text-2xs text-textMuted font-medium">Desktop Shell</p>
                    <p className="font-semibold text-white">Tauri v2</p>
                  </div>
                  <div className="p-3 bg-deck border border-white/[0.06] rounded-xl space-y-1">
                    <p className="text-2xs text-textMuted font-medium">UI Framework</p>
                    <p className="font-semibold text-white">React 18</p>
                  </div>
                  <div className="p-3 bg-deck border border-white/[0.06] rounded-xl space-y-1">
                    <p className="text-2xs text-textMuted font-medium">Linux MPRIS</p>
                    <p className="font-semibold text-white">zbus</p>
                  </div>
                  <div className="p-3 bg-deck border border-white/[0.06] rounded-xl space-y-1">
                    <p className="text-2xs text-textMuted font-medium">State</p>
                    <p className="font-semibold text-white">Zustand</p>
                  </div>
                </div>

                <div className="p-4 bg-deck border border-white/[0.06] rounded-xl space-y-2 text-xs">
                  <p className="font-bold text-white">What's new in 0.2.1 Beta:</p>
                  <ul className="text-2xs leading-relaxed text-textMuted space-y-1 mt-1">
                    <li>• VSync continuous scrubber interpolation with hardware refresh rate sync</li>
                    <li>• Centered global search bar with instant autocomplete and category browsing</li>
                    <li>• Apple HIG contrast and typography overhaul across Light and Dark themes</li>
                    <li>• Metadata editing modals for songs, albums, and artists with real-time sync</li>
                    <li>• Embedded and external LRC lyrics synchronization and Fullscreen Player</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Database Rebuild */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-surface border border-white/[0.08] w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">Rebuild Database?</h3>
                <p className="text-xs text-textMuted">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-textSecondary leading-relaxed">
              This clears the database index and rescans all audio files directly from your music folder.
              <br /><br />
              <span className="text-warning dark:text-warning font-semibold">
                ⚠️ Metadata edits that were not saved to audio file tags (ID3/FLAC) will be reset.
              </span>
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 text-xs font-semibold text-textSecondary hover:text-white rounded-lg active:scale-[0.96] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleRebuild}
                className="inline-flex items-center space-x-2 px-5 py-2 bg-danger hover:bg-accentHover active:scale-[0.96] text-white rounded-xl text-xs font-bold shadow-sm transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Rebuild Database</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Reset Defaults */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-surface border border-white/[0.08] w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center space-x-3">
              <RotateCcw className="w-5 h-5 text-danger flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">Reset Settings?</h3>
                <p className="text-xs text-textMuted">Restore default configuration.</p>
              </div>
            </div>

            <p className="text-xs text-textSecondary leading-relaxed">
              Reset audio, appearance, theme, and keyboard shortcuts back to default values?
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 text-xs font-semibold text-textSecondary hover:text-white rounded-lg active:scale-[0.96] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleResetConfirm}
                className="inline-flex items-center space-x-2 px-5 py-2 bg-danger hover:bg-accentHover active:scale-[0.96] text-white rounded-xl text-xs font-bold shadow-sm transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
              >
                <span>Reset to Defaults</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Configuration Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-surface border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center space-x-3">
              <Upload className="w-5 h-5 text-accent flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">Import Configuration JSON</h3>
                <p className="text-xs text-textMuted">Paste exported settings JSON below</p>
              </div>
            </div>

            <textarea
              rows={8}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="Paste JSON configuration content here..."
              className="w-full bg-deck border border-white/[0.08] rounded-xl p-3 text-xs font-mono text-white placeholder-textMuted focus:outline-none focus:border-accent transition"
            />

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportJsonText("");
                }}
                className="px-4 py-2 text-xs font-semibold text-textSecondary hover:text-white rounded-lg active:scale-[0.96] transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={!importJsonText.trim()}
                className="inline-flex items-center space-x-2 px-5 py-2 bg-accent-fill hover:bg-accentHover active:scale-[0.96] text-white rounded-xl text-xs font-bold shadow-sm transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                <span>Import & Apply</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Theme Maker Studio Modal */}
      <CustomThemeModal
        isOpen={isCustomThemeModalOpen}
        onClose={() => {
          setIsCustomThemeModalOpen(false);
          setCustomThemeToEdit(null);
        }}
        initialTheme={customThemeToEdit}
      />
    </div>
  );
};


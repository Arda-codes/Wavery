import React, { useState, useRef, useEffect } from "react";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import {
  useSettingsStore,
  ThemeMode,
  ReplayGainMode,
  AlbumGridSize,
  RowDensity,
} from "../stores/settingsStore";
import { playerAdapter } from "../services/adapter";
import {
  requestNotificationPermission,
  showTrackNotification,
} from "../utils/notifications";
import { isMediaSessionSupported } from "../utils/mediaSession";
import { getDiscordStatus, DiscordStatusResponse } from "../utils/discordRpc";
import { ModeSwitcher } from "./ModeSwitcher";
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
  Sparkles,
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
  Cpu,
  Tv,
  Monitor,
  Plus,
  X,
  Link2,
  Wifi,
  WifiOff,
  MonitorSpeaker,
  MessageSquare,
} from "lucide-react";

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
];

interface ThemeOption {
  id: ThemeMode;
  name: string;
  desc: string;
  bg: string;
  surface: string;
  textPrimary: string;
  textMuted: string;
  border: string;
  accentPreview: string;
}

const THEME_OPTIONS: Array<ThemeOption> = [
  {
    id: "dark",
    name: "Obsidian Dark",
    desc: "Dark gray interface with soft contrast",
    bg: "#121216",
    surface: "#1A1A1E",
    textPrimary: "#ECEFF4",
    textMuted: "#8F93A0",
    border: "rgba(255, 255, 255, 0.12)",
    accentPreview: "#FA586A",
  },
  {
    id: "oled",
    name: "Pure OLED Black",
    desc: "True black background for OLED screens",
    bg: "#000000",
    surface: "#0A0A0C",
    textPrimary: "#FFFFFF",
    textMuted: "#80808C",
    border: "rgba(255, 255, 255, 0.16)",
    accentPreview: "#FA586A",
  },
  {
    id: "midnight",
    name: "Midnight Indigo",
    desc: "Deep navy blue palette",
    bg: "#080C14",
    surface: "#0F172A",
    textPrimary: "#F1F5F9",
    textMuted: "#94A3B8",
    border: "rgba(99, 102, 241, 0.25)",
    accentPreview: "#6366F1",
  },
  {
    id: "light",
    name: "Frost Light",
    desc: "Crisp, high-contrast light theme",
    bg: "#F4F4F6",
    surface: "#FFFFFF",
    textPrimary: "#18181B",
    textMuted: "#71717A",
    border: "rgba(0, 0, 0, 0.12)",
    accentPreview: "#FA586A",
  },
];

export const SettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // Library Store
  const tracks = useLibraryStore((s) => s.tracks);
  const albums = useLibraryStore((s) => s.albums);
  const artists = useLibraryStore((s) => s.artists);
  const rebuildDatabase = useLibraryStore((s) => s.rebuildDatabase);
  const vacuumDatabase = useLibraryStore((s) => s.vacuumDatabase);

  // Settings Store
  const settings = useSettingsStore();
  const setSetting = useSettingsStore((s) => s.setSetting);
  const addCustomColor = useSettingsStore((s) => s.addCustomColor);
  const removeCustomColor = useSettingsStore((s) => s.removeCustomColor);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const exportConfigJson = useSettingsStore((s) => s.exportConfigJson);
  const importConfigJson = useSettingsStore((s) => s.importConfigJson);

  // Custom Color State
  const [customHexInput, setCustomHexInput] = useState("#FA586A");
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Maintenance States
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);

  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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
        text: "SQLite database vacuumed, checkpointed, and FTS5 indices optimized successfully.",
      });
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
        text: "Artwork in-memory and disk cache purged successfully.",
      });
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

  const handleExport = () => {
    const jsonStr = exportConfigJson();
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
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0D0D10] animate-fade-in min-h-0 w-full h-full">
      {/* Top Header */}
      <div className="px-8 pt-7 pb-5 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#FA586A]/15 border border-[#FA586A]/30 flex items-center justify-center text-[#FA586A] shadow-lg shadow-[#FA586A]/15">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white tracking-tight">
              Settings & Preferences
            </h1>
            <p className="text-xs text-[#71717A] mt-0.5">
              Customize playback, audio pipeline, appearance themes, keybindings, and database maintenance.
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition border border-white/[0.08]"
            title="Export settings to JSON file"
          >
            <Download className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span>Export</span>
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition border border-white/[0.08]"
            title="Import settings from JSON"
          >
            <Upload className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span>Import</span>
          </button>
          <button
            onClick={() => setShowResetModal(true)}
            className="px-3 py-1.5 bg-white/[0.06] hover:bg-red-500/20 text-[#A1A1AA] hover:text-red-300 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition border border-white/[0.08]"
            title="Reset all settings to factory defaults"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Global Feedback Banner */}
      {feedbackMessage && (
        <div
          className={`mx-8 mt-4 flex items-center space-x-3 p-3.5 rounded-xl border text-xs font-semibold flex-shrink-0 animate-fade-in ${
            feedbackMessage.type === "success"
              ? "bg-green-500/10 border-green-500/30 text-green-300"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}
        >
          {feedbackMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-green-400" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
          )}
          <span className="flex-1">{feedbackMessage.text}</span>
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
        <aside className="w-full md:w-56 border-b md:border-b-0 md:border-r border-white/[0.06] p-2 sm:p-3 md:p-4 flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto space-x-1 md:space-x-0 md:space-y-1 flex-shrink-0 select-none bg-[#0F0F13]/60 min-h-0">
          {[
            { id: "general" as const, label: "General", icon: Settings, desc: "App & startup behavior" },
            { id: "audio" as const, label: "Audio & Playback", icon: Volume2, desc: "Volume, crossfade & gain" },
            { id: "appearance" as const, label: "Appearance", icon: Palette, desc: "Themes, accents & layout" },
            { id: "keybindings" as const, label: "Shortcuts", icon: Keyboard, desc: "Key combinations" },
            { id: "storage" as const, label: "Library & Database", icon: Database, desc: "Storage & maintenance" },
            { id: "network" as const, label: "Server & Streaming", icon: Radio, desc: "Port, RFC 7233 & web" },
            { id: "integrations" as const, label: "Integrations", icon: Link2, desc: "Discord, Media Controls" },
            { id: "about" as const, label: "About & Info", icon: Info, desc: "Version & diagnostics" },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap md:w-full text-left px-3 py-2 md:px-3.5 md:py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-2 md:space-x-3 transition-all flex-shrink-0 ${
                  isActive
                    ? "bg-[#FA586A] text-white shadow-md shadow-[#FA586A]/20"
                    : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white" : "text-[#71717A]"}`} />
                <div className="truncate">
                  <div className="leading-tight">{tab.label}</div>
                </div>
              </button>
            );
          })}
        </aside>

        {/* Right Settings Pane Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6 min-h-0 pb-28 sm:pb-24">
          {/* TAB 1: GENERAL */}
          {activeTab === "general" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">General Preferences</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  Startup behavior, notifications, and desktop integration.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Setting: Application Runtime Mode */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Monitor className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Application Mode</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Switch between the native desktop window and a web browser session.
                    </p>
                  </div>
                  <ModeSwitcher />
                </div>

                {/* Setting: Simplify / Low-Resource (Fast) Mode */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Zap className="w-3.5 h-3.5 text-[#00D2D3]" />
                      <span>Low-Resource Mode</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Turns off blur effects and heavy animations to save CPU and GPU power.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.simplifyMode}
                    onChange={(val) => setSetting("simplifyMode", val)}
                  />
                </div>

                {/* Setting: Auto-scan on startup */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <RefreshCw className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Scan Library on Startup</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Check your music folder for new files and tag changes on launch.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.autoScanOnStartup}
                    onChange={(val) => setSetting("autoScanOnStartup", val)}
                  />
                </div>

                {/* Setting: Track change notifications */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Bell className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Track Change Notifications</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Show a desktop alert with track title and artwork when songs change.
                    </p>
                    {settings.notificationsEnabled && (
                      <div className="pt-1.5">
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
                          className="px-2.5 py-1 bg-white/[0.06] hover:bg-white/[0.12] text-xs text-[#FA586A] rounded-lg border border-white/[0.08] font-semibold transition"
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
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Tv className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Linux MPRIS Integration</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Control playback through keyboard media keys, lock screen widgets, and desktop sound applets.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.enableMpris}
                    onChange={(val) => setSetting("enableMpris", val)}
                  />
                </div>

                {/* Setting: Auto-Resume Playback */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Activity className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Resume Playback on Launch</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Restore your last played song and position when opening the app.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.autoResumePlayback}
                    onChange={(val) => setSetting("autoResumePlayback", val)}
                  />
                </div>

                {/* Setting: Minimize to tray */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Shield className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Minimize to System Tray</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
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
                <p className="text-xs text-[#71717A] mt-0.5">
                  Volume settings, crossfade transitions, and loudness normalization.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Setting: Default Volume */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-white">Default Volume</div>
                      <p className="text-[11px] text-[#71717A]">
                        Starting volume level when the app opens.
                      </p>
                    </div>
                    <span className="font-mono text-xs text-white font-bold bg-white/[0.06] px-2.5 py-1 rounded-lg border border-white/[0.08]">
                      {Math.round(settings.defaultVolume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.defaultVolume}
                    onChange={(e) => setSetting("defaultVolume", parseFloat(e.target.value))}
                    className="w-full wavery-slider"
                    style={{ "--slider-progress": `${settings.defaultVolume * 100}%` } as React.CSSProperties}
                  />
                </div>

                {/* Setting: Volume Step Increment */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-white">Volume Step</div>
                      <p className="text-[11px] text-[#71717A]">
                        Volume adjustment per scroll wheel step or arrow key press.
                      </p>
                    </div>
                    <span className="font-mono text-xs text-white font-bold bg-white/[0.06] px-2.5 py-1 rounded-lg border border-white/[0.08]">
                      {Math.round(settings.volumeStep * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.01}
                    max={0.1}
                    step={0.01}
                    value={settings.volumeStep}
                    onChange={(e) => setSetting("volumeStep", parseFloat(e.target.value))}
                    className="w-full wavery-slider"
                    style={{ "--slider-progress": `${((settings.volumeStep - 0.01) / (0.1 - 0.01)) * 100}%` } as React.CSSProperties}
                  />
                </div>

                {/* Setting: Crossfade Duration */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-white">Crossfade</div>
                      <p className="text-[11px] text-[#71717A]">
                        Fade time between consecutive songs. Set to 0s to cut directly.
                      </p>
                    </div>
                    <span className="font-mono text-xs text-white font-bold bg-white/[0.06] px-2.5 py-1 rounded-lg border border-white/[0.08]">
                      {settings.crossfadeDurationMs === 0
                        ? "Off (0s)"
                        : `${(settings.crossfadeDurationMs / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10000}
                    step={500}
                    value={settings.crossfadeDurationMs}
                    onChange={(e) => setSetting("crossfadeDurationMs", parseInt(e.target.value, 10))}
                    className="w-full wavery-slider"
                    style={{ "--slider-progress": `${(settings.crossfadeDurationMs / 10000) * 100}%` } as React.CSSProperties}
                  />
                </div>

                {/* Setting: Gapless Playback */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Music className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Gapless Playback</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Preloads the upcoming audio stream to eliminate silence between tracks.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.gaplessPlayback}
                    onChange={(val) => setSetting("gaplessPlayback", val)}
                  />
                </div>

                {/* Setting: ReplayGain Normalization */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Sliders className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>ReplayGain Normalization</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Balance track loudness automatically using embedded ReplayGain tags.
                    </p>
                  </div>
                  <div className="flex items-center space-x-1 bg-[#121216] p-1 rounded-xl border border-white/[0.08]">
                    {(["off", "track", "album"] as ReplayGainMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setSetting("replayGainMode", mode)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition ${
                          settings.replayGainMode === mode
                            ? "bg-[#FA586A] text-white shadow-sm"
                            : "text-[#71717A] hover:text-white"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Engine Diagnostic Info */}
                <div className="p-5 bg-[#121216]/50 space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-bold text-white">
                    <Cpu className="w-3.5 h-3.5 text-green-400" />
                    <span>Native Audio Engine</span>
                  </div>
                  <p className="text-[11px] text-[#71717A] leading-relaxed">
                    Rodio backend on CPAL with a 2048-sample ring buffer, streaming 32-bit float audio directly to your audio sink.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: APPEARANCE */}
          {activeTab === "appearance" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">Appearance</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  Theme selection, accent color, and layout density.
                </p>
              </div>

              {/* Theme Mode Selector Cards */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-white uppercase tracking-wider text-[#71717A]">
                  Theme
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {THEME_OPTIONS.map((theme) => {
                    const isSelected = settings.themeMode === theme.id;
                    const accent = settings.accentColor || "#FA586A";
                    return (
                      <button
                        key={theme.id}
                        onClick={() => setSetting("themeMode", theme.id)}
                        style={{
                          backgroundColor: theme.bg,
                          borderColor: isSelected ? accent : theme.border,
                          boxShadow: isSelected
                            ? `0 0 0 2px ${accent}40, 0 8px 20px -6px ${accent}25`
                            : undefined,
                        }}
                        className={`p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between min-h-[6.5rem] group ${
                          isSelected ? "" : "hover:brightness-110"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span
                            className="text-xs font-bold tracking-tight transition-colors"
                            style={{ color: theme.textPrimary }}
                          >
                            {theme.name}
                          </span>
                          {isSelected && (
                            <span
                              className="w-5 h-5 rounded-full flex items-center justify-center shadow-sm"
                              style={{ backgroundColor: accent, color: "#FFFFFF" }}
                            >
                              <Check className="w-3 h-3 stroke-[2.5]" />
                            </span>
                          )}
                        </div>

                        <p
                          className="text-[11px] leading-snug mt-1 mb-2 font-normal"
                          style={{ color: theme.textMuted }}
                        >
                          {theme.desc}
                        </p>

                        {/* Theme palette mini preview dots */}
                        <div className="flex items-center space-x-1.5 pt-0.5">
                          <div
                            className="w-3 h-3 rounded-full border border-black/10 shadow-inner"
                            style={{ backgroundColor: theme.bg }}
                            title="Background"
                          />
                          <div
                            className="w-3 h-3 rounded-full border border-black/10 shadow-inner"
                            style={{ backgroundColor: theme.surface }}
                            title="Surface"
                          />
                          <div
                            className="w-3 h-3 rounded-full border border-black/10 shadow-inner"
                            style={{ backgroundColor: theme.textPrimary }}
                            title="Text Primary"
                          />
                          <div
                            className="w-3 h-3 rounded-full shadow-sm"
                            style={{ backgroundColor: isSelected ? accent : theme.accentPreview }}
                            title="Accent"
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent Color Picker */}
              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl p-5 space-y-4 shadow-xl">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-white">Accent Color</div>
                  <p className="text-[11px] text-[#71717A]">
                    Color used for active buttons, sliders, and selection highlights.
                  </p>
                </div>

                {/* Preset Palettes */}
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider">
                    Presets
                  </div>
                  <div className="flex flex-wrap gap-2.5 pt-0.5">
                    {ACCENT_PALETTE.map((color) => {
                      const isSelected = (settings.accentColor || "#FA586A").toLowerCase() === color.value.toLowerCase();
                      return (
                        <button
                          key={color.value}
                          onClick={() => setSetting("accentColor", color.value)}
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
                    <div className="text-[10px] font-semibold text-[#71717A] uppercase tracking-wider">
                      Custom Colors
                    </div>
                    <span className="text-[11px] text-[#71717A] font-mono">
                      Current: {settings.accentColor || "#FA586A"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                    {/* User saved custom colors */}
                    {(settings.customColors || []).map((color) => {
                      const isSelected = (settings.accentColor || "#FA586A").toLowerCase() === color.toLowerCase();
                      return (
                        <div key={color} className="relative group">
                          <button
                            onClick={() => setSetting("accentColor", color)}
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
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#18181B] text-[#A1A1AA] hover:text-white border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px]"
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
                    <div className="flex items-center space-x-1.5 ml-auto">
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-xs text-[#71717A] font-mono">#</span>
                        <input
                          type="text"
                          value={customHexInput.replace(/^#/, "")}
                          maxLength={6}
                          onChange={(e) => {
                            const clean = e.target.value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
                            setCustomHexInput(`#${clean}`);
                          }}
                          placeholder="FA586A"
                          className="w-24 pl-6 pr-2 py-1 text-xs bg-[#0F0F13] border border-white/10 rounded-lg text-white font-mono focus:outline-none focus:border-white/30"
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
                        className="px-2.5 py-1 text-xs font-semibold bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 text-white rounded-lg transition-all"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Layout & Visual Density */}
              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Album Grid Card Size */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white">Album Grid Size</div>
                    <p className="text-[11px] text-[#71717A]">
                      Card dimension scaling in album and artist views.
                    </p>
                  </div>
                  <div className="flex items-center space-x-1 bg-[#121216] p-1 rounded-xl border border-white/[0.08]">
                    {(["compact", "medium", "spacious"] as AlbumGridSize[]).map((size) => (
                      <button
                        key={size}
                        onClick={() => setSetting("albumGridSize", size)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition ${
                          settings.albumGridSize === size
                            ? "bg-[#FA586A] text-white shadow-sm"
                            : "text-[#71717A] hover:text-white"
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Track Row Density */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white">Track List Density</div>
                    <p className="text-[11px] text-[#71717A]">
                      Controls vertical spacing in track tables.
                    </p>
                  </div>
                  <div className="flex items-center space-x-1 bg-[#121216] p-1 rounded-xl border border-white/[0.08]">
                    {(["comfortable", "compact"] as RowDensity[]).map((density) => (
                      <button
                        key={density}
                        onClick={() => setSetting("rowDensity", density)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition ${
                          settings.rowDensity === density
                            ? "bg-[#FA586A] text-white shadow-sm"
                            : "text-[#71717A] hover:text-white"
                        }`}
                      >
                        {density}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Waveform Visualizer Toggle */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Activity className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Playing Waveform Animation</span>
                    </div>
                    <p className="text-[11px] text-[#71717A]">
                      Show small animated waveform bars next to playing songs.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.showVisualizer}
                    onChange={(val) => setSetting("showVisualizer", val)}
                  />
                </div>

                {/* Smooth Lyrics Scrolling */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Music className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Smooth Lyrics Auto-Scroll</span>
                    </div>
                    <p className="text-[11px] text-[#71717A]">
                      Center the active line smoothly as songs progress in fullscreen.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.showLyricsSmoothScroll}
                    onChange={(val) => setSetting("showLyricsSmoothScroll", val)}
                  />
                </div>

                {/* Simplify Low Resource Mode */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Zap className="w-3.5 h-3.5 text-[#00D2D3]" />
                      <span>Low-Resource Mode</span>
                    </div>
                    <p className="text-[11px] text-[#71717A]">
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
                <p className="text-xs text-[#71717A] mt-0.5">
                  Hotkeys for playback, search, and window navigation.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
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
                      <p className="text-[11px] text-[#71717A]">{item.desc}</p>
                    </div>
                    <kbd className="px-2.5 py-1 bg-white/[0.08] border border-white/[0.12] rounded-lg font-mono text-xs text-white font-semibold shadow-inner">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: STORAGE & DATABASE */}
          {activeTab === "storage" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">Library & Storage</h2>
                <p className="text-xs text-[#71717A]">
                  Folder locations, database indexing, and artwork cache maintenance.
                </p>
              </div>

              {/* Maintenance Callout Warning */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start space-x-3 text-xs">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-amber-300">Note on tag edits:</p>
                  <p className="text-amber-200/80 leading-relaxed text-[11px]">
                    Rebuilding clears database caches and rescans all audio files directly from disk.
                    <strong> If you edited metadata without writing changes back to the audio file tags (ID3/FLAC), those changes will be replaced by what is currently on disk.</strong>
                  </p>
                </div>
              </div>

              {/* Storage Info Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-[#16161A]/80 border border-white/[0.06] rounded-2xl space-y-1 shadow-md">
                  <p className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider">
                    Music Folder
                  </p>
                  <p className="font-mono text-white text-xs select-all truncate">
                    ~/.local/share/wavery/library
                  </p>
                  <p className="text-[11px] text-[#71717A] pt-1">
                    {tracks.length} songs in {albums.length} albums, {artists.length} artists.
                  </p>
                </div>

                <div className="p-4 bg-[#16161A]/80 border border-white/[0.06] rounded-2xl space-y-1 shadow-md">
                  <p className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider">
                    Database File
                  </p>
                  <p className="font-mono text-white text-xs select-all truncate">
                    ~/.local/share/wavery/library.db
                  </p>
                  <p className="text-[11px] text-[#71717A] pt-1">
                    SQLite WAL mode with FTS5 search index.
                  </p>
                </div>
              </div>

              {/* Maintenance Actions Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Action 1: Rebuild */}
                <div className="p-4 bg-[#16161A]/80 border border-white/[0.06] rounded-2xl flex flex-col justify-between space-y-3 shadow-md">
                  <div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Rebuild Database</span>
                    </h3>
                    <p className="text-[11px] text-[#71717A] mt-1 leading-relaxed">
                      Clears SQLite tables and indexes your music folder from scratch.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowConfirmModal(true)}
                    disabled={isRebuilding}
                    className="w-full inline-flex items-center justify-center space-x-2 px-3 py-2 bg-[#FA586A] hover:bg-[#E04859] active:scale-95 text-white rounded-xl text-xs font-bold transition shadow-md shadow-[#FA586A]/20 disabled:opacity-50"
                  >
                    {isRebuilding ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Rebuilding...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Rebuild Database</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Action 2: Vacuum & Optimize */}
                <div className="p-4 bg-[#16161A]/80 border border-white/[0.06] rounded-2xl flex flex-col justify-between space-y-3 shadow-md">
                  <div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                      <span>Optimize SQLite</span>
                    </h3>
                    <p className="text-[11px] text-[#71717A] mt-1 leading-relaxed">
                      Reclaims unused disk space, checkpoints WAL log, and cleans search tables.
                    </p>
                  </div>
                  <button
                    onClick={handleVacuum}
                    disabled={isVacuuming}
                    className="w-full inline-flex items-center justify-center space-x-2 px-3 py-2 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-white border border-white/[0.08] rounded-xl text-xs font-bold transition disabled:opacity-50"
                  >
                    {isVacuuming ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Optimizing...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-[#FA586A]" />
                        <span>Vacuum Database</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Action 3: Clear Artwork Cache */}
                <div className="p-4 bg-[#16161A]/80 border border-white/[0.06] rounded-2xl flex flex-col justify-between space-y-3 shadow-md">
                  <div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Trash2 className="w-3.5 h-3.5 text-[#FF453A]" />
                      <span>Purge Art Cache</span>
                    </h3>
                    <p className="text-[11px] text-[#71717A] mt-1 leading-relaxed">
                      Deletes cached covers so they get extracted fresh from audio files.
                    </p>
                  </div>
                  <button
                    onClick={handleClearCache}
                    disabled={isClearingCache}
                    className="w-full inline-flex items-center justify-center space-x-2 px-3 py-2 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-white border border-white/[0.08] rounded-xl text-xs font-bold transition disabled:opacity-50"
                  >
                    {isClearingCache ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Purging...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5 text-[#FF453A]" />
                        <span>Purge Cache</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: SERVER & STREAMING */}
          {activeTab === "network" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">Local Web Server</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  Stream audio and load the web client through the built-in HTTP server.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                <div className="p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-white">Server Address</div>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Local endpoint for web playback and cover art streaming.
                    </p>
                  </div>
                  <div className="flex items-center space-x-2 bg-white/[0.06] px-3 py-1.5 rounded-xl border border-white/[0.08]">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="font-mono text-xs text-white font-bold">http://127.0.0.1:4242</span>
                  </div>
                </div>

                <div className="p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-white">HTTP Range Requests</div>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Supports partial content requests (HTTP 206) for instant seeking in browsers.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-[11px] font-bold rounded-lg">
                    Active (64KB Chunks)
                  </span>
                </div>

                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white">Browser Client</div>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Open Wavery directly in your default web browser.
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <ModeSwitcher />
                    <button
                      onClick={() => {
                        usePlayerStore.getState().switchToWeb();
                      }}
                      className="px-3 py-1.5 bg-[#FA586A]/20 hover:bg-[#FA586A]/30 text-[#FA586A] border border-[#FA586A]/30 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition"
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
                <h2 className="text-base font-bold text-white">Integrations</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  Connect Wavery to OS media controls, Discord, and other external services.
                </p>
              </div>

              {/* ── Media Session API ── */}
              <div>
                <div className="flex items-center space-x-2 mb-3">
                  <MonitorSpeaker className="w-3.5 h-3.5 text-[#FA586A]" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Browser & OS Media Controls</h3>
                </div>
                <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                  <div className="p-5 flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="text-xs font-bold text-white flex items-center space-x-2">
                        <MonitorSpeaker className="w-3.5 h-3.5 text-[#FA586A] flex-shrink-0" />
                        <span>Browser Media Controls</span>
                        {/* Live status badge */}
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ml-1 ${
                          isMediaSessionSupported()
                            ? "bg-green-500/10 border-green-500/30 text-green-400"
                            : "bg-[#3F3F46]/60 border-white/[0.08] text-[#71717A]"
                        }`}>
                          {isMediaSessionSupported() ? (
                            <><Wifi className="w-2.5 h-2.5" /><span>Supported</span></>
                          ) : (
                            <><WifiOff className="w-2.5 h-2.5" /><span>Unsupported</span></>
                          )}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#71717A] leading-relaxed">
                        Show the current track in your browser's media panel, OS lock screen,
                        notification shade, and hardware media key controls (⏮ ⏯ ⏭).
                        Works in Chrome, Firefox, Safari, Edge — on Windows, macOS, Linux, Android, and iOS.
                      </p>
                      {!isMediaSessionSupported() && (
                        <p className="text-[11px] text-amber-400/80 mt-1">
                          Your browser does not support the Media Session API. Try Chrome 73+, Firefox 82+, or Safari 15+.
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      <ToggleSwitch
                        checked={settings.enableMediaSession}
                        onChange={(val) => setSetting("enableMediaSession", val)}
                      />
                    </div>
                  </div>

                  {/* Info row */}
                  <div className="px-5 py-3 bg-[#FA586A]/5 border-t border-[#FA586A]/10">
                    <p className="text-[11px] text-[#A1A1AA] leading-relaxed">
                      <span className="text-[#FA586A] font-semibold">How it works:</span>{" "}
                      Wavery pushes track metadata and artwork into the browser's native media overlay
                      on every status update. No extensions or installs required.
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Discord Rich Presence ── */}
              <div>
                <div className="flex items-center space-x-2 mb-3">
                  <MessageSquare className="w-3.5 h-3.5 text-[#5865F2]" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Discord Rich Presence</h3>
                </div>
                <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                  <div className="p-5 flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="text-xs font-bold text-white flex items-center flex-wrap gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-[#5865F2] flex-shrink-0" />
                        <span>Show Currently Playing in Discord</span>
                        {/* Live Discord connection badge */}
                        {discordStatusLoading && !discordStatus ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-[#3F3F46]/60 border-white/[0.08] text-[#71717A]">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>Checking…</span>
                          </span>
                        ) : discordStatus === null ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-[#3F3F46]/60 border-white/[0.08] text-[#71717A]">
                            <WifiOff className="w-2.5 h-2.5" />
                            <span>Server unreachable</span>
                          </span>
                        ) : !discordStatus.discord_running ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-500/10 border-amber-500/30 text-amber-400">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            <span>Discord not running</span>
                          </span>
                        ) : discordStatus.connected ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-green-500/10 border-green-500/30 text-green-400">
                            <Wifi className="w-2.5 h-2.5" />
                            <span>Connected</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-red-500/10 border-red-500/30 text-red-400">
                            <WifiOff className="w-2.5 h-2.5" />
                            <span>Disconnected</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#71717A] leading-relaxed">
                        Display the track you're listening to as your Discord activity status —
                        "Listening to Wavery". Updates in real-time as tracks change.
                        Requires Discord desktop to be running on this machine.
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <ToggleSwitch
                        checked={settings.enableDiscordRpc}
                        onChange={(val) => setSetting("enableDiscordRpc", val)}
                      />
                    </div>
                  </div>

                  {/* Setup info */}
                  <div className="p-5 space-y-3">
                    <div className="text-xs font-semibold text-[#A1A1AA]">Requirements</div>
                    <div className="space-y-2">
                      {[
                        { label: "Discord desktop app", met: discordStatus?.discord_running ?? false },
                        { label: "Wavery server running (always active)", met: discordStatus !== null },
                        { label: "IPC bridge connected", met: discordStatus?.connected ?? false },
                      ].map((req) => (
                        <div key={req.label} className="flex items-center space-x-2.5">
                          <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                            req.met ? "bg-green-500/20 text-green-400" : "bg-white/[0.06] text-[#52525B]"
                          }`}>
                            {req.met
                              ? <Check className="w-2.5 h-2.5" />
                              : <X className="w-2.5 h-2.5" />}
                          </div>
                          <span className={`text-[11px] ${req.met ? "text-[#D4D4D8]" : "text-[#52525B]"}`}>
                            {req.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* How it works */}
                  <div className="px-5 py-3 bg-[#5865F2]/5 border-t border-[#5865F2]/10">
                    <p className="text-[11px] text-[#A1A1AA] leading-relaxed">
                      <span className="text-[#5865F2] font-semibold">How it works:</span>{" "}
                      Wavery's local server maintains an IPC connection to Discord's desktop app.
                      Works in any browser (Chrome, Firefox, Safari, Edge) on Windows, macOS, and Linux
                      without extensions. No data is sent to Discord's servers — all communication is local.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: ABOUT & DIAGNOSTICS */}
          {activeTab === "about" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">About Wavery</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  Version, dependencies, and subsystem components.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl p-6 space-y-5 shadow-xl">
                <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FA586A] to-[#E0284F] flex items-center justify-center font-black text-2xl text-white shadow-xl shadow-[#FA586A]/20">
                    W
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white tracking-tight">Wavery</h3>
                    <p className="text-xs text-[#FA586A] font-semibold">Version 0.2.0 • Beta</p>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Local-first music player built with Rust, Tauri v2, and React. No accounts, no telemetry, no internet required.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">Audio Engine</p>
                    <p className="font-semibold text-white">Rodio + cpal</p>
                  </div>
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">Database</p>
                    <p className="font-semibold text-white">SQLite + FTS5</p>
                  </div>
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">Tag Parser</p>
                    <p className="font-semibold text-white">Lofty</p>
                  </div>
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">Streaming</p>
                    <p className="font-semibold text-white">Axum + Tokio</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">Desktop Shell</p>
                    <p className="font-semibold text-white">Tauri v2</p>
                  </div>
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">UI Framework</p>
                    <p className="font-semibold text-white">React 18</p>
                  </div>
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">Linux MPRIS</p>
                    <p className="font-semibold text-white">zbus</p>
                  </div>
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">State</p>
                    <p className="font-semibold text-white">Zustand</p>
                  </div>
                </div>

                <div className="p-4 bg-[#121216] border border-white/[0.06] rounded-xl space-y-1.5 text-xs">
                  <p className="font-bold text-white">What's new in 0.2.0 Beta:</p>
                  <ul className="text-[11px] leading-relaxed text-[#71717A] space-y-1 mt-1">
                    <li>• Home view with recently played and library highlights</li>
                    <li>• Full-featured Search with genre/decade browsing and Top Result card</li>
                    <li>• Play History view with chronological listening timeline</li>
                    <li>• Dual-mode: native desktop (Tauri IPC) or browser streaming (Axum)</li>
                    <li>• Dead code sweep and dependency cleanup across all workspace crates</li>
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
          <div className="bg-[#18181D] border border-white/[0.08] w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Rebuild Database?</h3>
                <p className="text-xs text-[#71717A]">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-[#A1A1AA] leading-relaxed">
              This clears the database index and rescans all audio files directly from your music folder.
              <br /><br />
              <span className="text-amber-300 font-semibold">
                ⚠️ Metadata edits that were not saved to audio file tags (ID3/FLAC) will be reset.
              </span>
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 text-xs font-semibold text-[#A1A1AA] hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRebuild}
                className="inline-flex items-center space-x-2 px-5 py-2 bg-[#FF453A] hover:bg-[#E03A30] active:scale-95 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-[#FF453A]/25"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Rebuild</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Reset Defaults */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#18181D] border border-white/[0.08] w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 flex-shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Reset Settings?</h3>
                <p className="text-xs text-[#71717A]">Restore default configuration.</p>
              </div>
            </div>

            <p className="text-xs text-[#A1A1AA] leading-relaxed">
              Reset audio, appearance, theme, and keyboard shortcuts back to default values?
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 text-xs font-semibold text-[#A1A1AA] hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleResetConfirm}
                className="inline-flex items-center space-x-2 px-5 py-2 bg-[#FF453A] hover:bg-[#E03A30] active:scale-95 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-[#FF453A]/25"
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
          <div className="bg-[#18181D] border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-[#FA586A]/15 border border-[#FA586A]/30 flex items-center justify-center text-[#FA586A] flex-shrink-0">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Import Configuration JSON</h3>
                <p className="text-xs text-[#71717A]">Paste exported settings JSON below</p>
              </div>
            </div>

            <textarea
              rows={8}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder="Paste JSON configuration content here..."
              className="w-full bg-[#121216] border border-white/[0.08] rounded-xl p-3 text-xs font-mono text-white placeholder-[#71717A] focus:outline-none focus:border-[#FA586A] transition"
            />

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportJsonText("");
                }}
                className="px-4 py-2 text-xs font-semibold text-[#A1A1AA] hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSubmit}
                disabled={!importJsonText.trim()}
                className="inline-flex items-center space-x-2 px-5 py-2 bg-[#FA586A] hover:bg-[#E04859] active:scale-95 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-[#FA586A]/25 disabled:opacity-50"
              >
                <span>Import & Apply</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#FA586A]/30 ${
        checked ? "bg-[#FA586A]" : "bg-white/[0.12]"
      }`}
    >
      <div
        className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
};


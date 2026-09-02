import React, { useState } from "react";
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
} from "lucide-react";

type SettingsTab =
  | "general"
  | "audio"
  | "appearance"
  | "keybindings"
  | "storage"
  | "network"
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

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  name: string;
  desc: string;
  bg: string;
  border: string;
}> = [
  {
    id: "dark",
    name: "Obsidian Dark",
    desc: "Apple Music inspired dark interface",
    bg: "#121216",
    border: "border-white/[0.12]",
  },
  {
    id: "oled",
    name: "Pure OLED Black",
    desc: "Maximum contrast #000000 for OLED screens",
    bg: "#000000",
    border: "border-white/[0.16]",
  },
  {
    id: "midnight",
    name: "Midnight Indigo",
    desc: "Deep navy blue palette with soft ambient glow",
    bg: "#0B0F19",
    border: "border-blue-500/20",
  },
  {
    id: "light",
    name: "Frost Light",
    desc: "High clarity crisp bright theme",
    bg: "#F4F4F6",
    border: "border-black/[0.10]",
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
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const exportConfigJson = useSettingsStore((s) => s.exportConfigJson);
  const importConfigJson = useSettingsStore((s) => s.importConfigJson);

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
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0D0D10] animate-fade-in">
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
      <div className="flex-1 flex overflow-hidden">
        {/* Left Settings Tabs Navigation */}
        <aside className="w-56 border-r border-white/[0.06] p-4 flex flex-col space-y-1 flex-shrink-0 overflow-y-auto select-none bg-[#0F0F13]/60">
          {[
            { id: "general" as const, label: "General", icon: Settings, desc: "App & startup behavior" },
            { id: "audio" as const, label: "Audio & Playback", icon: Volume2, desc: "Volume, crossfade & gain" },
            { id: "appearance" as const, label: "Appearance", icon: Palette, desc: "Themes, accents & layout" },
            { id: "keybindings" as const, label: "Shortcuts", icon: Keyboard, desc: "Key combinations" },
            { id: "storage" as const, label: "Library & Database", icon: Database, desc: "Storage & maintenance" },
            { id: "network" as const, label: "Server & Streaming", icon: Radio, desc: "Port, RFC 7233 & web" },
            { id: "about" as const, label: "About & Info", icon: Info, desc: "Version & diagnostics" },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-3 transition-all ${
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
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {/* TAB 1: GENERAL */}
          {activeTab === "general" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">General Preferences</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  Application startup, desktop integration, and system notification settings.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Setting: Application Runtime Mode */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Monitor className="w-3.5 h-3.5 text-[#FA586A]" />
                      <span>Application Runtime Mode</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Switch between Native Desktop (Rodio low-latency audio engine, MPRIS & system integrations) and Web Browser Client (144Hz Chromium rendering, web audio streaming & remote access).
                    </p>
                  </div>
                  <ModeSwitcher />
                </div>

                {/* Setting: Simplify / Low-Resource (Fast) Mode */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-2">
                      <Zap className="w-3.5 h-3.5 text-[#00D2D3]" />
                      <span>Simplify & Low-Resource Mode (Fast Mode)</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Disables backdrop blurs and heavy animations for ultra-low CPU/GPU resource usage and maximum responsiveness.
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
                      Automatically check your managed music folder for newly added tracks and tag modifications when Wavery opens.
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
                      Display desktop system notifications with album art, song title, and artist whenever the track changes.
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
                                  artist: "Wavery Desktop Music Player",
                                  album: "Audio Engine",
                                  format: "FLAC",
                                  duration: { secs: 180, nanos: 0 },
                                },
                                date_added: Date.now(),
                              });
                              setFeedbackMessage({
                                type: "success",
                                text: "Desktop test notification dispatched successfully!",
                              });
                            } else {
                              setFeedbackMessage({
                                type: "error",
                                text: "Desktop notifications permission was blocked or denied by your browser/system.",
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
                      <span>Linux MPRIS & Media Keys Integration</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Expose D-Bus MPRIS `org.mpris.MediaPlayer2.wavery` interface for hardware media keys and desktop widgets.
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
                      <span>Auto-Resume Playback Position</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Restore and resume the last active track and timestamp when reopening the player.
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
                      Keep audio playback running in the background when closing the main window.
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
                <h2 className="text-base font-bold text-white">Audio Engine & Playback</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  Configure volume dynamics, transitions, ReplayGain, and bit-perfect audio delivery.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Setting: Default Volume */}
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-white">Default Initial Volume</div>
                      <p className="text-[11px] text-[#71717A]">
                        Master volume level applied when initializing audio playback.
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
                      <div className="text-xs font-bold text-white">Volume Scroll & Key Step</div>
                      <p className="text-[11px] text-[#71717A]">
                        Percentage change per mouse scroll tick or keyboard arrow press.
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
                      <div className="text-xs font-bold text-white">Track Crossfade Transition</div>
                      <p className="text-[11px] text-[#71717A]">
                        Smoothly blend consecutive songs into each other. Set to 0s for instant cut.
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
                      Pre-buffer incoming audio samples to eliminate silence between live concert or classical tracks.
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
                      <span>ReplayGain Volume Normalization</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] leading-relaxed">
                      Automatically balance perceived loudness across tracks from different albums.
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
                    <span>Low-Latency Core Audio Backend</span>
                  </div>
                  <p className="text-[11px] text-[#71717A] leading-relaxed">
                    Native driver: <strong>Rodio / cpal</strong> with 2048-frame ring buffer, 32-bit Float bit-perfect audio stream, and direct ALSA/PulseAudio/PipeWire sink passthrough.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: APPEARANCE */}
          {activeTab === "appearance" && (
            <div className="space-y-6 animate-fade-in max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-white">Appearance & Theme</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  Personalize themes, accent colors, visual density, and GPU performance modes.
                </p>
              </div>

              {/* Theme Mode Selector Cards */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-white uppercase tracking-wider text-[#71717A]">
                  Color Theme Palette
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {THEME_OPTIONS.map((theme) => {
                    const isSelected = settings.themeMode === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => setSetting("themeMode", theme.id)}
                        style={{ backgroundColor: theme.bg }}
                        className={`p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between h-24 ${
                          isSelected
                            ? "border-[#FA586A] ring-2 ring-[#FA586A]/30 shadow-lg shadow-[#FA586A]/10"
                            : "border-white/[0.08] hover:border-white/[0.20]"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-bold text-white">{theme.name}</span>
                          {isSelected && (
                            <span className="w-5 h-5 rounded-full bg-[#FA586A] flex items-center justify-center text-white">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#A1A1AA] leading-snug">
                          {theme.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent Color Picker */}
              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl p-5 space-y-4 shadow-xl">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-white">Primary Accent Tint</div>
                  <p className="text-[11px] text-[#71717A]">
                    Select the dominant color for buttons, active navigation states, and audio scrubbers.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 pt-1">
                  {ACCENT_PALETTE.map((color) => {
                    const isSelected = (settings.accentColor || "#FA586A").toLowerCase() === color.value.toLowerCase();
                    return (
                      <button
                        key={color.value}
                        onClick={() => setSetting("accentColor", color.value)}
                        style={{ backgroundColor: color.value }}
                        className={`w-9 h-9 rounded-full transition-all flex items-center justify-center shadow-md relative ${
                          isSelected
                            ? "ring-4 ring-white/30 scale-110 shadow-lg"
                            : "opacity-80 hover:opacity-100 hover:scale-105"
                        }`}
                        title={color.name}
                      >
                        {isSelected && <Check className="w-4 h-4 text-white drop-shadow" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Layout & Visual Density */}
              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {/* Album Grid Card Size */}
                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white">Album Artwork Grid Size</div>
                    <p className="text-[11px] text-[#71717A]">
                      Card dimension scaling in Albums and Artists gallery views.
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
                    <div className="text-xs font-bold text-white">Track List Row Density</div>
                    <p className="text-[11px] text-[#71717A]">
                      Compact mode allows fitting more tracks per screen height.
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
                      <span>Animated Waveform Visualizer</span>
                    </div>
                    <p className="text-[11px] text-[#71717A]">
                      Render dynamic animated audio visualizer waves during active playback.
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
                      <span>Synchronized Karaoke Lyrics Motion</span>
                    </div>
                    <p className="text-[11px] text-[#71717A]">
                      Smooth auto-scroll and highlight dynamic lyrics lines in fullscreen mode.
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
                      <span>Simplify & Low-Resource Mode (Fast Mode)</span>
                    </div>
                    <p className="text-[11px] text-[#71717A]">
                      Disables backdrop blurs and heavy animations for maximum frame rates on low-end hardware or battery saving.
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
                  Global desktop hotkeys for quick playback control, search, and navigation.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                {[
                  { label: "Play / Pause Toggle", key: settings.keybindings?.togglePlay || "Space", desc: "Resume or pause playback immediately" },
                  { label: "Next Track", key: settings.keybindings?.nextTrack || "Ctrl+Right", desc: "Skip to following song in queue" },
                  { label: "Previous Track", key: settings.keybindings?.prevTrack || "Ctrl+Left", desc: "Restart song or return to previous track" },
                  { label: "Volume Increase", key: settings.keybindings?.volumeUp || "Up", desc: "Increase playback volume by configured step" },
                  { label: "Volume Decrease", key: settings.keybindings?.volumeDown || "Down", desc: "Decrease playback volume by configured step" },
                  { label: "Seek Forward (+5s)", key: settings.keybindings?.seekForward || "Right", desc: "Jump forward 5 seconds in current track" },
                  { label: "Seek Backward (-5s)", key: settings.keybindings?.seekBackward || "Left", desc: "Rewind 5 seconds in current track" },
                  { label: "Global Search & Find", key: settings.keybindings?.openSearch || "Ctrl+K", desc: "Focus top search bar across all entities" },
                  { label: "Mute / Unmute Audio", key: settings.keybindings?.toggleMute || "M", desc: "Toggle audio output mute state" },
                  { label: "Fullscreen Player", key: settings.keybindings?.toggleFullscreen || "F", desc: "Open immersive full-window visualizer" },
                  { label: "Synchronized Lyrics", key: settings.keybindings?.toggleLyrics || "L", desc: "Toggle live karaoke lyrics display" },
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
                <h2 className="text-base font-bold text-white">Library Storage & Maintenance</h2>
                <p className="text-xs text-[#71717A]">
                  Inspect directory indices, vacuum SQLite tables, and manage artwork caches.
                </p>
              </div>

              {/* Maintenance Callout Warning */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start space-x-3 text-xs">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-amber-300">Important Warning Regarding Custom Tag Edits:</p>
                  <p className="text-amber-200/80 leading-relaxed text-[11px]">
                    Rebuilding the database resets SQLite indices, clears orphaned records, and rescans all audio files directly from disk.
                    <strong>
                      Any custom metadata changes not written directly to audio file tags (ID3v2 / FLAC comments) will be refreshed from original embedded tags.
                    </strong>
                  </p>
                </div>
              </div>

              {/* Storage Info Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-[#16161A]/80 border border-white/[0.06] rounded-2xl space-y-1 shadow-md">
                  <p className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider">
                    Managed Music Directory
                  </p>
                  <p className="font-mono text-white text-xs select-all truncate">
                    ~/.local/share/wavery/library
                  </p>
                  <p className="text-[11px] text-[#71717A] pt-1">
                    Indexed <strong>{tracks.length}</strong> songs across <strong>{albums.length}</strong> albums and <strong>{artists.length}</strong> artists.
                  </p>
                </div>

                <div className="p-4 bg-[#16161A]/80 border border-white/[0.06] rounded-2xl space-y-1 shadow-md">
                  <p className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider">
                    SQLite Database File
                  </p>
                  <p className="font-mono text-white text-xs select-all truncate">
                    ~/.local/share/wavery/library.db
                  </p>
                  <p className="text-[11px] text-[#71717A] pt-1">
                    WAL Journal Mode & FTS5 unicode61 tokenizer.
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
                      Wipes cache, purges orphaned records, and re-indexes the music directory.
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
                      Reclaims free database pages, checkpoints WAL log, and rebuilds FTS5 indexes.
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
                      Clears memory and disk artwork cache, forcing fresh extraction on next view.
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
                <h2 className="text-base font-bold text-white">Local Streaming & Remote Web Server</h2>
                <p className="text-xs text-[#71717A] mt-0.5">
                  High-performance RFC 7233 partial content HTTP audio server configuration.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.06] shadow-xl overflow-hidden">
                <div className="p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-white">Local Server Endpoint</div>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Embedded zero-overhead streaming daemon for UI audio and album cover delivery.
                    </p>
                  </div>
                  <div className="flex items-center space-x-2 bg-white/[0.06] px-3 py-1.5 rounded-xl border border-white/[0.08]">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="font-mono text-xs text-white font-bold">http://127.0.0.1:4242</span>
                  </div>
                </div>

                <div className="p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-white">RFC 7233 Range Audio Streaming</div>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Zero-copy streaming with `206 Partial Content` support for instant seeking.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-[11px] font-bold rounded-lg">
                    Active (64KB Chunks)
                  </span>
                </div>

                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-0.5 pr-4">
                    <div className="text-xs font-bold text-white">Browser Client Access & Mode Switch</div>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Open Wavery directly in Google Chrome, Brave, Firefox, or Safari with 144Hz acceleration, or switch runtime modes.
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <ModeSwitcher />
                    <button
                      onClick={() => window.open("http://127.0.0.1:4242", "_blank")}
                      className="px-3 py-1.5 bg-[#FA586A]/20 hover:bg-[#FA586A]/30 text-[#FA586A] border border-[#FA586A]/30 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition"
                      title="Open http://127.0.0.1:4242 in default browser"
                    >
                      <span>Open Browser</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
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
                  System architecture, runtime environment, and build specifications.
                </p>
              </div>

              <div className="bg-[#16161A]/80 border border-white/[0.06] rounded-2xl p-6 space-y-5 shadow-xl">
                <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FA586A] to-[#E0284F] flex items-center justify-center font-black text-2xl text-white shadow-xl shadow-[#FA586A]/20">
                    W
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white tracking-tight">Wavery Desktop</h3>
                    <p className="text-xs text-[#FA586A] font-semibold">Version 0.1.0 • Release Build</p>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      Modern, high-fidelity modular music player written in Rust & TypeScript.
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
                    <p className="font-semibold text-white">Lofty v0.21</p>
                  </div>
                  <div className="p-3 bg-[#121216] border border-white/[0.06] rounded-xl space-y-0.5">
                    <p className="text-[10px] text-[#71717A] uppercase font-bold">Streaming</p>
                    <p className="font-semibold text-white">Axum + Tokio</p>
                  </div>
                </div>

                <div className="p-4 bg-[#121216] border border-white/[0.06] rounded-xl space-y-1.5 text-xs text-[#A1A1AA]">
                  <p className="font-bold text-white">Hard Modular Architecture Enforcement:</p>
                  <p className="text-[11px] leading-relaxed text-[#71717A]">
                    Designed with strict trait boundaries separating `wavery-core`, `wavery-audio`, `wavery-library`, `wavery-server`, `wavery-mpris`, and `wavery-ui`. Zero concrete driver leakage across architectural layers.
                  </p>
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
                <h3 className="text-sm font-bold text-white">Rebuild Entire Database?</h3>
                <p className="text-xs text-[#71717A]">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-[#A1A1AA] leading-relaxed">
              This will clear the SQLite tracks index, purge all orphaned records, and rescan all audio files directly from your library folder.
              <br /><br />
              <span className="text-amber-300 font-semibold">
                ⚠️ Any metadata edits that were NOT saved directly to physical audio file tags (ID3v2 / FLAC tags) may disappear.
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
                <span>Confirm & Rebuild</span>
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
                <h3 className="text-sm font-bold text-white">Reset All Settings?</h3>
                <p className="text-xs text-[#71717A]">Restore factory default configuration.</p>
              </div>
            </div>

            <p className="text-xs text-[#A1A1AA] leading-relaxed">
              Are you sure you want to reset all audio, appearance, theme, and keybinding preferences to their factory defaults?
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


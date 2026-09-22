import React, { useState, useEffect } from "react";
import {
  X,
  Check,
  Download,
  Upload,
  RotateCcw,
  Palette,
  Sun,
  Moon,
  Play,
  Volume2,
  Music,
  Heart,
  Search,
  Home,
} from "lucide-react";
import {
  CustomTheme,
  THEME_PRESETS,
  ThemeMode,
  useSettingsStore,
} from "../stores/settingsStore";

interface CustomThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTheme?: CustomTheme | null;
}

const DEFAULT_STARTER_THEME: CustomTheme = {
  id: "custom-" + Date.now(),
  name: "My Custom Theme",
  isLight: false,
  bg: "#0D0D10",
  surface: "#16161A",
  deck: "#121216",
  sidebar: "#0F0F13",
  border: "rgba(255, 255, 255, 0.08)",
  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1AA",
  textMuted: "#71717A",
  accentColor: "#FA586A",
};

export const CustomThemeModal: React.FC<CustomThemeModalProps> = ({
  isOpen,
  onClose,
  initialTheme,
}) => {
  const saveCustomTheme = useSettingsStore((s) => s.saveCustomTheme);
  const activeCustomTheme = useSettingsStore((s) => s.customTheme);

  const [themeDraft, setThemeDraft] = useState<CustomTheme>(() => {
    return initialTheme || activeCustomTheme || { ...DEFAULT_STARTER_THEME, id: "custom-" + Date.now() };
  });

  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialTheme) {
        setThemeDraft(initialTheme);
      } else if (activeCustomTheme) {
        setThemeDraft(activeCustomTheme);
      } else {
        setThemeDraft({ ...DEFAULT_STARTER_THEME, id: "custom-" + Date.now() });
      }
      setImportError(null);
    }
  }, [isOpen, initialTheme, activeCustomTheme]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const updateColor = (key: keyof CustomTheme, value: string | boolean) => {
    setImportError(null);
    setThemeDraft((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleDuplicateFromPreset = (presetId: ThemeMode) => {
    const preset = THEME_PRESETS[presetId];
    if (!preset) return;
    setThemeDraft((prev) => ({
      ...prev,
      name: `${preset.name} (Custom)`,
      isLight: preset.isLight,
      bg: preset.bg,
      surface: preset.surface,
      deck: preset.deck.startsWith("rgba") ? "#121216" : preset.deck,
      sidebar: preset.sidebar.startsWith("rgba") ? "#0F0F13" : preset.sidebar,
      border: preset.border,
      textPrimary: preset.textPrimary,
      textSecondary: preset.textSecondary,
      textMuted: preset.textMuted,
      accentColor: preset.accentColor,
    }));
  };

  const handleSaveAndApply = () => {
    if (!themeDraft.name.trim()) {
      setImportError("Theme name is required. Please enter a name for your theme.");
      return;
    }
    setImportError(null);
    const finalTheme: CustomTheme = {
      ...themeDraft,
      id: themeDraft.id || "custom-" + Date.now(),
      name: themeDraft.name.trim(),
    };
    saveCustomTheme(finalTheme);
    onClose();
  };

  const handleExportJson = () => {
    const json = JSON.stringify(themeDraft, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopiedNotification("Theme JSON copied to clipboard!");
      setTimeout(() => setCopiedNotification(null), 3000);
    }).catch(() => {
      setCopiedNotification("Failed to copy JSON");
      setTimeout(() => setCopiedNotification(null), 3000);
    });
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = JSON.parse(text);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof parsed.bg === "string" &&
          typeof parsed.surface === "string" &&
          typeof parsed.accentColor === "string"
        ) {
          setThemeDraft({
            ...DEFAULT_STARTER_THEME,
            ...parsed,
            id: parsed.id || "custom-" + Date.now(),
            name: parsed.name || "Imported Theme",
          });
          setImportError(null);
          setCopiedNotification("Theme imported successfully!");
          setTimeout(() => setCopiedNotification(null), 3000);
        } else {
          setImportError("Invalid theme JSON format: missing core color attributes.");
        }
      } catch {
        setImportError("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-[#16161A] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#0F0F13]/80">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white">
              <Palette className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Custom Theme Maker</h2>
              <p className="text-[11px] text-[#71717A]">
                Craft your bespoke color palette with live preview.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#71717A] hover:text-white hover:bg-white/[0.06] transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: Two Column Studio */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Controls: Name, Mode & Starter Template */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-[#121216]/60 p-4 rounded-xl border border-white/[0.05]">
            {/* Theme Name */}
            <div>
              <label className="block text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider mb-1.5">
                Theme Name
              </label>
              <input
                type="text"
                value={themeDraft.name}
                onChange={(e) => updateColor("name", e.target.value)}
                placeholder="e.g. Midnight Cyberpunk"
                className="w-full px-3 py-2 text-xs bg-[#16161A] text-white border border-white/10 rounded-lg focus:outline-none focus:border-white/30 transition-colors"
              />
            </div>

            {/* Base Contrast Mode */}
            <div>
              <label className="block text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider mb-1.5">
                Base Contrast Mode
              </label>
              <div className="flex items-center space-x-1.5 bg-[#16161A] p-1 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => updateColor("isLight", false)}
                  className={`flex-1 flex items-center justify-center space-x-1.5 py-1 px-2.5 rounded-md text-xs font-medium transition-colors ${
                    !themeDraft.isLight
                      ? "bg-white/[0.12] text-white shadow-sm"
                      : "text-[#71717A] hover:text-white"
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Dark</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateColor("isLight", true)}
                  className={`flex-1 flex items-center justify-center space-x-1.5 py-1 px-2.5 rounded-md text-xs font-medium transition-colors ${
                    themeDraft.isLight
                      ? "bg-white/[0.12] text-white shadow-sm"
                      : "text-[#71717A] hover:text-white"
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>Light</span>
                </button>
              </div>
            </div>

            {/* Duplicate from Preset */}
            <div>
              <label className="block text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider mb-1.5">
                Clone from Preset
              </label>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleDuplicateFromPreset(e.target.value as ThemeMode);
                    e.target.value = "";
                  }
                }}
                defaultValue=""
                className="w-full px-3 py-2 text-xs bg-[#16161A] text-white border border-white/10 rounded-lg focus:outline-none focus:border-white/30 transition-colors cursor-pointer"
              >
                <option value="" disabled>
                  Select a starter preset...
                </option>
                {Object.values(THEME_PRESETS).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} ({preset.category})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Color Channels Grid */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider">
              Color Channels
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Background */}
              <ColorInput
                label="Background (Canvas)"
                value={themeDraft.bg}
                onChange={(v) => updateColor("bg", v)}
              />

              {/* Surface */}
              <ColorInput
                label="Surface (Cards & Rows)"
                value={themeDraft.surface}
                onChange={(v) => updateColor("surface", v)}
              />

              {/* Sidebar */}
              <ColorInput
                label="Sidebar (Nav)"
                value={themeDraft.sidebar}
                onChange={(v) => updateColor("sidebar", v)}
              />

              {/* Player Deck */}
              <ColorInput
                label="Player Deck (Bottom)"
                value={themeDraft.deck}
                onChange={(v) => updateColor("deck", v)}
              />

              {/* Border */}
              <ColorInput
                label="Border & Dividers"
                value={themeDraft.border}
                onChange={(v) => updateColor("border", v)}
              />

              {/* Text Primary */}
              <ColorInput
                label="Primary Text"
                value={themeDraft.textPrimary}
                onChange={(v) => updateColor("textPrimary", v)}
              />

              {/* Text Muted */}
              <ColorInput
                label="Muted Text"
                value={themeDraft.textMuted}
                onChange={(v) => updateColor("textMuted", v)}
              />

              {/* Signature Accent */}
              <ColorInput
                label="Signature Accent"
                value={themeDraft.accentColor}
                onChange={(v) => updateColor("accentColor", v)}
              />
            </div>
          </div>

          {/* Interactive Live UI Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider">
                Live Interface Preview
              </span>
              <span className="text-[11px] text-[#71717A]">
                Changes apply in real-time below
              </span>
            </div>

            <div
              className="rounded-xl border overflow-hidden transition-all shadow-lg"
              style={{
                backgroundColor: themeDraft.bg,
                borderColor: themeDraft.border || "rgba(255, 255, 255, 0.1)",
              }}
            >
              {/* Mini App Window */}
              <div className="flex flex-col h-64 select-none">
                {/* Window Header */}
                <div
                  className="flex items-center justify-between px-3 py-2 border-b text-xs"
                  style={{
                    backgroundColor: themeDraft.sidebar,
                    borderColor: themeDraft.border || "rgba(255, 255, 255, 0.08)",
                  }}
                >
                  <div className="flex items-center space-x-2">
                    <div className="flex space-x-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
                    </div>
                    <span
                      className="text-[11px] font-semibold ml-2"
                      style={{ color: themeDraft.textPrimary }}
                    >
                      Wavery
                    </span>
                  </div>

                  {/* Mini Search input */}
                  <div
                    className="flex items-center space-x-1.5 px-2 py-0.5 rounded border text-[10px]"
                    style={{
                      backgroundColor: themeDraft.surface,
                      borderColor: themeDraft.border || "rgba(255, 255, 255, 0.08)",
                      color: themeDraft.textMuted,
                    }}
                  >
                    <Search className="w-2.5 h-2.5" />
                    <span>Search songs, albums...</span>
                  </div>
                </div>

                {/* Main Body */}
                <div className="flex-1 flex overflow-hidden">
                  {/* Mini Sidebar */}
                  <div
                    className="w-32 border-r p-2 space-y-1 text-[11px] flex flex-col justify-between"
                    style={{
                      backgroundColor: themeDraft.sidebar,
                      borderColor: themeDraft.border || "rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    <div className="space-y-0.5">
                      <div
                        className="flex items-center space-x-1.5 px-2 py-1 rounded font-medium"
                        style={{
                          backgroundColor: `${themeDraft.accentColor}25`,
                          color: themeDraft.accentColor,
                        }}
                      >
                        <Home className="w-3 h-3" />
                        <span>Home</span>
                      </div>
                      <div
                        className="flex items-center space-x-1.5 px-2 py-1 rounded"
                        style={{ color: themeDraft.textMuted }}
                      >
                        <Music className="w-3 h-3" />
                        <span>All Tracks</span>
                      </div>
                      <div
                        className="flex items-center space-x-1.5 px-2 py-1 rounded"
                        style={{ color: themeDraft.textMuted }}
                      >
                        <Heart className="w-3 h-3" />
                        <span>Liked</span>
                      </div>
                    </div>

                    <div
                      className="text-[9px] px-2 py-1 rounded border text-center font-medium"
                      style={{
                        borderColor: themeDraft.border,
                        color: themeDraft.textMuted,
                      }}
                    >
                      Library: 722
                    </div>
                  </div>

                  {/* Mini Content Area */}
                  <div className="flex-1 p-3 space-y-2 overflow-hidden flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className="text-xs font-bold"
                          style={{ color: themeDraft.textPrimary }}
                        >
                          Recently Played
                        </span>
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: themeDraft.accentColor }}
                        >
                          See All
                        </span>
                      </div>

                      {/* Mock track rows */}
                      <div className="space-y-1">
                        <div
                          className="flex items-center justify-between p-1.5 rounded-lg border text-xs"
                          style={{
                            backgroundColor: themeDraft.surface,
                            borderColor: themeDraft.border,
                          }}
                        >
                          <div className="flex items-center space-x-2">
                            <div
                              className="w-6 h-6 rounded flex items-center justify-center text-white"
                              style={{ backgroundColor: themeDraft.accentColor }}
                            >
                              <Music className="w-3 h-3" />
                            </div>
                            <div>
                              <div
                                className="text-[11px] font-semibold leading-tight"
                                style={{ color: themeDraft.textPrimary }}
                              >
                                City of Delusion
                              </div>
                              <div
                                className="text-[9px]"
                                style={{ color: themeDraft.textMuted }}
                              >
                                Muse • HAARP
                              </div>
                            </div>
                          </div>
                          <span
                            className="text-[10px]"
                            style={{ color: themeDraft.textMuted }}
                          >
                            4:48
                          </span>
                        </div>

                        <div
                          className="flex items-center justify-between p-1.5 rounded-lg text-xs"
                          style={{
                            backgroundColor: "transparent",
                          }}
                        >
                          <div className="flex items-center space-x-2">
                            <div
                              className="w-6 h-6 rounded border flex items-center justify-center"
                              style={{
                                borderColor: themeDraft.border,
                                color: themeDraft.textMuted,
                              }}
                            >
                              <Music className="w-3 h-3" />
                            </div>
                            <div>
                              <div
                                className="text-[11px] font-semibold leading-tight"
                                style={{ color: themeDraft.textPrimary }}
                              >
                                Starlight
                              </div>
                              <div
                                className="text-[9px]"
                                style={{ color: themeDraft.textMuted }}
                              >
                                Muse • Black Holes
                              </div>
                            </div>
                          </div>
                          <span
                            className="text-[10px]"
                            style={{ color: themeDraft.textMuted }}
                          >
                            3:59
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mini Player Deck */}
                <div
                  className="flex items-center justify-between px-3 py-2 border-t"
                  style={{
                    backgroundColor: themeDraft.deck,
                    borderColor: themeDraft.border || "rgba(255, 255, 255, 0.08)",
                  }}
                >
                  <div className="flex items-center space-x-2 w-1/3">
                    <div
                      className="w-6 h-6 rounded shadow-sm flex items-center justify-center text-white"
                      style={{ backgroundColor: themeDraft.accentColor }}
                    >
                      <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                    </div>
                    <div className="truncate">
                      <div
                        className="text-[10px] font-semibold truncate leading-tight"
                        style={{ color: themeDraft.textPrimary }}
                      >
                        City of Delusion
                      </div>
                      <div
                        className="text-[8px] truncate"
                        style={{ color: themeDraft.textMuted }}
                      >
                        Muse
                      </div>
                    </div>
                  </div>

                  {/* Scrubber Bar */}
                  <div className="flex flex-col items-center w-1/3 space-y-1">
                    <div className="w-full bg-black/20 rounded-full h-1 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: "45%",
                          backgroundColor: themeDraft.accentColor,
                        }}
                      />
                    </div>
                    <div
                      className="flex justify-between w-full text-[8px]"
                      style={{ color: themeDraft.textMuted }}
                    >
                      <span>1:42</span>
                      <span>4:48</span>
                    </div>
                  </div>

                  {/* Volume Slider Mock */}
                  <div className="flex items-center justify-end space-x-1.5 w-1/3">
                    <Volume2
                      className="w-3 h-3"
                      style={{ color: themeDraft.textMuted }}
                    />
                    <div className="w-12 bg-black/20 rounded-full h-1 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: "80%",
                          backgroundColor: themeDraft.accentColor,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Feedback / Notifications */}
          {copiedNotification && (
            <div className="p-2.5 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-[#10B981] flex items-center space-x-2">
              <Check className="w-4 h-4" />
              <span>{copiedNotification}</span>
            </div>
          )}
          {importError && (
            <div className="p-2.5 rounded-lg bg-[#FF453A]/10 border border-[#FF453A]/30 text-xs text-[#FF453A]">
              {importError}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/[0.06] bg-[#0F0F13]/80">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleExportJson}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-[#A1A1AA] hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>

            <label className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-[#A1A1AA] hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-lg transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Import JSON</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportJson}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={() => setThemeDraft({ ...DEFAULT_STARTER_THEME, id: "custom-" + Date.now() })}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-[#71717A] hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-[#A1A1AA] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAndApply}
              style={{ backgroundColor: themeDraft.accentColor }}
              className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white rounded-lg shadow-sm hover:brightness-110 active:scale-[0.98] transition-all"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Save & Apply Theme</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const ColorInput: React.FC<ColorInputProps> = ({ label, value, onChange }) => {
  const hexForPicker = value.startsWith("#") && value.length === 7 ? value : "#16161A";

  return (
    <div className="bg-[#121216]/50 p-2.5 rounded-xl border border-white/[0.05] space-y-1.5">
      <span className="block text-[10px] font-semibold text-[#71717A] truncate">
        {label}
      </span>
      <div className="flex items-center space-x-2">
        <label className="relative cursor-pointer shrink-0">
          <div
            className="w-6 h-6 rounded-lg border border-white/20 shadow-inner"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            value={hexForPicker}
            onChange={(e) => onChange(e.target.value)}
            className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
          />
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full text-xs font-mono bg-transparent text-white focus:outline-none border-b border-transparent focus:border-white/20"
        />
      </div>
    </div>
  );
};

import React, { useState } from "react";
import { ImportStrategy } from "../types";
import { Copy, ArrowRightLeft, X, FolderOpen, FileAudio, Folder, HardDrive } from "lucide-react";
import { playerAdapter } from "../services/adapter";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (path: string, strategy: ImportStrategy, isFolder: boolean) => Promise<void>;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [mode, setMode] = useState<"file" | "folder">("folder");
  const [targetPath, setTargetPath] = useState("");
  const [strategy, setStrategy] = useState<ImportStrategy>("Copy");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePick = async () => {
    setError(null);
    try {
      if (mode === "folder") {
        const picked = await playerAdapter.pickFolder();
        if (picked) {
          setTargetPath(picked);
        }
      } else {
        const picked = await playerAdapter.pickFile();
        if (picked) {
          setTargetPath(picked);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to open file manager");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPath.trim()) {
      setError("Please select or enter a path");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onImport(targetPath.trim(), strategy, mode === "folder");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Failed to import");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-[#18181D] border border-white/[0.08] w-full max-w-lg rounded-2xl p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#71717A] hover:text-white hover:bg-white/[0.06] p-1 rounded-full transition"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-[#FA586A]" /> Import Music
        </h2>
        <p className="text-xs text-[#71717A] mb-5">
          Select a folder or audio file to add to your library.
        </p>

        {/* Mode Selector: Single File vs Folder */}
        <div className="flex bg-[#121216] p-1 rounded-full border border-white/[0.08] mb-5">
          <button
            type="button"
            onClick={() => setMode("folder")}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-full text-xs font-semibold transition-all ${
              mode === "folder"
                ? "bg-white/[0.14] text-white shadow-sm font-bold"
                : "text-[#71717A] hover:text-white"
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>Music Folder</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-full text-xs font-semibold transition-all ${
              mode === "file"
                ? "bg-white/[0.14] text-white shadow-sm font-bold"
                : "text-[#71717A] hover:text-white"
            }`}
          >
            <FileAudio className="w-3.5 h-3.5" />
            <span>Audio File</span>
          </button>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* File Manager Picker Button & Input */}
          <div>
            <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
              {mode === "folder" ? "Selected Folder" : "Selected Audio File"}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                placeholder={
                  mode === "folder"
                    ? "/home/user/Music/Albums"
                    : "/home/user/Music/song.flac"
                }
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                className="flex-1 px-3.5 py-2.5 bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
              />
              <button
                type="button"
                onClick={handlePick}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-white rounded-xl text-xs font-medium border border-white/[0.08] transition shadow-sm whitespace-nowrap"
              >
                <HardDrive className="w-4 h-4 text-[#FA586A]" />
                <span>Browse</span>
              </button>
            </div>
          </div>

          {/* Import Method (Copy vs Move) */}
          <div>
            <label className="block text-xs font-semibold text-[#A1A1AA] mb-2">
              Import Method
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStrategy("Copy")}
                className={`p-3.5 rounded-xl border flex flex-col items-start gap-1 transition-all ${
                  strategy === "Copy"
                    ? "bg-[#FA586A]/10 border-[#FA586A]/60 text-white"
                    : "border-white/[0.06] bg-[#121216] text-[#71717A] hover:border-white/[0.15]"
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <Copy className="w-4 h-4 text-[#FA586A]" /> Copy
                </div>
                <span className="text-[10.5px] text-[#71717A] text-left leading-relaxed">
                  Copies {mode === "folder" ? "all tracks" : "the file"} into your library folder. Source files stay where they are.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStrategy("Move")}
                className={`p-3.5 rounded-xl border flex flex-col items-start gap-1 transition-all ${
                  strategy === "Move"
                    ? "bg-[#FA586A]/10 border-[#FA586A]/60 text-white"
                    : "border-white/[0.06] bg-[#121216] text-[#71717A] hover:border-white/[0.15]"
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <ArrowRightLeft className="w-4 h-4 text-[#FA586A]" /> Move
                </div>
                <span className="text-[10.5px] text-[#71717A] text-left leading-relaxed">
                  Moves {mode === "folder" ? "all tracks" : "the file"} into your library folder and removes them from the source location.
                </span>
              </button>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#71717A] hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-[#FA586A] hover:bg-[#E04859] active:scale-95 text-white transition shadow-md shadow-[#FA586A]/20 disabled:opacity-50"
            >
              {loading
                ? mode === "folder"
                  ? "Scanning and importing..."
                  : "Importing track..."
                : mode === "folder"
                ? "Import Folder"
                : "Import Track"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

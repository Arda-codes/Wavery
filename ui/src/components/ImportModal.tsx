import React, { useState } from "react";
import { ImportStrategy, PlaylistImportSummary } from "../types";
import {
  Copy,
  ArrowRightLeft,
  X,
  FolderOpen,
  FileAudio,
  Folder,
  HardDrive,
  ListMusic,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { playerAdapter } from "../services/adapter";
import { SegmentedControl } from "./SegmentedControl";
import { useTransitionMount } from "../utils/useTransitionMount";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (path: string, strategy: ImportStrategy, isFolder: boolean) => Promise<void>;
  /** Desktop-only: build a playlist from an M3U, M3U8, or yt-dlp JSON file. */
  onImportPlaylist?: (path: string) => Promise<PlaylistImportSummary>;
  /** Opens the playlist created by the last import. */
  onOpenPlaylist?: (playlistId: string) => void;
}

type ImportMode = "file" | "folder" | "playlist";

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  onImportPlaylist,
  onOpenPlaylist,
}) => {
  const [mode, setMode] = useState<ImportMode>("folder");
  const [targetPath, setTargetPath] = useState("");
  const [strategy, setStrategy] = useState<ImportStrategy>("Copy");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlistResult, setPlaylistResult] = useState<PlaylistImportSummary | null>(null);

  // Browser builds cannot read a chosen file from disk, so the JSON option is
  // only offered where the native shell can hand the path to the backend.
  const canImportPlaylist = Boolean(onImportPlaylist) && playerAdapter.isTauri();
  const { isRendered, isExiting } = useTransitionMount(isOpen, 160);

  if (!isRendered) return null;

  const handleClose = () => {
    setTargetPath("");
    setError(null);
    setPlaylistResult(null);
    onClose();
  };

  const changeMode = (next: ImportMode) => {
    setMode(next);
    setTargetPath("");
    setError(null);
    setPlaylistResult(null);
  };

  const handlePick = async () => {
    setError(null);
    try {
      if (mode === "folder") {
        const picked = await playerAdapter.pickFolder();
        if (picked) {
          setTargetPath(picked);
        }
      } else if (mode === "playlist") {
        const picked = await playerAdapter.pickPlaylistFile();
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
    const path = targetPath.trim();
    if (!path) {
      setError(
        mode === "playlist"
          ? "Choose an M3U, M3U8, or yt-dlp JSON file to import as a playlist."
          : "Choose an audio file or folder to import."
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (mode === "playlist") {
        if (!onImportPlaylist) {
          throw new Error("Playlist import is not available in this build.");
        }
        const summary = await onImportPlaylist(path);
        setPlaylistResult(summary);
        setTargetPath("");
      } else {
        await onImport(path, strategy, mode === "folder");
        handleClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Unable to import selected path. Check file permissions and try again.");
    } finally {
      setLoading(false);
    }
  };

  const modeOptions = [
    { value: "folder", label: "Music Folder", icon: Folder },
    { value: "file", label: "Audio File", icon: FileAudio },
    ...(canImportPlaylist
      ? [{ value: "playlist", label: "Playlist File", icon: ListMusic }]
      : []),
  ];

  const unmatchedPreview = playlistResult
    ? playlistResult.unmatched_titles.slice(0, 4)
    : [];

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md ${
        isExiting ? "animate-backdrop-out" : "animate-backdrop-in"
      }`}
    >
      <div
        className={`bg-surface border border-white/[0.08] w-full max-w-lg rounded-2xl p-5 sm:p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto ${
          isExiting ? "animate-scale-down pointer-events-none" : "animate-scale-up"
        }`}
      >
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-textMuted hover:text-white hover:bg-white/[0.06] p-1 rounded-full transition"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-accent" /> Import Music
        </h2>
        <p className="text-xs text-textMuted mb-5">
          {mode === "playlist"
            ? "Turn an M3U, M3U8, or yt-dlp JSON file into a playlist from tracks in your library."
            : "Select a folder or audio file to add to your library."}
        </p>

        {playlistResult ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-success/10 border border-success/25">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">
                    {playlistResult.playlist_name}
                  </p>
                  <p className="text-xs text-textSecondary mt-1">
                    {playlistResult.matched_tracks} of {playlistResult.total_entries} entries
                    matched to your library
                    {playlistResult.already_in_playlist > 0
                      ? `, ${playlistResult.already_in_playlist} already in the playlist`
                      : ""}
                    .
                  </p>
                </div>
              </div>
            </div>

            {playlistResult.unmatched_entries > 0 && (
              <div className="p-4 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <div className="flex items-center gap-2 text-xs font-semibold text-textSecondary">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span>
                    {playlistResult.unmatched_entries} entr
                    {playlistResult.unmatched_entries === 1 ? "y was" : "ies were"} not found
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {unmatchedPreview.map((title, index) => (
                    <li key={`${title}-${index}`} className="text-2xs text-textMuted truncate">
                      {title}
                    </li>
                  ))}
                </ul>
                {playlistResult.unmatched_entries > unmatchedPreview.length && (
                  <p className="text-2xs text-textMuted mt-2">
                    and {playlistResult.unmatched_entries - unmatchedPreview.length} more. Import
                    the matching audio files, then add the JSON again to pick them up.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-semibold text-textMuted hover:text-white transition"
              >
                Done
              </button>
              {onOpenPlaylist && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenPlaylist(playlistResult.playlist_id);
                    handleClose();
                  }}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-accent-fill hover:bg-accentHover active:scale-95 text-white transition shadow-md shadow-accent/20"
                >
                  Open Playlist
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Mode Selector: Single File vs Folder vs yt-dlp JSON */}
            <SegmentedControl
              value={mode}
              onChange={(val) => changeMode(val as ImportMode)}
              options={modeOptions}
              ariaLabel="Import Mode Selection"
              variant="subtle"
              size="md"
              pillShape="pill"
              className="w-full mb-5"
            />

            {error && (
              <div className="p-3 mb-4 rounded-xl bg-danger/10 border border-danger/30 text-xs text-danger">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* File Manager Picker Button & Input */}
              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  {mode === "folder"
                    ? "Selected Folder"
                    : mode === "playlist"
                    ? "Selected yt-dlp JSON"
                    : "Selected Audio File"}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder={
                      mode === "folder"
                        ? "/home/user/Music/Albums"
                        : mode === "playlist"
                        ? "/home/user/Music/playlist.json"
                        : "/home/user/Music/song.flac"
                    }
                    value={targetPath}
                    onChange={(e) => setTargetPath(e.target.value)}
                    className="flex-1 px-4 py-3 bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                  />
                  <button
                    type="button"
                    onClick={handlePick}
                    className="flex items-center gap-2 px-4 py-3 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-white rounded-xl text-xs font-medium border border-white/[0.08] transition shadow-sm whitespace-nowrap"
                  >
                    <HardDrive className="w-4 h-4 text-accent" />
                    <span>Browse</span>
                  </button>
                </div>
                {mode === "playlist" && (
                  <p className="text-2xs text-textMuted mt-2 leading-relaxed">
                    Accepts standard <span className="text-textSecondary">.m3u</span> /{" "}
                    <span className="text-textSecondary">.m3u8</span> files or yt-dlp{" "}
                    <span className="text-textSecondary">.info.json</span> metadata and dumps.
                    Tracks are matched against your library by path, filename, and tags;
                    audio files are not modified.
                  </p>
                )}
              </div>

              {/* Import Method (Copy vs Move) — not applicable to playlists */}
              {mode !== "playlist" && (
                <div>
                  <label className="block text-xs font-semibold text-textSecondary mb-2">
                    Import Method
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setStrategy("Copy")}
                      className={`p-4 rounded-xl border flex flex-col items-start gap-1 transition-all ${
                        strategy === "Copy"
                          ? "bg-accent/10 border-accent/60 text-white"
                          : "border-white/[0.06] bg-deck text-textMuted hover:border-white/[0.15]"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-xs text-white">
                        <Copy className="w-4 h-4 text-accent" /> Copy
                      </div>
                      <span className="text-2xs text-textMuted text-left leading-relaxed">
                        Copies {mode === "folder" ? "all tracks" : "the file"} into your library
                        folder. Source files stay where they are.
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStrategy("Move")}
                      className={`p-4 rounded-xl border flex flex-col items-start gap-1 transition-all ${
                        strategy === "Move"
                          ? "bg-accent/10 border-accent/60 text-white"
                          : "border-white/[0.06] bg-deck text-textMuted hover:border-white/[0.15]"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-xs text-white">
                        <ArrowRightLeft className="w-4 h-4 text-accent" /> Move
                      </div>
                      <span className="text-2xs text-textMuted text-left leading-relaxed">
                        Moves {mode === "folder" ? "all tracks" : "the file"} into your library
                        folder and removes them from the source location.
                      </span>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-xs font-semibold text-textMuted hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-accent-fill hover:bg-accentHover active:scale-95 text-white transition shadow-md shadow-accent/20 disabled:opacity-50"
                >
                  {loading
                    ? mode === "folder"
                      ? "Scanning and importing..."
                      : mode === "playlist"
                      ? "Matching tracks..."
                      : "Importing track..."
                    : mode === "folder"
                    ? "Import Folder"
                    : mode === "playlist"
                    ? "Add as Playlist"
                    : "Import Track"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

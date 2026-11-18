import React, { useState, useEffect } from "react";
import {
  ImportStrategy,
  PlaylistImportSummary,
  FolderPlaylistImportResult,
} from "../types";
import {
  Copy,
  ArrowRightLeft,
  X,
  FolderOpen,
  FileAudio,
  Folder,
  FolderPlus,
  HardDrive,
  ListMusic,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { playerAdapter } from "../services/adapter";
import { SegmentedControl } from "./SegmentedControl";
import { useTransitionMount } from "../utils/useTransitionMount";

export type ImportMode = "file" | "folder" | "folder-playlist" | "playlist";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (path: string, strategy: ImportStrategy, isFolder: boolean) => Promise<void>;
  /** Import one or more folders into the library and create/update playlists. */
  onImportFoldersAsPlaylist?: (
    dirPaths: string[],
    strategy: ImportStrategy,
    combineName?: string
  ) => Promise<FolderPlaylistImportResult>;
  /** Desktop-only: build a playlist from an M3U, M3U8, or yt-dlp JSON file. */
  onImportPlaylist?: (path: string) => Promise<PlaylistImportSummary>;
  /** Opens the playlist created by the last import. */
  onOpenPlaylist?: (playlistId: string) => void;
  /** Optional initial tab when opening the modal. */
  initialMode?: ImportMode;
}

function getFolderBasename(folderPath: string): string {
  const normalized = folderPath.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || folderPath;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  onImportFoldersAsPlaylist,
  onImportPlaylist,
  onOpenPlaylist,
  initialMode = "folder",
}) => {
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [targetPath, setTargetPath] = useState("");
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [combineFolders, setCombineFolders] = useState(false);
  const [customPlaylistName, setCustomPlaylistName] = useState("");
  const [strategy, setStrategy] = useState<ImportStrategy>("Copy");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlistResult, setPlaylistResult] = useState<PlaylistImportSummary | null>(null);
  const [folderPlaylistResult, setFolderPlaylistResult] =
    useState<FolderPlaylistImportResult | null>(null);

  // Sync mode when modal opens with a specific initialMode
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
    }
  }, [isOpen, initialMode]);

  // Browser builds cannot read a chosen file from disk, so the JSON option is
  // only offered where the native shell can hand the path to the backend.
  const canImportPlaylist = Boolean(onImportPlaylist) && playerAdapter.isTauri();
  const canImportFolderPlaylist = Boolean(onImportFoldersAsPlaylist);
  const { isRendered, isExiting } = useTransitionMount(isOpen, 160);

  if (!isRendered) return null;

  const handleClose = () => {
    setTargetPath("");
    setSelectedFolders([]);
    setCombineFolders(false);
    setCustomPlaylistName("");
    setError(null);
    setPlaylistResult(null);
    setFolderPlaylistResult(null);
    onClose();
  };

  const changeMode = (next: ImportMode) => {
    setMode(next);
    setTargetPath("");
    setSelectedFolders([]);
    setCombineFolders(false);
    setCustomPlaylistName("");
    setError(null);
    setPlaylistResult(null);
    setFolderPlaylistResult(null);
  };

  const handlePick = async () => {
    setError(null);
    try {
      if (mode === "folder") {
        const picked = await playerAdapter.pickFolder();
        if (picked) {
          setTargetPath(picked);
        }
      } else if (mode === "folder-playlist") {
        const picked = await playerAdapter.pickFolders();
        if (picked.length > 0) {
          setSelectedFolders((prev) => {
            const seen = new Set(prev);
            const next = [...prev];
            for (const p of picked) {
              if (!seen.has(p)) {
                seen.add(p);
                next.push(p);
              }
            }
            return next;
          });
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

  const handleAddManualFolder = () => {
    const trimmed = targetPath.trim();
    if (!trimmed) return;
    setSelectedFolders((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setTargetPath("");
    setError(null);
  };

  const handleRemoveFolder = (folderPath: string) => {
    setSelectedFolders((prev) => prev.filter((p) => p !== folderPath));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "folder-playlist") {
      const manualTrimmed = targetPath.trim();
      const foldersToImport =
        manualTrimmed && !selectedFolders.includes(manualTrimmed)
          ? [...selectedFolders, manualTrimmed]
          : selectedFolders;

      if (foldersToImport.length === 0) {
        setError("Select at least one folder to import as a playlist.");
        return;
      }
      if (!onImportFoldersAsPlaylist) {
        setError("Folder playlist import is not available.");
        return;
      }

      const trimmedCustomName = customPlaylistName.trim();
      const effectiveCombineName =
        foldersToImport.length === 1
          ? trimmedCustomName || undefined
          : combineFolders
          ? trimmedCustomName || getFolderBasename(foldersToImport[0])
          : undefined;

      setLoading(true);
      setError(null);
      try {
        const result = await onImportFoldersAsPlaylist(
          foldersToImport,
          strategy,
          effectiveCombineName
        );
        setFolderPlaylistResult(result);
        setSelectedFolders([]);
        setTargetPath("");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || "Failed to import folder(s) as playlist.");
      } finally {
        setLoading(false);
      }
      return;
    }

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
    ...(canImportFolderPlaylist
      ? [{ value: "folder-playlist", label: "Folder Playlist", icon: FolderPlus }]
      : []),
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
            : mode === "folder-playlist"
            ? "Import one or more music folders into your library and create playlists from them."
            : "Select a folder or audio file to add to your library."}
        </p>

        {folderPlaylistResult ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-success/10 border border-success/25 space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">
                    {folderPlaylistResult.playlists.length === 1
                      ? folderPlaylistResult.playlists[0].playlist_name
                      : `${folderPlaylistResult.playlists.length} playlists ready`}
                  </p>
                  <p className="text-xs text-textSecondary mt-1">
                    {folderPlaylistResult.total_tracks_imported}{" "}
                    {folderPlaylistResult.total_tracks_imported === 1 ? "track" : "tracks"} imported
                    {folderPlaylistResult.playlists.length === 1 &&
                    folderPlaylistResult.playlists[0].already_in_playlist > 0
                      ? ` (${folderPlaylistResult.playlists[0].already_in_playlist} already in playlist)`
                      : ""}
                    .
                  </p>
                </div>
              </div>

              {folderPlaylistResult.playlists.length > 1 && (
                <ul className="space-y-2 pt-2 border-t border-white/[0.08]">
                  {folderPlaylistResult.playlists.map((pl) => (
                    <li
                      key={pl.playlist_id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-white font-medium truncate">
                        {pl.playlist_name}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-2xs text-textMuted">
                          {pl.matched_tracks}{" "}
                          {pl.matched_tracks === 1 ? "track" : "tracks"}
                        </span>
                        {onOpenPlaylist && (
                          <button
                            type="button"
                            onClick={() => {
                              onOpenPlaylist(pl.playlist_id);
                              handleClose();
                            }}
                            className="text-2xs font-semibold text-accent hover:text-accentHover transition"
                          >
                            Open
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {folderPlaylistResult.skipped_folders.length > 0 && (
              <div className="p-4 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <div className="flex items-center gap-2 text-xs font-semibold text-textSecondary">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span>
                    {folderPlaylistResult.skipped_folders.length}{" "}
                    {folderPlaylistResult.skipped_folders.length === 1
                      ? "folder had"
                      : "folders had"}{" "}
                    no supported audio files
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {folderPlaylistResult.skipped_folders.map((folder) => (
                    <li key={folder} className="text-2xs text-textMuted truncate">
                      {folder}
                    </li>
                  ))}
                </ul>
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
              {onOpenPlaylist && folderPlaylistResult.playlists.length === 1 && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenPlaylist(folderPlaylistResult.playlists[0].playlist_id);
                    handleClose();
                  }}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-accent-fill hover:bg-accentHover active:scale-95 text-white transition shadow-md shadow-accent/20"
                >
                  Open Playlist
                </button>
              )}
            </div>
          </div>
        ) : playlistResult ? (
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
              {mode === "folder-playlist" ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold text-textSecondary">
                        Selected Folder(s)
                      </label>
                      <button
                        type="button"
                        onClick={handlePick}
                        className="flex items-center gap-2 px-3 py-2 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-white rounded-lg text-xs font-medium border border-white/[0.08] transition"
                      >
                        <HardDrive className="w-3.5 h-3.5 text-accent" />
                        <span>{selectedFolders.length > 0 ? "Add Folder(s)" : "Browse Folder(s)"}</span>
                      </button>
                    </div>

                    {selectedFolders.length > 0 && (
                      <div className="space-y-2 max-h-36 overflow-y-auto pr-1 mb-3">
                        {selectedFolders.map((folderPath) => (
                          <div
                            key={folderPath}
                            title={folderPath}
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-deck border border-white/[0.08] text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Folder className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                              <span className="text-white font-medium truncate">
                                {getFolderBasename(folderPath)}
                              </span>
                              <span className="text-2xs text-textMuted truncate hidden sm:inline">
                                {folderPath}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveFolder(folderPath)}
                              aria-label={`Remove ${getFolderBasename(folderPath)}`}
                              className="text-textMuted hover:text-white p-1 rounded-full hover:bg-white/[0.08] transition flex-shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="/home/user/Music/Workout"
                        value={targetPath}
                        onChange={(e) => setTargetPath(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && targetPath.trim()) {
                            e.preventDefault();
                            handleAddManualFolder();
                          }
                        }}
                        className="flex-1 px-4 py-2 bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                      />
                      {targetPath.trim() && (
                        <button
                          type="button"
                          onClick={handleAddManualFolder}
                          className="px-4 py-2 bg-white/[0.08] hover:bg-white/[0.14] text-white rounded-xl text-xs font-medium border border-white/[0.08] transition whitespace-nowrap"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Multi-folder grouping & naming */}
                  {selectedFolders.length > 1 && (
                    <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-xl bg-deck border border-white/[0.06]">
                      <span className="text-xs text-textSecondary">
                        Combine all folders into one playlist
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={combineFolders}
                        onClick={() => setCombineFolders((v) => !v)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                          combineFolders ? "bg-accent" : "bg-white/[0.14]"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            combineFolders ? "translate-x-4.5" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  )}

                  {(selectedFolders.length === 1 || (selectedFolders.length > 1 && combineFolders)) && (
                    <div>
                      <label className="block text-xs font-semibold text-textSecondary mb-2">
                        Playlist Name{" "}
                        <span className="text-textMuted font-normal">(optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder={
                          selectedFolders[0]
                            ? getFolderBasename(selectedFolders[0])
                            : "Playlist name"
                        }
                        value={customPlaylistName}
                        onChange={(e) => setCustomPlaylistName(e.target.value)}
                        className="w-full px-4 py-2 bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                      />
                    </div>
                  )}
                </div>
              ) : (
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
              )}

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
                        Copies{" "}
                        {mode === "folder" || mode === "folder-playlist"
                          ? "all tracks"
                          : "the file"}{" "}
                        into your library folder. Source files stay where they are.
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
                        Moves{" "}
                        {mode === "folder" || mode === "folder-playlist"
                          ? "all tracks"
                          : "the file"}{" "}
                        into your library folder and removes them from the source location.
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
                    ? mode === "folder" || mode === "folder-playlist"
                      ? "Scanning and importing..."
                      : mode === "playlist"
                      ? "Matching tracks..."
                      : "Importing track..."
                    : mode === "folder"
                    ? "Import Folder"
                    : mode === "folder-playlist"
                    ? "Import as Playlist"
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

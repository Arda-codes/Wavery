import React, { useState, useEffect, useRef } from "react";
import { Track } from "../types";
import { Trash2, X, AlertTriangle, Music } from "lucide-react";
import { formatDuration } from "../utils/library";

interface DeleteTrackModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  onConfirm: (trackId: string, removeFile: boolean) => Promise<void>;
}

export const DeleteTrackModal: React.FC<DeleteTrackModalProps> = ({
  isOpen,
  onClose,
  track,
  onConfirm,
}) => {
  const [deleteFromDisk, setDeleteFromDisk] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setDeleteFromDisk(false);
      setIsDeleting(false);
      setErrorMessage(null);
      // Default focus on the safe Cancel button
      setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keyboard accessibility: Escape to cancel
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isDeleting) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen || !track) return null;

  const title = track.metadata.title || "Untitled Track";
  const artist = track.metadata.artist || "Unknown Artist";
  const album = track.metadata.album || "Unknown Album";
  const durationSecs = track.metadata.duration?.secs || 0;
  const durationFormatted = formatDuration(durationSecs);
  const audioFormat = track.metadata.format ? track.metadata.format.toUpperCase() : "AUDIO";

  const handleConfirm = async () => {
    if (isDeleting) return;
    try {
      setIsDeleting(true);
      setErrorMessage(null);
      await onConfirm(track.id, deleteFromDisk);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || "Failed to delete track");
      setIsDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-track-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onClose();
        }
      }}
    >
      <div className="bg-surface border border-white/[0.12] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl shadow-black/80 animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-danger/15 border border-danger/30 flex items-center justify-center text-danger shadow-md shadow-danger/10">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h2 id="delete-track-title" className="text-sm font-bold text-white">
                Delete Song
              </h2>
              <p className="text-2xs text-textMuted">
                Remove from library or delete permanently
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close dialog"
            className="text-textMuted hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Track Details Card */}
          <div className="bg-surfaceHover border border-white/[0.08] rounded-xl p-3 flex items-center space-x-4">
            <div className="w-11 h-11 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 text-textSecondary">
              <Music className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-bold text-white truncate">{title}</h3>
              <p className="text-2xs text-textSecondary truncate">{artist}</p>
              <div className="flex items-center space-x-2 mt-1 text-2xs text-textMuted">
                <span className="truncate">{album}</span>
                <span>•</span>
                <span className="font-mono">{durationFormatted}</span>
                <span>•</span>
                <span className="px-2 py-1 bg-white/[0.06] rounded text-2xs font-semibold text-textSecondary">
                  {audioFormat}
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs text-textSecondary leading-relaxed">
            Are you sure you want to delete <strong className="text-white font-semibold">"{title}"</strong> from your library?
          </p>

          {/* Delete File from Disk Option */}
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4 space-y-3">
            <label className="flex items-start space-x-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteFromDisk}
                onChange={(e) => setDeleteFromDisk(e.target.checked)}
                disabled={isDeleting}
                className="mt-1 rounded bg-surfaceHover border-white/[0.2] text-danger focus:ring-danger/40 focus:ring-offset-0 transition cursor-pointer"
              />
              <div className="flex-1 text-xs">
                <span className="font-semibold text-white block">
                  Also delete audio file from computer
                </span>
                <span className="text-2xs text-textMuted block mt-1">
                  Permanently deletes the file from your local storage drive.
                </span>
              </div>
            </label>

            {/* Warning Banner when Delete From Disk is active */}
            {deleteFromDisk && (
              <div className="bg-danger/10 border border-danger/25 rounded-lg p-3 flex items-start space-x-2 text-danger text-2xs animate-fadeIn">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-danger mt-1" />
                <span className="leading-snug">
                  <strong>Warning:</strong> This cannot be undone. The audio file will be permanently removed from disk.
                </span>
              </div>
            )}
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="bg-danger/15 border border-danger/30 rounded-xl p-3 text-danger text-xs flex items-center space-x-2 animate-shake">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.10] active:scale-[0.98] text-textSecondary hover:text-white rounded-xl text-xs font-semibold transition disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isDeleting}
              className="flex items-center space-x-2 px-4 py-2 bg-danger hover:bg-danger active:scale-[0.98] disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-danger/25 transition"
            >
              {isDeleting ? (
                <span>Deleting...</span>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deleteFromDisk ? "Delete File & Track" : "Delete Track"}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

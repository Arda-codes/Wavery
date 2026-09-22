import React, { useState, useEffect } from "react";
import { ArtistInfo, Track } from "../types";
import { playerAdapter } from "../services/adapter";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { useArtwork } from "../utils/useArtwork";
import { X, Save, User, Check, AlertCircle, Loader2, Music, Disc } from "lucide-react";

interface ArtistMetadataModalProps {
  artist: ArtistInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (updatedTracks: Track[]) => void;
}

export const ArtistMetadataModal: React.FC<ArtistMetadataModalProps> = ({
  artist,
  isOpen,
  onClose,
  onSaved,
}) => {
  const setTracks = useLibraryStore((s) => s.setTracks);
  const artworkUrl = useArtwork(artist?.artworkTrackId);

  const [newName, setNewName] = useState("");
  const [updateAlbumArtist, setUpdateAlbumArtist] = useState(true);
  const [writeTags, setWriteTags] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (artist) {
      setNewName(artist.name || "");
      setUpdateAlbumArtist(true);
      setWriteTags(true);
      setErrorMessage(null);
      setSuccess(false);
    }
  }, [artist, isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artist) return;

    const trimmedNewName = newName.trim();
    if (!trimmedNewName) {
      setErrorMessage("Artist name cannot be empty");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        original_name: artist.name,
        new_name: trimmedNewName,
        update_album_artist: updateAlbumArtist,
        write_tags: writeTags,
      };

      const updatedTracks = await playerAdapter.updateArtistMetadata(payload);

      // Merge updated tracks into Zustand library store
      const allCurrentTracks = useLibraryStore.getState().tracks;
      const updatedMap = new Map<string, Track>();
      for (const t of updatedTracks) {
        updatedMap.set(t.id, t);
      }
      const newAllTracks = allCurrentTracks.map((t) => updatedMap.get(t.id) || t);
      setTracks(newAllTracks);

      // Update player store queue & currentTrack if affected
      const { currentTrack, queue } = usePlayerStore.getState();
      if (currentTrack && updatedMap.has(currentTrack.id)) {
        usePlayerStore.setState({ currentTrack: updatedMap.get(currentTrack.id) });
      }
      if (queue.some((t) => updatedMap.has(t.id))) {
        usePlayerStore.setState({
          queue: queue.map((t) => updatedMap.get(t.id) || t),
        });
      }

      setSuccess(true);
      if (onSaved) {
        onSaved(updatedTracks);
      }

      setTimeout(() => {
        onClose();
      }, 400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || "Failed to update artist metadata");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !artist) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="bg-[#18181D] border border-white/[0.08] w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-full bg-[#1C1C22] overflow-hidden flex items-center justify-center flex-shrink-0 border border-white/[0.08]">
              {artworkUrl ? (
                <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-5 h-5 text-[#71717A]" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Edit Artist Metadata</h2>
              <p className="text-xs text-[#71717A] truncate max-w-xs sm:max-w-sm">
                Rename &ldquo;{artist.name}&rdquo; across library
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-[#71717A] hover:text-white flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            {errorMessage && (
              <div className="flex items-center space-x-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Scope Summary Badge */}
            <div className="flex items-center space-x-3 p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
              <div className="flex items-center space-x-1.5 text-xs text-[#A1A1AA]">
                <Music className="w-3.5 h-3.5 text-[#FA586A]" />
                <span className="font-semibold text-white">{artist.trackCount}</span>
                <span>tracks</span>
              </div>
              <span className="text-white/[0.2]">•</span>
              <div className="flex items-center space-x-1.5 text-xs text-[#A1A1AA]">
                <Disc className="w-3.5 h-3.5 text-[#FA586A]" />
                <span className="font-semibold text-white">{artist.albumCount}</span>
                <span>albums</span>
              </div>
            </div>

            {/* Original Name */}
            <div>
              <label className="block text-xs font-semibold text-[#71717A] mb-1.5">
                Current Artist Name
              </label>
              <input
                type="text"
                value={artist.name}
                disabled
                className="w-full bg-[#121216]/60 border border-white/[0.04] rounded-xl px-3 py-2 text-xs text-[#71717A] cursor-not-allowed select-none"
              />
            </div>

            {/* New Name */}
            <div>
              <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                New Artist Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter new artist name"
                required
                autoFocus
                className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
              />
            </div>

            {/* Scope Checkboxes */}
            <div className="space-y-3 pt-1">
              <label className="flex items-start space-x-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={updateAlbumArtist}
                  onChange={(e) => setUpdateAlbumArtist(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded bg-[#121216] border-white/[0.12] text-[#FA586A] focus:ring-0 cursor-pointer accent-[#FA586A]"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-white">
                    Update Album Artist tags
                  </span>
                  <span className="text-[11px] text-[#71717A] leading-relaxed">
                    Also rename Album Artist tags matching &ldquo;{artist.name}&rdquo; across albums
                  </span>
                </div>
              </label>

              <label className="flex items-start space-x-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={writeTags}
                  onChange={(e) => setWriteTags(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded bg-[#121216] border-white/[0.12] text-[#FA586A] focus:ring-0 cursor-pointer accent-[#FA586A]"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-white">
                    Write tags directly to audio files
                  </span>
                  <span className="text-[11px] text-[#71717A] leading-relaxed">
                    Saves the new artist name into physical audio tags on disk
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-4 sm:px-6 py-4 border-t border-white/[0.06] bg-[#141418] flex items-center justify-end space-x-2.5 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl text-xs font-medium text-[#A1A1AA] hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center justify-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#FA586A] hover:bg-[#fa586a]/90 active:scale-98 transition shadow-lg shadow-[#FA586A]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Updating tracks...</span>
                </>
              ) : success ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Rename Artist</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

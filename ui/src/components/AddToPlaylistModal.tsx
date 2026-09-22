import React, { useState } from "react";
import { Playlist, Track } from "../types";
import { ListMusic, Plus, X, Check } from "lucide-react";

interface AddToPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  playlists: Playlist[];
  onAddToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  onCreateAndAdd: (name: string, trackId: string) => Promise<void>;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  isOpen,
  onClose,
  track,
  playlists,
  onAddToPlaylist,
  onCreateAndAdd,
}) => {
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [addedPlaylistIds, setAddedPlaylistIds] = useState<Set<string>>(new Set());

  if (!isOpen || !track) return null;

  const handleAdd = async (playlistId: string) => {
    try {
      await onAddToPlaylist(playlistId, track.id);
      setAddedPlaylistIds((prev) => new Set(prev).add(playlistId));
      setTimeout(() => {
        onClose();
        setAddedPlaylistIds(new Set());
      }, 500);
    } catch (err) {
      console.error("Failed to add track to playlist:", err);
    }
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;

    try {
      setIsCreating(true);
      await onCreateAndAdd(newPlaylistName.trim(), track.id);
      setNewPlaylistName("");
      onClose();
    } catch (err) {
      console.error("Failed to create playlist and add track:", err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-surface border border-white/[0.12] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center text-white shadow-sm flex-shrink-0">
              <ListMusic className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">Add to Playlist</h2>
              <p className="text-[11px] text-[#71717A] truncate font-medium">
                {track.metadata.title || "Untitled Track"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#71717A] hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Existing Playlists List */}
        <div className="p-4 max-h-60 overflow-y-auto space-y-1">
          {playlists.length === 0 ? (
            <p className="text-xs text-[#71717A] text-center py-4">
              No playlists found. Create one below to add this track.
            </p>
          ) : (
            playlists.map((pl) => {
              const alreadyContains = pl.track_ids.includes(track.id);
              const justAdded = addedPlaylistIds.has(pl.id);

              return (
                <button
                  key={pl.id}
                  onClick={() => handleAdd(pl.id)}
                  disabled={alreadyContains || justAdded}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium hover:bg-white/[0.06] disabled:opacity-50 transition text-left group"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <ListMusic className="w-4 h-4 text-[#71717A] group-hover:text-[#FA586A] transition-colors" />
                    <span className="text-white font-semibold truncate">{pl.name}</span>
                  </div>

                  {justAdded ? (
                    <span className="text-[11px] text-green-400 font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Added
                    </span>
                  ) : alreadyContains ? (
                    <span className="text-[11px] text-[#71717A]">Already in playlist</span>
                  ) : (
                    <span className="text-[11px] text-[#71717A] font-mono">
                      {pl.track_ids.length} tracks
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Create New Playlist & Add */}
        <div className="p-4 border-t border-white/[0.08] bg-white/[0.02]">
          <form onSubmit={handleCreateNew} className="flex items-center space-x-2">
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist name..."
              className="flex-1 bg-[#202028] border border-white/[0.10] focus:border-[#FA586A] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
            />
            <button
              type="submit"
              disabled={!newPlaylistName.trim() || isCreating}
              className="flex items-center space-x-1 px-3.5 py-2 bg-[#FA586A] hover:bg-[#E04859] disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-[#FA586A]/20 transition flex-shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create & Add</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

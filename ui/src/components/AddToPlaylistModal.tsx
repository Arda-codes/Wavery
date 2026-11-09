import React, { useState, useRef } from "react";
import { Playlist, Track } from "../types";
import { ListMusic, Plus, X, Check } from "lucide-react";
import { useTransitionMount } from "../utils/useTransitionMount";

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

  const { isRendered, isExiting } = useTransitionMount(isOpen && !!track, 160);
  const lastTrackRef = useRef(track);
  if (track) {
    lastTrackRef.current = track;
  }
  const displayTrack = track || lastTrackRef.current;

  if (!isRendered || !displayTrack) return null;

  const handleAdd = async (playlistId: string) => {
    try {
      await onAddToPlaylist(playlistId, displayTrack.id);
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
      await onCreateAndAdd(newPlaylistName.trim(), displayTrack.id);
      setNewPlaylistName("");
      onClose();
    } catch (err) {
      console.error("Failed to create playlist and add track:", err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 ${
        isExiting ? "animate-backdrop-out" : "animate-backdrop-in"
      }`}
    >
      <div
        className={`bg-surface border border-white/[0.12] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl ${
          isExiting ? "animate-scale-down pointer-events-none" : "animate-scale-up"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center space-x-3 min-w-0">
            <ListMusic className="w-5 h-5 text-accent flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">Add to Playlist</h2>
              <p className="text-2xs text-textMuted truncate font-medium">
                {displayTrack.metadata.title || "Untitled Track"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-textMuted hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Existing Playlists List */}
        <div className="p-4 max-h-60 overflow-y-auto space-y-1">
          {playlists.length === 0 ? (
            <p className="text-xs text-textMuted text-center py-4">
              You haven't created any playlists yet. Enter a name below to create one and add this track.
            </p>
          ) : (
            playlists.map((pl) => {
              const alreadyContains = pl.track_ids.includes(displayTrack.id);
              const justAdded = addedPlaylistIds.has(pl.id);

              return (
                <button
                  key={pl.id}
                  onClick={() => handleAdd(pl.id)}
                  disabled={alreadyContains || justAdded}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-medium hover:bg-white/[0.06] disabled:opacity-50 transition text-left group"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <ListMusic className="w-4 h-4 text-textMuted group-hover:text-accent transition-colors" />
                    <span className="text-white font-semibold truncate">{pl.name}</span>
                  </div>

                  {justAdded ? (
                    <span className="text-2xs text-success font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Added
                    </span>
                  ) : alreadyContains ? (
                    <span className="text-2xs text-textMuted">Already in playlist</span>
                  ) : (
                    <span className="text-2xs text-textMuted font-mono">
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
              className="flex-1 bg-surfaceHover border border-white/[0.10] focus:border-accent rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
            />
            <button
              type="submit"
              disabled={!newPlaylistName.trim() || isCreating}
              className="flex items-center space-x-1 px-4 py-2 bg-accent-fill hover:bg-accentHover disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-accent/20 transition flex-shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isCreating ? "Adding..." : "Create & Add Track"}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

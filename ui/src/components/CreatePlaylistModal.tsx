import React, { useState } from "react";
import { Plus, X, ListMusic } from "lucide-react";

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Playlist name is required. Please enter a title.");
      return;
    }
    if (isSubmitting) return;

    setError(null);
    try {
      setIsSubmitting(true);
      await onCreate(name.trim());
      setName("");
      setError(null);
      onClose();
    } catch (err) {
      console.error("Failed to create playlist:", err);
      setError("Failed to create playlist. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-surface border border-white/[0.12] rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center text-white shadow-md shadow-accent/20">
              <ListMusic className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-white">New Playlist</h2>
          </div>
          <button
            onClick={() => {
              setError(null);
              onClose();
            }}
            className="text-[#71717A] hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider mb-2">
              Playlist Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Chill Synthwave, Road Trip..."
              autoFocus
              className="w-full bg-[#202028] border border-white/[0.10] focus:border-accent rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-2 focus:ring-accent/30 transition"
            />
            {error && (
              <p className="text-[11px] text-[#FF453A] mt-1.5 font-medium animate-fadeIn">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end space-x-2.5 pt-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                onClose();
              }}
              className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.10] text-[#A1A1AA] hover:text-white rounded-xl text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center space-x-1.5 px-4 py-2 bg-accent hover:brightness-110 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow-md shadow-accent/20 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

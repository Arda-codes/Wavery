import React, { useState, useEffect } from "react";
import { Track } from "../types";
import { playerAdapter } from "../services/adapter";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { useArtwork } from "../utils/useArtwork";
import { X, Save, Music, Check, AlertCircle, Loader2, FileText } from "lucide-react";

interface SongMetadataModalProps {
  track: Track | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (updatedTrack: Track) => void;
}

export const SongMetadataModal: React.FC<SongMetadataModalProps> = ({
  track,
  isOpen,
  onClose,
  onSaved,
}) => {
  const setTracks = useLibraryStore((s) => s.setTracks);
  const artworkUrl = useArtwork(track?.id);

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [albumArtist, setAlbumArtist] = useState("");
  const [trackNumber, setTrackNumber] = useState("");
  const [discNumber, setDiscNumber] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [writeTags, setWriteTags] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (track) {
      setTitle(track.metadata.title || "");
      setArtist(track.metadata.artist || "");
      setAlbum(track.metadata.album || "");
      setAlbumArtist(track.metadata.album_artist || "");
      setTrackNumber(track.metadata.track_number !== undefined ? track.metadata.track_number.toString() : "");
      setDiscNumber(track.metadata.disc_number !== undefined ? track.metadata.disc_number.toString() : "");
      setYear(track.metadata.year !== undefined ? track.metadata.year.toString() : "");
      setGenre(track.metadata.genre || "");
      setLyrics(track.metadata.lyrics || "");
      setWriteTags(true);
      setErrorMessage(null);
      setSuccess(false);
    }
  }, [track, isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!track) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const parsedYear = year.trim() ? parseInt(year.trim(), 10) : undefined;
      const parsedTrackNum = trackNumber.trim() ? parseInt(trackNumber.trim(), 10) : undefined;
      const parsedDiscNum = discNumber.trim() ? parseInt(discNumber.trim(), 10) : undefined;

      const payload = {
        track_id: track.id,
        title: title.trim() || undefined,
        artist: artist.trim() || undefined,
        album: album.trim() || undefined,
        album_artist: albumArtist.trim() || undefined,
        track_number: isNaN(Number(parsedTrackNum)) ? undefined : parsedTrackNum,
        disc_number: isNaN(Number(parsedDiscNum)) ? undefined : parsedDiscNum,
        year: isNaN(Number(parsedYear)) ? undefined : parsedYear,
        genre: genre.trim() || undefined,
        lyrics: lyrics, // Empty string will be mapped to None in backend
        write_tags: writeTags,
      };

      const updatedTrack = await playerAdapter.updateTrackMetadata(payload);

      // Merge updated track into Zustand library store
      const allCurrentTracks = useLibraryStore.getState().tracks;
      const newAllTracks = allCurrentTracks.map((t) => (t.id === updatedTrack.id ? updatedTrack : t));
      setTracks(newAllTracks);

      // Also update player store if currently playing or queued
      const { currentTrack, queue } = usePlayerStore.getState();
      if (currentTrack && currentTrack.id === updatedTrack.id) {
        usePlayerStore.setState({ currentTrack: updatedTrack });
      }
      if (queue.some((t) => t.id === updatedTrack.id)) {
        usePlayerStore.setState({
          queue: queue.map((t) => (t.id === updatedTrack.id ? updatedTrack : t)),
        });
      }

      setSuccess(true);
      if (onSaved) {
        onSaved(updatedTrack);
      }

      setTimeout(() => {
        onClose();
      }, 400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || "Failed to update song metadata");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !track) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="bg-[#18181D] border border-white/[0.08] w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#1C1C22] overflow-hidden flex items-center justify-center flex-shrink-0 border border-white/[0.08]">
              {artworkUrl ? (
                <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <Music className="w-5 h-5 text-[#71717A]" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Edit Song Metadata</h2>
              <p className="text-xs text-[#71717A] truncate max-w-xs sm:max-w-sm">
                {track.metadata.title || "Untitled Track"} — {track.metadata.artist || "Unknown Artist"}
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
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {errorMessage && (
              <div className="flex items-center space-x-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Title & Artist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Track Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Paranoid Android"
                  required
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Artist
                </label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="e.g. Radiohead"
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>
            </div>

            {/* Album & Album Artist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Album
                </label>
                <input
                  type="text"
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  placeholder="e.g. OK Computer"
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Album Artist
                </label>
                <input
                  type="text"
                  value={albumArtist}
                  onChange={(e) => setAlbumArtist(e.target.value)}
                  placeholder="e.g. Radiohead"
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>
            </div>

            {/* Track #, Disc #, Year, Genre */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Track #
                </label>
                <input
                  type="number"
                  value={trackNumber}
                  onChange={(e) => setTrackNumber(e.target.value)}
                  placeholder="1"
                  min="0"
                  max="999"
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Disc #
                </label>
                <input
                  type="number"
                  value={discNumber}
                  onChange={(e) => setDiscNumber(e.target.value)}
                  placeholder="1"
                  min="0"
                  max="99"
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Year
                </label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="1997"
                  min="1900"
                  max="2099"
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Genre
                </label>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="Rock"
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>
            </div>

            {/* Lyrics Section */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="flex items-center space-x-1.5 text-xs font-semibold text-[#A1A1AA]">
                  <FileText className="w-3.5 h-3.5 text-[#FA586A]" />
                  <span>Lyrics (LRC or Plain Text)</span>
                </label>
                {lyrics.trim() && (
                  <button
                    type="button"
                    onClick={() => setLyrics("")}
                    className="text-[11px] text-[#71717A] hover:text-red-400 transition"
                  >
                    Clear lyrics
                  </button>
                )}
              </div>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={5}
                placeholder="[00:12.34] Synchronized lyrics line...&#10;Or plain text lyrics without timestamps"
                className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl p-3 text-xs text-white font-mono placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition resize-y leading-relaxed"
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-4 sm:px-6 py-4 border-t border-white/[0.06] bg-[#141418] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 flex-shrink-0">
            <label className="flex items-center space-x-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={writeTags}
                onChange={(e) => setWriteTags(e.target.checked)}
                className="w-4 h-4 rounded bg-[#121216] border-white/[0.12] text-[#FA586A] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#FA586A]"
              />
              <span className="text-xs text-[#A1A1AA] hover:text-white transition">
                Write tags directly to audio file
              </span>
            </label>

            <div className="flex items-center space-x-2.5 justify-end">
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
                    <span>Saving...</span>
                  </>
                ) : success ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-white" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

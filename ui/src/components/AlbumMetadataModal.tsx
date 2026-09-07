import React, { useState, useEffect, useCallback } from "react";
import { AlbumInfo, Track } from "../types";
import { playerAdapter } from "../services/adapter";
import { useLibraryStore } from "../stores/libraryStore";
import { useArtwork } from "../utils/useArtwork";
import { X, Save, Disc, Check, AlertCircle, Loader2 } from "lucide-react";

export interface AlbumMetadataModalProps {
  album: AlbumInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (updatedTracks: Track[]) => void;
}

interface EditableTrackRow {
  id: string;
  title: string;
  artist: string;
  trackNumber: number;
  discNumber: number;
}

export const AlbumMetadataModal: React.FC<AlbumMetadataModalProps> = ({
  album,
  isOpen,
  onClose,
  onSaved,
}) => {
  const setTracks = useLibraryStore((s) => s.setTracks);
  const artworkUrl = useArtwork(album?.artworkTrackId);

  const [albumTitle, setAlbumTitle] = useState("");
  const [albumArtist, setAlbumArtist] = useState("");
  const [year, setYear] = useState<string>("");
  const [genre, setGenre] = useState("");
  const [writeTags, setWriteTags] = useState(true);
  const [trackRows, setTrackRows] = useState<EditableTrackRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (album) {
      setAlbumTitle(album.title || "");
      setAlbumArtist(album.albumArtist || album.artist || "");
      setYear(album.year ? album.year.toString() : "");
      setGenre(album.tracks[0]?.metadata.genre || "");
      setErrorMessage(null);
      setSuccess(false);

      const rows: EditableTrackRow[] = album.tracks.map((t, idx) => ({
        id: t.id,
        title: t.metadata.title || `Track ${idx + 1}`,
        artist: t.metadata.artist || album.artist || "",
        trackNumber: t.metadata.track_number || idx + 1,
        discNumber: t.metadata.disc_number || 1,
      }));
      setTrackRows(rows);
    }
  }, [album, isOpen]);

  const handleTrackChange = useCallback(
    (index: number, field: keyof EditableTrackRow, value: string | number) => {
      setTrackRows((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    []
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!album) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const parsedYear = year.trim() ? parseInt(year.trim(), 10) : undefined;
      const payload = {
        album: albumTitle.trim() || undefined,
        album_artist: albumArtist.trim() || undefined,
        year: isNaN(Number(parsedYear)) ? undefined : parsedYear,
        genre: genre.trim() || undefined,
        write_tags: writeTags,
        tracks: trackRows.map((r) => ({
          track_id: r.id,
          title: r.title.trim() || undefined,
          artist: r.artist.trim() || undefined,
          track_number: r.trackNumber,
          disc_number: r.discNumber,
        })),
      };

      const updatedTracks = await playerAdapter.updateAlbumMetadata(payload);

      // Merge updated tracks into Zustand library store
      const allCurrentTracks = useLibraryStore.getState().tracks;
      const updatedMap = new Map<string, Track>();
      for (const t of updatedTracks) {
        updatedMap.set(t.id, t);
      }
      const newAllTracks = allCurrentTracks.map((t) => updatedMap.get(t.id) || t);
      setTracks(newAllTracks);

      setSuccess(true);
      if (onSaved) {
        onSaved(updatedTracks);
      }

      setTimeout(() => {
        onClose();
      }, 400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || "Failed to update album metadata");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !album) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="bg-[#18181D] border border-white/[0.08] w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#1C1C22] overflow-hidden flex items-center justify-center flex-shrink-0 border border-white/[0.08]">
              {artworkUrl ? (
                <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <Disc className="w-5 h-5 text-[#71717A]" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Edit Album Metadata</h2>
              <p className="text-xs text-[#71717A] truncate max-w-sm">{album.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-[#71717A] hover:text-white flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {errorMessage && (
              <div className="flex items-center space-x-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Album-level Common Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Album Title
                </label>
                <input
                  type="text"
                  value={albumTitle}
                  onChange={(e) => setAlbumTitle(e.target.value)}
                  placeholder="Album Title"
                  required
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Album Artist (Band Name)
                </label>
                <input
                  type="text"
                  value={albumArtist}
                  onChange={(e) => setAlbumArtist(e.target.value)}
                  placeholder="e.g. Radiohead, Muse"
                  required
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#A1A1AA] mb-1.5">
                  Release Year
                </label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g. 2007"
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
                  placeholder="e.g. Alternative Rock"
                  className="w-full bg-[#121216] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
                />
              </div>
            </div>

            {/* Tracklist Editor Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Album Tracks ({trackRows.length})
                </h3>
                <span className="text-[11px] text-[#71717A]">
                  Edit song titles and artists
                </span>
              </div>

              <div className="border border-white/[0.08] rounded-xl overflow-hidden bg-[#121216]/60">
                <div className="max-h-56 overflow-y-auto divide-y divide-white/[0.04]">
                  {trackRows.map((row, idx) => (
                    <div
                      key={row.id}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center px-3 py-2 gap-2 text-xs hover:bg-white/[0.04] transition"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="w-6 text-center text-[#71717A] text-[11px] font-mono flex-shrink-0">
                          {row.trackNumber}
                        </span>
                        <input
                          type="text"
                          value={row.title}
                          onChange={(e) => handleTrackChange(idx, "title", e.target.value)}
                          placeholder="Track Title"
                          className="flex-1 bg-[#18181D] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <input
                        type="text"
                        value={row.artist}
                        onChange={(e) => handleTrackChange(idx, "artist", e.target.value)}
                        placeholder="Track Artist"
                        className="w-full sm:w-1/3 sm:min-w-[120px] bg-[#18181D] border border-white/[0.08] focus:border-[#FA586A]/60 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Options: Save Tags to Disk */}
            <div className="flex items-center space-x-2 pt-2 border-t border-white/[0.06]">
              <input
                type="checkbox"
                id="writeTagsCheckbox"
                checked={writeTags}
                onChange={(e) => setWriteTags(e.target.checked)}
                className="w-4 h-4 rounded text-[#FA586A] bg-[#121216] border-white/[0.12] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#FA586A]"
              />
              <label
                htmlFor="writeTagsCheckbox"
                className="text-xs text-white cursor-pointer select-none font-medium"
              >
                Save tag changes to audio files on disk (ID3, Vorbis, FLAC)
              </label>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end space-x-3 px-4 sm:px-6 py-4 border-t border-white/[0.06] bg-[#121216] flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold text-[#71717A] hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center space-x-2 px-5 py-2 bg-[#FA586A] hover:bg-[#E04859] active:scale-95 text-white rounded-xl text-xs font-bold transition shadow-md shadow-[#FA586A]/20 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : success ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-300" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

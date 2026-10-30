import React, { useState, useEffect } from "react";
import { Track } from "../types";
import { playerAdapter } from "../services/adapter";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { useArtwork } from "../utils/useArtwork";
import { X, Save, Music, Check, AlertCircle, Loader2, FileText, Sparkles, Mic2 } from "lucide-react";
import { searchAppleMusicTrack } from "../services/appleMusic";
import { fetchLyrics } from "../services/lyrics";

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

  const [isFetchingAppleMusic, setIsFetchingAppleMusic] = useState(false);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [onlineNotice, setOnlineNotice] = useState<string | null>(null);

  const handleAutoFillAppleMusic = async () => {
    if (!track) return;
    setIsFetchingAppleMusic(true);
    setOnlineNotice(null);
    setErrorMessage(null);

    try {
      const match = await searchAppleMusicTrack(
        title || track.metadata.title || "",
        artist || track.metadata.artist || "",
        album || track.metadata.album || ""
      );

      if (match) {
        if (match.title) setTitle(match.title);
        if (match.artist) setArtist(match.artist);
        if (match.album) setAlbum(match.album);
        if (match.albumArtist) setAlbumArtist(match.albumArtist);
        if (match.year) setYear(match.year.toString());
        if (match.genre) setGenre(match.genre);
        if (match.trackNumber) setTrackNumber(match.trackNumber.toString());
        if (match.discNumber) setDiscNumber(match.discNumber.toString());
        setOnlineNotice("Matched & auto-filled from Apple Music!");
      } else {
        setErrorMessage("No matching track found on Apple Music");
      }
    } catch {
      setErrorMessage("Failed to query Apple Music");
    } finally {
      setIsFetchingAppleMusic(false);
    }
  };

  const handleFetchLyrics = async () => {
    if (!track) return;
    setIsFetchingLyrics(true);
    setOnlineNotice(null);
    setErrorMessage(null);

    try {
      const lyricsRes = await fetchLyrics(
        artist || track.metadata.artist || "",
        title || track.metadata.title || "",
        album || track.metadata.album || "",
        track.metadata.duration.secs
      );

      if (lyricsRes?.bestLyrics) {
        setLyrics(lyricsRes.bestLyrics);
        setOnlineNotice(
          lyricsRes.syncedLyrics
            ? "Fetched time-synced lyrics from LRCLIB!"
            : "Fetched plain text lyrics from LRCLIB!"
        );
      } else {
        setErrorMessage("No lyrics found on LRCLIB for this track");
      }
    } catch {
      setErrorMessage("Failed to query LRCLIB");
    } finally {
      setIsFetchingLyrics(false);
    }
  };

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
        className="bg-surface border border-white/[0.08] w-full max-w-xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 rounded-xl bg-surfaceHover overflow-hidden flex items-center justify-center flex-shrink-0 border border-white/[0.08]">
              {artworkUrl ? (
                <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <Music className="w-5 h-5 text-textMuted" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Edit Song Metadata</h2>
              <p className="text-xs text-textMuted truncate max-w-xs sm:max-w-sm">
                {track.metadata.title || "Untitled Track"} — {track.metadata.artist || "Unknown Artist"}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleAutoFillAppleMusic}
              disabled={isFetchingAppleMusic}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-xs font-semibold text-white bg-accent/15 hover:bg-accent/25 border border-accent/30 hover:border-accent/50 active:scale-95 transition disabled:opacity-50"
              title="Query Apple Music / iTunes to auto-fill title, artist, album, genre, year, and track #"
            >
              {isFetchingAppleMusic ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <span>Auto-Fill Apple Music</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-textMuted hover:text-white flex items-center justify-center transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {onlineNotice && (
              <div className="flex items-center space-x-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs animate-fade-in">
                <Check className="w-4 h-4 flex-shrink-0" />
                <span>{onlineNotice}</span>
              </div>
            )}
            {errorMessage && (
              <div className="flex items-center space-x-2 p-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Title & Artist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  Track Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Paranoid Android"
                  required
                  className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  Artist
                </label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="e.g. Radiohead"
                  className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>
            </div>

            {/* Album & Album Artist */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  Album
                </label>
                <input
                  type="text"
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  placeholder="e.g. OK Computer"
                  className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  Album Artist
                </label>
                <input
                  type="text"
                  value={albumArtist}
                  onChange={(e) => setAlbumArtist(e.target.value)}
                  placeholder="e.g. Radiohead"
                  className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>
            </div>

            {/* Track #, Disc #, Year, Genre */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  Track #
                </label>
                <input
                  type="number"
                  value={trackNumber}
                  onChange={(e) => setTrackNumber(e.target.value)}
                  placeholder="1"
                  min="0"
                  max="999"
                  className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  Disc #
                </label>
                <input
                  type="number"
                  value={discNumber}
                  onChange={(e) => setDiscNumber(e.target.value)}
                  placeholder="1"
                  min="0"
                  max="99"
                  className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  Year
                </label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="1997"
                  min="1900"
                  max="2099"
                  className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-textSecondary mb-2">
                  Genre
                </label>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="Rock"
                  className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl px-3 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                />
              </div>
            </div>

            {/* Lyrics Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center space-x-2 text-xs font-semibold text-textSecondary">
                  <FileText className="w-3.5 h-3.5 text-accent" />
                  <span>Lyrics (LRC or Plain Text)</span>
                </label>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={handleFetchLyrics}
                    disabled={isFetchingLyrics}
                    className="inline-flex items-center gap-1 text-2xs font-semibold text-accent hover:text-white bg-accent/10 hover:bg-accent/20 px-3 py-1 rounded-lg transition disabled:opacity-50"
                    title="Fetch synced or plain lyrics from LRCLIB"
                  >
                    {isFetchingLyrics ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Fetching...</span>
                      </>
                    ) : (
                      <>
                        <Mic2 className="w-3 h-3" />
                        <span>Fetch from LRCLIB</span>
                      </>
                    )}
                  </button>
                  {lyrics.trim() && (
                    <button
                      type="button"
                      onClick={() => setLyrics("")}
                      className="text-2xs text-textMuted hover:text-danger transition"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={5}
                placeholder="[00:12.34] Synchronized lyrics line...&#10;Or plain text lyrics without timestamps"
                className="w-full bg-deck border border-white/[0.08] focus:border-accent/60 rounded-xl p-3 text-xs text-white font-mono placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition resize-y leading-relaxed"
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-4 sm:px-6 py-4 border-t border-white/[0.06] bg-surfaceHover flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 flex-shrink-0">
            <label className="flex items-center space-x-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={writeTags}
                onChange={(e) => setWriteTags(e.target.checked)}
                className="w-4 h-4 rounded bg-deck border-white/[0.12] text-accent focus:ring-0 focus:ring-offset-0 cursor-pointer accent-accent"
              />
              <span className="text-xs text-textSecondary hover:text-white transition">
                Write tags directly to audio file
              </span>
            </label>

            <div className="flex items-center space-x-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl text-xs font-medium text-textSecondary hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center justify-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-accent-fill hover:bg-accent/90 active:scale-98 transition shadow-lg shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
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

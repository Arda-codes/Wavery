import React, { useState, useMemo, useCallback } from "react";
import { Playlist, Track, PlaybackContext } from "../types";
import { TrackTable } from "./TrackTable";
import { usePlayerStore } from "../stores/playerStore";
import { ListMusic, Play, Shuffle, Edit2, Trash2, Check, X } from "lucide-react";
import { formatTotalDuration } from "../utils/library";
import { EqualizerWave } from "./EqualizerWave";

interface PlaylistDetailProps {
  playlist: Playlist;
  tracks: Track[];
  onRenamePlaylist: (name: string) => Promise<void>;
  onDeletePlaylist: () => Promise<void>;
  onRemoveTrack: (trackId: string) => Promise<void>;
  onSelectArtist?: (artistName: string) => void;
  onSelectAlbum?: (albumTitle: string, artistName: string) => void;
  getArtworkUrl?: (id: string) => string;
}

export const PlaylistDetail: React.FC<PlaylistDetailProps> = ({
  playlist,
  tracks,
  onRenamePlaylist,
  onDeletePlaylist,
  onRemoveTrack,
  onSelectArtist,
  onSelectAlbum,
  getArtworkUrl,
}) => {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(playlist.name);

  const playlistContext = useMemo<PlaybackContext>(
    () => ({
      type: "playlist",
      name: playlist.name,
      id: playlist.id,
    }),
    [playlist.name, playlist.id]
  );

  const isThisPlaylistPlaying =
    playbackContext?.type === "playlist" && playbackContext.id === playlist.id;

  const totalDurationSecs = useMemo(() => {
    return tracks.reduce(
      (acc, t) => acc + (t.metadata.duration?.secs || 0),
      0
    );
  }, [tracks]);

  const handlePlayAll = useCallback(() => {
    if (tracks.length === 0) return;
    setQueue(tracks, 0, playlistContext);
  }, [tracks, setQueue, playlistContext]);

  const handleShuffle = useCallback(() => {
    if (tracks.length === 0) return;
    if (!isShuffle) toggleShuffle();
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled, 0, playlistContext);
  }, [tracks, isShuffle, toggleShuffle, setQueue, playlistContext]);

  const handleSaveName = async () => {
    if (!editedName.trim() || editedName === playlist.name) {
      setIsEditingName(false);
      setEditedName(playlist.name);
      return;
    }
    await onRenamePlaylist(editedName.trim());
    setIsEditingName(false);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0D0D10]">
      {/* Hero Banner */}
      <div className="p-8 pb-6 flex items-end gap-6 bg-gradient-to-b from-white/[0.08] via-white/[0.02] to-transparent border-b border-white/[0.06] flex-shrink-0">
        {/* Playlist Art Card */}
        <div className="w-36 h-36 rounded-2xl bg-gradient-to-br from-[#0070F3] via-[#7928CA] to-[#FF0080] flex items-center justify-center shadow-2xl shadow-purple-500/20 border border-white/20 flex-shrink-0">
          <ListMusic className="w-16 h-16 text-white drop-shadow-md" />
        </div>

        {/* Info & Action Controls */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-bold text-[#71717A] uppercase tracking-widest">
              User Playlist
            </p>
            {isThisPlaylistPlaying && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FA586A]/15 border border-[#FA586A]/30 text-[10px] font-bold text-[#FA586A] shadow-sm animate-fade-in">
                <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-[#FA586A]" />
                <span>Now Playing</span>
              </span>
            )}
          </div>

          {isEditingName ? (
            <div className="flex items-center space-x-2 mb-2">
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") {
                    setIsEditingName(false);
                    setEditedName(playlist.name);
                  }
                }}
                autoFocus
                className="bg-[#1C1C22] border border-[#FA586A] rounded-lg px-3 py-1 text-2xl font-black text-white focus:outline-none focus:ring-2 focus:ring-[#FA586A]/40"
              />
              <button
                onClick={handleSaveName}
                className="p-1.5 rounded-lg bg-[#FA586A] text-white hover:bg-[#E04859] transition"
                title="Save Name"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsEditingName(false);
                  setEditedName(playlist.name);
                }}
                className="p-1.5 rounded-lg bg-white/[0.08] text-[#A1A1AA] hover:text-white transition"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-3 mb-2 group/title">
              <h1 className="text-3xl font-black text-white tracking-tight truncate">
                {playlist.name}
              </h1>
              <button
                onClick={() => {
                  setEditedName(playlist.name);
                  setIsEditingName(true);
                }}
                className="opacity-0 group-hover/title:opacity-100 p-1.5 rounded-lg hover:bg-white/[0.08] text-[#71717A] hover:text-white transition"
                title="Rename Playlist"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          )}

          <p className="text-xs text-[#A1A1AA] font-medium flex items-center gap-2 mb-4">
            <span className="text-white font-semibold">{tracks.length} tracks</span>
            <span>•</span>
            <span>{formatTotalDuration(totalDurationSecs)}</span>
          </p>

          {/* Action Pills */}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              className="flex items-center space-x-2 px-5 py-2 bg-[#FA586A] hover:bg-[#E04859] disabled:opacity-40 disabled:hover:bg-[#FA586A] active:scale-[0.98] text-white rounded-full text-xs font-bold shadow-lg shadow-[#FA586A]/25 transition"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Play All</span>
            </button>
            <button
              onClick={handleShuffle}
              disabled={tracks.length === 0}
              className="flex items-center space-x-2 px-4 py-2 bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-40 active:scale-[0.98] text-white rounded-full text-xs font-semibold border border-white/[0.08] transition"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>Shuffle</span>
            </button>
            <button
              onClick={() => {
                if (confirm(`Are you sure you want to delete "${playlist.name}"?`)) {
                  onDeletePlaylist();
                }
              }}
              className="p-2 bg-white/[0.06] hover:bg-red-500/20 text-[#71717A] hover:text-red-400 rounded-full border border-white/[0.06] transition ml-auto"
              title="Delete Playlist"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tracks Table */}
      <TrackTable
        tracks={tracks}
        playbackContext={playlistContext}
        onSelectArtist={onSelectArtist}
        onSelectAlbum={onSelectAlbum}
        getArtworkUrl={getArtworkUrl}
        showSearchBar={true}
        onRemoveTrack={onRemoveTrack}
      />
    </div>
  );
};

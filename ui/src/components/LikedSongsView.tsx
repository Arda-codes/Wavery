import React, { useMemo, useCallback } from "react";
import { Track, PlaybackContext } from "../types";
import { TrackTable } from "./TrackTable";
import { usePlayerStore } from "../stores/playerStore";
import { Heart, Play, Shuffle } from "lucide-react";
import { formatTotalDuration } from "../utils/library";
import { EqualizerWave } from "./EqualizerWave";

interface LikedSongsViewProps {
  likedTracks: Track[];
  onSelectArtist?: (artistName: string) => void;
  onSelectAlbum?: (albumTitle: string, artistName: string) => void;
  getArtworkUrl?: (id: string) => string;
}

export const LikedSongsView: React.FC<LikedSongsViewProps> = ({
  likedTracks,
  onSelectArtist,
  onSelectAlbum,
  getArtworkUrl,
}) => {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  const likedContext = useMemo<PlaybackContext>(
    () => ({
      type: "liked",
      name: "Liked Songs",
    }),
    []
  );

  const isLikedPlaying = playbackContext?.type === "liked";

  const totalDurationSecs = useMemo(() => {
    return likedTracks.reduce(
      (acc, t) => acc + (t.metadata.duration?.secs || 0),
      0
    );
  }, [likedTracks]);

  const handlePlayAll = useCallback(() => {
    if (likedTracks.length === 0) return;
    setQueue(likedTracks, 0, likedContext);
  }, [likedTracks, setQueue, likedContext]);

  const handleShuffle = useCallback(() => {
    if (likedTracks.length === 0) return;
    if (!isShuffle) toggleShuffle();
    const shuffled = [...likedTracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled, 0, likedContext);
  }, [likedTracks, isShuffle, toggleShuffle, setQueue, likedContext]);

  if (likedTracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[#0D0D10]">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#FA586A]/20 to-[#7928CA]/20 border border-[#FA586A]/30 flex items-center justify-center mb-5 shadow-2xl shadow-[#FA586A]/10">
          <Heart className="w-10 h-10 text-[#FA586A]" />
        </div>
        <h2 className="text-lg font-bold text-white mb-1.5">No Liked Songs Yet</h2>
        <p className="text-xs text-[#A1A1AA] max-w-sm leading-relaxed mb-6">
          Tap the heart icon next to any song in your library or now playing bar to save your favorite tracks here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0D0D10]">
      {/* Hero Banner with Vibrant Glass Glow */}
      <div className="p-8 pb-6 flex items-end gap-6 bg-gradient-to-b from-[#FA586A]/15 via-[#FA586A]/5 to-transparent border-b border-white/[0.06] flex-shrink-0">
        {/* Large Heart Art Card */}
        <div className="w-36 h-36 rounded-2xl bg-gradient-to-br from-[#FA586A] via-[#E0284F] to-[#7928CA] flex items-center justify-center shadow-2xl shadow-[#FA586A]/30 border border-white/20 flex-shrink-0">
          <Heart className="w-16 h-16 text-white fill-white drop-shadow-md" />
        </div>

        {/* Info & Action Buttons */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] font-bold text-[#FA586A] uppercase tracking-widest">
              Auto Playlist
            </p>
            {isLikedPlaying && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FA586A]/15 border border-[#FA586A]/30 text-[10px] font-bold text-[#FA586A] shadow-sm animate-fade-in">
                <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-[#FA586A]" />
                <span>Now Playing</span>
              </span>
            )}
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight truncate mb-2">
            Liked Songs
          </h1>
          <p className="text-xs text-[#A1A1AA] font-medium flex items-center gap-2 mb-4">
            <span className="text-white font-semibold">{likedTracks.length} tracks</span>
            <span>•</span>
            <span>{formatTotalDuration(totalDurationSecs)}</span>
          </p>

          {/* Action Pills */}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePlayAll}
              className="flex items-center space-x-2 px-5 py-2 bg-[#FA586A] hover:bg-[#E04859] active:scale-[0.98] text-white rounded-full text-xs font-bold shadow-lg shadow-[#FA586A]/25 transition"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Play All</span>
            </button>
            <button
              onClick={handleShuffle}
              className="flex items-center space-x-2 px-4 py-2 bg-white/[0.08] hover:bg-white/[0.14] active:scale-[0.98] text-white rounded-full text-xs font-semibold border border-white/[0.08] transition"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>Shuffle</span>
            </button>
          </div>
        </div>
      </div>

      {/* Virtualized Tracks Table */}
      <TrackTable
        tracks={likedTracks}
        playbackContext={likedContext}
        onSelectArtist={onSelectArtist}
        onSelectAlbum={onSelectAlbum}
        getArtworkUrl={getArtworkUrl}
        showSearchBar={true}
      />
    </div>
  );
};

import React, { useMemo, useCallback } from "react";
import { Track, PlaybackContext } from "../types";
import { TrackTable } from "./TrackTable";
import { usePlayerStore } from "../stores/playerStore";
import { useNavigationStore } from "../stores/navigationStore";
import { Heart, Play, Shuffle, Music } from "lucide-react";
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
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const navigate = useNavigationStore((s) => s.navigate);

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

  const handleShuffle = useCallback(async () => {
    if (likedTracks.length === 0) return;
    const shuffled = [...likedTracks].sort(() => Math.random() - 0.5);
    await setQueue(shuffled, 0, likedContext);
    if (!usePlayerStore.getState().isShuffle) {
      toggleShuffle();
    }
  }, [likedTracks, toggleShuffle, setQueue, likedContext]);

  if (likedTracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-background">
        <div className="w-20 h-20 rounded-3xl bg-surfaceActive border border-white/[0.08] flex items-center justify-center mb-5 shadow-xl">
          <Heart className="w-10 h-10 text-accent" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">No Liked Songs Yet</h2>
        <p className="text-xs text-textSecondary max-w-sm leading-relaxed mb-6">
          Songs you mark with a heart will appear here for quick access.
        </p>
        <button
          type="button"
          onClick={() => navigate("tracks")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-accent-fill hover:bg-accentHover active:scale-95 transition shadow-lg shadow-accent/20"
        >
          <Music className="w-3.5 h-3.5" />
          <span>Browse Library</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Hero Header */}
      <div className="p-4 sm:p-8 pb-6 flex flex-col sm:flex-row items-center sm:items-end gap-4 sm:gap-6 text-center sm:text-left bg-surface border-b border-border flex-shrink-0">
        {/* Large Heart Art Card */}
        <div className="w-24 h-24 sm:w-36 sm:h-36 rounded-2xl bg-accent-fill text-onAccent flex items-center justify-center shadow-lg border border-white/10 flex-shrink-0 relative overflow-hidden group hover:brightness-105 transition-all">
          <Heart className="w-10 h-10 sm:w-16 sm:h-16 text-onAccent fill-current drop-shadow-md" />
        </div>

        {/* Info & Action Buttons */}
        <div className="flex-1 min-w-0 w-full">
          {isLikedPlaying && (
            <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
              <span className="inline-flex items-center gap-2 px-2 py-1 rounded-[4px] bg-accent/10 border border-accent/25 text-2xs font-medium text-accent animate-fade-in">
                <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-accent" />
                <span>Now Playing</span>
              </span>
            </div>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight truncate mb-2">
            Liked Songs
          </h1>
          <p className="text-xs text-textSecondary font-medium flex items-center justify-center sm:justify-start gap-2 mb-4">
            <span className="text-white font-semibold">{likedTracks.length} tracks</span>
            <span>•</span>
            <span>{formatTotalDuration(totalDurationSecs)}</span>
          </p>

          {/* Action Buttons */}
          <div className="flex items-center justify-center sm:justify-start flex-wrap gap-3">
            <button
              onClick={handlePlayAll}
              className="flex items-center space-x-2 px-5 py-2 bg-accent hover:opacity-90 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-lg shadow-black/20 transition"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Play All</span>
            </button>
            <button
              onClick={handleShuffle}
              className="flex items-center space-x-2 px-4 py-2 bg-white/[0.08] hover:bg-white/[0.14] active:scale-[0.98] text-white rounded-xl text-xs font-semibold border border-white/[0.08] transition"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>Shuffle</span>
            </button>
          </div>
        </div>
      </div>

      {/* Virtualized Tracks Table */}
      <TrackTable
        pageKey="liked"
        defaultSortKey="date_added"
        defaultSortDir="desc"
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

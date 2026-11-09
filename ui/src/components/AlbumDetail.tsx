import React, { useCallback, useState, useMemo } from "react";
import { AlbumInfo, PlaybackContext } from "../types";
import { formatTotalDuration } from "../utils/library";
import { TrackTable } from "./TrackTable";
import { usePlayerStore } from "../stores/playerStore";
import { useArtwork } from "../utils/useArtwork";
import { Disc, Play, Clock, User, Calendar, Pencil, EyeOff, Eye } from "lucide-react";
import { ArtistLinks } from "./ArtistLinks";
import { AlbumMetadataModal } from "./AlbumMetadataModal";
import { EqualizerWave } from "./EqualizerWave";
import { useSettingsStore } from "../stores/settingsStore";

interface AlbumDetailProps {
  album: AlbumInfo;
  onPlayAlbum?: (album: AlbumInfo) => void;
  onSelectArtist: (artistName: string) => void;
  getArtworkUrl?: (trackId: string) => string;
}

const AlbumDetailInner: React.FC<AlbumDetailProps> = ({
  album,
  onPlayAlbum,
  onSelectArtist,
  getArtworkUrl,
}) => {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const coverArtwork = useArtwork(album.artworkTrackId);
  const [coverError, setCoverError] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const isArtistHidden = useSettingsStore((s) => s.isArtistHidden(album.artist));
  const toggleHideArtist = useSettingsStore((s) => s.toggleHideArtist);

  const albumContext = useMemo<PlaybackContext>(
    () => ({
      type: "album",
      name: album.title,
      artist: album.artist,
    }),
    [album.title, album.artist]
  );

  const isThisAlbumPlaying =
    playbackContext?.type === "album" &&
    playbackContext.name.toLowerCase() === album.title.toLowerCase();

  const handlePlay = useCallback(() => {
    if (onPlayAlbum) {
      onPlayAlbum(album);
    } else if (album.tracks.length > 0) {
      setQueue(album.tracks, 0, albumContext);
    }
  }, [album, onPlayAlbum, setQueue, albumContext]);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-background">
      {/* Album Header Banner */}
      <div className="bg-gradient-to-b from-accent/[0.08] to-transparent p-4 sm:p-6 md:p-8 border-b border-white/[0.06] flex flex-col md:flex-row items-center md:items-end gap-5 sm:gap-8 flex-shrink-0">
        {/* Cover Art */}
        <div className="w-36 h-36 sm:w-44 sm:h-44 md:w-48 md:h-48 rounded-2xl bg-surface overflow-hidden shadow-2xl shadow-black/80 flex items-center justify-center flex-shrink-0 border border-white/[0.08]">
          {coverArtwork && !coverError ? (
            <img
              src={coverArtwork}
              alt={album.title}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              onError={() => setCoverError(true)}
            />
          ) : (
            <Disc className="w-16 h-16 text-textMuted/60" />
          )}
        </div>

        {/* Album Metadata */}
        <div className="flex-1 text-center md:text-left">
          {isThisAlbumPlaying && (
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <span className="inline-flex items-center gap-2 px-2 py-1 rounded-[4px] bg-accent/10 border border-accent/25 text-2xs font-medium text-accent animate-fade-in">
                <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-accent-fill" />
                <span>Now Playing</span>
              </span>
            </div>
          )}
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            {album.title}
          </h1>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-xs text-textSecondary mb-5">
            <div className="flex items-center gap-2 font-bold text-white whitespace-nowrap">
              <User className="w-3.5 h-3.5 text-accent" />
              <ArtistLinks
                artistName={album.artist}
                onSelectArtist={onSelectArtist}
                className="font-bold text-white"
                linkClassName="hover:text-accent hover:underline cursor-pointer transition-colors"
                delimiterClassName="text-textMuted"
              />
            </div>
            {album.year && (
              <span className="flex items-center gap-2 whitespace-nowrap before:content-['•'] before:text-textMuted">
                <Calendar className="w-3.5 h-3.5 text-textMuted" />
                {album.year}
              </span>
            )}
            <span className="flex items-center gap-2 whitespace-nowrap before:content-['•'] before:text-textMuted">
              <Disc className="w-3.5 h-3.5 text-textMuted" />
              {album.trackCount} {album.trackCount === 1 ? "track" : "tracks"}
            </span>
            <span className="flex items-center gap-2 whitespace-nowrap before:content-['•'] before:text-textMuted">
              <Clock className="w-3.5 h-3.5 text-textMuted" />
              {formatTotalDuration(album.totalDurationSecs)}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 sm:gap-3">
            <button
              onClick={handlePlay}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3 bg-accent-fill hover:bg-accentHover active:scale-95 text-white rounded-xl text-xs font-bold shadow-lg shadow-accent/20 transition whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isThisAlbumPlaying && isPlaying ? "Restart Album" : "Play Album"}</span>
            </button>
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-white rounded-xl text-xs font-semibold transition border border-white/[0.08] whitespace-nowrap"
              title="Edit Album & Track Metadata"
            >
              <Pencil className="w-3.5 h-3.5 text-accent" />
              <span>Edit Metadata</span>
            </button>
            {album.artist && album.artist !== "Unknown Artist" && (
              <button
                onClick={() => toggleHideArtist(album.artist)}
                className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold border transition active:scale-95 whitespace-nowrap ${
                  isArtistHidden
                    ? "bg-warning/15 hover:bg-warning/25 text-warning border-warning/30"
                    : "bg-white/[0.08] hover:bg-white/[0.14] text-white/90 hover:text-white border-white/[0.08]"
                }`}
                title={isArtistHidden ? `Unhide ${album.artist}` : `Hide ${album.artist}`}
              >
                {isArtistHidden ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-warning" />
                    <span>Unhide Artist</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-textSecondary" />
                    <span>Hide Artist</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Album Tracks */}
      <div className="p-3 sm:p-6 pb-32 sm:pb-24">
        <div className="bg-surface/60 rounded-2xl border border-white/[0.06] overflow-hidden shadow-md">
          <TrackTable
            pageKey="album_detail"
            defaultSortKey="track_number"
            defaultSortDir="asc"
            tracks={album.tracks}
            playbackContext={albumContext}
            onSelectArtist={onSelectArtist}
            getArtworkUrl={getArtworkUrl}
            showSearchBar={false}
          />
        </div>
      </div>

      {/* Metadata Editor Modal */}
      <AlbumMetadataModal
        album={album}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
      />
    </div>
  );
};

export const AlbumDetail = React.memo(AlbumDetailInner);

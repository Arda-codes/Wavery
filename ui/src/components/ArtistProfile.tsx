import React, { useMemo, useCallback, useState } from "react";
import { ArtistInfo, Track, AlbumInfo, PlaybackContext } from "../types";
import { formatTotalDuration } from "../utils/library";
import { TrackTable } from "./TrackTable";
import { AlbumCard } from "./AlbumCard";
import { AlbumMetadataModal } from "./AlbumMetadataModal";
import { ArtistMetadataModal } from "./ArtistMetadataModal";
import { usePlayerStore } from "../stores/playerStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useArtwork } from "../utils/useArtwork";
import { Users, Play, Disc, Music, Clock, FilePenLine, EyeOff, Eye } from "lucide-react";
import { EqualizerWave } from "./EqualizerWave";

interface ArtistProfileProps {
  artist: ArtistInfo;
  onPlayTrack?: (track: Track) => void;
  onSelectAlbum: (albumTitle: string, artistName: string) => void;
  onSelectArtist: (artistName: string) => void;
  getArtworkUrl?: (trackId: string) => string;
}

const ArtistProfileInner: React.FC<ArtistProfileProps> = ({
  artist,
  onPlayTrack,
  onSelectAlbum,
  onSelectArtist,
  getArtworkUrl,
}) => {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const avatarArtwork = useArtwork(artist.artworkTrackId);
  const [avatarError, setAvatarError] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<AlbumInfo | null>(null);
  const [isEditingArtist, setIsEditingArtist] = useState(false);
  const isHidden = useSettingsStore((s) => s.isArtistHidden(artist.name));
  const toggleHideArtist = useSettingsStore((s) => s.toggleHideArtist);

  const artistContext = useMemo<PlaybackContext>(
    () => ({
      type: "artist",
      name: artist.name,
    }),
    [artist.name]
  );

  const isArtistPlaying =
    playbackContext?.type === "artist" &&
    playbackContext.name.toLowerCase() === artist.name.toLowerCase();

  const totalDuration = useMemo(
    () =>
      artist.tracks.reduce(
        (acc, t) => acc + (t.metadata.duration?.secs || 0),
        0
      ),
    [artist.tracks]
  );

  const handlePlayArtist = useCallback(() => {
    if (artist.tracks.length > 0) {
      if (onPlayTrack) {
        onPlayTrack(artist.tracks[0]);
      } else {
        setQueue(artist.tracks, 0, artistContext);
      }
    }
  }, [artist.tracks, onPlayTrack, setQueue, artistContext]);

  const handlePlayAlbumCard = useCallback(
    (album: AlbumInfo) => {
      if (album.tracks.length > 0) {
        setQueue(album.tracks, 0, {
          type: "album",
          name: album.title,
          artist: album.artist,
        });
      }
    },
    [setQueue]
  );

  // Partition artist releases
  const { fullAlbums, singles } = useMemo(() => {
    const full: AlbumInfo[] = [];
    const sgl: AlbumInfo[] = [];
    for (const album of artist.albums) {
      if (album.trackCount <= 3 || album.title.toLowerCase().includes("single") || album.title.toLowerCase().includes("ep")) {
        sgl.push(album);
      } else {
        full.push(album);
      }
    }
    return { fullAlbums: full, singles: sgl };
  }, [artist.albums]);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-background">
      {/* Hero Banner */}
      <div className="bg-gradient-to-b from-accent/[0.08] to-transparent p-4 sm:p-6 md:p-8 border-b border-white/[0.06] flex flex-col md:flex-row items-center md:items-end gap-5 sm:gap-8 flex-shrink-0">
        {/* Large Avatar */}
        <div className="w-32 h-32 sm:w-36 sm:h-36 md:w-40 md:h-40 rounded-full bg-surface overflow-hidden shadow-2xl shadow-black/80 flex items-center justify-center flex-shrink-0 border-2 border-white/[0.12]">
          {avatarArtwork && !avatarError ? (
            <img
              src={avatarArtwork}
              alt={artist.name}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              onError={() => setAvatarError(true)}
            />
          ) : (
            <Users className="w-16 h-16 text-textMuted" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 text-center md:text-left">
          {isArtistPlaying && (
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <span className="inline-flex items-center gap-2 px-2 py-1 rounded-[4px] bg-accent/10 border border-accent/25 text-2xs font-medium text-accent animate-fade-in">
                <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-accent-fill" />
                <span>Now Playing</span>
              </span>
            </div>
          )}
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight mb-3">
            {artist.name}
          </h1>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs text-textSecondary mb-5">
            <span className="flex items-center gap-2 whitespace-nowrap">
              <Disc className="w-4 h-4 text-accent" />
              <strong className="text-white">{fullAlbums.length}</strong> Albums
            </span>
            {singles.length > 0 && (
              <span className="flex items-center gap-2 whitespace-nowrap before:content-['•'] before:text-textMuted">
                <Music className="w-4 h-4 text-accent" />
                <strong className="text-white">{singles.length}</strong> Singles & EPs
              </span>
            )}
            <span className="flex items-center gap-2 whitespace-nowrap before:content-['•'] before:text-textMuted">
              <Music className="w-4 h-4 text-textMuted" />
              <strong className="text-white">{artist.trackCount}</strong> Tracks
            </span>
            <span className="flex items-center gap-2 whitespace-nowrap before:content-['•'] before:text-textMuted">
              <Clock className="w-4 h-4 text-textMuted" />
              {formatTotalDuration(totalDuration)}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 sm:gap-3">
            <button
              onClick={handlePlayArtist}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-6 py-3 bg-accent-fill hover:bg-accentHover active:scale-95 text-white rounded-xl text-xs font-bold shadow-lg shadow-accent/20 transition whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isArtistPlaying && isPlaying ? "Restart Artist" : "Play Artist"}</span>
            </button>
            <button
              onClick={() => setIsEditingArtist(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 text-white/90 hover:text-white rounded-xl text-xs font-semibold border border-white/[0.08] transition whitespace-nowrap"
              title="Edit Artist Metadata"
            >
              <FilePenLine className="w-4 h-4 text-textSecondary" />
              <span>Edit Artist</span>
            </button>
            <button
              onClick={() => toggleHideArtist(artist.name)}
              className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold border transition active:scale-95 whitespace-nowrap ${
                isHidden
                  ? "bg-warning/15 hover:bg-warning/25 text-warning border-warning/30"
                  : "bg-white/[0.06] hover:bg-white/[0.12] text-white/90 hover:text-white border-white/[0.08]"
              }`}
              title={isHidden ? "Unhide this artist" : "Don't play songs from this artist"}
            >
              {isHidden ? (
                <>
                  <Eye className="w-4 h-4 text-warning" />
                  <span>Unhide Artist</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-4 h-4 text-textSecondary" />
                  <span>Hide Artist</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Discography / Albums by this Artist */}
      <div className="p-3 sm:p-6 space-y-8 pb-32 sm:pb-24">
        {/* Full Albums */}
        {fullAlbums.length > 0 && (
          <div>
            <h3 className="text-base font-bold text-white mb-4">
              Albums
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {fullAlbums.map((album) => (
                <AlbumCard
                  key={album.title}
                  album={album}
                  onSelectAlbum={onSelectAlbum}
                  onSelectArtist={onSelectArtist}
                  onPlayAlbum={handlePlayAlbumCard}
                  onEditMetadata={setEditingAlbum}
                />
              ))}
            </div>
          </div>
        )}

        {/* Singles & EPs */}
        {singles.length > 0 && (
          <div>
            <h3 className="text-base font-bold text-white mb-4">
              Singles & EPs
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {singles.map((album) => (
                <AlbumCard
                  key={album.title}
                  album={album}
                  onSelectAlbum={onSelectAlbum}
                  onSelectArtist={onSelectArtist}
                  onPlayAlbum={handlePlayAlbumCard}
                  onEditMetadata={setEditingAlbum}
                />
              ))}
            </div>
          </div>
        )}

        {/* Appears On / Features & Collaborations */}
        {artist.appearsOn && artist.appearsOn.length > 0 && (
          <div>
            <h3 className="text-base font-bold text-white mb-4">
              Appears On & Collaborations
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {artist.appearsOn.map((album) => (
                <AlbumCard
                  key={`${album.title}-${album.artist}`}
                  album={album}
                  onSelectAlbum={onSelectAlbum}
                  onSelectArtist={onSelectArtist}
                  onPlayAlbum={handlePlayAlbumCard}
                  onEditMetadata={setEditingAlbum}
                />
              ))}
            </div>
          </div>
        )}

        {/* All Songs by this Artist */}
        <div>
          <h3 className="text-base font-bold text-white mb-4">
            All Tracks
          </h3>
          <div className="bg-surface/60 rounded-2xl border border-white/[0.06] overflow-hidden shadow-md">
            <TrackTable
              pageKey="artist_detail"
              defaultSortKey="title"
              defaultSortDir="asc"
              tracks={artist.tracks}
              playbackContext={artistContext}
              onSelectArtist={onSelectArtist}
              onSelectAlbum={onSelectAlbum}
              getArtworkUrl={getArtworkUrl}
              showSearchBar={false}
            />
          </div>
        </div>
      </div>

      {/* Album Metadata Modal */}
      {editingAlbum && (
        <AlbumMetadataModal
          album={editingAlbum}
          isOpen={!!editingAlbum}
          onClose={() => setEditingAlbum(null)}
        />
      )}

      {/* Artist Metadata Modal */}
      <ArtistMetadataModal
        artist={artist}
        isOpen={isEditingArtist}
        onClose={() => setIsEditingArtist(false)}
        onSaved={(updatedTracks) => {
          if (updatedTracks.length > 0) {
            const newName = updatedTracks[0].metadata.artist || artist.name;
            if (newName && newName !== artist.name) {
              onSelectArtist(newName);
            }
          }
        }}
      />
    </div>
  );
};

export const ArtistProfile = React.memo(ArtistProfileInner);

import React, { useMemo, useCallback, useState } from "react";
import { ArtistInfo, Track, AlbumInfo, PlaybackContext } from "../types";
import { formatTotalDuration } from "../utils/library";
import { TrackTable } from "./TrackTable";
import { AlbumCard } from "./AlbumCard";
import { AlbumMetadataModal } from "./AlbumMetadataModal";
import { usePlayerStore } from "../stores/playerStore";
import { useArtwork } from "../utils/useArtwork";
import { Users, Play, Disc, Music, Clock } from "lucide-react";
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
    <div className="flex-1 flex flex-col overflow-y-auto bg-[#0D0D10]">
      {/* Hero Banner */}
      <div className="bg-gradient-to-b from-[#FA586A]/20 via-[#16161A]/80 to-[#0D0D10] p-8 border-b border-white/[0.06] flex flex-col md:flex-row items-center md:items-end gap-7 flex-shrink-0">
        {/* Large Avatar */}
        <div className="w-40 h-40 rounded-full bg-[#1C1C22] overflow-hidden shadow-2xl shadow-black/80 flex items-center justify-center flex-shrink-0 border-2 border-white/[0.12]">
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
            <Users className="w-16 h-16 text-[#71717A]" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 mb-1.5">
            <p className="text-[11px] font-bold text-[#FA586A] tracking-wider uppercase">
              Artist Profile
            </p>
            {isArtistPlaying && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FA586A]/15 border border-[#FA586A]/30 text-[10px] font-bold text-[#FA586A] shadow-sm animate-fade-in">
                <EqualizerWave isPlaying={isPlaying} size="xs" color="bg-[#FA586A]" />
                <span>Now Playing</span>
              </span>
            )}
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight mb-3">
            {artist.name}
          </h1>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-xs text-[#A1A1AA] mb-5">
            <span className="flex items-center gap-1.5">
              <Disc className="w-4 h-4 text-[#FA586A]" />
              <strong className="text-white">{fullAlbums.length}</strong> Albums
            </span>
            {singles.length > 0 && (
              <>
                <span className="text-[#71717A]">•</span>
                <span className="flex items-center gap-1.5">
                  <Music className="w-4 h-4 text-[#FA586A]" />
                  <strong className="text-white">{singles.length}</strong> Singles & EPs
                </span>
              </>
            )}
            <span className="text-[#71717A]">•</span>
            <span className="flex items-center gap-1.5">
              <Music className="w-4 h-4 text-[#71717A]" />
              <strong className="text-white">{artist.trackCount}</strong> Tracks
            </span>
            <span className="text-[#71717A]">•</span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-[#71717A]" />
              {formatTotalDuration(totalDuration)}
            </span>
          </div>

          <button
            onClick={handlePlayArtist}
            className="inline-flex items-center gap-2 px-7 py-2.5 bg-[#FA586A] hover:bg-[#E04859] active:scale-95 text-white rounded-full text-xs font-bold shadow-xl shadow-[#FA586A]/25 transition"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>{isArtistPlaying && isPlaying ? "Restart Artist" : "Play Artist"}</span>
          </button>
        </div>
      </div>

      {/* Discography / Albums by this Artist */}
      <div className="p-6 space-y-8">
        {/* Full Albums */}
        {fullAlbums.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Disc className="w-4 h-4 text-[#FA586A]" /> Albums ({fullAlbums.length})
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
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Music className="w-4 h-4 text-[#FA586A]" /> Singles & EPs ({singles.length})
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
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#FA586A]" /> Appears On & Collaborations ({artist.appearsOn.length})
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
          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <Music className="w-4 h-4 text-[#FA586A]" /> All Tracks ({artist.tracks.length})
          </h3>
          <div className="bg-[#16161A]/60 rounded-2xl border border-white/[0.06] overflow-hidden shadow-md">
            <TrackTable
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
    </div>
  );
};

export const ArtistProfile = React.memo(ArtistProfileInner);

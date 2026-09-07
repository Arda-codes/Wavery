import React, { useMemo, useCallback } from "react";
import { AlbumInfo, ArtistInfo, Playlist, Track, ViewMode } from "../types";
import { usePlayerStore } from "../stores/playerStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import {
  Play,
  Sparkles,
  ChevronRight,
  Heart,
  FolderPlus,
  Radio,
  Flame,
  Music,
  Disc,
  Users,
  Compass,
  Clock,
  Calendar,
} from "lucide-react";

interface HomeViewProps {
  tracks: Track[];
  albums: AlbumInfo[];
  artists: ArtistInfo[];
  playlists: Playlist[];
  likedTracks: Track[];
  onSelectAlbum: (albumTitle: string, artistName: string) => void;
  onSelectArtist: (artistName: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onNavigate: (view: ViewMode) => void;
  onOpenImport?: () => void;
  getArtworkUrl: (trackId: string) => string;
}

interface EditorialPick {
  id: string;
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  gradient: string;
  artworkTrackId?: string;
  tracks: Track[];
  type: "album" | "station" | "mix" | "artist";
  targetAlbum?: { title: string; artist: string };
  targetArtist?: string;
}

export const HomeView: React.FC<HomeViewProps> = ({
  tracks,
  albums,
  artists,
  playlists,
  likedTracks,
  onSelectAlbum,
  onSelectArtist,
  onSelectPlaylist,
  onNavigate,
  onOpenImport,
  getArtworkUrl,
}) => {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playHistory = usePlayerStore((s) => s.playHistory);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  // 1. Dynamic "Recently Played" or "Recently Added" Albums based on actual play history
  const recentShelf = useMemo<{ title: string; isHistory: boolean; albums: AlbumInfo[] }>(() => {
    if (playHistory.length > 0) {
      const seenKeys = new Set<string>();
      const historyAlbums: AlbumInfo[] = [];

      for (const entry of playHistory) {
        const trackId = entry.trackId;
        const tr = tracks.find((t) => t.id === trackId);
        if (tr && tr.metadata.album) {
          const key = `${tr.metadata.album.toLowerCase()}:::${(tr.metadata.artist || "").toLowerCase()}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            const foundAlbum = albums.find(
              (a) =>
                a.title.toLowerCase() === tr.metadata.album!.toLowerCase() &&
                a.artist.toLowerCase() === (tr.metadata.artist || "").toLowerCase()
            );
            if (foundAlbum) {
              historyAlbums.push(foundAlbum);
              if (historyAlbums.length >= 10) break;
            }
          }
        }
      }

      if (historyAlbums.length > 0) {
        return { title: "Recently Played", isHistory: true, albums: historyAlbums };
      }
    }

    // If no play history recorded yet, dynamically sort albums by latest addition date
    const byDate = albums
      .slice()
      .sort((a, b) => {
        const maxA = Math.max(...a.tracks.map((t) => t.date_added || 0), 0);
        const maxB = Math.max(...b.tracks.map((t) => t.date_added || 0), 0);
        return maxB - maxA;
      })
      .slice(0, 10);

    return { title: "Recently Added", isHistory: false, albums: byDate };
  }, [playHistory, tracks, albums]);

  // 2. Dynamic Library Genres extraction
  const libraryGenres = useMemo(() => {
    const genreMap = new Map<string, Track[]>();
    for (const t of tracks) {
      const rawGenre = t.metadata.genre?.trim();
      if (rawGenre) {
        const parts = rawGenre.split(/[,/&;]/).map((p) => p.trim()).filter(Boolean);
        for (const part of parts) {
          const capitalized = part.charAt(0).toUpperCase() + part.slice(1);
          if (!genreMap.has(capitalized)) {
            genreMap.set(capitalized, []);
          }
          genreMap.get(capitalized)!.push(t);
        }
      }
    }
    return Array.from(genreMap.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, genreTracks]) => ({ name, tracks: genreTracks }));
  }, [tracks]);

  // 3. Dynamic "Top Picks for You" Generation (100% data-driven from user's library)
  const editorialPicks = useMemo<EditorialPick[]>(() => {
    const picks: EditorialPick[] = [];

    // Pick 1: Most Recently Added Album
    if (albums.length > 0) {
      const newestAlbum = albums.slice().sort((a, b) => {
        const maxA = Math.max(...a.tracks.map((t) => t.date_added || 0), 0);
        const maxB = Math.max(...b.tracks.map((t) => t.date_added || 0), 0);
        return maxB - maxA;
      })[0];

      picks.push({
        id: `pick-album-${newestAlbum.title}`,
        badge: "RECENT ADDITION",
        badgeColor: "bg-red-500/20 text-red-400 border-red-500/30",
        title: newestAlbum.title,
        subtitle: `${newestAlbum.artist} • ${newestAlbum.tracks.length} tracks`,
        gradient: "from-amber-600/60 via-red-700/40 to-[#121216]",
        artworkTrackId: newestAlbum.artworkTrackId,
        tracks: newestAlbum.tracks,
        type: "album",
        targetAlbum: { title: newestAlbum.title, artist: newestAlbum.artist },
      });
    }

    // Pick 2: Personal Station (Favorites or Play History Highlights)
    if (likedTracks.length > 0) {
      picks.push({
        id: "pick-personal-favorites",
        badge: "FAVORITES",
        badgeColor: "bg-[#FA586A]/20 text-[#FA586A] border-[#FA586A]/30",
        title: "Your Favorites Station",
        subtitle: `${likedTracks.length} liked tracks from your collection`,
        gradient: "from-[#FA586A]/70 via-rose-900/40 to-[#121216]",
        artworkTrackId: likedTracks[0]?.id,
        tracks: likedTracks,
        type: "station",
      });
    } else if (playHistory.length > 0) {
      const historyTracks = playHistory
        .map((entry) => tracks.find((t) => t.id === entry.trackId))
        .filter((t): t is Track => Boolean(t))
        .slice(0, 30);

      picks.push({
        id: "pick-heavy-rotation",
        badge: "HEAVY ROTATION",
        badgeColor: "bg-[#FA586A]/20 text-[#FA586A] border-[#FA586A]/30",
        title: "Heavy Rotation",
        subtitle: `${historyTracks.length} recently played tracks`,
        gradient: "from-[#FA586A]/70 via-rose-900/40 to-[#121216]",
        artworkTrackId: historyTracks[0]?.id,
        tracks: historyTracks,
        type: "station",
      });
    } else if (tracks.length > 0) {
      picks.push({
        id: "pick-library-station",
        badge: "MADE FOR YOU",
        badgeColor: "bg-[#FA586A]/20 text-[#FA586A] border-[#FA586A]/30",
        title: "Your Library Station",
        subtitle: `Continuous mix from your ${tracks.length} library tracks`,
        gradient: "from-[#FA586A]/70 via-rose-900/40 to-[#121216]",
        artworkTrackId: tracks[0]?.id,
        tracks: tracks.slice(0, 30),
        type: "station",
      });
    }

    // Pick 3: Artist Spotlight (The artist with the most tracks in the library)
    if (artists.length > 0) {
      const topArtist = artists.slice().sort((a, b) => b.trackCount - a.trackCount)[0];
      picks.push({
        id: `pick-artist-${topArtist.name}`,
        badge: "ARTIST SPOTLIGHT",
        badgeColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
        title: `${topArtist.name} Essentials`,
        subtitle: `${topArtist.trackCount} tracks across ${topArtist.albumCount} albums`,
        gradient: "from-blue-600/60 via-indigo-900/40 to-[#121216]",
        artworkTrackId: topArtist.artworkTrackId,
        tracks: topArtist.tracks,
        type: "artist",
        targetArtist: topArtist.name,
      });
    }

    // Pick 4: Top Genre Mix 1 (Derived from real tags in library)
    if (libraryGenres.length > 0) {
      const genre1 = libraryGenres[0];
      picks.push({
        id: `pick-genre-${genre1.name}`,
        badge: "GENRE SPOTLIGHT",
        badgeColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        title: `${genre1.name} Collection`,
        subtitle: `${genre1.tracks.length} songs categorized as ${genre1.name}`,
        gradient: "from-emerald-600/60 via-teal-900/40 to-[#121216]",
        artworkTrackId: genre1.tracks[0]?.id,
        tracks: genre1.tracks,
        type: "mix",
      });
    } else if (albums.length > 1) {
      // If no genres tagged, pick second album
      const secondAlbum = albums[1];
      picks.push({
        id: `pick-album-${secondAlbum.title}`,
        badge: "DISCOVER ALBUM",
        badgeColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        title: secondAlbum.title,
        subtitle: `${secondAlbum.artist} • ${secondAlbum.tracks.length} tracks`,
        gradient: "from-emerald-600/60 via-teal-900/40 to-[#121216]",
        artworkTrackId: secondAlbum.artworkTrackId,
        tracks: secondAlbum.tracks,
        type: "album",
        targetAlbum: { title: secondAlbum.title, artist: secondAlbum.artist },
      });
    }

    // Pick 5: Top Genre Mix 2 or Era / Decade Highlights
    if (libraryGenres.length > 1) {
      const genre2 = libraryGenres[1];
      picks.push({
        id: `pick-genre-${genre2.name}`,
        badge: "GENRE MIX",
        badgeColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
        title: `${genre2.name} Mix`,
        subtitle: `${genre2.tracks.length} tracks from your collection`,
        gradient: "from-cyan-600/60 via-blue-900/40 to-[#121216]",
        artworkTrackId: genre2.tracks[0]?.id,
        tracks: genre2.tracks,
        type: "mix",
      });
    } else if (artists.length > 1) {
      const secondArtist = artists.slice().sort((a, b) => b.trackCount - a.trackCount)[1];
      picks.push({
        id: `pick-artist-${secondArtist.name}`,
        badge: "FEATURING",
        badgeColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
        title: secondArtist.name,
        subtitle: `${secondArtist.trackCount} tracks in your library`,
        gradient: "from-cyan-600/60 via-blue-900/40 to-[#121216]",
        artworkTrackId: secondArtist.artworkTrackId,
        tracks: secondArtist.tracks,
        type: "artist",
        targetArtist: secondArtist.name,
      });
    }

    return picks;
  }, [albums, likedTracks, playHistory, tracks, artists, libraryGenres]);

  // 4. Top / Heavy Rotation Artists (Sorted by track count and play history)
  const topArtists = useMemo(() => {
    return artists
      .slice()
      .sort((a, b) => {
        // Boost artists that have been played in playHistory
        const playsA = playHistory.filter((entry) =>
          a.tracks.some((t) => t.id === entry.trackId)
        ).length;
        const playsB = playHistory.filter((entry) =>
          b.tracks.some((t) => t.id === entry.trackId)
        ).length;
        if (playsB !== playsA) return playsB - playsA;
        return b.trackCount - a.trackCount;
      })
      .slice(0, 8);
  }, [artists, playHistory]);

  // Play an editorial pick
  const handlePlayPick = useCallback(
    async (pick: EditorialPick, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (pick.tracks.length === 0) return;
      await setQueue(pick.tracks, 0, {
        type: pick.type === "album" ? "album" : "tracks",
        name: pick.title,
      });
    },
    [setQueue]
  );

  // Play an album directly
  const handlePlayAlbum = useCallback(
    async (album: AlbumInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (album.tracks.length === 0) return;
      await setQueue(album.tracks, 0, {
        type: "album",
        name: album.title,
        artist: album.artist,
      });
    },
    [setQueue]
  );

  // Play an artist directly
  const handlePlayArtist = useCallback(
    async (artist: ArtistInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (artist.tracks.length === 0) return;
      await setQueue(artist.tracks, 0, {
        type: "artist",
        name: artist.name,
      });
    },
    [setQueue]
  );

  // Album context menu
  const handleAlbumContextMenu = useCallback(
    (e: React.MouseEvent, album: AlbumInfo) => {
      e.preventDefault();
      e.stopPropagation();

      const items: ContextMenuItem[] = [
        {
          id: "play-album",
          label: "Play Album",
          icon: Play,
          onClick: () => handlePlayAlbum(album),
        },
        {
          id: "divider-1",
          label: "",
          divider: true,
        },
        {
          id: "view-album",
          label: "View Album",
          icon: Disc,
          onClick: () => onSelectAlbum(album.title, album.artist),
        },
        {
          id: "view-artist",
          label: `Go to ${album.artist}`,
          icon: Users,
          onClick: () => onSelectArtist(album.artist),
        },
      ];

      openContextMenu(e, items);
    },
    [handlePlayAlbum, onSelectAlbum, onSelectArtist, openContextMenu]
  );

  // Empty library welcome experience
  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none overflow-y-auto">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-[#FA586A] to-[#E0284F] flex items-center justify-center text-white shadow-2xl shadow-[#FA586A]/30 mb-6 animate-pulse">
          <Music className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
          Welcome to Wavery
        </h1>
        <p className="text-sm text-[#A1A1AA] max-w-md mb-8 leading-relaxed">
          Your personal high-fidelity music sanctuary. Import your local audio library or connect your music folder to get started with instant playback.
        </p>

        {onOpenImport && (
          <button
            onClick={onOpenImport}
            className="px-6 py-3 bg-[#FA586A] hover:bg-[#E04859] active:scale-95 text-white font-bold text-sm rounded-full shadow-lg shadow-[#FA586A]/25 transition flex items-center space-x-2"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Import Your Music Collection</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-7 sm:space-y-9 select-none pb-28 sm:pb-24">
      {/* 1. Apple Music Style Hero Title & Greeting */}
      <div className="flex items-end justify-between border-b border-white/[0.06] pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Home</h1>
          <p className="text-xs text-[#A1A1AA] mt-1 flex flex-wrap items-center gap-2">
            <span>Dynamic recommendations derived from your listening history</span>
            <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-white/30" />
            <span className="font-mono text-[#71717A]">{tracks.length} Songs</span>
          </p>
        </div>

        <div className="hidden sm:flex items-center space-x-2 text-xs font-semibold">
          <button
            onClick={() => onNavigate("tracks")}
            className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white transition flex items-center gap-1.5"
          >
            <Music className="w-3.5 h-3.5 text-[#FA586A]" />
            <span>All Songs</span>
          </button>
          <button
            onClick={() => onNavigate("albums")}
            className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white transition flex items-center gap-1.5"
          >
            <Disc className="w-3.5 h-3.5 text-[#FA586A]" />
            <span>Albums</span>
          </button>
        </div>
      </div>

      {/* 2. Top Picks For You (Tall Editorial Poster Cards - Driven by user data) */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#FA586A]" />
            <h2 className="text-lg font-bold text-white tracking-tight">Top Picks for You</h2>
          </div>
          <span className="text-xs text-[#71717A] font-medium">Dynamic Selections</span>
        </div>

        {/* Horizontal Carousel / Flex Shelves */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {editorialPicks.map((pick) => {
            const hasArtwork = Boolean(pick.artworkTrackId);
            const artworkUrl = pick.artworkTrackId ? getArtworkUrl(pick.artworkTrackId) : null;

            return (
              <div
                key={pick.id}
                onClick={() => {
                  if (pick.targetAlbum) {
                    onSelectAlbum(pick.targetAlbum.title, pick.targetAlbum.artist);
                  } else if (pick.targetArtist) {
                    onSelectArtist(pick.targetArtist);
                  } else {
                    handlePlayPick(pick);
                  }
                }}
                className={`group relative h-[320px] rounded-2xl overflow-hidden cursor-pointer border border-white/[0.08] hover:border-white/[0.2] transition-all duration-300 hover:shadow-2xl hover:shadow-black/60 flex flex-col justify-between p-4 bg-gradient-to-b ${pick.gradient}`}
              >
                {/* Background Artwork Layer with Subtle Parallax & Overlay */}
                {hasArtwork && artworkUrl && (
                  <div className="absolute inset-0 z-0 overflow-hidden">
                    <img
                      src={artworkUrl}
                      alt={pick.title}
                      className="w-full h-full object-cover opacity-40 group-hover:scale-105 group-hover:opacity-50 transition-all duration-500 blur-[0.5px]"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0E0E12] via-[#0E0E12]/60 to-transparent" />
                  </div>
                )}

                {/* Top Card Bar: Badge & Brandmark */}
                <div className="relative z-10 flex items-center justify-between">
                  <span
                    className={`text-[10px] font-black tracking-wider uppercase px-2 py-0.5 rounded-full border backdrop-blur-md ${pick.badgeColor}`}
                  >
                    {pick.badge}
                  </span>
                  <div className="flex items-center space-x-1 opacity-75 group-hover:opacity-100 transition">
                    <span className="text-[11px] font-bold text-white/80 tracking-tighter font-sans">
                      Wavery
                    </span>
                  </div>
                </div>

                {/* Center / Ambient Icon Graphic */}
                <div className="relative z-10 flex-1 flex items-center justify-center my-2">
                  {pick.type === "station" && (
                    <Radio className="w-16 h-16 text-white/30 group-hover:text-white/60 transition-colors" />
                  )}
                  {pick.type === "mix" && (
                    <Flame className="w-16 h-16 text-white/30 group-hover:text-white/60 transition-colors" />
                  )}
                  {pick.type === "artist" && (
                    <Users className="w-16 h-16 text-white/30 group-hover:text-white/60 transition-colors" />
                  )}
                  {pick.type === "album" && (
                    <Disc className="w-16 h-16 text-white/30 group-hover:text-white/60 transition-colors" />
                  )}
                </div>

                {/* Bottom Card Content: Title, Subtitle, and Hover Play Pill */}
                <div className="relative z-10 flex items-end justify-between">
                  <div className="min-w-0 pr-2">
                    <h3 className="text-base font-bold text-white leading-tight line-clamp-2 group-hover:text-white transition">
                      {pick.title}
                    </h3>
                    <p className="text-xs text-white/75 mt-1 line-clamp-1">
                      {pick.subtitle}
                    </p>
                  </div>

                  {/* Play Button - Apple Glass Style */}
                  <button
                    onClick={(e) => handlePlayPick(pick, e)}
                    className="w-10 h-10 rounded-full bg-white text-black hover:bg-white hover:scale-105 active:scale-95 shadow-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 opacity-90 group-hover:opacity-100"
                    title={`Play ${pick.title}`}
                  >
                    <Play className="w-4 h-4 fill-black translate-x-0.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Dynamic Recently Played / Recently Added Shelf */}
      {recentShelf.albums.length > 0 && (
        <section className="space-y-3.5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => onNavigate(recentShelf.isHistory ? "history" : "albums")}
              className="group flex items-center space-x-2 text-lg font-bold text-white hover:text-[#FA586A] transition-colors"
            >
              {recentShelf.isHistory ? (
                <Clock className="w-4 h-4 text-[#FA586A]" />
              ) : (
                <Calendar className="w-4 h-4 text-[#FA586A]" />
              )}
              <span>{recentShelf.title}</span>
              <ChevronRight className="w-4 h-4 text-[#71717A] group-hover:text-[#FA586A] group-hover:translate-x-0.5 transition" />
            </button>
            <button
              onClick={() => onNavigate(recentShelf.isHistory ? "history" : "albums")}
              className="text-xs text-[#71717A] hover:text-white transition font-medium"
            >
              See All
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {recentShelf.albums.map((album) => {
              const artworkUrl = album.artworkTrackId
                ? getArtworkUrl(album.artworkTrackId)
                : null;
              const isCurrentlyPlayingThisAlbum =
                currentTrack &&
                currentTrack.metadata.album?.toLowerCase() === album.title.toLowerCase() &&
                isPlaying;

              return (
                <div
                  key={`${album.title}-${album.artist}`}
                  onContextMenu={(e) => handleAlbumContextMenu(e, album)}
                  onClick={() => onSelectAlbum(album.title, album.artist)}
                  className="group relative flex flex-col cursor-pointer"
                >
                  {/* Square Album Cover with Smooth Radius */}
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-[#16161A] border border-white/[0.08] group-hover:border-white/[0.18] transition-all duration-200 shadow-md group-hover:shadow-xl group-hover:shadow-black/40">
                    {artworkUrl ? (
                      <img
                        src={artworkUrl}
                        alt={album.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#1A1A22] text-[#71717A]">
                        <Disc className="w-12 h-12" />
                      </div>
                    )}

                    {/* Glossy Play Overlay on Hover */}
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                      <button
                        onClick={(e) => handlePlayAlbum(album, e)}
                        className="w-11 h-11 rounded-full bg-[#FA586A] hover:bg-[#E04859] active:scale-95 text-white shadow-xl flex items-center justify-center transition-transform hover:scale-110"
                        title={`Play ${album.title}`}
                      >
                        <Play className="w-5 h-5 fill-white translate-x-0.5" />
                      </button>
                    </div>

                    {/* Playing indicator */}
                    {isCurrentlyPlayingThisAlbum && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-[#FA586A] text-white text-[10px] font-bold shadow-md">
                        Playing
                      </div>
                    )}
                  </div>

                  {/* Album Metadata */}
                  <div className="mt-2.5 space-y-0.5">
                    <p className="text-xs font-semibold text-white truncate group-hover:text-[#FA586A] transition-colors">
                      {album.title}
                    </p>
                    <p
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectArtist(album.artist);
                      }}
                      className="text-[11px] text-[#A1A1AA] truncate hover:text-white transition-colors"
                    >
                      {album.artist}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4. Favorite Artists / Heavy Rotation (Circular Avatars) */}
      {topArtists.length > 0 && (
        <section className="space-y-3.5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => onNavigate("artists")}
              className="group flex items-center space-x-1.5 text-lg font-bold text-white hover:text-[#FA586A] transition-colors"
            >
              <span>Favorite Artists</span>
              <ChevronRight className="w-4 h-4 text-[#71717A] group-hover:text-[#FA586A] group-hover:translate-x-0.5 transition" />
            </button>
            <button
              onClick={() => onNavigate("artists")}
              className="text-xs text-[#71717A] hover:text-white transition font-medium"
            >
              See All
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
            {topArtists.map((artist) => {
              const artworkUrl = artist.artworkTrackId
                ? getArtworkUrl(artist.artworkTrackId)
                : null;

              return (
                <div
                  key={artist.name}
                  onClick={() => onSelectArtist(artist.name)}
                  className="group flex flex-col items-center text-center cursor-pointer"
                >
                  {/* Circular Portrait with Glow on Hover */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-[#1A1A22] border border-white/[0.08] group-hover:border-[#FA586A]/50 transition-all duration-300 shadow-md group-hover:shadow-lg group-hover:shadow-[#FA586A]/20">
                    {artworkUrl ? (
                      <img
                        src={artworkUrl}
                        alt={artist.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#71717A]">
                        <Users className="w-10 h-10" />
                      </div>
                    )}

                    {/* Quick Play Hover on Artist */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                      <button
                        onClick={(e) => handlePlayArtist(artist, e)}
                        className="w-9 h-9 rounded-full bg-[#FA586A] text-white flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition"
                        title={`Play ${artist.name}`}
                      >
                        <Play className="w-4 h-4 fill-white translate-x-0.5" />
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 text-xs font-semibold text-white truncate max-w-full group-hover:text-[#FA586A] transition-colors">
                    {artist.name}
                  </p>
                  <p className="text-[10px] text-[#71717A] mt-0.5 font-medium">
                    {artist.trackCount} {artist.trackCount === 1 ? "song" : "songs"}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 5. Playlists Shelf */}
      <section className="space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Compass className="w-4 h-4 text-[#FA586A]" />
            <h2 className="text-lg font-bold text-white tracking-tight">Playlists & Library</h2>
          </div>
          <button
            onClick={() => onNavigate("playlists")}
            className="text-xs text-[#71717A] hover:text-white transition font-medium"
          >
            All Playlists
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Liked Songs Card */}
          <div
            onClick={() => onNavigate("liked")}
            className="group relative h-36 rounded-2xl overflow-hidden cursor-pointer border border-[#FA586A]/20 bg-gradient-to-br from-[#FA586A]/30 via-rose-950/40 to-[#121216] p-4 flex flex-col justify-between hover:border-[#FA586A]/50 transition-all hover:shadow-xl hover:shadow-[#FA586A]/15"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#FA586A]/20 text-[#FA586A] border border-[#FA586A]/30">
                FAVORITES
              </span>
              <Heart className="w-6 h-6 text-[#FA586A] fill-[#FA586A] drop-shadow-md" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white group-hover:text-[#FA586A] transition-colors">
                Liked Songs
              </h3>
              <p className="text-xs text-[#A1A1AA] mt-0.5">
                {likedTracks.length} favorite {likedTracks.length === 1 ? "track" : "tracks"}
              </p>
            </div>
          </div>

          {/* User Playlists */}
          {playlists.slice(0, 3).map((pl) => (
            <div
              key={pl.id}
              onClick={() => onSelectPlaylist(pl.id)}
              className="group relative h-36 rounded-2xl overflow-hidden cursor-pointer border border-white/[0.08] bg-[#16161A] hover:bg-[#1A1A22] p-4 flex flex-col justify-between hover:border-white/[0.18] transition-all hover:shadow-lg"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/[0.08] text-[#A1A1AA]">
                  PLAYLIST
                </span>
                <Music className="w-5 h-5 text-[#71717A] group-hover:text-white transition-colors" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white truncate group-hover:text-[#FA586A] transition-colors">
                  {pl.name}
                </h3>
                <p className="text-xs text-[#71717A] mt-0.5">
                  {pl.track_ids.length} songs
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

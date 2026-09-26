import React, { useState, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlbumInfo, ArtistInfo, Playlist, Track } from "../types";
import { useNavigationStore } from "../stores/navigationStore";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { formatDuration } from "../utils/library";
import { DeleteTrackModal } from "./DeleteTrackModal";
import {
  Search,
  X,
  Play,
  Music,
  Disc,
  Users,
  ListMusic,
  Clock,
  Heart,
  Radio,
  Guitar,
  Flame,
  Zap,
  Headphones,
  Compass,
  Trash2,
} from "lucide-react";

interface SearchViewProps {
  tracks: Track[];
  albums: AlbumInfo[];
  artists: ArtistInfo[];
  playlists: Playlist[];
  onSelectArtist: (artistName: string) => void;
  onSelectAlbum: (albumTitle: string, artistName: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
  getArtworkUrl: (trackId: string) => string;
}

type SearchFilterTab = "all" | "songs" | "albums" | "artists" | "playlists";

const GRADIENT_PALETTES = [
  {
    cardGradient: "bg-gradient-to-br from-emerald-950/40 via-surface to-surface hover:from-emerald-900/50 border-emerald-500/20 hover:border-emerald-500/40",
    iconColor: "text-emerald-400",
    icon: Guitar,
  },
  {
    cardGradient: "bg-gradient-to-br from-indigo-950/40 via-surface to-surface hover:from-indigo-900/50 border-indigo-500/20 hover:border-indigo-500/40",
    iconColor: "text-indigo-400",
    icon: Flame,
  },
  {
    cardGradient: "bg-gradient-to-br from-rose-950/40 via-surface to-surface hover:from-rose-900/50 border-rose-500/20 hover:border-rose-500/40",
    iconColor: "text-rose-400",
    icon: Zap,
  },
  {
    cardGradient: "bg-gradient-to-br from-pink-950/40 via-surface to-surface hover:from-pink-900/50 border-pink-500/20 hover:border-pink-500/40",
    iconColor: "text-pink-400",
    icon: Heart,
  },
  {
    cardGradient: "bg-gradient-to-br from-amber-950/40 via-surface to-surface hover:from-amber-900/50 border-amber-500/20 hover:border-amber-500/40",
    iconColor: "text-amber-400",
    icon: Radio,
  },
  {
    cardGradient: "bg-gradient-to-br from-sky-950/40 via-surface to-surface hover:from-sky-900/50 border-sky-500/20 hover:border-sky-500/40",
    iconColor: "text-sky-400",
    icon: Headphones,
  },
  {
    cardGradient: "bg-gradient-to-br from-teal-950/40 via-surface to-surface hover:from-teal-900/50 border-teal-500/20 hover:border-teal-500/40",
    iconColor: "text-teal-400",
    icon: Compass,
  },
  {
    cardGradient: "bg-gradient-to-br from-blue-950/40 via-surface to-surface hover:from-blue-900/50 border-blue-500/20 hover:border-blue-500/40",
    iconColor: "text-blue-400",
    icon: Music,
  },
  {
    cardGradient: "bg-gradient-to-br from-violet-950/40 via-surface to-surface hover:from-violet-900/50 border-violet-500/20 hover:border-violet-500/40",
    iconColor: "text-violet-400",
    icon: Disc,
  },
  {
    cardGradient: "bg-gradient-to-br from-fuchsia-950/40 via-surface to-surface hover:from-fuchsia-900/50 border-fuchsia-500/20 hover:border-fuchsia-500/40",
    iconColor: "text-fuchsia-400",
    icon: Users,
  },
];

export const SearchView: React.FC<SearchViewProps> = ({
  tracks,
  albums,
  artists,
  playlists,
  onSelectAlbum,
  onSelectArtist,
  onSelectPlaylist,
  getArtworkUrl,
}) => {
  const globalSearch = useNavigationStore((s) => s.globalSearch);
  const setGlobalSearch = useNavigationStore((s) => s.setGlobalSearch);
  const recentSearches = useNavigationStore((s) => s.recentSearches);
  const addRecentSearch = useNavigationStore((s) => s.addRecentSearch);
  const removeRecentSearch = useNavigationStore((s) => s.removeRecentSearch);
  const clearRecentSearches = useNavigationStore((s) => s.clearRecentSearches);

  const [activeTab, setActiveTab] = useState<SearchFilterTab>("all");

  const setQueue = usePlayerStore((s) => s.setQueue);
  const isPlaying = usePlayerStore((s) => s.status.state === "Playing");
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playHistory = usePlayerStore((s) => s.playHistory);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const [trackToDelete, setTrackToDelete] = useState<Track | null>(null);
  const deleteTrack = useLibraryStore((s) => s.deleteTrack);

  const trimmedQuery = globalSearch.trim().toLowerCase();

  // Dynamically extract categories from user's actual tracks (genres, decades, or artists)
  const dynamicCategories = useMemo(() => {
    const genreMap = new Map<string, number>();
    for (const t of tracks) {
      const raw = t.metadata.genre?.trim();
      if (raw) {
        const parts = raw.split(/[,/&;]/).map((p) => p.trim()).filter(Boolean);
        for (const part of parts) {
          const capitalized = part.charAt(0).toUpperCase() + part.slice(1);
          genreMap.set(capitalized, (genreMap.get(capitalized) || 0) + 1);
        }
      }
    }

    const sorted = Array.from(genreMap.entries()).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      return sorted.slice(0, 10).map(([name, count], index) => {
        const palette = GRADIENT_PALETTES[index % GRADIENT_PALETTES.length];
        return {
          id: `genre-${name.toLowerCase().replace(/\s+/g, "-")}`,
          name,
          query: name,
          subtitle: `${count} ${count === 1 ? "track" : "tracks"}`,
          cardGradient: palette.cardGradient,
          iconColor: palette.iconColor,
          icon: palette.icon,
        };
      });
    }

    // If no genre tags in library, dynamically generate categories based on Decades
    const decadeMap = new Map<string, number>();
    for (const t of tracks) {
      const year = t.metadata.year;
      if (year && year >= 1900 && year <= 2100) {
        const decade = `${Math.floor(year / 10) * 10}s`;
        decadeMap.set(decade, (decadeMap.get(decade) || 0) + 1);
      }
    }

    const decadeEntries = Array.from(decadeMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    if (decadeEntries.length > 0) {
      return decadeEntries.slice(0, 8).map(([decade, count], index) => {
        const palette = GRADIENT_PALETTES[index % GRADIENT_PALETTES.length];
        return {
          id: `decade-${decade}`,
          name: `${decade} Music`,
          query: decade.replace("s", ""),
          subtitle: `${count} tracks`,
          cardGradient: palette.cardGradient,
          iconColor: palette.iconColor,
          icon: palette.icon,
        };
      });
    }

    // Fallback if neither genre nor year: top artists
    return artists.slice(0, 8).map((artist, index) => {
      const palette = GRADIENT_PALETTES[index % GRADIENT_PALETTES.length];
      return {
        id: `artist-${artist.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: artist.name,
        query: artist.name,
        subtitle: `${artist.trackCount} tracks`,
        cardGradient: palette.cardGradient,
        iconColor: palette.iconColor,
        icon: palette.icon,
      };
    });
  }, [tracks, artists]);

  // Suggested albums based on real playback history or date_added
  const suggestedAlbums = useMemo(() => {
    if (playHistory.length > 0) {
      const historyAlbums: AlbumInfo[] = [];
      const seen = new Set<string>();
      for (const entry of playHistory) {
        const trackId = entry.trackId;
        const tr = tracks.find((t) => t.id === trackId);
        if (tr?.metadata.album) {
          const key = `${tr.metadata.album.toLowerCase()}:::${(tr.metadata.artist || "").toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            const found = albums.find(
              (a) =>
                a.title.toLowerCase() === tr.metadata.album!.toLowerCase() &&
                a.artist.toLowerCase() === (tr.metadata.artist || "").toLowerCase()
            );
            if (found) {
              historyAlbums.push(found);
              if (historyAlbums.length >= 6) break;
            }
          }
        }
      }
      if (historyAlbums.length > 0) return historyAlbums;
    }
    return albums
      .slice()
      .sort((a, b) => {
        const maxA = Math.max(...a.tracks.map((t) => t.date_added || 0), 0);
        const maxB = Math.max(...b.tracks.map((t) => t.date_added || 0), 0);
        return maxB - maxA;
      })
      .slice(0, 6);
  }, [playHistory, tracks, albums]);

  // 1. Search Results Computation
  const matchingTracks = useMemo(() => {
    if (!trimmedQuery) return [];
    return tracks.filter((t) => {
      const title = t.metadata.title?.toLowerCase() || "";
      const artist = t.metadata.artist?.toLowerCase() || "";
      const album = t.metadata.album?.toLowerCase() || "";
      const genre = t.metadata.genre?.toLowerCase() || "";
      return (
        title.includes(trimmedQuery) ||
        artist.includes(trimmedQuery) ||
        album.includes(trimmedQuery) ||
        genre.includes(trimmedQuery)
      );
    });
  }, [tracks, trimmedQuery]);

  const matchingAlbums = useMemo(() => {
    if (!trimmedQuery) return [];
    return albums.filter((a) => {
      const title = a.title.toLowerCase();
      const artist = a.artist.toLowerCase();
      return title.includes(trimmedQuery) || artist.includes(trimmedQuery);
    });
  }, [albums, trimmedQuery]);

  const matchingArtists = useMemo(() => {
    if (!trimmedQuery) return [];
    return artists.filter((a) => a.name.toLowerCase().includes(trimmedQuery));
  }, [artists, trimmedQuery]);

  const matchingPlaylists = useMemo(() => {
    if (!trimmedQuery) return [];
    return playlists.filter((p) => p.name.toLowerCase().includes(trimmedQuery));
  }, [playlists, trimmedQuery]);

  // 2. Top Result Card (Apple Music signature feature)
  const topResult = useMemo(() => {
    if (!trimmedQuery) return null;

    // Check for exact/prefix artist match first
    const exactArtist = artists.find(
      (a) =>
        a.name.toLowerCase() === trimmedQuery ||
        a.name.toLowerCase().startsWith(trimmedQuery)
    );
    if (exactArtist) {
      return {
        type: "artist" as const,
        item: exactArtist,
        title: exactArtist.name,
        subtitle: `Artist • ${exactArtist.trackCount} songs`,
        artworkTrackId: exactArtist.artworkTrackId,
      };
    }

    // Check for exact/prefix album match
    const exactAlbum = albums.find(
      (a) =>
        a.title.toLowerCase() === trimmedQuery ||
        a.title.toLowerCase().startsWith(trimmedQuery)
    );
    if (exactAlbum) {
      return {
        type: "album" as const,
        item: exactAlbum,
        title: exactAlbum.title,
        subtitle: `Album • ${exactAlbum.artist}`,
        artworkTrackId: exactAlbum.artworkTrackId,
      };
    }

    // Check top matching track
    if (matchingTracks.length > 0) {
      const track = matchingTracks[0];
      return {
        type: "song" as const,
        item: track,
        title: track.metadata.title || "Untitled",
        subtitle: `Song • ${track.metadata.artist || "Unknown"}`,
        artworkTrackId: track.id,
      };
    }

    // Check any matching album
    if (matchingAlbums.length > 0) {
      const album = matchingAlbums[0];
      return {
        type: "album" as const,
        item: album,
        title: album.title,
        subtitle: `Album • ${album.artist}`,
        artworkTrackId: album.artworkTrackId,
      };
    }

    // Check any matching artist
    if (matchingArtists.length > 0) {
      const artist = matchingArtists[0];
      return {
        type: "artist" as const,
        item: artist,
        title: artist.name,
        subtitle: `Artist • ${artist.trackCount} songs`,
        artworkTrackId: artist.artworkTrackId,
      };
    }

    return null;
  }, [trimmedQuery, artists, albums, matchingTracks, matchingAlbums, matchingArtists]);

  // Handle Play for Top Result
  const handlePlayTopResult = useCallback(async () => {
    if (!topResult) return;
    if (topResult.type === "song") {
      const track = topResult.item as Track;
      await setQueue([track, ...matchingTracks.filter((t) => t.id !== track.id)], 0, {
        type: "tracks",
        name: `Search: ${globalSearch}`,
      });
    } else if (topResult.type === "album") {
      const album = topResult.item as AlbumInfo;
      if (album.tracks.length > 0) {
        await setQueue(album.tracks, 0, {
          type: "album",
          name: album.title,
          artist: album.artist,
        });
      }
    } else if (topResult.type === "artist") {
      const artist = topResult.item as ArtistInfo;
      if (artist.tracks.length > 0) {
        await setQueue(artist.tracks, 0, {
          type: "artist",
          name: artist.name,
        });
      }
    }
  }, [topResult, matchingTracks, globalSearch, setQueue]);

  // Play a single track from songs list
  const handlePlayTrack = useCallback(
    async (track: Track, index: number) => {
      addRecentSearch(track.metadata.title || globalSearch);
      await setQueue(matchingTracks, index, {
        type: "tracks",
        name: `Search: ${globalSearch}`,
      });
    },
    [matchingTracks, globalSearch, addRecentSearch, setQueue]
  );

  // Play an album
  const handlePlayAlbum = useCallback(
    async (album: AlbumInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      addRecentSearch(album.title);
      if (album.tracks.length > 0) {
        await setQueue(album.tracks, 0, {
          type: "album",
          name: album.title,
          artist: album.artist,
        });
      }
    },
    [addRecentSearch, setQueue]
  );

  // Play an artist
  const handlePlayArtist = useCallback(
    async (artist: ArtistInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      addRecentSearch(artist.name);
      if (artist.tracks.length > 0) {
        await setQueue(artist.tracks, 0, {
          type: "artist",
          name: artist.name,
        });
      }
    },
    [addRecentSearch, setQueue]
  );

  // Track context menu
  const handleTrackContextMenu = useCallback(
    (e: React.MouseEvent, track: Track) => {
      e.preventDefault();
      e.stopPropagation();

      const items: ContextMenuItem[] = [
        {
          id: "play-track",
          label: "Play",
          icon: Play,
          onClick: () => handlePlayTrack(track, matchingTracks.indexOf(track)),
        },
        {
          id: "divider-1",
          label: "",
          divider: true,
        },
        ...(track.metadata.album
          ? [
              {
                id: "go-album",
                label: `Go to Album "${track.metadata.album}"`,
                icon: Disc,
                onClick: () =>
                  onSelectAlbum(
                    track.metadata.album || "",
                    track.metadata.artist || ""
                  ),
              },
            ]
          : []),
        ...(track.metadata.artist
          ? [
              {
                id: "go-artist",
                label: `Go to Artist "${track.metadata.artist}"`,
                icon: Users,
                onClick: () => onSelectArtist(track.metadata.artist || ""),
              },
            ]
          : []),
        {
          id: "divider-del",
          label: "",
          divider: true,
        },
        {
          id: "delete-track-search",
          label: "Delete Song...",
          icon: Trash2,
          danger: true,
          onClick: () => setTrackToDelete(track),
        },
      ];

      openContextMenu(e, items);
    },
    [handlePlayTrack, matchingTracks, onSelectAlbum, onSelectArtist, openContextMenu, setTrackToDelete]
  );

  const totalResultsCount =
    matchingTracks.length +
    matchingAlbums.length +
    matchingArtists.length +
    matchingPlaylists.length;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: activeTab === "songs" ? matchingTracks.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-7 select-none pb-28 sm:pb-24"
    >
      {/* 1. Header & Active Search Filters */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {trimmedQuery ? `Results for “${trimmedQuery}”` : "Explore"}
            </h1>
            <p className="text-xs sm:text-sm text-textMuted mt-1">
              {trimmedQuery
                ? `${totalResultsCount} ${totalResultsCount === 1 ? "result" : "results"} found across your library`
                : "Search songs, artists, albums, or explore curated categories below."}
            </p>
          </div>

          {trimmedQuery && (
            <button
              onClick={() => setGlobalSearch("")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-textMuted hover:text-white bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 rounded-lg border border-white/[0.08] transition-all"
              title="Clear search query"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear search</span>
            </button>
          )}
        </div>

        {/* Filter Pills when query is present */}
        {trimmedQuery && (
          <div className="flex items-center gap-2 overflow-x-auto pt-1 pb-1">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                activeTab === "all"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "bg-white/[0.06] text-textSecondary hover:text-white hover:bg-white/[0.10]"
              }`}
            >
              All Results
            </button>
            <button
              onClick={() => setActiveTab("songs")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                activeTab === "songs"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "bg-white/[0.06] text-textSecondary hover:text-white hover:bg-white/[0.10]"
              }`}
            >
              Songs ({matchingTracks.length})
            </button>
            <button
              onClick={() => setActiveTab("albums")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                activeTab === "albums"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "bg-white/[0.06] text-textSecondary hover:text-white hover:bg-white/[0.10]"
              }`}
            >
              Albums ({matchingAlbums.length})
            </button>
            <button
              onClick={() => setActiveTab("artists")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                activeTab === "artists"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "bg-white/[0.06] text-textSecondary hover:text-white hover:bg-white/[0.10]"
              }`}
            >
              Artists ({matchingArtists.length})
            </button>
            <button
              onClick={() => setActiveTab("playlists")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                activeTab === "playlists"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "bg-white/[0.06] text-textSecondary hover:text-white hover:bg-white/[0.10]"
              }`}
            >
              Playlists ({matchingPlaylists.length})
            </button>
          </div>
        )}
      </div>

      {/* 2. STATE A: BROWSE & EXPLORE (When query is empty) */}
      {!trimmedQuery && (
        <div className="space-y-9">
          {/* Recent Searches Chips */}
          {recentSearches.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-bold text-textSecondary uppercase tracking-wider">
                  <Clock className="w-3.5 h-3.5 text-accent" />
                  <span>Recent Searches</span>
                </div>
                <button
                  onClick={clearRecentSearches}
                  className="text-xs text-textMuted hover:text-white transition font-medium"
                >
                  Clear History
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {recentSearches.map((search) => (
                  <div
                    key={search}
                    onClick={() => setGlobalSearch(search)}
                    className="group inline-flex items-center space-x-2 px-3 py-1.5 bg-surface hover:bg-surfaceActive border border-white/[0.08] hover:border-white/[0.18] rounded-full text-xs font-medium text-textPrimary cursor-pointer transition shadow-sm"
                  >
                    <Search className="w-3 h-3 text-textMuted group-hover:text-accent transition-colors" />
                    <span>{search}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecentSearch(search);
                      }}
                      className="text-textMuted hover:text-white p-0.5 rounded-full transition ml-1"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Browse Categories (Apple Music Vibrant Category Grid) */}
          <div className="space-y-3.5">
            <div className="flex items-center space-x-2">
              <Compass className="w-4 h-4 text-accent" />
              <h2 className="text-lg font-bold text-white tracking-tight">
                Browse Categories
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {dynamicCategories.map((cat) => {
                const IconComponent = cat.icon;
                return (
                  <div
                    key={cat.id}
                    onClick={() => {
                      setGlobalSearch(cat.query);
                      addRecentSearch(cat.query);
                    }}
                    className={`group relative h-28 sm:h-32 rounded-2xl overflow-hidden cursor-pointer p-4 flex flex-col justify-between border transition-all duration-300 hover:shadow-xl hover:scale-[1.02] shadow-sm ${cat.cardGradient}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm sm:text-base font-extrabold text-textPrimary tracking-tight leading-tight">
                        {cat.name}
                      </span>
                      <IconComponent className={`w-5 h-5 ${cat.iconColor} group-hover:scale-110 transition-transform flex-shrink-0`} />
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-semibold text-textSecondary group-hover:text-textPrimary transition-colors">
                      <span>{cat.subtitle}</span>
                      <span className="group-hover:translate-x-1 transition-transform">→</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Suggested Albums from Library based on history */}
          {suggestedAlbums.length > 0 && (
            <div className="space-y-3.5">
              <h2 className="text-lg font-bold text-white tracking-tight">
                Suggested From Your Library
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {suggestedAlbums.map((album) => {
                  const artworkUrl = album.artworkTrackId
                    ? getArtworkUrl(album.artworkTrackId)
                    : null;
                  return (
                    <div
                      key={album.title}
                      onClick={() => onSelectAlbum(album.title, album.artist)}
                      className="group cursor-pointer flex flex-col"
                    >
                      <div className="relative aspect-square rounded-xl overflow-hidden bg-surface border border-white/[0.08] group-hover:border-white/[0.2] transition shadow-md">
                        {artworkUrl ? (
                          <img
                            src={artworkUrl}
                            alt={album.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-textMuted">
                            <Disc className="w-10 h-10" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                          <button
                            onClick={(e) => handlePlayAlbum(album, e)}
                            className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-lg hover:scale-110 transition"
                          >
                            <Play className="w-4 h-4 fill-white translate-x-0.5" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs font-semibold text-white truncate group-hover:text-accent transition">
                        {album.title}
                      </p>
                      <p className="text-[11px] text-textMuted truncate">
                        {album.artist}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. STATE B: SEARCH RESULTS (When query is typed) */}
      {trimmedQuery && (
        <div className="space-y-8">
          {totalResultsCount === 0 ? (
            /* Empty Search State */
            <div className="flex flex-col items-center justify-center py-16 text-center select-none">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-textMuted mb-4">
                <Search className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">
                No Results Found
              </h3>
              <p className="text-xs text-textSecondary max-w-sm">
                We couldn't find any songs, albums, or artists matching "
                <span className="text-white font-medium">{globalSearch}</span>". Check your spelling or try another query.
              </p>
            </div>
          ) : (
            <>
              {/* "All Results" Tab View: Top Result + Songs split layout */}
              {activeTab === "all" && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Top Result Hero Card (Apple Music style) */}
                    {topResult && (
                      <div className="lg:col-span-5 space-y-2.5">
                        <h2 className="text-base font-bold text-white tracking-tight">
                          Top Result
                        </h2>
                        <div
                          onClick={() => {
                            if (topResult.type === "album") {
                              const alb = topResult.item as AlbumInfo;
                              onSelectAlbum(alb.title, alb.artist);
                            } else if (topResult.type === "artist") {
                              const art = topResult.item as ArtistInfo;
                              onSelectArtist(art.name);
                            } else {
                              handlePlayTopResult();
                            }
                          }}
                          className="group relative h-[210px] rounded-2xl bg-surface border border-white/[0.08] hover:border-white/[0.18] p-5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-md hover:shadow-xl"
                        >
                          <div className="flex items-start justify-between">
                            {/* Entity Artwork / Avatar */}
                            <div
                              className={`w-20 h-20 overflow-hidden bg-surfaceActive border border-white/[0.08] shadow-md ${
                                topResult.type === "artist"
                                  ? "rounded-full"
                                  : "rounded-xl"
                              }`}
                            >
                              {topResult.artworkTrackId ? (
                                <img
                                  src={getArtworkUrl(topResult.artworkTrackId)}
                                  alt={topResult.title}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-textMuted">
                                  {topResult.type === "artist" ? (
                                    <Users className="w-8 h-8" />
                                  ) : (
                                    <Disc className="w-8 h-8" />
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Prominent Play Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayTopResult();
                              }}
                              className="w-12 h-12 rounded-full bg-accent text-white shadow-xl flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
                              title="Play"
                            >
                              <Play className="w-5 h-5 fill-white translate-x-0.5" />
                            </button>
                          </div>

                          <div>
                            <span className="text-[10px] font-black tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/[0.08] text-accent border border-white/[0.06]">
                              {topResult.type.toUpperCase()}
                            </span>
                            <h3 className="text-xl font-extrabold text-white mt-1.5 truncate group-hover:text-accent transition-colors">
                              {topResult.title}
                            </h3>
                            <p className="text-xs text-textSecondary truncate mt-0.5">
                              {topResult.subtitle}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Songs preview (top 4-5) */}
                    <div
                      className={`${
                        topResult ? "lg:col-span-7" : "lg:col-span-12"
                      } space-y-2.5`}
                    >
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-bold text-white tracking-tight">
                          Songs
                        </h2>
                        {matchingTracks.length > 4 && (
                          <button
                            onClick={() => setActiveTab("songs")}
                            className="text-xs text-textMuted hover:text-white transition font-medium"
                          >
                            See all ({matchingTracks.length})
                          </button>
                        )}
                      </div>

                      <div className="space-y-1 bg-surface/60 border border-white/[0.06] rounded-2xl p-2">
                        {matchingTracks.slice(0, 4).map((track, idx) => {
                          const isThisPlaying =
                            currentTrack?.id === track.id && isPlaying;
                          const artworkUrl = getArtworkUrl(track.id);

                          return (
                            <div
                              key={track.id}
                              onClick={() => handlePlayTrack(track, idx)}
                              onContextMenu={(e) => handleTrackContextMenu(e, track)}
                              className="group flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/[0.06] cursor-pointer transition"
                            >
                              <div className="flex items-center space-x-3 min-w-0 pr-4">
                                <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-surfaceActive border border-white/[0.06] flex-shrink-0">
                                  {artworkUrl ? (
                                    <img
                                      src={artworkUrl}
                                      alt={track.metadata.title}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLElement).style.display =
                                          "none";
                                      }}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-textMuted">
                                      <Music className="w-4 h-4" />
                                    </div>
                                  )}

                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                    <Play className="w-4 h-4 fill-white translate-x-0.5" />
                                  </div>
                                </div>

                                <div className="min-w-0">
                                  <p
                                    className={`text-xs font-semibold truncate ${
                                      isThisPlaying
                                        ? "text-accent"
                                        : "text-white group-hover:text-accent"
                                    } transition-colors`}
                                  >
                                    {track.metadata.title || "Untitled Track"}
                                  </p>
                                  <p className="text-[11px] text-textSecondary truncate">
                                    {track.metadata.artist || "Unknown Artist"}
                                  </p>
                                </div>
                              </div>

                              <span className="text-xs text-textMuted font-mono flex-shrink-0">
                                {formatDuration(track.metadata.duration.secs)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Matching Albums Shelf */}
                  {matchingAlbums.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-bold text-white tracking-tight">
                          Albums
                        </h2>
                        {matchingAlbums.length > 5 && (
                          <button
                            onClick={() => setActiveTab("albums")}
                            className="text-xs text-textMuted hover:text-white transition font-medium"
                          >
                            See all ({matchingAlbums.length})
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {matchingAlbums.slice(0, 6).map((album) => {
                          const artworkUrl = album.artworkTrackId
                            ? getArtworkUrl(album.artworkTrackId)
                            : null;
                          return (
                            <div
                              key={album.title}
                              onClick={() => onSelectAlbum(album.title, album.artist)}
                              className="group cursor-pointer flex flex-col"
                            >
                              <div className="relative aspect-square rounded-xl overflow-hidden bg-surface border border-white/[0.08] group-hover:border-white/[0.2] transition shadow-md">
                                {artworkUrl ? (
                                  <img
                                    src={artworkUrl}
                                    alt={album.title}
                                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-textMuted">
                                    <Disc className="w-10 h-10" />
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                  <button
                                    onClick={(e) => handlePlayAlbum(album, e)}
                                    className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-lg hover:scale-110 transition"
                                  >
                                    <Play className="w-4 h-4 fill-white translate-x-0.5" />
                                  </button>
                                </div>
                              </div>
                              <p className="mt-2 text-xs font-semibold text-white truncate group-hover:text-accent transition">
                                {album.title}
                              </p>
                              <p className="text-[11px] text-textMuted truncate">
                                {album.artist}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Matching Artists Row */}
                  {matchingArtists.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-bold text-white tracking-tight">
                          Artists
                        </h2>
                        {matchingArtists.length > 6 && (
                          <button
                            onClick={() => setActiveTab("artists")}
                            className="text-xs text-textMuted hover:text-white transition font-medium"
                          >
                            See all ({matchingArtists.length})
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                        {matchingArtists.slice(0, 6).map((artist) => {
                          const artworkUrl = artist.artworkTrackId
                            ? getArtworkUrl(artist.artworkTrackId)
                            : null;
                          return (
                            <div
                              key={artist.name}
                              onClick={() => onSelectArtist(artist.name)}
                              className="group flex flex-col items-center text-center cursor-pointer"
                            >
                              <div className="relative w-24 h-24 rounded-full overflow-hidden bg-surface border border-white/[0.08] group-hover:border-accent/50 transition shadow-md">
                                {artworkUrl ? (
                                  <img
                                    src={artworkUrl}
                                    alt={artist.name}
                                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-textMuted">
                                    <Users className="w-8 h-8" />
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                  <button
                                    onClick={(e) => handlePlayArtist(artist, e)}
                                    className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center shadow-lg hover:scale-110 transition"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-white translate-x-0.5" />
                                  </button>
                                </div>
                              </div>
                              <p className="mt-2 text-xs font-semibold text-white truncate max-w-full group-hover:text-accent transition">
                                {artist.name}
                              </p>
                              <p className="text-[10px] text-textMuted">
                                {artist.trackCount} {artist.trackCount === 1 ? "song" : "songs"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Matching Playlists */}
                  {matchingPlaylists.length > 0 && (
                    <div className="space-y-3">
                      <h2 className="text-base font-bold text-white tracking-tight">
                        Playlists
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {matchingPlaylists.map((pl) => (
                          <div
                            key={pl.id}
                            onClick={() => onSelectPlaylist(pl.id)}
                            className="group p-4 bg-surface hover:bg-surfaceActive border border-white/[0.08] hover:border-white/[0.18] rounded-2xl cursor-pointer transition shadow-sm"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <ListMusic className="w-5 h-5 text-accent" />
                              <span className="text-[10px] text-textMuted font-mono">
                                {pl.track_ids.length} songs
                              </span>
                            </div>
                            <h3 className="text-sm font-bold text-white truncate group-hover:text-accent transition">
                              {pl.name}
                            </h3>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* "Songs" Tab View */}
              {activeTab === "songs" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 text-xs text-textMuted px-3 font-semibold uppercase">
                    <span>Title</span>
                    <span>Duration</span>
                  </div>
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const track = matchingTracks[virtualRow.index];
                      if (!track) return null;
                      const isThisPlaying = currentTrack?.id === track.id && isPlaying;
                      const artworkUrl = getArtworkUrl(track.id);

                      return (
                        <div
                          key={track.id}
                          onClick={() => handlePlayTrack(track, virtualRow.index)}
                          onContextMenu={(e) => handleTrackContextMenu(e, track)}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                          className="group flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/[0.06] cursor-pointer transition"
                        >
                          <div className="flex items-center space-x-3 min-w-0 pr-4">
                            <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-surfaceActive border border-white/[0.06] flex-shrink-0">
                              {artworkUrl ? (
                                <img
                                  src={artworkUrl}
                                  alt={track.metadata.title}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-textMuted">
                                  <Music className="w-4 h-4" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                <Play className="w-4 h-4 fill-white translate-x-0.5" />
                              </div>
                            </div>
                            <div className="min-w-0">
                              <p
                                className={`text-xs font-semibold truncate ${
                                  isThisPlaying
                                    ? "text-accent"
                                    : "text-white group-hover:text-accent"
                                } transition-colors`}
                              >
                                {track.metadata.title || "Untitled Track"}
                              </p>
                              <p className="text-[11px] text-textSecondary truncate">
                                {track.metadata.artist || "Unknown Artist"} • {track.metadata.album || "Unknown Album"}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs text-textMuted font-mono">
                            {formatDuration(track.metadata.duration.secs)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* "Albums" Tab View */}
              {activeTab === "albums" && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {matchingAlbums.map((album) => {
                    const artworkUrl = album.artworkTrackId
                      ? getArtworkUrl(album.artworkTrackId)
                      : null;
                    return (
                      <div
                        key={album.title}
                        onClick={() => onSelectAlbum(album.title, album.artist)}
                        className="group cursor-pointer flex flex-col"
                      >
                        <div className="relative aspect-square rounded-xl overflow-hidden bg-surface border border-white/[0.08] group-hover:border-white/[0.2] transition shadow-md">
                          {artworkUrl ? (
                            <img
                              src={artworkUrl}
                              alt={album.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-textMuted">
                              <Disc className="w-10 h-10" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                            <button
                              onClick={(e) => handlePlayAlbum(album, e)}
                              className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-lg hover:scale-110 transition"
                            >
                              <Play className="w-4 h-4 fill-white translate-x-0.5" />
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-xs font-semibold text-white truncate group-hover:text-accent transition">
                          {album.title}
                        </p>
                        <p className="text-[11px] text-textMuted truncate">
                          {album.artist}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* "Artists" Tab View */}
              {activeTab === "artists" && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                  {matchingArtists.map((artist) => {
                    const artworkUrl = artist.artworkTrackId
                      ? getArtworkUrl(artist.artworkTrackId)
                      : null;
                    return (
                      <div
                        key={artist.name}
                        onClick={() => onSelectArtist(artist.name)}
                        className="group flex flex-col items-center text-center cursor-pointer"
                      >
                        <div className="relative w-28 h-28 rounded-full overflow-hidden bg-surface border border-white/[0.08] group-hover:border-accent/50 transition shadow-md">
                          {artworkUrl ? (
                            <img
                              src={artworkUrl}
                              alt={artist.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-textMuted">
                              <Users className="w-8 h-8" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                            <button
                              onClick={(e) => handlePlayArtist(artist, e)}
                              className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center shadow-lg hover:scale-110 transition"
                            >
                              <Play className="w-3.5 h-3.5 fill-white translate-x-0.5" />
                            </button>
                          </div>
                        </div>
                        <p className="mt-2.5 text-xs font-semibold text-white truncate max-w-full group-hover:text-accent transition">
                          {artist.name}
                        </p>
                        <p className="text-[10px] text-textMuted">
                          {artist.trackCount} {artist.trackCount === 1 ? "song" : "songs"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* "Playlists" Tab View */}
              {activeTab === "playlists" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {matchingPlaylists.map((pl) => (
                    <div
                      key={pl.id}
                      onClick={() => onSelectPlaylist(pl.id)}
                      className="group p-4 bg-surface hover:bg-surfaceActive border border-white/[0.08] hover:border-white/[0.18] rounded-2xl cursor-pointer transition shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <ListMusic className="w-5 h-5 text-accent" />
                        <span className="text-[10px] text-textMuted font-mono">
                          {pl.track_ids.length} songs
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-white truncate group-hover:text-accent transition">
                        {pl.name}
                      </h3>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Delete Track Modal */}
      <DeleteTrackModal
        isOpen={!!trackToDelete}
        onClose={() => setTrackToDelete(null)}
        track={trackToDelete}
        onConfirm={async (id, removeFile) => {
          await deleteTrack(id, removeFile);
        }}
      />
    </div>
  );
};

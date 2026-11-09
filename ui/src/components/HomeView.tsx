import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { AlbumInfo, ArtistInfo, Playlist, Track, ViewMode } from "../types";
import { usePlayerStore } from "../stores/playerStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { isArtistHidden, extractLibraryGenres } from "../utils/library";
import {
  Play,
  ChevronRight,
  ChevronLeft,
  Heart,
  FolderPlus,
  Radio,
  Music,
  Disc,
  Users,
  Clock,
  Calendar,
  EyeOff,
  Eye,
  Compass,
  RotateCw,
  Guitar,
  Activity,
  Zap,
  Waves,
  Mic,
  Headphones,
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
  badgeColor?: string;
  dotColor?: string;
  title: string;
  subtitle: string;
  artworkTrackId?: string;
  tracks: Track[];
  type: "album" | "station" | "mix" | "artist";
  targetAlbum?: { title: string; artist: string };
  targetArtist?: string;
}

interface InfiniteShelfProps<T> {
  id: string;
  title: string;
  icon?: React.ReactNode;
  badge?: string;
  headerAction?: React.ReactNode;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  items: T[];
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  stepPixels?: number;
  resetScrollTrigger?: number;
}

/**
 * Reusable infinite horizontal side-scrolling shelf with smooth momentum,
 * zero scrollbar clutter, and seamless looping when scrolling past boundaries.
 */
function InfiniteShelf<T>({
  id,
  title,
  icon,
  badge,
  headerAction,
  onSeeAll,
  seeAllLabel = "See All",
  items,
  getItemKey,
  renderItem,
  stepPixels,
  resetScrollTrigger,
}: InfiniteShelfProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 6);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 6);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);

    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll, items.length]);

  useEffect(() => {
    if (!resetScrollTrigger) return;
    const el = scrollRef.current;
    if (el && el.scrollLeft > 6) {
      el.scrollTo({ left: 0, behavior: "smooth" });
    }
  }, [resetScrollTrigger]);

  const handleScrollBy = useCallback(
    (direction: "left" | "right") => {
      const el = scrollRef.current;
      if (!el) return;
      const step = stepPixels || Math.max(220, Math.floor(el.clientWidth * 0.75));
      const distance = direction === "left" ? -step : step;
      el.scrollBy({ left: distance, behavior: "smooth" });
    },
    [stepPixels]
  );

  if (items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {icon}
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">{title}</h2>
          {badge && (
            <span className="hidden sm:inline-block px-2 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-2xs font-semibold text-textSecondary">
              {badge}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {headerAction}
          {onSeeAll && (
            <button
              type="button"
              onClick={onSeeAll}
              className="text-xs text-textMuted hover:text-white transition font-medium mr-1 active:scale-95"
            >
              {seeAllLabel}
            </button>
          )}

          {/* Clean Desktop Navigation Chevrons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleScrollBy("left")}
              disabled={!canScrollLeft}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.14] active:scale-95 flex items-center justify-center text-white/80 hover:text-white transition border border-white/[0.06] disabled:opacity-20 disabled:cursor-default disabled:hover:bg-white/[0.06]"
              aria-label="Scroll previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleScrollBy("right")}
              disabled={!canScrollRight}
              className="w-7 h-7 rounded-full bg-white/[0.06] hover:bg-white/[0.14] active:scale-95 flex items-center justify-center text-white/80 hover:text-white transition border border-white/[0.06] disabled:opacity-20 disabled:cursor-default disabled:hover:bg-white/[0.06]"
              aria-label="Scroll next"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Side-Scrolling Shelf without artificial duplicates */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-none snap-x snap-proximity -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8 scroll-pl-4 sm:scroll-pl-6 md:scroll-pl-8 pt-2 pb-14 -mb-10"
      >
        {items.map((item, idx) => (
          <div key={`${id}-${getItemKey(item, idx)}`} className="flex-shrink-0 snap-start">
            {renderItem(item, idx)}
          </div>
        ))}
      </div>
    </section>
  );
}

interface GenreCardTheme {
  icon: React.ComponentType<{ className?: string }>;
  gradientClass: string;
  borderColorClass: string;
  iconColorClass: string;
}

function getGenreTheme(genreName: string): GenreCardTheme {
  const g = genreName.toLowerCase();

  // Rock / Alternative / Punk / Grunge
  if (g.includes("rock") || g.includes("alt") || g.includes("punk") || g.includes("grunge")) {
    return {
      icon: Guitar,
      gradientClass: "bg-gradient-to-br from-danger/15 via-surface to-surface",
      borderColorClass: "border-danger/25 hover:border-danger/50",
      iconColorClass: "text-danger",
    };
  }

  // Metal
  if (g.includes("metal")) {
    return {
      icon: Zap,
      gradientClass: "bg-gradient-to-br from-danger/20 via-surface to-surface",
      borderColorClass: "border-danger/30 hover:border-danger/60",
      iconColorClass: "text-danger",
    };
  }

  // Electronic / Dance / Techno / House / EDM / Electro
  if (
    g.includes("electr") ||
    g.includes("dance") ||
    g.includes("techno") ||
    g.includes("house") ||
    g.includes("edm") ||
    g.includes("synth")
  ) {
    return {
      icon: Activity,
      gradientClass: "bg-gradient-to-br from-success/15 via-surface to-surface",
      borderColorClass: "border-success/25 hover:border-success/50",
      iconColorClass: "text-success",
    };
  }

  // Pop / R&B
  if (g.includes("pop") || g.includes("r&b") || g.includes("k-pop") || g.includes("j-pop")) {
    return {
      icon: Music,
      gradientClass: "bg-gradient-to-br from-accent/20 via-surface to-surface",
      borderColorClass: "border-accent/30 hover:border-accent/60",
      iconColorClass: "text-accent",
    };
  }

  // Hip-Hop / Rap
  if (g.includes("hip") || g.includes("rap")) {
    return {
      icon: Mic,
      gradientClass: "bg-gradient-to-br from-warning/20 via-surface to-surface",
      borderColorClass: "border-warning/30 hover:border-warning/60",
      iconColorClass: "text-warning",
    };
  }

  // Jazz / Blues / Soul / Funk
  if (g.includes("jazz") || g.includes("blues") || g.includes("soul") || g.includes("funk")) {
    return {
      icon: Music,
      gradientClass: "bg-gradient-to-br from-warning/15 via-surface to-surface",
      borderColorClass: "border-warning/25 hover:border-warning/50",
      iconColorClass: "text-warning",
    };
  }

  // Classical / Ambient / Easy Listening / Instrumental / Acoustic
  if (
    g.includes("classic") ||
    g.includes("ambient") ||
    g.includes("easy") ||
    g.includes("instrument") ||
    g.includes("chill") ||
    g.includes("acoustic")
  ) {
    return {
      icon: Waves,
      gradientClass: "bg-gradient-to-br from-white/[0.08] via-surface to-surface",
      borderColorClass: "border-white/[0.12] hover:border-white/[0.3]",
      iconColorClass: "text-white/80",
    };
  }

  // Soundtrack / Score / OST
  if (g.includes("soundtrack") || g.includes("ost") || g.includes("score")) {
    return {
      icon: Disc,
      gradientClass: "bg-gradient-to-br from-white/[0.06] via-surface to-surface",
      borderColorClass: "border-white/[0.1] hover:border-white/[0.25]",
      iconColorClass: "text-textSecondary",
    };
  }

  // Indie / Folk / Singer-Songwriter
  if (g.includes("indie") || g.includes("folk") || g.includes("country")) {
    return {
      icon: Headphones,
      gradientClass: "bg-gradient-to-br from-warning/15 via-surface to-surface",
      borderColorClass: "border-warning/25 hover:border-warning/50",
      iconColorClass: "text-warning",
    };
  }

  // Fallback
  return {
    icon: Music,
    gradientClass: "bg-gradient-to-br from-white/[0.06] via-surface to-surface",
    borderColorClass: "border-white/[0.1] hover:border-white/[0.25]",
    iconColorClass: "text-textSecondary",
  };
}

/**
 * Fast seedable PRNG (Mulberry32-based) for deterministic daily & shuffle rotation.
 */
function createPicksRng(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates array shuffle using a deterministic PRNG function.
 */
function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
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
  const hiddenArtists = useSettingsStore((s) => s.hiddenArtists);
  const toggleHideArtist = useSettingsStore((s) => s.toggleHideArtist);

  // Daily seed string (e.g. "2026-11-01"), dynamically re-rollable on demand
  const [picksSeed, setPicksSeed] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  });
  const [picksRefreshEpoch, setPicksRefreshEpoch] = useState(0);
  const [picksSpinCount, setPicksSpinCount] = useState(0);
  const [picksRefreshPhase, setPicksRefreshPhase] = useState<"idle" | "exiting" | "entering">("idle");
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRefreshingPicks = picksRefreshPhase !== "idle";

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    };
  }, []);

  const handleRefreshPicks = useCallback(() => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);

    setPicksSpinCount((count) => count + 1);

    // If a refresh is already mid-flight, interrupt cleanly into the new deal immediately
    if (picksRefreshPhase !== "idle") {
      setPicksRefreshEpoch((epoch) => {
        const nextEpoch = epoch + 1;
        setPicksSeed(`${Date.now()}-${nextEpoch}`);
        return nextEpoch;
      });
      setPicksRefreshPhase("entering");
      enterTimerRef.current = setTimeout(() => {
        setPicksRefreshPhase("idle");
      }, 640);
      return;
    }

    setPicksRefreshPhase("exiting");
    exitTimerRef.current = setTimeout(() => {
      setPicksRefreshEpoch((epoch) => {
        const nextEpoch = epoch + 1;
        setPicksSeed(`${Date.now()}-${nextEpoch}`);
        return nextEpoch;
      });
      setPicksRefreshPhase("entering");
      enterTimerRef.current = setTimeout(() => {
        setPicksRefreshPhase("idle");
      }, 640);
    }, 115);
  }, [picksRefreshPhase]);

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
                a.artist.toLowerCase() === (tr.metadata.artist || "").toLowerCase() &&
                !isArtistHidden(a.artist)
            );
            if (foundAlbum) {
              historyAlbums.push(foundAlbum);
              if (historyAlbums.length >= 16) break;
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
      .filter((a) => !isArtistHidden(a.artist))
      .slice()
      .sort((a, b) => {
        const maxA = Math.max(...a.tracks.map((t) => t.date_added || 0), 0);
        const maxB = Math.max(...b.tracks.map((t) => t.date_added || 0), 0);
        return maxB - maxA;
      })
      .slice(0, 16);

    return { title: "Recently Added", isHistory: false, albums: byDate };
  }, [playHistory, tracks, albums, hiddenArtists]);

  // 2. Dynamic Library Genres extraction with multilingual normalization & grouping
  const libraryGenres = useMemo(() => {
    return extractLibraryGenres(tracks);
  }, [tracks]);

  // 3. Dynamic "Top Picks for You" Generation (Rotating daily & on-refresh across multiple dimensions)
  const editorialPicks = useMemo<EditorialPick[]>(() => {
    const picks: EditorialPick[] = [];
    const visibleAlbums = albums.filter((a) => !isArtistHidden(a.artist) && a.title !== "Unknown Album");
    const visibleArtists = artists.filter(
      (a) => !isArtistHidden(a.name) && a.name !== "Unknown Artist" && a.trackCount > 0
    );
    const rng = createPicksRng(picksSeed);
    const pickedAlbumKeys = new Set<string>();
    const pickedArtistNames = new Set<string>();

    // 1. Standout Recently Added Album (Rotated among the top 5 newest additions)
    if (visibleAlbums.length > 0) {
      const sortedByDate = visibleAlbums.slice().sort((a, b) => {
        const maxA = Math.max(...a.tracks.map((t) => t.date_added || 0), 0);
        const maxB = Math.max(...b.tracks.map((t) => t.date_added || 0), 0);
        return maxB - maxA;
      });
      const recentPool = sortedByDate.slice(0, Math.min(5, sortedByDate.length));
      const chosenRecent = recentPool[Math.floor(rng() * recentPool.length)] || sortedByDate[0];

      if (chosenRecent) {
        pickedAlbumKeys.add(`${chosenRecent.title}:::${chosenRecent.artist}`);
        pickedArtistNames.add(chosenRecent.artist.toLowerCase());
        picks.push({
          id: `pick-recent-${chosenRecent.title}:::${chosenRecent.artist}`,
          badge: "Recently Added",
          title: chosenRecent.title,
          subtitle: `${chosenRecent.artist} • Recently Added`,
          artworkTrackId: chosenRecent.artworkTrackId,
          tracks: chosenRecent.tracks,
          type: "album",
          targetAlbum: { title: chosenRecent.title, artist: chosenRecent.artist },
        });
      }
    }

    // 2. Personal Station / Flow (Favorites, Heavy Rotation, or Library Discovery)
    const personalRoll = rng();
    if (likedTracks.length >= 3 && (personalRoll < 0.6 || playHistory.length === 0)) {
      picks.push({
        id: "pick-personal-favorites",
        badge: "Favorites",
        title: "Favorites Station",
        subtitle: `${likedTracks.length} favorite ${likedTracks.length === 1 ? "song" : "songs"}`,
        artworkTrackId: likedTracks[0]?.id,
        tracks: likedTracks,
        type: "station",
      });
    } else if (playHistory.length >= 5) {
      const historyTracks = playHistory
        .map((entry) => tracks.find((t) => t.id === entry.trackId))
        .filter((t): t is Track => Boolean(t))
        .slice(0, 30);

      picks.push({
        id: "pick-heavy-rotation",
        badge: "On Repeat",
        title: "Heavy Rotation",
        subtitle: `${historyTracks.length} recent ${historyTracks.length === 1 ? "track" : "tracks"} • On repeat`,
        artworkTrackId: historyTracks[0]?.id,
        tracks: historyTracks,
        type: "station",
      });
    } else if (tracks.length > 0) {
      const sampleTracks = shuffleWithRng(tracks, rng).slice(0, 30);
      picks.push({
        id: "pick-library-station",
        badge: "Library Mix",
        title: "Library Discovery",
        subtitle: `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} • Endless mix`,
        artworkTrackId: sampleTracks[0]?.id,
        tracks: sampleTracks,
        type: "station",
      });
    }

    // 3. Daily Artist Spotlights (Up to 2 distinct artists rotated from top 10 ranked artists)
    if (visibleArtists.length > 0) {
      const rankedArtists = visibleArtists.slice().sort((a, b) => {
        const playsA = playHistory.filter((entry) =>
          a.tracks.some((t) => t.id === entry.trackId)
        ).length;
        const playsB = playHistory.filter((entry) =>
          b.tracks.some((t) => t.id === entry.trackId)
        ).length;
        if (playsB !== playsA) return playsB - playsA;
        return b.trackCount - a.trackCount;
      });

      const eligibleArtists = rankedArtists.filter((a) => a.trackCount >= 2);
      const pool = eligibleArtists.length >= 2 ? eligibleArtists.slice(0, 10) : rankedArtists.slice(0, 10);
      const shuffledPool = shuffleWithRng(pool, rng);

      let artistCount = 0;
      for (const artist of shuffledPool) {
        if (artistCount >= 2) break;
        if (pickedArtistNames.has(artist.name.toLowerCase())) continue;

        pickedArtistNames.add(artist.name.toLowerCase());
        artistCount++;

        const dedicatedTrack = artist.tracks.find(
          (t) =>
            t.metadata.album_artist?.toLowerCase() === artist.name.toLowerCase() ||
            t.metadata.artist?.toLowerCase() === artist.name.toLowerCase()
        );
        const artTrackId = dedicatedTrack?.id || artist.artworkTrackId;
        const isFirst = artistCount === 1;

        picks.push({
          id: `pick-artist-${artist.name}`,
          badge: isFirst ? "Featured Artist" : "Spotlight",
          title: isFirst ? `${artist.name} Essentials` : `${artist.name} Spotlight`,
          subtitle: `${artist.trackCount} ${artist.trackCount === 1 ? "track" : "tracks"} • ${artist.albumCount} ${artist.albumCount === 1 ? "album" : "albums"}`,
          artworkTrackId: artTrackId,
          tracks: artist.tracks,
          type: "artist",
          targetArtist: artist.name,
        });
      }
    }

    // 4. Album Showcases (Up to 2 distinct standout albums rotated)
    const albumPool = visibleAlbums.filter((a) => {
      const key = `${a.title}:::${a.artist}`;
      return !pickedAlbumKeys.has(key) && Boolean(a.artworkTrackId);
    });

    const qualityAlbums = albumPool.filter((a) => a.tracks.length >= 2);
    const candidateAlbums = qualityAlbums.length >= 2 ? qualityAlbums : albumPool;
    const shuffledAlbums = shuffleWithRng(candidateAlbums, rng);

    let albumShowcaseCount = 0;
    for (const alb of shuffledAlbums) {
      if (albumShowcaseCount >= 2) break;
      const key = `${alb.title}:::${alb.artist}`;
      if (pickedAlbumKeys.has(key)) continue;

      pickedAlbumKeys.add(key);
      albumShowcaseCount++;

      picks.push({
        id: `pick-album-${alb.title}:::${alb.artist}`,
        badge: albumShowcaseCount === 1 ? "Featured Album" : "Spotlight",
        title: alb.title,
        subtitle: `${alb.artist} • ${alb.tracks.length} ${alb.tracks.length === 1 ? "track" : "tracks"}`,
        artworkTrackId: alb.artworkTrackId,
        tracks: alb.tracks,
        type: "album",
        targetAlbum: { title: alb.title, artist: alb.artist },
      });
    }

    // 5. Genre Mixes (Up to 2 distinct genres rotated from libraryGenres)
    if (libraryGenres.length > 0) {
      const shuffledGenres = shuffleWithRng(libraryGenres, rng);
      let genreCount = 0;
      for (const g of shuffledGenres) {
        if (genreCount >= 2) break;
        genreCount++;

        const artTrack = g.tracks[0]?.id;

        picks.push({
          id: `pick-genre-${g.name}`,
          badge: g.name,
          title: genreCount === 1 ? `${g.name} Mix` : `${g.name} Essentials`,
          subtitle: `${g.tracks.length} ${g.tracks.length === 1 ? "track" : "tracks"}`,
          artworkTrackId: artTrack,
          tracks: g.tracks,
          type: "mix",
        });
      }
    }

    // 6. Decade Time Machine (If any decade has at least 4 tracks)
    const decadeGroups: Record<string, Track[]> = {};
    for (const tr of tracks) {
      const yr = tr.metadata.year;
      if (yr && yr > 1950 && yr < 2050) {
        let decLabel = "";
        if (yr >= 1970 && yr < 1980) decLabel = "70s";
        else if (yr >= 1980 && yr < 1990) decLabel = "80s";
        else if (yr >= 1990 && yr < 2000) decLabel = "90s";
        else if (yr >= 2000 && yr < 2010) decLabel = "2000s";
        else if (yr >= 2010 && yr < 2020) decLabel = "2010s";
        else if (yr >= 2020) decLabel = "2020s";

        if (decLabel) {
          if (!decadeGroups[decLabel]) decadeGroups[decLabel] = [];
          decadeGroups[decLabel].push(tr);
        }
      }
    }

    const validDecades = Object.entries(decadeGroups).filter(([_, list]) => list.length >= 4);
    if (validDecades.length > 0) {
      const chosenDecade = validDecades[Math.floor(rng() * validDecades.length)];
      const decadeTracks = chosenDecade[1];
      const artTrack = decadeTracks[0]?.id;

      picks.push({
        id: `pick-decade-${chosenDecade[0]}`,
        badge: chosenDecade[0],
        title: `${chosenDecade[0]} Time Machine`,
        subtitle: `${decadeTracks.length} tracks from the ${chosenDecade[0]}`,
        artworkTrackId: artTrack,
        tracks: decadeTracks,
        type: "mix",
      });
    }

    // 7. Rediscover / Deep Cuts (An unpicked album from earlier in the library)
    const remainingAlbums = visibleAlbums.filter((a) => {
      const key = `${a.title}:::${a.artist}`;
      return !pickedAlbumKeys.has(key);
    });

    if (remainingAlbums.length > 0) {
      const chosenDeepCut = remainingAlbums[Math.floor(rng() * remainingAlbums.length)];
      if (chosenDeepCut) {
        picks.push({
          id: `pick-rediscover-${chosenDeepCut.title}:::${chosenDeepCut.artist}`,
          badge: "Rediscover",
          title: chosenDeepCut.title,
          subtitle: `${chosenDeepCut.artist} • Rediscover`,
          artworkTrackId: chosenDeepCut.artworkTrackId,
          tracks: chosenDeepCut.tracks,
          type: "album",
          targetAlbum: { title: chosenDeepCut.title, artist: chosenDeepCut.artist },
        });
      }
    }

    if (picksRefreshEpoch > 0 && picks.length > 1) {
      const shuffledPicks = shuffleWithRng(picks, rng);
      if (shuffledPicks[0]?.id === picks[0]?.id) {
        const first = shuffledPicks.shift();
        if (first) shuffledPicks.push(first);
      }
      return shuffledPicks;
    }

    return picks;
  }, [
    albums,
    likedTracks,
    playHistory,
    tracks,
    artists,
    libraryGenres,
    hiddenArtists,
    picksSeed,
    picksRefreshEpoch,
  ]);

  // 4. Top / Heavy Rotation Artists (Sorted by track count and play history)
  const topArtists = useMemo(() => {
    return artists
      .filter((a) => !isArtistHidden(a.name))
      .sort((a, b) => {
        const playsA = playHistory.filter((entry) =>
          a.tracks.some((t) => t.id === entry.trackId)
        ).length;
        const playsB = playHistory.filter((entry) =>
          b.tracks.some((t) => t.id === entry.trackId)
        ).length;
        if (playsB !== playsA) return playsB - playsA;
        return b.trackCount - a.trackCount;
      })
      .slice(0, 16);
  }, [artists, playHistory, hiddenArtists]);

  // 5. Playlists & Library Cards data
  const playlistShelfItems = useMemo(() => {
    type ShelfItem =
      | { type: "liked" }
      | { type: "playlist"; playlist: Playlist }
      | { type: "all_songs" }
      | { type: "history" }
      | { type: "import" };

    const items: ShelfItem[] = [{ type: "liked" }];

    playlists.forEach((pl) => {
      items.push({ type: "playlist", playlist: pl });
    });

    if (playlists.length < 3) {
      items.push({ type: "all_songs" });
      items.push({ type: "history" });
      if (onOpenImport) {
        items.push({ type: "import" });
      }
    }

    return items;
  }, [playlists, onOpenImport]);

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

  // Play a genre mix directly
  const handlePlayGenre = useCallback(
    async (genreName: string, genreTracks: Track[], e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (genreTracks.length === 0) return;
      await setQueue(genreTracks, 0, {
        type: "tracks",
        name: `${genreName} Mix`,
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

      if (album.artist && album.artist !== "Unknown Artist") {
        const isHidden = isArtistHidden(album.artist);
        items.push({
          id: "toggle-hide-artist",
          label: isHidden ? `Unhide Artist (${album.artist})` : `Hide Artist (${album.artist})`,
          icon: isHidden ? Eye : EyeOff,
          onClick: () => {
            toggleHideArtist(album.artist);
          },
        });
      }

      openContextMenu(e, items);
    },
    [handlePlayAlbum, onSelectAlbum, onSelectArtist, openContextMenu, toggleHideArtist]
  );

  // Empty library welcome experience
  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none overflow-y-auto">
        <Music className="w-12 h-12 text-accent/80 mb-5 stroke-[1.5]" />
        <h1 className="text-2xl font-bold text-white tracking-tight mb-2">
          Your Library is Empty
        </h1>
        <p className="text-sm text-textSecondary max-w-sm mb-6 leading-relaxed">
          Import your local audio files or folder to start listening.
        </p>

        {onOpenImport && (
          <button
            onClick={onOpenImport}
            className="px-5 py-2 bg-accent-fill hover:bg-accentHover active:scale-95 text-white font-medium text-xs rounded-xl shadow-md shadow-accent/20 transition flex items-center space-x-2"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Import Folder</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-6 sm:space-y-8 select-none pb-32 sm:pb-24">
      {/* 1. Apple Music Style Hero Title & Quick Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between border-b border-white/[0.06] pb-4 gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Home</h1>
          <p className="text-xs text-textSecondary mt-1 flex flex-wrap items-center gap-2">
            <span>Your music library</span>
            <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-white/30" />
            <span className="font-mono text-textMuted">{tracks.length} Songs</span>
          </p>
        </div>

        {/* Quick Library Nav Pills */}
        <div className="flex items-center gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap py-2 -my-1 scrollbar-none text-xs font-semibold -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            type="button"
            onClick={() => onNavigate("tracks")}
            className="px-3 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white transition flex items-center gap-2 flex-shrink-0 active:scale-95"
          >
            <Music className="w-4 h-4 text-accent" />
            <span>All Songs</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("albums")}
            className="px-3 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white transition flex items-center gap-2 flex-shrink-0 active:scale-95"
          >
            <Disc className="w-4 h-4 text-accent" />
            <span>Albums</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("artists")}
            className="px-3 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white transition flex items-center gap-2 flex-shrink-0 active:scale-95"
          >
            <Users className="w-4 h-4 text-accent" />
            <span>Artists</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("playlists")}
            className="px-3 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white transition flex items-center gap-2 flex-shrink-0 active:scale-95"
          >
            <Radio className="w-4 h-4 text-accent" />
            <span>Playlists</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("liked")}
            className="px-3 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white transition flex items-center gap-2 flex-shrink-0 active:scale-95"
          >
            <Heart className="w-4 h-4 text-accent fill-accent" />
            <span>Favorites</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: Top Picks for You (Curated Editorial Showcase) */}
      <InfiniteShelf
        id="top-picks"
        title="Top Picks for You"
        icon={
          <Compass
            key={picksSpinCount}
            data-refreshing={isRefreshingPicks ? "true" : "false"}
            className="top-picks-compass-icon w-4 h-4 text-accent"
          />
        }
        headerAction={
          <button
            type="button"
            onClick={handleRefreshPicks}
            data-refreshing={isRefreshingPicks ? "true" : "false"}
            aria-busy={isRefreshingPicks}
            className="top-picks-refresh-btn px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-xs text-textSecondary hover:text-white flex items-center gap-1 border border-white/[0.06] hover:border-white/[0.15]"
            aria-label="Refresh top picks"
            title="Refresh top picks"
          >
            <RotateCw
              className="top-picks-refresh-icon w-3 h-3 text-accent"
              style={{ rotate: `${picksSpinCount * 360}deg` }}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        }
        items={editorialPicks}
        getItemKey={(pick) => `${pick.id}-${picksRefreshEpoch}`}
        resetScrollTrigger={picksRefreshEpoch}
        stepPixels={310}
        renderItem={(pick, idx) => {
          const hasArtwork = Boolean(pick.artworkTrackId);
          const artworkUrl = pick.artworkTrackId ? getArtworkUrl(pick.artworkTrackId) : null;
          const phaseClass =
            picksRefreshPhase === "exiting"
              ? "top-pick-card-exiting"
              : picksRefreshPhase === "entering"
                ? "top-pick-card-entering"
                : "";

          return (
            <div
              onClick={() => {
                if (pick.targetAlbum) {
                  onSelectAlbum(pick.targetAlbum.title, pick.targetAlbum.artist);
                } else if (pick.targetArtist) {
                  onSelectArtist(pick.targetArtist);
                } else {
                  handlePlayPick(pick);
                }
              }}
              style={{ "--pick-stagger": Math.min(idx, 7) } as React.CSSProperties}
              className={`poster-card top-pick-card ${phaseClass} group relative h-[290px] sm:h-[310px] w-[240px] sm:w-[270px] md:w-[290px] rounded-2xl overflow-hidden cursor-pointer border border-white/[0.08] hover:border-white/[0.22] hover:shadow-xl dark:hover:shadow-2xl flex flex-col justify-between p-4 bg-surface hover:bg-surfaceHover ${
                hasArtwork && artworkUrl ? "poster-card-artwork" : "poster-card-no-art"
              }`}
            >
              {/* Background Artwork Layer with Subtle Parallax & Overlay */}
              {hasArtwork && artworkUrl ? (
                <div className="absolute inset-0 z-0 overflow-hidden">
                  <img
                    src={artworkUrl}
                    alt={pick.title}
                    className="top-pick-card-artwork-img w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/20" />
                </div>
              ) : (
                <div className="absolute inset-0 z-0 bg-gradient-to-br from-surfaceHover via-surface to-deck flex items-center justify-center">
                  {pick.type === "station" && <Radio className="w-16 h-16 text-accent/30" />}
                  {pick.type === "mix" && <Disc className="w-16 h-16 text-warning/30" />}
                  {pick.type === "artist" && <Users className="w-16 h-16 text-accent/30" />}
                  {pick.type === "album" && <Disc className="w-16 h-16 text-textMuted/30" />}
                </div>
              )}

              {/* Subtle Specular Sheen on Refresh Deal */}
              <div className="top-pick-card-sheen absolute inset-0 z-[5]" aria-hidden="true" />

              {/* Hero Spacer */}
              <div className="relative z-10 flex-1" />

              {/* Bottom Card Content: Title, Subtitle, and Play Button */}
              <div className="top-pick-card-meta relative z-10 flex items-end justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3
                    className="poster-title text-sm sm:text-base font-bold leading-snug line-clamp-2 drop-shadow-sm"
                    title={pick.title}
                  >
                    {pick.title}
                  </h3>
                  <p
                    className="poster-subtitle text-xs mt-1 truncate drop-shadow-sm"
                    title={pick.subtitle}
                  >
                    {pick.subtitle}
                  </p>
                </div>

                {/* Play Button - Apple Glass Style */}
                <button
                  type="button"
                  onClick={(e) => handlePlayPick(pick, e)}
                  className="poster-play-btn w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg active:scale-95 transition-transform"
                  aria-label={`Play ${pick.title}`}
                >
                  <Play className="w-4 h-4 fill-current" />
                </button>
              </div>
            </div>
          );
        }}
      />

      {/* SECTION 2: Recently Played / Jump Back In (Infinite Album Carousel) */}
      {recentShelf.albums.length > 0 && (
        <InfiniteShelf
          id="recently-played"
          title={recentShelf.title}
          icon={
            recentShelf.isHistory ? (
              <Clock className="w-4 h-4 text-accent" />
            ) : (
              <Calendar className="w-4 h-4 text-accent" />
            )
          }
          onSeeAll={() => onNavigate(recentShelf.isHistory ? "history" : "albums")}
          seeAllLabel="See All"
          items={recentShelf.albums}
          getItemKey={(album) => `${album.title}:::${album.artist}`}
          stepPixels={200}
          renderItem={(album) => {
            const artworkUrl = album.artworkTrackId
              ? getArtworkUrl(album.artworkTrackId)
              : null;
            const isCurrentlyPlayingThisAlbum =
              currentTrack &&
              currentTrack.metadata.album?.toLowerCase() === album.title.toLowerCase() &&
              isPlaying;

            return (
              <div
                onContextMenu={(e) => handleAlbumContextMenu(e, album)}
                onClick={() => onSelectAlbum(album.title, album.artist)}
                className="group relative flex flex-col cursor-pointer w-[150px] sm:w-[170px] md:w-[180px]"
              >
                {/* Square Album Cover with Smooth Radius */}
                <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-surface border border-white/[0.08] group-hover:border-white/[0.2] transition-all duration-200 shadow-md group-hover:shadow-xl">
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
                    <div className="w-full h-full flex items-center justify-center bg-surfaceHover text-textMuted">
                      <Disc className="w-12 h-12" />
                    </div>
                  )}

                  {/* Glossy Play Overlay on Hover */}
                  <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={(e) => handlePlayAlbum(album, e)}
                      className="w-11 h-11 rounded-full bg-accent-fill hover:bg-accentHover active:scale-95 text-white shadow-xl flex items-center justify-center transition-transform hover:scale-110"
                      aria-label={`Play ${album.title}`}
                    >
                      <Play className="w-5 h-5 fill-white" />
                    </button>
                  </div>

                  {/* Playing indicator */}
                  {isCurrentlyPlayingThisAlbum && (
                    <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-accent-fill text-white text-2xs font-bold shadow-md">
                      Playing
                    </div>
                  )}
                </div>

                {/* Album Metadata */}
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-semibold text-white truncate group-hover:text-accent transition-colors">
                    {album.title}
                  </p>
                  <p
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectArtist(album.artist);
                    }}
                    className="text-2xs text-textSecondary truncate hover:text-white transition-colors"
                  >
                    {album.artist}
                  </p>
                </div>
              </div>
            );
          }}
        />
      )}

      {/* SECTION 3: Playlists & Mixes (Collections Row) */}
      <InfiniteShelf
        id="playlists-shelf"
        title="Playlists & Mixes"
        icon={<Radio className="w-4 h-4 text-accent" />}
        onSeeAll={() => onNavigate("playlists")}
        seeAllLabel="All Playlists"
        items={playlistShelfItems}
        getItemKey={(item, idx) =>
          item.type === "playlist" ? item.playlist.id : `${item.type}-${idx}`
        }
        stepPixels={250}
        renderItem={(item) => {
          if (item.type === "liked") {
            return (
              <div
                onClick={() => onNavigate("liked")}
                className="group relative h-32 sm:h-36 w-[210px] sm:w-[230px] md:w-[250px] rounded-2xl overflow-hidden cursor-pointer border border-accent/30 bg-gradient-to-br from-accent/20 via-surface to-surface hover:from-accent/30 hover:to-surfaceHover p-4 flex flex-col justify-between transition-all hover:shadow-xl active:scale-[0.99]"
              >
                <div className="flex items-center justify-end">
                  <Heart className="w-5 h-5 text-accent fill-accent drop-shadow-md" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-accent transition-colors">
                    Liked Songs
                  </h3>
                  <p className="text-xs text-textSecondary mt-1">
                    {likedTracks.length} favorite {likedTracks.length === 1 ? "track" : "tracks"}
                  </p>
                </div>
              </div>
            );
          }

          if (item.type === "playlist") {
            const pl = item.playlist;
            return (
              <div
                onClick={() => onSelectPlaylist(pl.id)}
                className="group relative h-32 sm:h-36 w-[210px] sm:w-[230px] md:w-[250px] rounded-2xl overflow-hidden cursor-pointer border border-white/[0.08] bg-surface hover:bg-surfaceHover p-4 flex flex-col justify-between hover:border-white/[0.2] transition-all hover:shadow-lg active:scale-[0.99]"
              >
                <div className="flex items-center justify-end">
                  <Music className="w-5 h-5 text-textMuted group-hover:text-accent transition-colors" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white truncate group-hover:text-accent transition-colors">
                    {pl.name}
                  </h3>
                  <p className="text-xs text-textMuted mt-1">
                    {pl.track_ids.length} {pl.track_ids.length === 1 ? "song" : "songs"}
                  </p>
                </div>
              </div>
            );
          }

          if (item.type === "all_songs") {
            return (
              <div
                onClick={() => onNavigate("tracks")}
                className="group relative h-32 sm:h-36 w-[210px] sm:w-[230px] md:w-[250px] rounded-2xl overflow-hidden cursor-pointer border border-white/[0.08] bg-surface hover:bg-surfaceHover p-4 flex flex-col justify-between hover:border-white/[0.2] transition-all hover:shadow-lg active:scale-[0.99]"
              >
                <div className="flex items-center justify-end">
                  <Music className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-accent transition-colors">
                    All Songs
                  </h3>
                  <p className="text-xs text-textMuted mt-1">
                    {tracks.length} songs in library
                  </p>
                </div>
              </div>
            );
          }

          if (item.type === "history") {
            return (
              <div
                onClick={() => onNavigate("history")}
                className="group relative h-32 sm:h-36 w-[210px] sm:w-[230px] md:w-[250px] rounded-2xl overflow-hidden cursor-pointer border border-white/[0.08] bg-surface hover:bg-surfaceHover p-4 flex flex-col justify-between hover:border-white/[0.2] transition-all hover:shadow-lg active:scale-[0.99]"
              >
                <div className="flex items-center justify-end">
                  <Clock className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-accent transition-colors">
                    Play History
                  </h3>
                  <p className="text-xs text-textMuted mt-1">
                    Recently played tracks
                  </p>
                </div>
              </div>
            );
          }

          // Import collection shortcut
          return (
            <div
              onClick={onOpenImport}
              className="group relative h-32 sm:h-36 w-[210px] sm:w-[230px] md:w-[250px] rounded-2xl overflow-hidden cursor-pointer border border-dashed border-white/[0.15] hover:border-accent/50 bg-white/[0.02] hover:bg-accent/[0.06] p-4 flex flex-col justify-between transition-all hover:shadow-lg active:scale-[0.99]"
            >
              <div className="flex items-center justify-end">
                <FolderPlus className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-accent transition-colors">
                  Import Collection
                </h3>
                <p className="text-xs text-textMuted mt-1">Add music folders</p>
              </div>
            </div>
          );
        }}
      />

      {/* SECTION 4: Favorite Artists (Infinite Portrait Carousel) */}
      {topArtists.length > 0 && (
        <InfiniteShelf
          id="favorite-artists"
          title="Favorite Artists"
          icon={<Users className="w-4 h-4 text-accent" />}
          onSeeAll={() => onNavigate("artists")}
          seeAllLabel="See All"
          items={topArtists}
          getItemKey={(artist) => artist.name}
          stepPixels={150}
          renderItem={(artist) => {
            const artworkUrl = artist.artworkTrackId
              ? getArtworkUrl(artist.artworkTrackId)
              : null;

            return (
              <div
                onClick={() => onSelectArtist(artist.name)}
                className="group flex flex-col items-center text-center cursor-pointer w-[110px] sm:w-[130px] md:w-[140px]"
              >
                {/* Circular Portrait with Glow on Hover */}
                <div className="relative w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full overflow-hidden bg-surfaceHover border border-white/[0.08] group-hover:border-accent/50 transition-all duration-300 shadow-md group-hover:shadow-lg group-hover:shadow-accent/20">
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
                    <div className="w-full h-full flex items-center justify-center text-textMuted">
                      <Users className="w-10 h-10" />
                    </div>
                  )}

                  {/* Quick Play Hover on Artist */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={(e) => handlePlayArtist(artist, e)}
                      className="w-9 h-9 rounded-full bg-accent-fill text-white flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition"
                      aria-label={`Play ${artist.name}`}
                    >
                      <Play className="w-4 h-4 fill-white" />
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-xs font-semibold text-white truncate max-w-full group-hover:text-accent transition-colors">
                  {artist.name}
                </p>
                <p className="text-2xs text-textMuted mt-1 font-medium">
                  {artist.trackCount} {artist.trackCount === 1 ? "song" : "songs"}
                </p>
              </div>
            );
          }}
        />
      )}

      {/* SECTION 5: Explore Genres & Sounds (Sound Palette) */}
      {libraryGenres.length > 0 && (
        <InfiniteShelf
          id="explore-genres"
          title="Explore Genres"
          icon={<Disc className="w-4 h-4 text-accent" />}
          items={libraryGenres}
          getItemKey={(g) => g.name}
          stepPixels={220}
          renderItem={(g) => {
            const theme = getGenreTheme(g.name);
            const IconComp = theme.icon;

            return (
              <div
                onClick={(e) => handlePlayGenre(g.name, g.tracks, e)}
                className={`group relative h-36 sm:h-40 w-[170px] sm:w-[190px] md:w-[210px] rounded-2xl overflow-hidden cursor-pointer border ${theme.borderColorClass} ${theme.gradientClass} p-4 flex flex-col justify-between transition-all duration-300 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]`}
              >
                {/* Top Row: Unboxed genre logo on left, play action revealed only on card hover on right */}
                <div className="flex items-center justify-between">
                  <IconComp className={`w-5 h-5 ${theme.iconColorClass} transition-transform duration-200 group-hover:scale-110`} />
                  <button
                    type="button"
                    onClick={(e) => handlePlayGenre(g.name, g.tracks, e)}
                    className="w-8 h-8 rounded-full bg-accent-fill hover:bg-accentHover active:scale-90 text-white shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 group-hover:scale-105"
                    aria-label={`Play ${g.name} Mix`}
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                  </button>
                </div>

                {/* Bottom Area: Full Width for Genre Name so long titles never truncate awkwardly */}
                <div className="mt-auto pt-2">
                  <h3
                    className="text-sm sm:text-base font-bold text-white leading-tight line-clamp-2 group-hover:text-accent transition-colors drop-shadow-sm"
                    title={g.name}
                  >
                    {g.name}
                  </h3>
                  <p className="text-2xs text-textSecondary font-medium mt-1">
                    {g.tracks.length} {g.tracks.length === 1 ? "track" : "tracks"}
                  </p>
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
};
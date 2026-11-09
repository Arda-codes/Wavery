import React, { useState, useMemo, useCallback, useDeferredValue } from "react";
import { AlbumInfo, AlbumSortKey, SortDirection } from "../types";
import { sortAlbums } from "../utils/library";
import { useSettingsStore } from "../stores/settingsStore";
import { useSortStore } from "../stores/sortStore";
import { AlbumCard } from "./AlbumCard";
import { AlbumMetadataModal } from "./AlbumMetadataModal";
import { FilterMenu, FilterSection } from "./FilterMenu";
import { Disc, ArrowUp, ArrowDown, Search } from "lucide-react";

interface AlbumsViewProps {
  albums: AlbumInfo[];
  onSelectAlbum: (albumTitle: string, artistName: string) => void;
  onSelectArtist: (artistName: string) => void;
  onPlayAlbum: (album: AlbumInfo) => void;
  getArtworkUrl?: (trackId: string) => string;
}

type AlbumCategoryFilter = "all" | "albums" | "singles";

function isSingleOrEp(album: AlbumInfo): boolean {
  if (album.trackCount <= 3) return true;
  const title = album.title.toLowerCase();
  return (
    title.includes(" - single") ||
    title.includes("(single)") ||
    title.includes(" - ep") ||
    title.includes("(ep)") ||
    title.endsWith(" ep") ||
    title.endsWith(" single")
  );
}

const AlbumsViewInner: React.FC<AlbumsViewProps> = ({
  albums,
  onSelectAlbum,
  onSelectArtist,
  onPlayAlbum,
}) => {
  const albumGridSize = useSettingsStore((s) => s.albumGridSize);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const sortState = useSortStore((s) => s.pageSorts["albums"]);
  const togglePageSort = useSortStore((s) => s.togglePageSort);
  const sortKey = (sortState?.key as AlbumSortKey) || "title";
  const sortDir = (sortState?.dir as SortDirection) || "asc";

  const [categoryFilter, setCategoryFilter] = useState<AlbumCategoryFilter>("all");
  const [decadeFilter, setDecadeFilter] = useState<string>("all");
  const [trackCountFilter, setTrackCountFilter] = useState<string>("all");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<AlbumInfo | null>(null);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (categoryFilter !== "all") count++;
    if (decadeFilter !== "all") count++;
    if (trackCountFilter !== "all") count++;
    return count;
  }, [categoryFilter, decadeFilter, trackCountFilter]);

  const resetAllFilters = useCallback(() => {
    setCategoryFilter("all");
    setDecadeFilter("all");
    setTrackCountFilter("all");
  }, []);

  const filterSections: FilterSection[] = useMemo(
    () => [
      {
        id: "release_type",
        title: "Release Type",
        selectedId: categoryFilter,
        onChange: (id) => setCategoryFilter(id as AlbumCategoryFilter),
        options: [
          { id: "all", label: "All Releases" },
          { id: "albums", label: "Full Albums" },
          { id: "singles", label: "Singles & EPs" },
        ],
      },
      {
        id: "era",
        title: "Release Era",
        selectedId: decadeFilter,
        onChange: setDecadeFilter,
        options: [
          { id: "all", label: "All Eras" },
          { id: "2020s", label: "2020s" },
          { id: "2010s", label: "2010s" },
          { id: "2000s", label: "2000s" },
          { id: "1990s", label: "90s" },
          { id: "older", label: "Classic" },
        ],
      },
      {
        id: "track_count",
        title: "Track Count",
        selectedId: trackCountFilter,
        onChange: setTrackCountFilter,
        options: [
          { id: "all", label: "Any Count" },
          { id: "5+", label: "5+ Tracks" },
          { id: "10+", label: "10+ Tracks" },
        ],
      },
    ],
    [categoryFilter, decadeFilter, trackCountFilter]
  );

  const gridClass = useMemo(() => {
    switch (albumGridSize) {
      case "compact":
        return "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4";
      case "spacious":
        return "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-6";
      case "medium":
      default:
        return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5";
    }
  }, [albumGridSize]);

  const filteredAndSortedAlbums = useMemo(() => {
    let list = albums;

    if (decadeFilter !== "all") {
      list = list.filter((a) => {
        if (!a.year) return false;
        if (decadeFilter === "2020s") return a.year >= 2020;
        if (decadeFilter === "2010s") return a.year >= 2010 && a.year < 2020;
        if (decadeFilter === "2000s") return a.year >= 2000 && a.year < 2010;
        if (decadeFilter === "1990s") return a.year >= 1990 && a.year < 2000;
        if (decadeFilter === "older") return a.year < 1990;
        return true;
      });
    }

    if (trackCountFilter === "5+") {
      list = list.filter((a) => a.trackCount >= 5);
    } else if (trackCountFilter === "10+") {
      list = list.filter((a) => a.trackCount >= 10);
    }

    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.artist.toLowerCase().includes(q)
      );
    }
    return sortAlbums(list, sortKey, sortDir);
  }, [albums, decadeFilter, trackCountFilter, deferredSearchQuery, sortKey, sortDir]);

  // Partition into Albums (LP) and Singles & EPs
  const { fullAlbums, singles } = useMemo(() => {
    const full: AlbumInfo[] = [];
    const sgl: AlbumInfo[] = [];
    for (const album of filteredAndSortedAlbums) {
      if (isSingleOrEp(album)) {
        sgl.push(album);
      } else {
        full.push(album);
      }
    }
    return { fullAlbums: full, singles: sgl };
  }, [filteredAndSortedAlbums]);

  const toggleSort = useCallback(
    (key: AlbumSortKey) => {
      togglePageSort("albums", key, "title");
    },
    [togglePageSort]
  );

  if (albums.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background">
        <Disc className="w-12 h-12 text-textMuted mb-4 stroke-[1.5]" />
        <h3 className="text-sm font-bold text-white mb-1">No Albums Found</h3>
        <p className="text-xs text-textMuted max-w-sm">
          Import music files to populate albums in your library.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Top Filter and Sort Controls */}
      <div className="flex flex-wrap items-center justify-between px-3 sm:px-6 py-3 border-b border-white/[0.06] flex-shrink-0 gap-2 sm:gap-4 bg-background">
        {/* Search & Filter */}
        <div className="flex items-center space-x-2 sm:space-x-3 w-full sm:w-auto sm:flex-1 sm:min-w-0">
          <div className="relative w-40 sm:w-60 max-w-xs group flex-shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-textMuted group-focus-within:text-accent transition-colors" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter albums..."
              className="w-full bg-surface border border-white/[0.08] hover:border-white/[0.15] focus:border-accent/60 rounded-full pl-8 pr-4 py-2 text-xs text-white placeholder-textMuted focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
            />
          </div>

          <FilterMenu
            isOpen={isFilterOpen}
            onToggle={() => setIsFilterOpen((v) => !v)}
            onClose={() => setIsFilterOpen(false)}
            activeFilterCount={activeFilterCount}
            onResetAll={resetAllFilters}
            sections={filterSections}
          />
        </div>

        {/* Sort Controls */}
        <div className="flex items-center space-x-2 overflow-x-auto scrollbar-none flex-shrink-0">
          <span className="text-textMuted mr-1 hidden sm:inline text-xs">Sort:</span>
          {(
            ["title", "artist", "year", "track_count"] as AlbumSortKey[]
          ).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleSort(key)}
              className={`px-3 py-1 rounded-full border text-2xs font-medium flex items-center gap-1 whitespace-nowrap transition-all ${
                sortKey === key
                  ? "bg-accent/15 border-accent/40 text-white font-semibold shadow-sm"
                  : "bg-surface border-white/[0.06] text-textMuted hover:text-white hover:border-white/[0.15]"
              }`}
            >
              <span>
                {key === "title"
                  ? "Title"
                  : key === "artist"
                  ? "Artist"
                  : key === "year"
                  ? "Year"
                  : "Tracks"}
              </span>
              {sortKey === key && (
                sortDir === "asc" ? (
                  <ArrowUp className="w-3 h-3 text-accent" />
                ) : (
                  <ArrowDown className="w-3 h-3 text-accent" />
                )
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Categorized Albums Grid */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-6 sm:space-y-8 pb-32 sm:pb-24">
        {/* 1. Full Albums Section */}
        {(categoryFilter === "all" || categoryFilter === "albums") && fullAlbums.length > 0 && (
          <section>
            <div className="mb-4">
              <h3 className="text-base font-bold text-white">
                Albums
              </h3>
            </div>
            <div className={gridClass}>
              {fullAlbums.map((album) => (
                <AlbumCard
                  key={`${album.title}-${album.artist}`}
                  album={album}
                  onSelectAlbum={onSelectAlbum}
                  onSelectArtist={onSelectArtist}
                  onPlayAlbum={onPlayAlbum}
                  onEditMetadata={setEditingAlbum}
                />
              ))}
            </div>
          </section>
        )}

        {/* 2. Singles & EPs Section */}
        {(categoryFilter === "all" || categoryFilter === "singles") && singles.length > 0 && (
          <section>
            <div className="mb-4">
              <h3 className="text-base font-bold text-white">
                Singles & EPs
              </h3>
            </div>
            <div className={gridClass}>
              {singles.map((album) => (
                <AlbumCard
                  key={`${album.title}-${album.artist}`}
                  album={album}
                  onSelectAlbum={onSelectAlbum}
                  onSelectArtist={onSelectArtist}
                  onPlayAlbum={onPlayAlbum}
                  onEditMetadata={setEditingAlbum}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty Search / Filter State */}
        {filteredAndSortedAlbums.length === 0 && (
          <div className="flex flex-col items-center justify-center p-12 text-center text-textMuted">
            <p className="text-sm">No albums matching &ldquo;{searchQuery}&rdquo;</p>
          </div>
        )}
      </div>

      {/* Album Metadata Editor Modal */}
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

export const AlbumsView = React.memo(AlbumsViewInner);

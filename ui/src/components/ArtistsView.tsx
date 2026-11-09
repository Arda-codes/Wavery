import React, { useState, useMemo, useCallback, useDeferredValue } from "react";
import { ArtistInfo, ArtistSortKey, SortDirection } from "../types";
import { sortArtists, isArtistHidden } from "../utils/library";
import { useSettingsStore } from "../stores/settingsStore";
import { useSortStore } from "../stores/sortStore";
import { ArtistCard } from "./ArtistCard";
import { ArtistMetadataModal } from "./ArtistMetadataModal";
import { FilterMenu, FilterSection } from "./FilterMenu";
import { Users, ArrowUp, ArrowDown, Search } from "lucide-react";

interface ArtistsViewProps {
  artists: ArtistInfo[];
  onSelectArtist: (artistName: string) => void;
  getArtworkUrl?: (trackId: string) => string;
}

const ArtistsViewInner: React.FC<ArtistsViewProps> = ({
  artists,
  onSelectArtist,
}) => {
  const albumGridSize = useSettingsStore((s) => s.albumGridSize);
  const hiddenArtists = useSettingsStore((s) => s.hiddenArtists);
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const sortState = useSortStore((s) => s.pageSorts["artists"]);
  const togglePageSort = useSortStore((s) => s.togglePageSort);
  const sortKey = (sortState?.key as ArtistSortKey) || "name";
  const sortDir = (sortState?.dir as SortDirection) || "asc";

  const [editingArtist, setEditingArtist] = useState<ArtistInfo | null>(null);
  const [artistFilter, setArtistFilter] = useState<"all" | "with_albums" | "multi_track">("all");
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const hiddenCount = useMemo(
    () => artists.filter((a) => isArtistHidden(a.name)).length,
    [artists, hiddenArtists]
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (artistFilter !== "all") count++;
    if (showHidden) count++;
    return count;
  }, [artistFilter, showHidden]);

  const resetAllFilters = useCallback(() => {
    setArtistFilter("all");
    setShowHidden(false);
  }, []);

  const filterSections: FilterSection[] = useMemo(() => {
    const sections: FilterSection[] = [
      {
        id: "catalog",
        title: "Catalog Size",
        selectedId: artistFilter,
        onChange: (id) => setArtistFilter(id as "all" | "with_albums" | "multi_track"),
        options: [
          { id: "all", label: "All Artists" },
          { id: "with_albums", label: "With Albums" },
          { id: "multi_track", label: "3+ Tracks" },
        ],
      },
    ];

    if (hiddenCount > 0) {
      sections.push({
        id: "visibility",
        title: "Visibility",
        selectedId: showHidden ? "show" : "hide",
        onChange: (id) => setShowHidden(id === "show"),
        options: [
          { id: "hide", label: "Hide Hidden" },
          { id: "show", label: `Show Hidden (${hiddenCount})` },
        ],
      });
    }

    return sections;
  }, [artistFilter, showHidden, hiddenCount]);

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

  const filteredAndSortedArtists = useMemo(() => {
    let list = artists;
    if (!showHidden) {
      list = list.filter((a) => !isArtistHidden(a.name));
    }
    if (artistFilter === "with_albums") {
      list = list.filter((a) => a.albumCount > 0);
    } else if (artistFilter === "multi_track") {
      list = list.filter((a) => a.trackCount >= 3);
    }
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q));
    }
    return sortArtists(list, sortKey, sortDir);
  }, [artists, showHidden, artistFilter, deferredSearchQuery, sortKey, sortDir, hiddenArtists]);

  const toggleSort = useCallback(
    (key: ArtistSortKey) => {
      togglePageSort("artists", key, "name");
    },
    [togglePageSort]
  );

  if (artists.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-background">
        <Users className="w-12 h-12 text-textMuted mb-4 stroke-[1.5]" />
        <h3 className="text-sm font-bold text-white mb-1">No Artists Found</h3>
        <p className="text-xs text-textMuted max-w-sm">
          Import music files to populate artists in your library.
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
              placeholder="Filter artists..."
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
          {(["name", "album_count", "track_count"] as ArtistSortKey[]).map(
            (key) => (
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
                  {key === "name"
                    ? "Name"
                    : key === "album_count"
                    ? "Albums"
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
            )
          )}
        </div>
      </div>

      {/* Hardware-Accelerated Artists Grid */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 pb-32 sm:pb-24">
        <div className={gridClass}>
          {filteredAndSortedArtists.map((artist) => (
            <ArtistCard
              key={artist.name}
              artist={artist}
              onSelectArtist={onSelectArtist}
              onEditArtist={setEditingArtist}
            />
          ))}
        </div>
      </div>

      {/* Edit Artist Metadata Modal */}
      <ArtistMetadataModal
        artist={editingArtist}
        isOpen={!!editingArtist}
        onClose={() => setEditingArtist(null)}
      />
    </div>
  );
};

export const ArtistsView = React.memo(ArtistsViewInner);

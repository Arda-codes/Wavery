import React, { useState, useMemo, useCallback, useDeferredValue } from "react";
import { ArtistInfo, ArtistSortKey, SortDirection } from "../types";
import { sortArtists } from "../utils/library";
import { useSettingsStore } from "../stores/settingsStore";
import { ArtistCard } from "./ArtistCard";
import { Users, ArrowUpDown, Search } from "lucide-react";

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
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [sortKey, setSortKey] = useState<ArtistSortKey>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const gridClass = useMemo(() => {
    switch (albumGridSize) {
      case "compact":
        return "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3.5";
      case "spacious":
        return "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-6";
      case "medium":
      default:
        return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5";
    }
  }, [albumGridSize]);

  const filteredAndSortedArtists = useMemo(() => {
    let list = artists;
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q));
    }
    return sortArtists(list, sortKey, sortDir);
  }, [artists, deferredSearchQuery, sortKey, sortDir]);

  const toggleSort = useCallback(
    (key: ArtistSortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  if (artists.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0D0D10]">
        <div className="w-16 h-16 rounded-2xl bg-[#16161A] border border-white/[0.07] flex items-center justify-center mb-4 shadow-lg">
          <Users className="w-8 h-8 text-[#71717A]" />
        </div>
        <h3 className="text-sm font-bold text-white mb-1">No Artists Found</h3>
        <p className="text-xs text-[#71717A] max-w-sm">
          Import music files to populate artists in your library.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0D0D10]">
      {/* Top Filter and Sort Controls */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.06] flex-shrink-0 gap-4">
        <div className="relative flex-1 max-w-xs group">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#71717A] group-focus-within:text-[#FA586A] transition-colors" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter artists..."
            className="w-full bg-[#18181D] border border-white/[0.08] hover:border-white/[0.15] focus:border-[#FA586A]/60 rounded-full pl-8 pr-4 py-1.5 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <span className="text-[#71717A]">Sort by:</span>
          {(["name", "album_count", "track_count"] as ArtistSortKey[]).map(
            (key) => (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                className={`px-3 py-1 rounded-full border text-[11px] font-medium flex items-center gap-1 transition-all ${
                  sortKey === key
                    ? "bg-[#FA586A]/15 border-[#FA586A]/40 text-white font-semibold shadow-sm"
                    : "bg-[#18181D] border-white/[0.06] text-[#71717A] hover:text-white hover:border-white/[0.15]"
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
                  <ArrowUpDown className="w-3 h-3 text-[#FA586A]" />
                )}
              </button>
            )
          )}
        </div>
      </div>

      {/* Hardware-Accelerated Artists Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className={gridClass}>
          {filteredAndSortedArtists.map((artist) => (
            <ArtistCard
              key={artist.name}
              artist={artist}
              onSelectArtist={onSelectArtist}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export const ArtistsView = React.memo(ArtistsViewInner);

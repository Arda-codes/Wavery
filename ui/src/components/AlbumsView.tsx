import React, { useState, useMemo, useCallback, useDeferredValue } from "react";
import { AlbumInfo, AlbumSortKey, SortDirection } from "../types";
import { sortAlbums } from "../utils/library";
import { useSettingsStore } from "../stores/settingsStore";
import { AlbumCard } from "./AlbumCard";
import { AlbumMetadataModal } from "./AlbumMetadataModal";
import { Disc, ArrowUpDown, Search, Radio } from "lucide-react";

interface AlbumsViewProps {
  albums: AlbumInfo[];
  onSelectAlbum: (albumTitle: string, artistName: string) => void;
  onSelectArtist: (artistName: string) => void;
  onPlayAlbum: (album: AlbumInfo) => void;
  getArtworkUrl?: (trackId: string) => string;
}

export type AlbumCategoryFilter = "all" | "albums" | "singles";

export function isSingleOrEp(album: AlbumInfo): boolean {
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
  const [sortKey, setSortKey] = useState<AlbumSortKey>("title");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [categoryFilter, setCategoryFilter] = useState<AlbumCategoryFilter>("all");
  const [editingAlbum, setEditingAlbum] = useState<AlbumInfo | null>(null);

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

  const filteredAndSortedAlbums = useMemo(() => {
    let list = albums;
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.artist.toLowerCase().includes(q)
      );
    }
    return sortAlbums(list, sortKey, sortDir);
  }, [albums, deferredSearchQuery, sortKey, sortDir]);

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
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  if (albums.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0D0D10]">
        <div className="w-16 h-16 rounded-2xl bg-[#16161A] border border-white/[0.07] flex items-center justify-center mb-4 shadow-lg">
          <Disc className="w-8 h-8 text-[#71717A]" />
        </div>
        <h3 className="text-sm font-bold text-white mb-1">No Albums Found</h3>
        <p className="text-xs text-[#71717A] max-w-sm">
          Import music files to populate albums in your library.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0D0D10]">
      {/* Top Filter, Category Tabs, and Sort Controls */}
      <div className="flex flex-wrap items-center justify-between px-6 py-3.5 border-b border-white/[0.06] flex-shrink-0 gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-xs min-w-[160px] group">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#71717A] group-focus-within:text-[#FA586A] transition-colors" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter albums or artists..."
            className="w-full bg-[#18181D] border border-white/[0.08] hover:border-white/[0.15] focus:border-[#FA586A]/60 rounded-full pl-8 pr-4 py-1.5 text-xs text-white placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#FA586A]/30 transition"
          />
        </div>

        {/* Category Tabs: All | Albums | Singles & EPs (Apple Filter Chips) */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`px-3.5 py-1 rounded-full text-xs font-semibold transition-all ${
              categoryFilter === "all"
                ? "bg-white text-black shadow-md font-bold"
                : "bg-white/[0.06] text-[#A1A1AA] hover:text-white hover:bg-white/[0.10] border border-white/[0.06]"
            }`}
          >
            All ({filteredAndSortedAlbums.length})
          </button>
          <button
            onClick={() => setCategoryFilter("albums")}
            className={`px-3.5 py-1 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              categoryFilter === "albums"
                ? "bg-white text-black shadow-md font-bold"
                : "bg-white/[0.06] text-[#A1A1AA] hover:text-white hover:bg-white/[0.10] border border-white/[0.06]"
            }`}
          >
            <Disc className="w-3.5 h-3.5" />
            <span>Albums ({fullAlbums.length})</span>
          </button>
          <button
            onClick={() => setCategoryFilter("singles")}
            className={`px-3.5 py-1 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              categoryFilter === "singles"
                ? "bg-white text-black shadow-md font-bold"
                : "bg-white/[0.06] text-[#A1A1AA] hover:text-white hover:bg-white/[0.10] border border-white/[0.06]"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Singles & EPs ({singles.length})</span>
          </button>
        </div>

        {/* Sort Controls */}
        <div className="flex items-center space-x-1.5 text-xs">
          <span className="text-[#71717A] mr-1">Sort:</span>
          {(
            ["title", "artist", "year", "track_count"] as AlbumSortKey[]
          ).map((key) => (
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
                {key === "title"
                  ? "Title"
                  : key === "artist"
                  ? "Artist"
                  : key === "year"
                  ? "Year"
                  : "Tracks"}
              </span>
              {sortKey === key && (
                <ArrowUpDown className="w-3 h-3 text-[#FA586A]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Categorized Albums Grid */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* 1. Full Albums Section */}
        {(categoryFilter === "all" || categoryFilter === "albums") && fullAlbums.length > 0 && (
          <section>
            <div className="flex items-center space-x-2 mb-4">
              <Disc className="w-4 h-4 text-[#FA586A]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Albums ({fullAlbums.length})
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
            <div className="flex items-center space-x-2 mb-4">
              <Radio className="w-4 h-4 text-[#FA586A]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Singles & EPs ({singles.length})
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
          <div className="flex flex-col items-center justify-center p-12 text-center text-[#71717A]">
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

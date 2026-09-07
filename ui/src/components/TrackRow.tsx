import React, { useState, useCallback } from "react";
import { Track } from "../types";
import { formatDuration, getFullTrackArtistString } from "../utils/library";
import {
  Play,
  Pause,
  Music,
  Heart,
  ListPlus,
  ListMusic,
  Plus,
  User,
  Disc,
  Copy,
  FileText,
  Trash2,
  CornerDownRight,
} from "lucide-react";
import { useArtwork } from "../utils/useArtwork";
import { ArtistLinks } from "./ArtistLinks";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { EqualizerWave } from "./EqualizerWave";
import { RowDensity } from "../stores/settingsStore";

interface TrackRowProps {
  track: Track;
  index: number;
  style: React.CSSProperties;
  isSelected: boolean;
  isPlaying: boolean;
  onPlay: (track: Track, index: number) => void;
  onSelectArtist?: (artistName: string) => void;
  onSelectAlbum?: (albumTitle: string, artistName: string) => void;
  onAddToPlaylist?: (track: Track) => void;
  onRemoveFromPlaylist?: (trackId: string) => void;
  artworkUrl?: string;
  rowDensity?: RowDensity;
}

const TrackRowInner: React.FC<TrackRowProps> = ({
  track,
  index,
  style,
  isSelected,
  isPlaying,
  onPlay,
  onSelectArtist,
  onSelectAlbum,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  artworkUrl: propArtworkUrl,
  rowDensity = "comfortable",
}) => {
  const isLiked = useLibraryStore((s) => s.likedTrackIds.has(track.id));
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const playlists = useLibraryStore((s) => s.playlists);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);

  const insertAfterCurrent = usePlayerStore((s) => s.insertAfterCurrent);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const fetchedArtwork = useArtwork(track.id);
  const artworkUrl = propArtworkUrl || fetchedArtwork;
  const [imgError, setImgError] = useState(false);

  const artistName = getFullTrackArtistString(track);
  const albumTitle = track.metadata.album || "Unknown Album";
  const durationSecs = track.metadata.duration?.secs || 0;

  const handleToggleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await toggleLike(track.id);
    } catch (err) {
      console.error("Failed to toggle like:", err);
    }
  };

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const playlistSubmenuItems: ContextMenuItem[] = [];

      playlists.forEach((pl) => {
        const alreadyIn = pl.track_ids.includes(track.id);
        playlistSubmenuItems.push({
          id: `playlist-${pl.id}`,
          label: pl.name,
          icon: ListMusic,
          disabled: alreadyIn,
          shortcut: alreadyIn ? "Added" : undefined,
          onClick: () => {
            addTracksToPlaylist(pl.id, [track.id]);
          },
        });
      });

      if (playlistSubmenuItems.length > 0) {
        playlistSubmenuItems.push({
          id: "divider-new-playlist",
          label: "",
          divider: true,
        });
      }

      playlistSubmenuItems.push({
        id: "create-new-playlist",
        label: "New Playlist...",
        icon: Plus,
        onClick: () => {
          if (onAddToPlaylist) {
            onAddToPlaylist(track);
          }
        },
      });

      const menuItems: ContextMenuItem[] = [
        {
          id: "play-now",
          label: isSelected && isPlaying ? "Pause" : "Play Now",
          icon: isSelected && isPlaying ? Pause : Play,
          onClick: () => onPlay(track, index),
        },
        {
          id: "play-next",
          label: "Play Next",
          icon: CornerDownRight,
          onClick: () => insertAfterCurrent(track),
        },
        {
          id: "add-to-queue",
          label: "Add to Queue",
          icon: ListPlus,
          onClick: () => addToQueue(track),
        },
        {
          id: "divider-1",
          label: "",
          divider: true,
        },
        {
          id: "toggle-like",
          label: isLiked ? "Remove from Liked Songs" : "Add to Liked Songs",
          icon: Heart,
          onClick: () => toggleLike(track.id),
        },
        {
          id: "add-to-playlist",
          label: "Add to Playlist",
          icon: ListMusic,
          items: playlistSubmenuItems,
        },
      ];

      if (onSelectArtist && artistName && artistName !== "Unknown Artist") {
        menuItems.push(
          {
            id: "divider-nav",
            label: "",
            divider: true,
          },
          {
            id: "go-to-artist",
            label: `Go to Artist (${artistName.length > 20 ? artistName.slice(0, 20) + "..." : artistName})`,
            icon: User,
            onClick: () => onSelectArtist(artistName),
          }
        );
      }

      if (onSelectAlbum && albumTitle && albumTitle !== "Unknown Album") {
        menuItems.push({
          id: "go-to-album",
          label: `Go to Album (${albumTitle.length > 20 ? albumTitle.slice(0, 20) + "..." : albumTitle})`,
          icon: Disc,
          onClick: () => onSelectAlbum(albumTitle, artistName),
        });
      }

      menuItems.push(
        {
          id: "divider-copy",
          label: "",
          divider: true,
        },
        {
          id: "copy-title",
          label: "Copy Track Title",
          icon: Copy,
          onClick: () => {
            navigator.clipboard.writeText(track.metadata.title || "Untitled");
          },
        },
        {
          id: "copy-share",
          label: "Copy Title & Artist",
          icon: Copy,
          onClick: () => {
            navigator.clipboard.writeText(
              `${track.metadata.title || "Untitled"} - ${artistName}`
            );
          },
        },
        {
          id: "copy-path",
          label: "Copy File Path",
          icon: FileText,
          onClick: () => {
            navigator.clipboard.writeText(track.source?.Managed || "");
          },
        }
      );

      if (onRemoveFromPlaylist) {
        menuItems.push(
          {
            id: "divider-remove",
            label: "",
            divider: true,
          },
          {
            id: "remove-from-playlist",
            label: "Remove from Playlist",
            icon: Trash2,
            danger: true,
            onClick: () => {
              onRemoveFromPlaylist(track.id);
            },
          }
        );
      }

      openContextMenu(e, menuItems);
    },
    [
      track,
      index,
      isSelected,
      isPlaying,
      isLiked,
      artistName,
      albumTitle,
      playlists,
      onPlay,
      onSelectArtist,
      onSelectAlbum,
      onAddToPlaylist,
      onRemoveFromPlaylist,
      insertAfterCurrent,
      addToQueue,
      toggleLike,
      addTracksToPlaylist,
      openContextMenu,
    ]
  );

  const isCompact = rowDensity === "compact";

  return (
    <div
      role="row"
      aria-selected={isSelected}
      aria-rowindex={index + 1}
      data-index={index}
      style={style}
      onDoubleClick={() => onPlay(track, index)}
      onContextMenu={handleContextMenu}
      className={`grid grid-cols-[36px_minmax(0,1fr)_auto] md:grid-cols-[40px_minmax(160px,1fr)_140px_80px] lg:grid-cols-[44px_minmax(180px,1fr)_150px_150px_90px] xl:grid-cols-[48px_minmax(180px,1fr)_160px_160px_80px_110px] gap-2 sm:gap-3 px-3 sm:px-6 items-center group cursor-pointer hover:bg-white/[0.06] transition-all border-b border-white/[0.03] select-none ${
        isCompact ? "text-[11px]" : "text-xs"
      } ${
        isSelected ? "bg-white/[0.08] text-[#FA586A]" : "text-white"
      }`}
    >
      {/* 1. Track Number / Play-Pause Button */}
      <div
        role="cell"
        className={`flex items-center justify-center text-[#71717A] flex-shrink-0 w-8 ${isCompact ? "text-[10.5px]" : "text-xs"}`}
      >
        {/* Not hovered state */}
        <span className="group-hover:hidden font-mono tabular-nums flex items-center justify-center">
          {isSelected && isPlaying ? (
            <EqualizerWave isPlaying={true} size="xs" />
          ) : isSelected ? (
            <EqualizerWave isPlaying={false} size="xs" />
          ) : (
            <span>{index + 1}</span>
          )}
        </span>

        {/* Hovered state: Interactive Play/Pause Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlay(track, index);
          }}
          className="hidden group-hover:inline-flex text-white hover:text-[#FA586A] hover:scale-110 active:scale-95 transition items-center justify-center"
          title={isSelected && isPlaying ? "Pause Track" : isSelected ? "Resume Track" : "Play Track"}
        >
          {isSelected && isPlaying ? (
            <Pause className={`${isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} fill-current text-[#FA586A]`} />
          ) : (
            <Play className={`${isCompact ? "w-3.5 h-3.5" : "w-4 h-4"} fill-current`} />
          )}
        </button>
      </div>

      {/* 2. Title & Artwork (with mobile-stacked Artist) */}
      <div role="cell" className="flex items-center space-x-2.5 min-w-0 font-medium">
        <div className={`${isCompact ? "w-6 h-6 rounded-md" : "w-8 h-8 rounded-lg"} bg-[#1C1C22] flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm relative border border-white/[0.06]`}>
          {artworkUrl && !imgError ? (
            <img
              src={artworkUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
          ) : (
            <Music className={`${isCompact ? "w-3 h-3" : "w-3.5 h-3.5"} text-[#71717A]`} />
          )}
        </div>
        <div className="min-w-0 flex-1 truncate">
          <span className={`truncate font-semibold block leading-tight ${isSelected ? "text-[#FA586A]" : "text-white"}`}>
            {track.metadata.title || "Untitled"}
          </span>
          {/* Mobile-only stacked artist subtitle */}
          <div className="md:hidden text-[11px] text-[#A1A1AA] truncate leading-tight mt-0.5">
            <ArtistLinks
              artistName={artistName}
              onSelectArtist={onSelectArtist}
              className="truncate block"
              linkClassName="hover:text-white hover:underline cursor-pointer transition-colors"
              delimiterClassName="text-[#71717A]"
            />
          </div>
        </div>
      </div>

      {/* 3. Artist (visible on md+) */}
      <div role="cell" className="hidden md:block text-[#A1A1AA] truncate min-w-0">
        <ArtistLinks
          artistName={artistName}
          onSelectArtist={onSelectArtist}
          className="truncate block"
          linkClassName="hover:text-white hover:underline cursor-pointer transition-colors"
          delimiterClassName="text-[#71717A]"
        />
      </div>

      {/* 4. Album (visible on lg+) */}
      <div role="cell" className="hidden lg:block text-[#A1A1AA] truncate min-w-0">
        {onSelectAlbum ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onSelectAlbum(albumTitle, artistName);
            }}
            className="hover:text-white hover:underline cursor-pointer transition truncate block"
          >
            {albumTitle}
          </span>
        ) : (
          <span className="truncate block">{albumTitle}</span>
        )}
      </div>

      {/* 5. Format (visible on xl+) */}
      <div role="cell" className="hidden xl:flex items-center justify-center">
        <span className="px-2 py-0.5 text-[9.5px] font-bold bg-white/[0.06] text-[#A1A1AA] rounded-md tracking-wider border border-white/[0.04]">
          {track.metadata.format}
        </span>
      </div>

      {/* 6. Actions (Like, Add to playlist) & Duration */}
      <div
        role="cell"
        className="flex items-center justify-end space-x-2 text-xs text-[#71717A]"
      >
        {/* Heart Like Toggle */}
        <button
          type="button"
          onClick={handleToggleLike}
          className={`p-1 rounded transition ${
            isLiked
              ? "text-[#FA586A] opacity-100"
              : "text-[#71717A] opacity-0 group-hover:opacity-100 hover:text-white"
          }`}
          title={isLiked ? "Unlike song" : "Like song"}
        >
          <Heart className={`w-3.5 h-3.5 ${isLiked ? "fill-[#FA586A]" : ""}`} />
        </button>

        {/* Add to Playlist Trigger */}
        {onAddToPlaylist && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddToPlaylist(track);
            }}
            className="p-1 text-[#71717A] hover:text-white opacity-0 group-hover:opacity-100 transition"
            title="Add to Playlist"
          >
            <ListPlus className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Duration */}
        <span className="font-mono pr-1">{formatDuration(durationSecs)}</span>
      </div>
    </div>
  );
};

export const TrackRow = React.memo(TrackRowInner);

import React, { useState, useCallback } from "react";
import { AlbumInfo } from "../types";
import { Play, Disc, ListPlus, CornerDownRight, ListMusic, User, Pencil, Copy } from "lucide-react";
import { useArtwork } from "../utils/useArtwork";
import { ArtistLinks } from "./ArtistLinks";
import { useLibraryStore } from "../stores/libraryStore";
import { usePlayerStore } from "../stores/playerStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";

interface AlbumCardProps {
  album: AlbumInfo;
  onSelectAlbum: (albumTitle: string, artistName: string) => void;
  onSelectArtist: (artistName: string) => void;
  onPlayAlbum: (album: AlbumInfo) => void;
  onEditMetadata?: (album: AlbumInfo) => void;
  artworkUrl?: string;
}

const AlbumCardInner: React.FC<AlbumCardProps> = ({
  album,
  onSelectAlbum,
  onSelectArtist,
  onPlayAlbum,
  onEditMetadata,
  artworkUrl: propArtworkUrl,
}) => {
  const fetchedArtwork = useArtwork(album.artworkTrackId);
  const artworkUrl = propArtworkUrl || fetchedArtwork;
  const [imgError, setImgError] = useState(false);

  const playlists = useLibraryStore((s) => s.playlists);
  const addTracksToPlaylist = useLibraryStore((s) => s.addTracksToPlaylist);
  const insertAfterCurrent = usePlayerStore((s) => s.insertAfterCurrent);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const trackIds = album.tracks.map((t) => t.id);

      const playlistSubmenuItems: ContextMenuItem[] = playlists.map((pl) => ({
        id: `album-playlist-${pl.id}`,
        label: pl.name,
        icon: ListMusic,
        onClick: () => {
          if (trackIds.length > 0) {
            addTracksToPlaylist(pl.id, trackIds);
          }
        },
      }));

      const menuItems: ContextMenuItem[] = [
        {
          id: "play-album",
          label: "Play Album",
          icon: Play,
          onClick: () => onPlayAlbum(album),
        },
        {
          id: "play-next-album",
          label: "Play Next",
          icon: CornerDownRight,
          onClick: () => {
            if (album.tracks.length > 0) {
              insertAfterCurrent(album.tracks);
            }
          },
        },
        {
          id: "add-album-to-queue",
          label: "Add Album to Queue",
          icon: ListPlus,
          onClick: () => {
            if (album.tracks.length > 0) {
              addToQueue(album.tracks);
            }
          },
        },
        {
          id: "divider-1",
          label: "",
          divider: true,
        },
      ];

      if (playlistSubmenuItems.length > 0) {
        menuItems.push({
          id: "add-to-playlist",
          label: "Add Album to Playlist",
          icon: ListMusic,
          items: playlistSubmenuItems,
        });
      }

      menuItems.push(
        {
          id: "divider-nav",
          label: "",
          divider: true,
        },
        {
          id: "go-to-artist",
          label: `Go to Artist (${album.artist})`,
          icon: User,
          onClick: () => onSelectArtist(album.artist),
        }
      );

      if (onEditMetadata) {
        menuItems.push({
          id: "edit-metadata",
          label: "Edit Album Metadata...",
          icon: Pencil,
          onClick: () => onEditMetadata(album),
        });
      }

      menuItems.push(
        {
          id: "divider-copy",
          label: "",
          divider: true,
        },
        {
          id: "copy-album-title",
          label: "Copy Album Title",
          icon: Copy,
          onClick: () => {
            navigator.clipboard.writeText(album.title);
          },
        },
        {
          id: "copy-album-artist",
          label: "Copy Album & Artist",
          icon: Copy,
          onClick: () => {
            navigator.clipboard.writeText(`${album.title} - ${album.artist}`);
          },
        }
      );

      openContextMenu(e, menuItems);
    },
    [
      album,
      playlists,
      onPlayAlbum,
      onSelectArtist,
      onEditMetadata,
      insertAfterCurrent,
      addToQueue,
      addTracksToPlaylist,
      openContextMenu,
    ]
  );

  return (
    <div
      onClick={() => onSelectAlbum(album.title, album.artist)}
      onContextMenu={handleContextMenu}
      style={{ contain: "content" }}
      className="group cursor-pointer bg-[#16161A] hover:bg-[#202026] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-3.5 flex flex-col transition-[background-color,border-color,box-shadow,transform] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-sm hover:shadow-xl hover:-translate-y-0.5 select-none"
    >
      {/* Cover Art */}
      <div className="aspect-square rounded-xl bg-[#1C1C22] overflow-hidden mb-3 relative flex items-center justify-center border border-white/[0.06] shadow-md">
        {artworkUrl && !imgError ? (
          <img
            src={artworkUrl}
            alt={album.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform"
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <Disc className="w-12 h-12 text-[#71717A]/60" />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlayAlbum(album);
          }}
          className="absolute bottom-2.5 right-2.5 w-10 h-10 rounded-full bg-[#FA586A] text-white flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-xl shadow-black/60 hover:scale-105 active:scale-95 z-10"
          title="Play Album"
        >
          <Play className="w-4 h-4 fill-white ml-0.5" />
        </button>
      </div>

      {/* Title & Artist */}
      <h4 className="font-bold text-xs text-white truncate group-hover:text-[#FA586A] transition-colors mb-0.5">
        {album.title}
      </h4>
      <div className="text-[11px] text-[#A1A1AA] truncate">
        <ArtistLinks
          artistName={album.artist}
          onSelectArtist={onSelectArtist}
          className="truncate block"
          linkClassName="hover:text-white hover:underline cursor-pointer transition-colors"
          delimiterClassName="text-[#71717A]"
        />
      </div>
      <span className="text-[10px] text-[#71717A] mt-1 font-medium">
        {album.year ? `${album.year} • ` : ""}
        {album.trackCount} {album.trackCount === 1 ? "track" : "tracks"}
      </span>
    </div>
  );
};

export const AlbumCard = React.memo(AlbumCardInner);

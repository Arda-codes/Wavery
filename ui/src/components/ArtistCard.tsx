import React, { useState, useCallback } from "react";
import { ArtistInfo } from "../types";
import { Users, Disc, Music, Play, ListPlus, CornerDownRight, User, Copy, FilePenLine } from "lucide-react";
import { useArtwork } from "../utils/useArtwork";
import { usePlayerStore } from "../stores/playerStore";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";

interface ArtistCardProps {
  artist: ArtistInfo;
  onSelectArtist: (artistName: string) => void;
  onEditArtist?: (artist: ArtistInfo) => void;
  artworkUrl?: string;
}

const ArtistCardInner: React.FC<ArtistCardProps> = ({
  artist,
  onSelectArtist,
  onEditArtist,
  artworkUrl: propArtworkUrl,
}) => {
  const fetchedArtwork = useArtwork(artist.artworkTrackId);
  const artworkUrl = propArtworkUrl || fetchedArtwork;
  const [imgError, setImgError] = useState(false);

  const setQueue = usePlayerStore((s) => s.setQueue);
  const insertAfterCurrent = usePlayerStore((s) => s.insertAfterCurrent);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openContextMenu = useContextMenuStore((s) => s.openContextMenu);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const menuItems: ContextMenuItem[] = [
        {
          id: "play-artist",
          label: `Play ${artist.name}`,
          icon: Play,
          onClick: () => {
            if (artist.tracks.length > 0) {
              setQueue(artist.tracks, 0, {
                type: "artist",
                name: artist.name,
              });
            }
          },
        },
        {
          id: "play-next-artist",
          label: "Play Next",
          icon: CornerDownRight,
          onClick: () => {
            if (artist.tracks.length > 0) {
              insertAfterCurrent(artist.tracks);
            }
          },
        },
        {
          id: "add-artist-to-queue",
          label: "Add All Songs to Queue",
          icon: ListPlus,
          onClick: () => {
            if (artist.tracks.length > 0) {
              addToQueue(artist.tracks);
            }
          },
        },
        {
          id: "divider-1",
          label: "",
          divider: true,
        },
        {
          id: "go-to-artist-profile",
          label: "View Artist Profile",
          icon: User,
          onClick: () => onSelectArtist(artist.name),
        },
        {
          id: "divider-copy",
          label: "",
          divider: true,
        },
        {
          id: "copy-artist-name",
          label: "Copy Artist Name",
          icon: Copy,
          onClick: () => {
            navigator.clipboard.writeText(artist.name);
          },
        },
      ];

      if (onEditArtist) {
        menuItems.push(
          {
            id: "divider-edit-artist",
            label: "",
            divider: true,
          },
          {
            id: "edit-artist-metadata",
            label: "Edit Artist Metadata...",
            icon: FilePenLine,
            onClick: () => onEditArtist(artist),
          }
        );
      }

      openContextMenu(e, menuItems);
    },
    [artist, onSelectArtist, onEditArtist, setQueue, insertAfterCurrent, addToQueue, openContextMenu]
  );

  return (
    <div
      onClick={() => onSelectArtist(artist.name)}
      onContextMenu={handleContextMenu}
      style={{ contain: "content" }}
      className="group cursor-pointer bg-[#16161A] hover:bg-[#202026] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-4 flex flex-col items-center text-center transition-[background-color,border-color,box-shadow,transform] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-sm hover:shadow-xl hover:-translate-y-0.5 select-none"
    >
      {/* Artist Avatar Circle */}
      <div className="w-28 h-28 rounded-full bg-[#1C1C22] overflow-hidden flex items-center justify-center mb-3.5 relative border border-white/[0.08] shadow-lg group-hover:scale-105 transition-transform duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform">
        {artworkUrl && !imgError ? (
          <img
            src={artworkUrl}
            alt={artist.name}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <Users className="w-10 h-10 text-[#71717A]" />
        )}
      </div>

      {/* Artist Name & Stats */}
      <h4 className="font-bold text-xs text-white truncate w-full group-hover:text-[#FA586A] transition-colors mb-1">
        {artist.name}
      </h4>
      <div className="flex items-center space-x-2 text-[10.5px] text-[#71717A] font-medium">
        <span className="flex items-center gap-1">
          <Disc className="w-3 h-3 text-[#FA586A]" /> {artist.albumCount}
        </span>
        <span>•</span>
        <span className="flex items-center gap-1">
          <Music className="w-3 h-3 text-[#71717A]" /> {artist.trackCount}
        </span>
      </div>
    </div>
  );
};

export const ArtistCard = React.memo(ArtistCardInner);

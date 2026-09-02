import React from "react";
import { parseArtistTokens } from "../utils/library";

export interface ArtistLinksProps {
  artistName?: string;
  onSelectArtist?: (artistName: string) => void;
  className?: string;
  linkClassName?: string;
  delimiterClassName?: string;
}

const ArtistLinksInner: React.FC<ArtistLinksProps> = ({
  artistName = "Unknown Artist",
  onSelectArtist,
  className = "truncate",
  linkClassName = "hover:text-[#FA586A] hover:underline cursor-pointer transition-colors",
  delimiterClassName = "text-[#71717A]",
}) => {
  const tokens = parseArtistTokens(artistName);

  return (
    <span className={className}>
      {tokens.map((tok, idx) => {
        if (!tok.isArtist || !onSelectArtist) {
          return (
            <span key={idx} className={delimiterClassName}>
              {tok.text}
            </span>
          );
        }
        return (
          <span
            key={idx}
            onClick={(e) => {
              e.stopPropagation();
              onSelectArtist(tok.text);
            }}
            className={linkClassName}
          >
            {tok.text}
          </span>
        );
      })}
    </span>
  );
};

export const ArtistLinks = React.memo(ArtistLinksInner);

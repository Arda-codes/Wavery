import React from "react";
import { ChevronRight, Home } from "lucide-react";
import { ViewMode } from "../types";

export interface BreadcrumbItem {
  label: string;
  view: ViewMode;
  targetId?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onNavigate: (view: ViewMode, targetId?: string) => void;
}

const BreadcrumbsInner: React.FC<BreadcrumbsProps> = ({ items, onNavigate }) => {
  return (
    <nav className="flex items-center space-x-1.5 text-xs text-[#71717A] py-2.5 px-6 bg-[#0D0D10]/80 border-b border-white/[0.06] select-none flex-shrink-0">
      <button
        onClick={() => onNavigate("tracks")}
        className="flex items-center text-[#71717A] hover:text-white transition p-1 rounded-md hover:bg-white/[0.04]"
        title="Library Home"
      >
        <Home className="w-3.5 h-3.5" />
      </button>

      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={idx}>
            <ChevronRight className="w-3.5 h-3.5 text-[#71717A]/50 flex-shrink-0" />
            <button
              onClick={() => onNavigate(item.view, item.targetId)}
              disabled={isLast}
              className={`font-medium transition max-w-[200px] truncate px-1.5 py-0.5 rounded-md ${
                isLast
                  ? "text-white font-semibold cursor-default"
                  : "text-[#A1A1AA] hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              {item.label}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export const Breadcrumbs = React.memo(BreadcrumbsInner);

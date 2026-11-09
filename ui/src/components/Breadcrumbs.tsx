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
    <nav className="flex items-center space-x-1 sm:space-x-2 text-xs text-textMuted py-2 sm:py-3 px-3 sm:px-6 bg-background/80 border-b border-white/[0.06] select-none flex-shrink-0 overflow-x-auto scrollbar-none whitespace-nowrap">
      <button
        onClick={() => onNavigate("tracks")}
        className="flex items-center text-textMuted hover:text-white transition p-2 sm:p-1 rounded-md hover:bg-white/[0.04] touch-target"
        title="Library Home"
      >
        <Home className="w-3.5 h-3.5" />
      </button>

      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={idx}>
            <ChevronRight className="w-3.5 h-3.5 text-textMuted/50 flex-shrink-0" />
            <button
              onClick={() => onNavigate(item.view, item.targetId)}
              disabled={isLast}
              className={`font-medium transition max-w-[120px] sm:max-w-[200px] truncate px-2 py-1 rounded-md ${
                isLast
                  ? "text-white font-semibold cursor-default"
                  : "text-textSecondary hover:text-white hover:bg-white/[0.04]"
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

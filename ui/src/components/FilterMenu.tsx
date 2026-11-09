import React, { useRef, useEffect } from "react";
import { ListFilter, X, RotateCcw } from "lucide-react";
import { useTransitionMount } from "../utils/useTransitionMount";

export interface FilterSectionOption<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

export interface FilterSection<T extends string = string> {
  id: string;
  title: string;
  options: FilterSectionOption<T>[];
  selectedId: T;
  onChange: (id: T) => void;
}

export interface FilterMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  activeFilterCount: number;
  onResetAll?: () => void;
  sections: FilterSection[];
  className?: string;
  buttonLabel?: string;
}

/**
 * Apple HIG-grade floating popover filter menu with grouped sections,
 * active badges, checkmarks, and outside-click dismissal.
 */
export const FilterMenu: React.FC<FilterMenuProps> = ({
  isOpen,
  onToggle,
  onClose,
  activeFilterCount,
  onResetAll,
  sections,
  className = "",
  buttonLabel = "Filter",
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { isRendered, isExiting } = useTransitionMount(isOpen, 120);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={menuRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label="Toggle filter menu"
        className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all border ${
          activeFilterCount > 0
            ? "bg-accent/15 border-accent/40 text-white shadow-sm"
            : isOpen
            ? "bg-white/[0.12] border-white/20 text-white"
            : "bg-surface hover:bg-surfaceHover border-white/[0.08] text-textSecondary hover:text-white"
        }`}
      >
        <ListFilter
          className={`w-3.5 h-3.5 flex-shrink-0 ${
            activeFilterCount > 0 ? "text-accent" : "text-textMuted"
          }`}
        />
        <span>{buttonLabel}</span>
        {activeFilterCount > 0 && (
          <span className="w-4 h-4 rounded-full bg-accent-fill text-white text-2xs font-bold flex items-center justify-center flex-shrink-0">
            {activeFilterCount}
          </span>
        )}
      </button>

      {/* Popover Card */}
      {isRendered && (
        <div
          className={`absolute left-0 sm:right-0 sm:left-auto top-full mt-2 w-72 sm:w-80 bg-surface/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-4 z-50 select-none space-y-4 ${
            isExiting ? "animate-scale-down pointer-events-none" : "animate-scale-up"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-white tracking-tight">
                Filter View
              </span>
              {activeFilterCount > 0 && (
                <span className="text-2xs font-semibold text-accent">
                  ({activeFilterCount} active)
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {activeFilterCount > 0 && onResetAll && (
                <button
                  type="button"
                  onClick={onResetAll}
                  className="text-2xs font-semibold text-textMuted hover:text-white flex items-center space-x-1 transition"
                  title="Reset all filters"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-6 h-6 rounded-lg hover:bg-white/[0.08] text-textMuted hover:text-white flex items-center justify-center transition"
                aria-label="Close menu"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Filter Sections */}
          <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
            {sections.map((section) => (
              <div key={section.id} className="space-y-2">
                <div className="text-2xs font-semibold text-textMuted tracking-wider uppercase">
                  {section.title}
                </div>
                <div className="flex flex-wrap gap-2">
                  {section.options.map((opt) => {
                    const isSelected = section.selectedId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => section.onChange(opt.id)}
                        className={`px-3 py-1 rounded-lg text-xs transition-all flex items-center space-x-2 border ${
                          isSelected
                            ? "bg-accent/20 border-accent/40 text-white font-semibold shadow-sm"
                            : "bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.06] text-textSecondary hover:text-white"
                        }`}
                      >
                        <span>{opt.label}</span>
                        {opt.count !== undefined && (
                          <span
                            className={`text-2xs font-mono tabular-nums ${
                              isSelected ? "text-accent" : "text-textMuted"
                            }`}
                          >
                            {opt.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

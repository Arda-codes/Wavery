import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { useContextMenuStore, ContextMenuItem } from "../stores/contextMenuStore";
import { windowService } from "../services/windowService";
import { ChevronRight } from "lucide-react";

interface SubmenuProps {
  items: ContextMenuItem[];
  parentRect: DOMRect | null;
  onCloseAll: () => void;
}

const Submenu: React.FC<SubmenuProps> = ({ items, parentRect, onCloseAll }) => {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!parentRect || !submenuRef.current) return;

    const el = submenuRef.current;
    const width = el.offsetWidth || 200;
    const height = el.offsetHeight || 150;
    const padding = 8;

    // Prefer opening to the right of the parent item
    let x = parentRect.right + 4;
    if (x + width > window.innerWidth - padding) {
      // Flip to the left
      x = Math.max(padding, parentRect.left - width - 4);
    }

    // Align with top of parent item, but clamp if going below screen
    let y = parentRect.top - 4;
    if (y + height > window.innerHeight - padding) {
      y = Math.max(padding, window.innerHeight - height - padding);
    }

    setCoords({ x, y });
  }, [parentRect]);

  return (
    <div
      ref={submenuRef}
      role="menu"
      style={{
        position: "fixed",
        left: `${coords.x}px`,
        top: `${coords.y}px`,
        zIndex: 10000,
      }}
      className="bg-[#1C1C22]/95 backdrop-blur-2xl border border-white/[0.12] rounded-2xl p-1.5 shadow-2xl shadow-black/90 min-w-[200px] max-w-[280px] max-h-[380px] overflow-y-auto animate-menu-in select-none"
    >
      {items.map((item) => {
        if (item.divider) {
          return <div key={item.id} className="my-1 border-t border-white/[0.08]" />;
        }

        const Icon = item.icon;

        return (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (item.disabled) return;
              if (item.onClick) item.onClick();
              onCloseAll();
            }}
            className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all text-left group ${
              item.disabled
                ? "opacity-35 cursor-not-allowed text-[#71717A]"
                : item.danger
                ? "text-red-400 hover:bg-red-500/20 hover:text-red-300"
                : "text-[#E4E4E7] hover:bg-white/[0.10] hover:text-white active:scale-[0.98]"
            }`}
          >
            {Icon && (
              <Icon
                className={`w-4 h-4 flex-shrink-0 transition-colors ${
                  item.danger
                    ? "text-red-400"
                    : "text-[#A1A1AA] group-hover:text-white"
                }`}
              />
            )}
            <span className="truncate flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] font-mono text-[#71717A] ml-2 group-hover:text-[#A1A1AA]">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export const ContextMenu: React.FC = () => {
  const isOpen = useContextMenuStore((s) => s.isOpen);
  const rawPosition = useContextMenuStore((s) => s.position);
  const items = useContextMenuStore((s) => s.items);
  const closeContextMenu = useContextMenuStore((s) => s.closeContextMenu);

  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x: 0, y: 0 });
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [activeSubmenuRect, setActiveSubmenuRect] = useState<DOMRect | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Dynamic viewport boundary calculation & clamping
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const el = menuRef.current;
    const width = el.offsetWidth || 220;
    const height = el.offsetHeight || 200;
    const padding = 10;

    let x = rawPosition.x;
    let y = rawPosition.y;

    if (x + width > window.innerWidth - padding) {
      x = Math.max(padding, window.innerWidth - width - padding);
    }
    if (y + height > window.innerHeight - padding) {
      y = Math.max(padding, window.innerHeight - height - padding);
    }

    setAdjustedPos({ x, y });
    setActiveSubmenuId(null);
    setActiveSubmenuRect(null);
  }, [isOpen, rawPosition]);

  // Click outside, Escape key, and window resize listeners
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeContextMenu();
      }
    };

    const handleScroll = (e: Event) => {
      // If scroll target is not inside the context menu, dismiss
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("touchstart", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", closeContextMenu);
    const unsubscribeWindowState = windowService.onWindowStateChange(closeContextMenu);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("touchstart", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", closeContextMenu);
      unsubscribeWindowState();
    };
  }, [isOpen, closeContextMenu]);

  const handleItemHover = useCallback((item: ContextMenuItem) => {
    if (item.items && item.items.length > 0) {
      const el = itemRefs.current.get(item.id);
      if (el) {
        setActiveSubmenuRect(el.getBoundingClientRect());
        setActiveSubmenuId(item.id);
      }
    } else {
      setActiveSubmenuId(null);
      setActiveSubmenuRect(null);
    }
  }, []);

  if (!isOpen || items.length === 0) return null;

  const activeSubmenuItem = items.find((i) => i.id === activeSubmenuId && i.items);

  return (
    <>
      <div
        ref={menuRef}
        role="menu"
        aria-orientation="vertical"
        style={{
          position: "fixed",
          left: `${adjustedPos.x}px`,
          top: `${adjustedPos.y}px`,
          zIndex: 9999,
        }}
        className="bg-[#16161C]/95 backdrop-blur-2xl border border-white/[0.12] rounded-2xl p-1.5 shadow-2xl shadow-black/90 min-w-[210px] max-w-[300px] select-none animate-menu-in text-xs"
      >
        {items.map((item) => {
          if (item.divider) {
            return <div key={item.id} className="my-1 border-t border-white/[0.08]" />;
          }

          const Icon = item.icon;
          const hasSubmenu = !!item.items && item.items.length > 0;
          const isSubmenuOpen = activeSubmenuId === item.id;

          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) itemRefs.current.set(item.id, el);
                else itemRefs.current.delete(item.id);
              }}
              role="menuitem"
              disabled={item.disabled}
              onMouseEnter={() => handleItemHover(item)}
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                if (hasSubmenu) {
                  handleItemHover(item);
                  return;
                }
                if (item.onClick) item.onClick();
                closeContextMenu();
              }}
              className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all text-left group ${
                item.disabled
                  ? "opacity-35 cursor-not-allowed text-[#71717A]"
                  : item.danger
                  ? "text-red-400 hover:bg-red-500/20 hover:text-red-300"
                  : isSubmenuOpen
                  ? "bg-white/[0.12] text-white"
                  : "text-[#E4E4E7] hover:bg-white/[0.10] hover:text-white active:scale-[0.98]"
              }`}
            >
              {Icon && (
                <Icon
                  className={`w-4 h-4 flex-shrink-0 transition-colors ${
                    item.danger
                      ? "text-red-400"
                      : "text-[#A1A1AA] group-hover:text-white"
                  }`}
                />
              )}
              <span className="truncate flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-[10px] font-mono text-[#71717A] ml-2 group-hover:text-[#A1A1AA]">
                  {item.shortcut}
                </span>
              )}
              {hasSubmenu && (
                <ChevronRight className="w-3.5 h-3.5 text-[#71717A] group-hover:text-white ml-1.5 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Submenu Portal */}
      {activeSubmenuItem && activeSubmenuItem.items && (
        <Submenu
          items={activeSubmenuItem.items}
          parentRect={activeSubmenuRect}
          onCloseAll={closeContextMenu}
        />
      )}
    </>
  );
};

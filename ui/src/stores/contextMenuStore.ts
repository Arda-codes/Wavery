import { create } from "zustand";
import React from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  divider?: boolean;
  items?: ContextMenuItem[];
}

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  openContextMenu: (
    e: React.MouseEvent | { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void },
    items: ContextMenuItem[]
  ) => void;
  closeContextMenu: () => void;
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  items: [],

  openContextMenu: (e, items) => {
    if ("preventDefault" in e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if ("stopPropagation" in e && typeof e.stopPropagation === "function") {
      e.stopPropagation();
    }

    set({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      items,
    });
  },

  closeContextMenu: () => {
    set({ isOpen: false, items: [] });
  },
}));

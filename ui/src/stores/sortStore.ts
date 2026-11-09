/**
 * Persistent page sorting options store.
 *
 * Remembers the chosen sort key and sort direction for every page across navigation
 * and app restarts, backed by localStorage and Zustand.
 */

import { create } from "zustand";
import { SortDirection } from "../types";

export const PAGE_SORTS_STORAGE_KEY = "wavery:page_sort_options";

export interface PageSortOption {
  key: string;
  dir: SortDirection;
}

export const DEFAULT_PAGE_SORTS: Record<string, PageSortOption> = {
  tracks: { key: "title", dir: "asc" },
  albums: { key: "title", dir: "asc" },
  artists: { key: "name", dir: "asc" },
  playlists: { key: "name", dir: "asc" },
  liked: { key: "date_added", dir: "desc" },
  album_detail: { key: "track_number", dir: "asc" },
  artist_detail: { key: "title", dir: "asc" },
  playlist_detail: { key: "date_added", dir: "asc" },
};

function loadPersistedPageSorts(): Record<string, PageSortOption> {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(PAGE_SORTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, PageSortOption>;
        }
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return {};
}

function persistPageSorts(sorts: Record<string, PageSortOption>) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PAGE_SORTS_STORAGE_KEY, JSON.stringify(sorts));
    }
  } catch {
    // Ignore storage write errors (quota or disabled storage)
  }
}

export interface SortStoreState {
  pageSorts: Record<string, PageSortOption>;
  getPageSort: (
    pageKey: string,
    defaultKey?: string,
    defaultDir?: SortDirection,
    fallbackPageKey?: string
  ) => PageSortOption;
  setPageSort: (
    pageKey: string,
    key: string,
    dir: SortDirection,
    aliasPageKey?: string
  ) => void;
  togglePageSort: (
    pageKey: string,
    key: string,
    defaultKey?: string,
    aliasPageKey?: string
  ) => PageSortOption;
  resetAllSorts: () => void;
}

export const useSortStore = create<SortStoreState>((set, get) => ({
  pageSorts: loadPersistedPageSorts(),

  getPageSort: (pageKey, defaultKey, defaultDir = "asc", fallbackPageKey) => {
    const { pageSorts } = get();
    if (pageSorts[pageKey]) {
      return pageSorts[pageKey];
    }
    if (fallbackPageKey && pageSorts[fallbackPageKey]) {
      return pageSorts[fallbackPageKey];
    }
    if (DEFAULT_PAGE_SORTS[pageKey]) {
      return DEFAULT_PAGE_SORTS[pageKey];
    }
    return {
      key: defaultKey || "title",
      dir: defaultDir,
    };
  },

  setPageSort: (pageKey, key, dir, aliasPageKey) => {
    const currentSorts = get().pageSorts;
    const nextSorts: Record<string, PageSortOption> = {
      ...currentSorts,
      [pageKey]: { key, dir },
    };
    if (aliasPageKey) {
      nextSorts[aliasPageKey] = { key, dir };
    }
    persistPageSorts(nextSorts);
    set({ pageSorts: nextSorts });
  },

  togglePageSort: (pageKey, key, defaultKey = "title", aliasPageKey) => {
    const { pageSorts } = get();
    const current =
      pageSorts[pageKey] ||
      (aliasPageKey ? pageSorts[aliasPageKey] : null) ||
      DEFAULT_PAGE_SORTS[pageKey] || { key: defaultKey, dir: "asc" };

    let nextDir: SortDirection = "asc";
    if (current.key === key) {
      nextDir = current.dir === "asc" ? "desc" : "asc";
    }

    const nextOption: PageSortOption = { key, dir: nextDir };
    const nextSorts: Record<string, PageSortOption> = {
      ...pageSorts,
      [pageKey]: nextOption,
    };
    if (aliasPageKey) {
      nextSorts[aliasPageKey] = nextOption;
    }

    persistPageSorts(nextSorts);
    set({ pageSorts: nextSorts });
    return nextOption;
  },

  resetAllSorts: () => {
    persistPageSorts({});
    set({ pageSorts: {} });
  },
}));

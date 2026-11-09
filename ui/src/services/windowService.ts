import { isTauri } from "./adapter";
import { useState, useEffect } from "react";

let tauriInvokeFn: (<T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;
async function getTauriInvoke(): Promise<<T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>> {
  if (!tauriInvokeFn) {
    const { invoke } = await import("@tauri-apps/api/core");
    tauriInvokeFn = invoke;
  }
  return tauriInvokeFn;
}

export interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
  isMinimized: boolean;
  width: number;
  height: number;
}

export type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export interface WindowService {
  isTauri(): boolean;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  toggleFullscreen(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  close(): Promise<void>;
  startHeaderDrag(screenX?: number, screenY?: number): Promise<void>;
  startResize(direction: ResizeDirection): Promise<void>;
  getWindowState(): WindowState;
  onWindowStateChange(callback: (state: WindowState) => void, emitCurrent?: boolean): () => void;
  onWindowResize?(callback: (size: { width: number; height: number }) => void, emitCurrent?: boolean): () => void;
}

class DesktopWindowService implements WindowService {
  private currentState: WindowState = {
    isMaximized: false,
    isFullscreen: false,
    isMinimized: false,
    width: typeof window !== "undefined" ? window.innerWidth : 1200,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  };
  private listeners: Set<(state: WindowState) => void> = new Set();
  private resizeListeners: Set<(size: { width: number; height: number }) => void> = new Set();
  private initialized = false;

  constructor() {
    this.initListeners();
  }

  private initListeners() {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function" || this.initialized) return;
    this.initialized = true;

    // 1. Viewport resize listener (throttled to 60fps via requestAnimationFrame)
    let resizeRaf: number | null = null;
    window.addEventListener("resize", () => {
      if (resizeRaf === null) {
        resizeRaf = window.requestAnimationFrame(() => {
          resizeRaf = null;
          this.updateState({
            width: window.innerWidth,
            height: window.innerHeight,
            isFullscreen: !isTauri ? Boolean(document.fullscreenElement) : this.currentState.isFullscreen,
          });
        });
      }
      if (isTauri) {
        this.debouncedSyncTauriWindowState();
      }
    });

    if (isTauri) {
      // 2. Initial state sync
      this.syncTauriWindowState();

      // 3. High-priority native Tauri custom event stream (dispatched instantly from Rust)
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          listen<Partial<WindowState>>("window-state-changed", (event) => {
            if (event.payload) {
              this.updateState({
                isMaximized: event.payload.isMaximized ?? this.currentState.isMaximized,
                isFullscreen: event.payload.isFullscreen ?? this.currentState.isFullscreen,
                isMinimized: event.payload.isMinimized ?? false,
                width: event.payload.width && event.payload.width > 0 ? event.payload.width : window.innerWidth,
                height: event.payload.height && event.payload.height > 0 ? event.payload.height : window.innerHeight,
              });
            }
          }).catch(() => {});
        })
        .catch(() => {});

      // 4. Tauri native window resize callback (emitted directly on WM_SIZE)
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => {
          const appWindow = getCurrentWindow();
          appWindow
            .onResized(({ payload: size }) => {
              this.updateState({
                width: size.width,
                height: size.height,
              });
              this.debouncedSyncTauriWindowState();
            })
            .catch(() => {});
        })
        .catch(() => {});
    } else {
      // Browser mode: listen for HTML5 Fullscreen API state changes
      if (typeof document !== "undefined") {
        document.addEventListener("fullscreenchange", () => {
          this.updateState({
            isFullscreen: Boolean(document.fullscreenElement),
          });
        });
      }
    }
  }

  private syncTimeout: ReturnType<typeof setTimeout> | null = null;

  private debouncedSyncTauriWindowState() {
    if (!isTauri) return;
    if (this.syncTimeout !== null) {
      clearTimeout(this.syncTimeout);
    }
    this.syncTimeout = setTimeout(() => {
      this.syncTimeout = null;
      this.syncTauriWindowState();
    }, 150);
  }

  private async syncTauriWindowState() {
    if (!isTauri) return;
    try {
      const [maximized, fullscreen] = await Promise.all([
        this.isMaximized(),
        this.isFullscreen(),
      ]);
      this.updateState({
        isMaximized: maximized,
        isFullscreen: fullscreen,
        width: typeof window !== "undefined" ? window.innerWidth : this.currentState.width,
        height: typeof window !== "undefined" ? window.innerHeight : this.currentState.height,
      });
    } catch {}
  }

  private updateState(partial: Partial<WindowState>) {
    const nextState: WindowState = {
      ...this.currentState,
      ...partial,
    };

    const discreteChanged =
      nextState.isMaximized !== this.currentState.isMaximized ||
      nextState.isFullscreen !== this.currentState.isFullscreen ||
      nextState.isMinimized !== this.currentState.isMinimized;

    const dimensionsChanged =
      nextState.width !== this.currentState.width ||
      nextState.height !== this.currentState.height;

    if (discreteChanged || dimensionsChanged) {
      this.currentState = nextState;

      // 1. Only broadcast to discrete state listeners (App, WindowControls, Handles)
      // when maximize, fullscreen, or minimize state changes. This isolates continuous
      // pixel dragging from triggering full React application tree re-renders.
      if (discreteChanged) {
        for (const listener of this.listeners) {
          try {
            listener(this.currentState);
          } catch (e) {
            console.error("[WindowService] Listener error:", e);
          }
        }
      }

      // 2. Broadcast dimension changes exclusively to dedicated resize listeners
      if (dimensionsChanged) {
        for (const resizeListener of this.resizeListeners) {
          try {
            resizeListener({ width: nextState.width, height: nextState.height });
          } catch (e) {
            console.error("[WindowService] Resize listener error:", e);
          }
        }
      }
    }
  }

  getWindowState(): WindowState {
    return this.currentState;
  }

  onWindowStateChange(callback: (state: WindowState) => void, emitCurrent = false): () => void {
    this.listeners.add(callback);
    if (emitCurrent) {
      callback(this.currentState);
    }
    return () => {
      this.listeners.delete(callback);
    };
  }

  onWindowResize(callback: (size: { width: number; height: number }) => void, emitCurrent = false): () => void {
    this.resizeListeners.add(callback);
    if (emitCurrent) {
      callback({ width: this.currentState.width, height: this.currentState.height });
    }
    return () => {
      this.resizeListeners.delete(callback);
    };
  }

  isTauri(): boolean {
    return isTauri;
  }

  async minimize(): Promise<void> {
    if (!isTauri) return;
    try {
      this.updateState({ isMinimized: true });
      const invoke = await getTauriInvoke();
      await invoke("minimize_window");
    } catch (e) {
      console.error("[WindowService] minimize failed:", e);
    }
  }

  async toggleMaximize(): Promise<boolean> {
    if (!isTauri) return false;
    try {
      const invoke = await getTauriInvoke();
      const newMax = await invoke<boolean>("toggle_maximize_window");
      this.updateState({ isMaximized: newMax });
      return newMax;
    } catch (e) {
      console.error("[WindowService] toggleMaximize failed:", e);
      return false;
    }
  }

  async isMaximized(): Promise<boolean> {
    if (!isTauri) return false;
    try {
      const invoke = await getTauriInvoke();
      return await invoke<boolean>("is_window_maximized");
    } catch (e) {
      console.error("[WindowService] isMaximized failed:", e);
      return false;
    }
  }

  async toggleFullscreen(): Promise<boolean> {
    if (isTauri) {
      try {
        const invoke = await getTauriInvoke();
        const newFull = await invoke<boolean>("toggle_fullscreen_window");
        this.updateState({ isFullscreen: newFull });
        return newFull;
      } catch (e) {
        console.error("[WindowService] toggleFullscreen failed:", e);
        return false;
      }
    } else {
      // Browser fallback using HTML5 Fullscreen API
      if (typeof document !== "undefined") {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen().catch(() => {});
          this.updateState({ isFullscreen: true });
          return true;
        } else {
          await document.exitFullscreen().catch(() => {});
          this.updateState({ isFullscreen: false });
          return false;
        }
      }
      return false;
    }
  }

  async isFullscreen(): Promise<boolean> {
    if (isTauri) {
      try {
        const invoke = await getTauriInvoke();
        return await invoke<boolean>("is_window_fullscreen");
      } catch (e) {
        console.error("[WindowService] isFullscreen failed:", e);
        return false;
      }
    } else {
      return typeof document !== "undefined" && Boolean(document.fullscreenElement);
    }
  }

  async close(): Promise<void> {
    if (isTauri) {
      try {
        const invoke = await getTauriInvoke();
        await invoke("close_app_window");
      } catch (e) {
        console.error("[WindowService] close failed:", e);
      }
    } else if (typeof window !== "undefined") {
      try {
        window.close();
      } catch {}
    }
  }

  async startHeaderDrag(): Promise<void> {
    if (!isTauri) return;
    try {
      this.updateState({ isMaximized: false });
      const invoke = await getTauriInvoke();
      await invoke("start_header_drag");
    } catch (e) {
      console.error("[WindowService] startHeaderDrag failed:", e);
    }
  }

  private isResizing = false;

  async startResize(direction: ResizeDirection): Promise<void> {
    if (!isTauri || this.currentState.isMaximized || this.currentState.isFullscreen || this.isResizing) return;
    this.isResizing = true;
    if (typeof document !== "undefined") {
      document.body.classList.add("is-resizing");
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startResizeDragging(direction);
    } catch (e) {
      console.error("[WindowService] startResize failed:", e);
    } finally {
      setTimeout(() => {
        this.isResizing = false;
        if (typeof document !== "undefined") {
          document.body.classList.remove("is-resizing");
        }
      }, 300);
    }
  }
}

export const windowService: WindowService = new DesktopWindowService();

/**
 * React hook to synchronize component renders with instantaneous window state updates
 * (Sudden maximize, restore, minimize, snap, or continuous resize).
 */
export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>(() => windowService.getWindowState());

  useEffect(() => {
    return windowService.onWindowStateChange((newState) => {
      setState(newState);
    });
  }, []);

  return state;
}

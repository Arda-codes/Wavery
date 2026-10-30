import { Track } from "../types";
import { getFullTrackArtistString } from "./library";
import { invoke } from "@tauri-apps/api/core";

function isTauriEnv(): boolean {
  return (
    typeof window !== "undefined" &&
    (Boolean((window as unknown as { isTauri?: boolean }).isTauri) ||
      Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__))
  );
}

/**
 * Requests desktop notification permission from the user's browser or desktop environment.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  // Tauri Desktop Environment:
  // Desktop notifications on Linux/Windows/macOS route through native desktop IPC
  // (`show_desktop_notification` on dedicated threads). Avoid calling Tauri's default
  // plugin-notification permission IPC on Tokio worker threads to prevent zbus block_on panics.
  if (isTauriEnv()) {
    return true;
  }

  // Standard Web Browser Environment
  if (!("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission !== "denied") {
    const perm = await Notification.requestPermission();
    return perm === "granted";
  }
  return false;
}

/**
 * Displays a desktop system notification for the currently playing track.
 */
export function showTrackNotification(track: Track, artworkUrl?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const title = track.metadata.title || "Now Playing";
  const artist = getFullTrackArtistString(track) || "Unknown Artist";
  const album = track.metadata.album ? ` • ${track.metadata.album}` : "";
  const body = `${artist}${album}`;

  // Tauri Desktop: routes via thread-isolated show_desktop_notification
  if (isTauriEnv()) {
    invoke("show_desktop_notification", {
      title,
      body,
    }).catch((err) => {
      console.debug("Tauri notification dispatch failed:", err);
    });
    return;
  }

  // Web Browser Notification fallback
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  try {
    const notification = new Notification(title, {
      body,
      icon: artworkUrl || undefined,
      silent: true,
      tag: "wavery-now-playing",
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    // Automatically close notification after 4 seconds
    setTimeout(() => {
      notification.close();
    }, 4000);
  } catch (err) {
    console.debug("Failed to spawn desktop notification:", err);
  }
}

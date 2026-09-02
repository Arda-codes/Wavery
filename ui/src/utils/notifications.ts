import { Track } from "../types";
import { getFullTrackArtistString } from "./library";

/**
 * Requests desktop notification permission from the user's browser or desktop environment.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
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
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }

  const title = track.metadata.title || "Now Playing";
  const artist = getFullTrackArtistString(track) || "Unknown Artist";
  const album = track.metadata.album ? ` • ${track.metadata.album}` : "";
  const body = `${artist}${album}`;

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

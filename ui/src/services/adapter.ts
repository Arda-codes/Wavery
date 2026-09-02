//! Universal API and Audio Adapter for Wavery.
//! Abstracts Tauri IPC and Browser HTTP Streaming under a single contract.

import { Track, PlayerStatus, ImportStrategy, Playlist } from "../types";
import { useSettingsStore } from "../stores/settingsStore";

export interface AudioPlayerAdapter {
  isTauri(): boolean;
  getTracks(): Promise<Track[]>;
  pickFile(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  importFile(path: string, strategy: ImportStrategy): Promise<Track>;
  importFolder(path: string, strategy: ImportStrategy): Promise<Track[]>;
  playTrack(track: Track): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getStatus(): Promise<PlayerStatus>;
  onTrackEnded?(callback: () => void): () => void;
  search(query: string): Promise<Track[]>;
  getArtwork(trackId: string): Promise<string | null>;
  getArtworkUrl(trackId: string): string;
  updateAlbumMetadata(payload: UpdateAlbumMetadataPayload): Promise<Track[]>;
  rebuildLibrary(): Promise<Track[]>;
  vacuumDatabase(): Promise<void>;
  clearArtworkCache(): Promise<void>;
  switchToWeb(): Promise<void>;
  switchToNative(): Promise<void>;
  getLikedTracks(): Promise<Track[]>;
  getLikedTrackIds(): Promise<string[]>;
  toggleLike(trackId: string): Promise<boolean>;
  likeTrack(trackId: string): Promise<void>;
  unlikeTrack(trackId: string): Promise<void>;
  listPlaylists(): Promise<Playlist[]>;
  createPlaylist(name: string): Promise<Playlist>;
  getPlaylist(id: string): Promise<Playlist | null>;
  getPlaylistTracks(id: string): Promise<Track[]>;
  renamePlaylist(id: string, name: string): Promise<void>;
  deletePlaylist(id: string): Promise<void>;
  addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void>;
  removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void>;
  savePlaylist(playlist: Playlist): Promise<void>;
  saveConfig?(config: unknown): Promise<void>;
  getConfig?(): Promise<unknown>;
  exportConfigJson?(): Promise<string>;
  importConfigJson?(jsonStr: string): Promise<unknown>;
}


export interface AlbumTrackUpdatePayload {
  track_id: string;
  title?: string;
  artist?: string;
  track_number?: number;
  disc_number?: number;
}

export interface UpdateAlbumMetadataPayload {
  album?: string;
  album_artist?: string;
  year?: number;
  genre?: string;
  tracks: AlbumTrackUpdatePayload[];
  write_tags?: boolean;
}

class BrowserAudioPlayer implements AudioPlayerAdapter {
  // Two alternating audio elements: one active (playing), one standby (next track).
  // This enables true simultaneous crossfade: outgoing fades out, incoming fades in.
  private elements: [HTMLAudioElement, HTMLAudioElement];
  // Index into `elements` of the currently active (playing) element.
  private activeIdx: 0 | 1 = 0;
  private currentTrack: Track | null = null;
  private volume: number = 0.8;
  private endedListeners: Set<() => void> = new Set();
  // Per-element fade intervals so both fades (in + out) run independently.
  private fadeIntervals: [ReturnType<typeof setInterval> | null, ReturnType<typeof setInterval> | null] = [null, null];
  // Guards against the outgoing element's `ended` event triggering playNext
  // during a crossfade handoff, which would cause a double-advance.
  private handoffActive: boolean = false;

  constructor() {
    const settings = useSettingsStore.getState();
    this.volume = typeof settings?.defaultVolume === "number" ? settings.defaultVolume : 0.8;

    this.elements = [new Audio(), new Audio()];

    for (let i = 0; i < 2; i++) {
      const el = this.elements[i];
      el.volume = this.volume;
      if (settings?.gaplessPlayback) {
        el.preload = "auto";
      }
      const idx = i as 0 | 1;
      el.addEventListener("ended", () => {
        // Suppress ended events from the outgoing element during a crossfade handoff.
        if (this.handoffActive) return;
        // Only fire ended callbacks when this is the active element.
        if (this.activeIdx !== idx) return;
        this.endedListeners.forEach((cb) => {
          try {
            cb();
          } catch (e) {
            console.error("Error in track ended callback:", e);
          }
        });
      });
    }
  }

  private get activeElement(): HTMLAudioElement {
    return this.elements[this.activeIdx];
  }

  private get standbyElement(): HTMLAudioElement {
    return this.elements[this.activeIdx === 0 ? 1 : 0];
  }

  private get standbyIdx(): 0 | 1 {
    return this.activeIdx === 0 ? 1 : 0;
  }

  private clearFade(idx: 0 | 1): void {
    if (this.fadeIntervals[idx] !== null) {
      clearInterval(this.fadeIntervals[idx]!);
      this.fadeIntervals[idx] = null;
    }
  }

  onTrackEnded(callback: () => void): () => void {
    this.endedListeners.add(callback);
    return () => {
      this.endedListeners.delete(callback);
    };
  }

  isTauri(): boolean {
    return false;
  }

  async pickFile(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".mp3,.flac,.ogg,.opus,.m4a,.wav,.aac";
      input.onchange = () => {
        if (input.files && input.files[0]) {
          resolve(input.files[0].name);
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  }

  async pickFolder(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
      input.onchange = () => {
        if (input.files && input.files.length > 0) {
          resolve(input.files[0].webkitRelativePath?.split("/")[0] || null);
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  }

  async getTracks(): Promise<Track[]> {
    const res = await fetch("/api/tracks");
    if (!res.ok) throw new Error("Failed to fetch tracks");
    return res.json();
  }

  async importFile(sourcePath: string, strategy: ImportStrategy): Promise<Track> {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_path: sourcePath, strategy }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async importFolder(dirPath: string, strategy: ImportStrategy): Promise<Track[]> {
    const res = await fetch("/api/import/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir_path: dirPath, strategy }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  private computeEffectiveVolume(track: Track | null): number {
    let effective = this.volume;
    if (!track) return effective;

    const settings = useSettingsStore.getState();
    if (settings?.replayGainMode === "track") {
      const trackGain = (track.metadata as { replaygain_track_gain?: number }).replaygain_track_gain;
      if (typeof trackGain === "number" && !isNaN(trackGain)) {
        const scale = Math.pow(10, trackGain / 20);
        effective = Math.max(0, Math.min(1, effective * scale));
      }
    } else if (settings?.replayGainMode === "album") {
      const albumGain = (track.metadata as { replaygain_album_gain?: number }).replaygain_album_gain;
      if (typeof albumGain === "number" && !isNaN(albumGain)) {
        const scale = Math.pow(10, albumGain / 20);
        effective = Math.max(0, Math.min(1, effective * scale));
      }
    }
    return effective;
  }

  async playTrack(track: Track): Promise<void> {
    const settings = useSettingsStore.getState();
    const crossfadeMs = settings?.crossfadeDurationMs || 0;
    const targetVolume = this.computeEffectiveVolume(track);

    this.currentTrack = track;

    if (crossfadeMs > 0) {
      // --- True dual-element crossfade ---
      // Block ended events from the outgoing element while we hand off to the
      // incoming element. Without this guard the outgoing element's `ended`
      // event would fire (if it finishes during the crossfade window) and call
      // playNext() a second time, advancing the queue by two tracks.
      this.handoffActive = true;

      const outgoingIdx = this.activeIdx;
      const incomingIdx = this.standbyIdx;
      const outgoingEl = this.elements[outgoingIdx];
      const incomingEl = this.elements[incomingIdx];

      // Cancel any fade that was already running on either element.
      this.clearFade(outgoingIdx);
      this.clearFade(incomingIdx);

      // Prepare the incoming element at volume 0.
      incomingEl.src = `/api/stream/${track.id}`;
      incomingEl.volume = 0;
      await incomingEl.play();

      // Promote incoming to active before starting intervals so that getStatus()
      // and `ended` events already reference the correct element.
      this.activeIdx = incomingIdx;
      this.handoffActive = false;

      const stepMs = 50;
      const totalSteps = Math.max(1, Math.floor(crossfadeMs / stepMs));
      let step = 0;
      const outgoingStartVolume = outgoingEl.volume;

      const crossInterval = setInterval(() => {
        step++;
        const frac = step / totalSteps;
        const clampedFrac = Math.min(1, frac);

        // Equal-power crossfade curve (cos for outgoing, sin for incoming)
        // Preserves perceived acoustic energy (0 dB dip at midpoint)
        const inGain = Math.sin(clampedFrac * (Math.PI / 2));
        const outGain = Math.cos(clampedFrac * (Math.PI / 2));

        incomingEl.volume = Math.min(1, targetVolume * inGain);
        outgoingEl.volume = Math.max(0, outgoingStartVolume * outGain);

        if (step >= totalSteps) {
          clearInterval(crossInterval);
          // Snap to exact target volumes to avoid floating-point drift.
          incomingEl.volume = targetVolume;
          outgoingEl.pause();
          outgoingEl.src = "";
          outgoingEl.volume = this.volume;
          // Clear both interval slots since the same interval object covered both fades.
          this.fadeIntervals[outgoingIdx] = null;
          this.fadeIntervals[incomingIdx] = null;
        }
      }, stepMs);

      // Store the same interval handle in both slots so clearFade() on either
      // index cancels it correctly if playTrack() is called again mid-crossfade.
      this.fadeIntervals[outgoingIdx] = crossInterval;
      this.fadeIntervals[incomingIdx] = crossInterval;
    } else {
      // --- Instant switch (no crossfade) ---
      // Stop and silence the standby element in case it was mid-crossfade.
      const outgoingIdx = this.activeIdx;
      this.clearFade(outgoingIdx);
      this.clearFade(this.standbyIdx);

      this.handoffActive = true;
      const standby = this.standbyElement;
      standby.pause();
      standby.src = "";
      standby.volume = this.volume;
      this.handoffActive = false;

      const active = this.activeElement;
      active.src = `/api/stream/${track.id}`;
      active.volume = targetVolume;
      await active.play();
    }
  }

  async pause(): Promise<void> {
    this.activeElement.pause();
  }

  async resume(): Promise<void> {
    // If a fade-in is in progress, don't stomp the volume — the interval
    // owns it. Only restore when no fade is running on the active element.
    if (this.fadeIntervals[this.activeIdx] === null) {
      this.activeElement.volume = this.computeEffectiveVolume(this.currentTrack);
    }
    await this.activeElement.play();
  }

  async stop(): Promise<void> {
    this.handoffActive = true;
    // Stop and reset both elements cleanly.
    for (let i = 0; i < 2; i++) {
      this.clearFade(i as 0 | 1);
      this.elements[i].pause();
      this.elements[i].currentTime = 0;
    }
    this.handoffActive = false;
    this.currentTrack = null;
  }

  async seek(seconds: number): Promise<void> {
    this.activeElement.currentTime = seconds;
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(1, volume));
    // Only update the active element's volume when no fade is in-flight.
    // The fade interval already accounts for the target volume via
    // computeEffectiveVolume, so changing it mid-fade would cause a jump.
    if (this.fadeIntervals[this.activeIdx] === null) {
      this.activeElement.volume = this.computeEffectiveVolume(this.currentTrack);
    }
  }

  async getStatus(): Promise<PlayerStatus> {
    const el = this.activeElement;
    return {
      state: el.paused
        ? el.currentTime === 0
          ? "Stopped"
          : "Paused"
        : "Playing",
      volume: this.volume,
      position_secs: el.currentTime,
      duration_secs: isNaN(el.duration) ? undefined : el.duration,
      current_track: this.currentTrack || undefined,
      loop_mode: el.loop ? "Track" : "Off",
    };
  }

  async search(query: string): Promise<Track[]> {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error("Search failed");
    return res.json();
  }

  async getArtwork(trackId: string): Promise<string | null> {
    if (!trackId) return null;
    return `http://127.0.0.1:4242/api/tracks/${trackId}/artwork`;
  }

  getArtworkUrl(trackId: string): string {
    return `http://127.0.0.1:4242/api/tracks/${trackId}/artwork`;
  }

  async updateAlbumMetadata(payload: UpdateAlbumMetadataPayload): Promise<Track[]> {
    const res = await fetch("/api/albums/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async rebuildLibrary(): Promise<Track[]> {
    const res = await fetch("/api/library/rebuild", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async vacuumDatabase(): Promise<void> {
    const res = await fetch("/api/library/vacuum", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
  }

  async clearArtworkCache(): Promise<void> {
    // In-browser cache purge
    return Promise.resolve();
  }

  async switchToWeb(): Promise<void> {
    this.pause();
    if (typeof window !== "undefined") {
      window.open(window.location.origin, "_blank");
    }
  }

  async switchToNative(): Promise<void> {
    this.pause();
    try {
      await fetch("/api/app/switch-to-native", { method: "POST" });
    } catch {
      // Ignored if server terminates immediately
    }
    if (typeof window !== "undefined") {
      window.close();
      setTimeout(() => {
        window.close();
      }, 100);
    }
  }

  async getLikedTracks(): Promise<Track[]> {
    const res = await fetch("/api/liked");
    if (!res.ok) throw new Error("Failed to fetch liked tracks");
    return res.json();
  }

  async getLikedTrackIds(): Promise<string[]> {
    const res = await fetch("/api/liked/ids");
    if (!res.ok) throw new Error("Failed to fetch liked track IDs");
    return res.json();
  }

  async toggleLike(trackId: string): Promise<boolean> {
    const res = await fetch(`/api/liked/${encodeURIComponent(trackId)}/toggle`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to toggle like");
    const data = await res.json();
    return data.liked;
  }

  async likeTrack(trackId: string): Promise<void> {
    const res = await fetch(`/api/liked/${encodeURIComponent(trackId)}`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to like track");
  }

  async unlikeTrack(trackId: string): Promise<void> {
    const res = await fetch(`/api/liked/${encodeURIComponent(trackId)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to unlike track");
  }

  async listPlaylists(): Promise<Playlist[]> {
    const res = await fetch("/api/playlists");
    if (!res.ok) throw new Error("Failed to list playlists");
    return res.json();
  }

  async createPlaylist(name: string): Promise<Playlist> {
    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async getPlaylistTracks(id: string): Promise<Track[]> {
    const res = await fetch(`/api/playlists/${encodeURIComponent(id)}/tracks`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async renamePlaylist(id: string, name: string): Promise<void> {
    const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async deletePlaylist(id: string): Promise<void> {
    const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
    const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_ids: trackIds }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    const res = await fetch(
      `/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) throw new Error(await res.text());
  }

  async savePlaylist(playlist: Playlist): Promise<void> {
    const res = await fetch(`/api/playlists/${encodeURIComponent(playlist.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(playlist),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async saveConfig(config: unknown): Promise<void> {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async getConfig(): Promise<unknown> {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to fetch config");
    return res.json();
  }

  async exportConfigJson(): Promise<string> {
    const res = await fetch("/api/config/export");
    if (!res.ok) throw new Error("Failed to export config");
    return res.text();
  }

  async importConfigJson(jsonStr: string): Promise<unknown> {
    const res = await fetch("/api/config/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json_str: jsonStr }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
}


class TauriAudioPlayer implements AudioPlayerAdapter {
  isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }

  onTrackEnded(callback: () => void): () => void {
    let unlisten: (() => void) | null = null;
    let isCleanedUp = false;

    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        if (isCleanedUp) return;
        return listen("track-ended", () => {
          try {
            callback();
          } catch (e) {
            console.error("Error in tauri track-ended callback:", e);
          }
        });
      })
      .then((u) => {
        if (!u) return;
        if (isCleanedUp) {
          u();
        } else {
          unlisten = u;
        }
      })
      .catch((e) => {
        console.error("Failed to register Tauri track-ended listener:", e);
      });

    return () => {
      isCleanedUp = true;
      if (unlisten) {
        unlisten();
      }
    };
  }

  async getArtwork(trackId: string): Promise<string | null> {
    if (!trackId) return null;
    return `http://127.0.0.1:4242/api/tracks/${trackId}/artwork`;
  }

  getArtworkUrl(trackId: string): string {
    return `http://127.0.0.1:4242/api/tracks/${trackId}/artwork`;
  }

  async getTracks(): Promise<Track[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Track[]>("get_tracks");
  }

  async pickFile(): Promise<string | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("pick_file");
  }

  async pickFolder(): Promise<string | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("pick_folder");
  }

  async importFile(sourcePath: string, strategy: ImportStrategy): Promise<Track> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Track>("import_file", { sourcePath, strategy });
  }

  async importFolder(dirPath: string, strategy: ImportStrategy): Promise<Track[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Vec<Track>>("import_folder", { dirPath, strategy });
  }

  async playTrack(track: Track): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("play_track", { trackId: track.id });
  }

  async pause(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("pause_playback");
  }

  async resume(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("resume_playback");
  }

  async stop(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("stop_playback");
  }

  async seek(seconds: number): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("seek_playback", { positionSecs: seconds });
  }

  async setVolume(volume: number): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_volume", { volume });
  }

  async getStatus(): Promise<PlayerStatus> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PlayerStatus>("get_status");
  }

  async search(query: string): Promise<Track[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Track[]>("search_tracks", { query });
  }

  async updateAlbumMetadata(payload: UpdateAlbumMetadataPayload): Promise<Track[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Track[]>("update_album_metadata", { req: payload });
  }

  async rebuildLibrary(): Promise<Track[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Track[]>("rebuild_library");
  }

  async vacuumDatabase(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("vacuum_library");
  }

  async clearArtworkCache(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("clear_artwork_cache");
  }

  async switchToWeb(): Promise<void> {
    this.pause();
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("switch_to_web");
  }

  async switchToNative(): Promise<void> {
    return Promise.resolve();
  }

  async getLikedTracks(): Promise<Track[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Track[]>("get_liked_tracks");
  }

  async getLikedTrackIds(): Promise<string[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string[]>("get_liked_track_ids");
  }

  async toggleLike(trackId: string): Promise<boolean> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("toggle_like", { trackId });
  }

  async likeTrack(trackId: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("like_track", { trackId });
  }

  async unlikeTrack(trackId: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("unlike_track", { trackId });
  }

  async listPlaylists(): Promise<Playlist[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Playlist[]>("list_playlists");
  }

  async createPlaylist(name: string): Promise<Playlist> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Playlist>("create_playlist", { name });
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Playlist | null>("get_playlist", { id });
  }

  async getPlaylistTracks(id: string): Promise<Track[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Track[]>("get_playlist_tracks", { id });
  }

  async renamePlaylist(id: string, name: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("rename_playlist", { id, name });
  }

  async deletePlaylist(id: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("delete_playlist", { id });
  }

  async addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("add_tracks_to_playlist", { playlistId, trackIds });
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("remove_track_from_playlist", { playlistId, trackId });
  }

  async savePlaylist(playlist: Playlist): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("save_playlist", { playlist });
  }

  async saveConfig(config: unknown): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("save_config", { config });
  }

  async getConfig(): Promise<unknown> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_config");
  }

  async exportConfigJson(): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("export_config_json");
  }

  async importConfigJson(jsonStr: string): Promise<unknown> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("import_config_json", { jsonStr });
  }
}


type Vec<T> = T[];

export const playerAdapter: AudioPlayerAdapter =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    ? new TauriAudioPlayer()
    : new BrowserAudioPlayer();

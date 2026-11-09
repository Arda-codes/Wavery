//! Universal API and Audio Adapter for Wavery.
//! Abstracts Tauri IPC and Browser HTTP Streaming under a single contract.

import {
  Track,
  PlayerStatus,
  ImportStrategy,
  Playlist,
  UpdateTrackMetadataPayload,
  UpdateArtistMetadataPayload,
  AlbumInfo,
  ArtistInfo,
  GenreInfo,
  QueueStateSnapshot,
  LoopMode,
  WaveformData,
  PlaylistImportSummary,
  DatabaseStats,
  DatabaseHealth,
  DatabaseBackup,
  DatabaseLocation,
} from "../types";
import { useSettingsStore } from "../stores/settingsStore";
import { groupTracksByAlbum, groupTracksByArtist, extractLibraryGenres } from "../utils/library";

export type { WaveformData } from "../types";

export interface ServerStatus {
  host: string;
  port: number;
  is_lan_enabled: boolean;
  local_ip: string | null;
  lan_url: string | null;
}

export interface AudioPlayerAdapter {
  isTauri(): boolean;
  getTracks(): Promise<Track[]>;
  pickFile(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  pickPlaylistFile(): Promise<string | null>;
  importFile(path: string, strategy: ImportStrategy): Promise<Track>;
  importFolder(path: string, strategy: ImportStrategy): Promise<Track[]>;
  importPlaylistFile(path: string): Promise<PlaylistImportSummary>;
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
  updateTrackMetadata(payload: UpdateTrackMetadataPayload): Promise<Track>;
  updateArtistMetadata(payload: UpdateArtistMetadataPayload): Promise<Track[]>;
  updateAlbumMetadata(payload: UpdateAlbumMetadataPayload): Promise<Track[]>;
  rebuildLibrary(): Promise<Track[]>;
  vacuumDatabase(): Promise<void>;
  getDatabaseStats(): Promise<DatabaseStats>;
  checkDatabaseHealth(): Promise<DatabaseHealth>;
  pruneMissingTracks(): Promise<number>;
  backupDatabase(): Promise<DatabaseBackup | null>;
  revealDatabaseLocation(location: DatabaseLocation): Promise<void>;
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
  deleteTrack(id: string, removeFile?: boolean): Promise<void>;
  addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void>;
  removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void>;
  savePlaylist(playlist: Playlist): Promise<void>;
  syncQueue?(payload: {
    user_queue: Track[];
    context_queue: Track[];
    current_track_id?: string;
    is_shuffle: boolean;
    loop_mode: string;
  }): Promise<void>;
  syncFromStore?(state: {
    queue?: Track[];
    queueIndex?: number;
    currentTrack?: Track | null;
    status?: { position_secs?: number; loop_mode?: string };
    isShuffle?: boolean;
    loopMode?: LoopMode;
    isAutoplay?: boolean;
    userQueue?: Track[];
    contextQueue?: Track[];
    contextIndex?: number;
    shuffleIndices?: number[];
    shufflePos?: number;
  }): void;
  saveConfig?(config: unknown): Promise<void>;
  getConfig?(): Promise<unknown>;
  getServerStatus?(): Promise<ServerStatus>;
  setServerLanMode?(enabled: boolean): Promise<ServerStatus>;
  getWaveform?(trackId: string): Promise<WaveformData | null>;
  exportConfigJson?(): Promise<string>;
  importConfigJson?(jsonStr: string): Promise<unknown>;

  // Queue Authority IPC API (Milestone M4)
  queueSetContext(tracks: Track[], startIndex: number): Promise<QueueStateSnapshot>;
  queueAddUser(tracks: Track[]): Promise<QueueStateSnapshot>;
  queuePlayNext(tracks: Track[]): Promise<QueueStateSnapshot>;
  queueRemoveUserTrack(index: number): Promise<QueueStateSnapshot>;
  queueReorderUser(from: number, to: number): Promise<QueueStateSnapshot>;
  queueClearUser(): Promise<QueueStateSnapshot>;
  queueNext(): Promise<QueueStateSnapshot>;
  queuePrevious(positionSecs?: number): Promise<QueueStateSnapshot>;
  queueJumpToIndex(index: number): Promise<QueueStateSnapshot>;
  queueJumpToContextTrack(contextIndex: number): Promise<QueueStateSnapshot>;
  queueJumpToUserTrack(userIndex: number): Promise<QueueStateSnapshot>;
  queueSetShuffle(enabled: boolean): Promise<QueueStateSnapshot>;
  queueSetLoopMode(mode: LoopMode | string): Promise<QueueStateSnapshot>;
  queueSetAutoplay(enabled: boolean): Promise<QueueStateSnapshot>;
  queueClear(): Promise<QueueStateSnapshot>;
  queueGetState(): Promise<QueueStateSnapshot>;
  getAutoplayNext(candidatePool?: Track[]): Promise<Track | null>;

  // Library Aggregation IPC Helpers (Milestone M4)
  getAlbums(): Promise<AlbumInfo[]>;
  getArtists(): Promise<ArtistInfo[]>;
  getGenres(): Promise<GenreInfo[]>;
  getAlbumDetails?(title: string, artist?: string): Promise<AlbumInfo | null>;
  getArtistDetails?(name: string): Promise<ArtistInfo | null>;
}


interface AlbumTrackUpdatePayload {
  track_id: string;
  title?: string;
  artist?: string;
  track_number?: number;
  disc_number?: number;
}

interface UpdateAlbumMetadataPayload {
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

    let prevReplayGainMode = settings?.replayGainMode;
    if (typeof useSettingsStore.subscribe === "function") {
      useSettingsStore.subscribe((state) => {
        if (state.replayGainMode !== prevReplayGainMode) {
          prevReplayGainMode = state.replayGainMode;
          if (this.fadeIntervals[this.activeIdx] === null) {
            this.activeElement.volume = this.computeEffectiveVolume(this.currentTrack);
          }
        }
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

  async pickPlaylistFile(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
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

  async importPlaylistFile(): Promise<PlaylistImportSummary> {
    throw new Error(
      "Playlist import needs the Wavery desktop app, because the browser cannot read the file from disk."
    );
  }

  private computeEffectiveVolume(track: Track | null): number {
    const baseVolume = Math.max(0, Math.min(1, this.volume));
    if (!track) return baseVolume;

    const settings = useSettingsStore.getState();
    const mode = settings?.replayGainMode ?? "off";
    if (mode === "off") return baseVolume;

    const meta = track.metadata;
    const gainDb =
      mode === "album"
        ? (meta.replaygain_album_gain ?? meta.replaygain_track_gain)
        : meta.replaygain_track_gain;
    const peak =
      mode === "album"
        ? (meta.replaygain_album_peak ?? meta.replaygain_track_peak)
        : meta.replaygain_track_peak;

    if (typeof gainDb !== "number" || isNaN(gainDb)) {
      return baseVolume;
    }

    const clampedGain = Math.max(-60, Math.min(30, gainDb));
    let multiplier = Math.pow(10, clampedGain / 20);

    if (typeof peak === "number" && peak > 0 && !isNaN(peak)) {
      if (multiplier * peak > 1.0) {
        multiplier = 1.0 / peak;
      }
    }

    multiplier = Math.max(0.0001, Math.min(2.0, multiplier));
    return Math.max(0, Math.min(1, baseVolume * multiplier));
  }

  async playTrack(track: Track): Promise<void> {
    const settings = useSettingsStore.getState();
    const crossfadeMs = settings?.crossfadeDurationMs || 0;
    const targetVolume = this.computeEffectiveVolume(track);

    this.currentTrack = track;

    const outgoingIdx = this.activeIdx;
    const incomingIdx = this.standbyIdx;
    const outgoingEl = this.elements[outgoingIdx];
    const incomingEl = this.elements[incomingIdx];

    const isCurrentlyPlaying = !outgoingEl.paused && outgoingEl.currentTime > 0 && !!outgoingEl.src;

    if (crossfadeMs > 0 && isCurrentlyPlaying) {
      // --- True dual-element crossfade ---
      // Block ended events from the outgoing element while we hand off to the
      // incoming element to avoid premature double-advancement.
      this.handoffActive = true;

      // Cancel any fade that was already running on either element.
      this.clearFade(outgoingIdx);
      this.clearFade(incomingIdx);

      // Prepare the incoming element at volume 0.
      incomingEl.src = `/api/stream/${encodeURIComponent(track.id)}`;
      incomingEl.volume = 0;
      try {
        await incomingEl.play();
      } catch (e) {
        console.warn("Incoming crossfade track play postponed or interrupted:", e);
      }

      if (this.currentTrack?.id !== track.id) {
        incomingEl.pause();
        return;
      }

      // Promote incoming to active so that getStatus() and events reference the incoming element.
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

        incomingEl.volume = Math.max(0, Math.min(1, targetVolume * inGain));
        outgoingEl.volume = Math.max(0, Math.min(1, outgoingStartVolume * outGain));

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
      // --- Instant switch (no crossfade or starting from stopped/paused state) ---
      this.clearFade(outgoingIdx);
      this.clearFade(incomingIdx);

      this.handoffActive = true;
      outgoingEl.pause();
      outgoingEl.src = "";
      outgoingEl.volume = this.volume;
      this.handoffActive = false;

      const active = this.activeElement;
      active.src = `/api/stream/${encodeURIComponent(track.id)}`;
      active.volume = targetVolume;
      try {
        await active.play();
      } catch (e) {
        console.warn("Instant track play postponed or interrupted:", e);
      }
    }
  }

  async pause(): Promise<void> {
    this.activeElement.pause();
    this.standbyElement.pause();
  }

  async resume(): Promise<void> {
    if (!this.currentTrack || !this.activeElement.src) {
      throw new Error("No track loaded in browser audio player");
    }
    // If a fade-in is in progress, don't stomp the volume — the interval owns it.
    if (this.fadeIntervals[this.activeIdx] === null) {
      this.activeElement.volume = this.computeEffectiveVolume(this.currentTrack);
    }
    await this.activeElement.play();
    if (this.fadeIntervals[this.standbyIdx] !== null) {
      await this.standbyElement.play().catch(() => {});
    }
  }

  async stop(): Promise<void> {
    this.currentTrack = null;
    this.handoffActive = true;
    // Stop and reset both elements cleanly.
    for (let i = 0; i < 2; i++) {
      this.clearFade(i as 0 | 1);
      this.elements[i].pause();
      this.elements[i].currentTime = 0;
    }
    this.handoffActive = false;
  }

  async seek(seconds: number): Promise<void> {
    // Seeking cancels any pending crossfade and locks to current volume
    for (let i = 0; i < 2; i++) {
      this.clearFade(i as 0 | 1);
    }
    this.activeElement.volume = this.computeEffectiveVolume(this.currentTrack);
    const el = this.activeElement;
    if (typeof el.readyState === "number" && el.readyState >= 1) {
      try {
        el.currentTime = seconds;
      } catch (e) {
        console.warn("Seek error:", e);
      }
    } else {
      const onLoaded = () => {
        try {
          el.currentTime = seconds;
        } catch (e) {
          console.warn("Deferred seek error:", e);
        }
        el.removeEventListener("loadedmetadata", onLoaded);
      };
      el.addEventListener("loadedmetadata", onLoaded, { once: true });
    }
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.fadeIntervals[this.activeIdx] === null) {
      this.activeElement.volume = this.computeEffectiveVolume(this.currentTrack);
    }
  }

  async getStatus(): Promise<PlayerStatus> {
    const el = this.activeElement;
    const isFading = this.fadeIntervals[0] !== null || this.fadeIntervals[1] !== null;
    let state: "Playing" | "Paused" | "Stopped";
    if (isFading || !el.paused) {
      state = "Playing";
    } else if (el.currentTime === 0) {
      state = "Stopped";
    } else {
      state = "Paused";
    }

    return {
      state,
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
    return `/api/tracks/${encodeURIComponent(trackId)}/artwork`;
  }

  getArtworkUrl(trackId: string): string {
    if (!trackId) return "";
    return `/api/tracks/${encodeURIComponent(trackId)}/artwork`;
  }

  async updateTrackMetadata(payload: UpdateTrackMetadataPayload): Promise<Track> {
    const res = await fetch("/api/tracks/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async updateArtistMetadata(payload: UpdateArtistMetadataPayload): Promise<Track[]> {
    const res = await fetch("/api/artists/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
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

  async getDatabaseStats(): Promise<DatabaseStats> {
    const res = await fetch("/api/library/stats");
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async checkDatabaseHealth(): Promise<DatabaseHealth> {
    const res = await fetch("/api/library/health", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async pruneMissingTracks(): Promise<number> {
    const res = await fetch("/api/library/prune", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    const body: { removed: number } = await res.json();
    return body.removed;
  }

  async backupDatabase(): Promise<DatabaseBackup | null> {
    const res = await fetch("/api/library/backup", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async revealDatabaseLocation(_location: DatabaseLocation): Promise<void> {
    // Browsers cannot hand a local path to the platform file manager.
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
      // Ignored if network error
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

  async deleteTrack(id: string, removeFile = false): Promise<void> {
    const res = await fetch(`/api/tracks/${encodeURIComponent(id)}?remove_file=${Boolean(removeFile)}`, {
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

  // In-Memory Queue State for Browser / Headless Node mode
  private queue: Track[] = [];
  private currentIdx: number | null = null;
  private contextQueue: Track[] = [];
  private contextIdx: number | null = null;
  private userQueue: Track[] = [];
  private history: Track[] = [];
  private isShuffle: boolean = false;
  private loopMode: LoopMode = "Off";
  private isAutoplay: boolean = false;
  private shuffledIndices: number[] = [];
  private shufflePos: number = 0;

  private rebuildShuffle(preserveCurrentIndex = false): void {
    const len = this.queue.length;
    if (len === 0) {
      this.shuffledIndices = [];
      this.shufflePos = 0;
      return;
    }
    const indices = Array.from({ length: len }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = indices[i];
      indices[i] = indices[j];
      indices[j] = temp;
    }
    if (preserveCurrentIndex && this.currentIdx !== null && this.currentIdx < len) {
      const pos = indices.indexOf(this.currentIdx);
      if (pos !== -1) {
        indices[pos] = indices[0];
        indices[0] = this.currentIdx;
      }
      this.shufflePos = 0;
    } else {
      this.shufflePos = 0;
      if (indices.length > 0 && this.currentIdx === null) {
        this.currentIdx = indices[0];
      }
    }
    this.shuffledIndices = indices;
  }

  private getQueueSnapshot(): QueueStateSnapshot {
    return {
      currentTrack: this.currentTrack,
      currentIndex: this.currentIdx,
      userQueue: [...this.userQueue],
      contextQueue: [...this.contextQueue],
      contextIndex: this.contextIdx,
      queue: [...this.queue],
      isShuffle: this.isShuffle,
      loopMode: this.loopMode,
      isAutoplay: this.isAutoplay,
      history: [...this.history],
      shuffleIndices: [...this.shuffledIndices],
      shufflePos: this.shufflePos,
    };
  }

  public syncFromStore(state: {
    queue?: Track[];
    queueIndex?: number;
    currentTrack?: Track | null;
    status?: { position_secs?: number; loop_mode?: string };
    isShuffle?: boolean;
    loopMode?: LoopMode;
    isAutoplay?: boolean;
    userQueue?: Track[];
    contextQueue?: Track[];
    contextIndex?: number;
    shuffleIndices?: number[];
    shufflePos?: number;
  }): void {
    if (state.queue) this.queue = [...state.queue];
    if (state.queueIndex !== undefined && state.queueIndex !== null) this.currentIdx = state.queueIndex;
    if (state.currentTrack !== undefined) this.currentTrack = state.currentTrack;
    if (state.isShuffle !== undefined) this.isShuffle = state.isShuffle;
    const effLoop = state.status?.loop_mode ?? state.loopMode;
    if (effLoop !== undefined) this.loopMode = effLoop as LoopMode;
    if (state.isAutoplay !== undefined) this.isAutoplay = state.isAutoplay;
    if (state.userQueue) this.userQueue = [...state.userQueue];
    if (state.contextQueue) this.contextQueue = [...state.contextQueue];
    if (state.contextIndex !== undefined) this.contextIdx = state.contextIndex;
    if (this.isShuffle) {
      if (Array.isArray(state.shuffleIndices) && state.shuffleIndices.length === this.queue.length) {
        this.shuffledIndices = [...state.shuffleIndices];
        this.shufflePos = typeof state.shufflePos === "number" ? state.shufflePos : 0;
      } else if (this.shuffledIndices.length !== this.queue.length) {
        this.rebuildShuffle(true);
      }
    } else {
      this.shuffledIndices = [];
      this.shufflePos = 0;
    }
  }

  async syncQueue(payload: {
    user_queue: Track[];
    context_queue: Track[];
    current_track_id?: string;
    is_shuffle: boolean;
    loop_mode: string;
  }): Promise<void> {
    this.elements.forEach((el) => {
      el.loop = payload.loop_mode === "Track";
    });
    this.userQueue = [...payload.user_queue];
    this.contextQueue = [...payload.context_queue];
    this.isShuffle = payload.is_shuffle;
    this.loopMode = (payload.loop_mode === "Track" || payload.loop_mode === "Queue") ? payload.loop_mode : "Off";
    if (this.queue.length === 0 && (this.contextQueue.length > 0 || this.userQueue.length > 0)) {
      this.queue = [...this.contextQueue, ...this.userQueue];
    }
    if (payload.current_track_id) {
      const found = this.userQueue.find((t) => t.id === payload.current_track_id) ||
                    this.contextQueue.find((t) => t.id === payload.current_track_id) ||
                    this.queue.find((t) => t.id === payload.current_track_id);
      if (found) {
        this.currentTrack = found;
        const qIdx = this.queue.findIndex((t) => t.id === found.id);
        if (qIdx !== -1) this.currentIdx = qIdx;
        const cIdx = this.contextQueue.findIndex((t) => t.id === found.id);
        if (cIdx !== -1) this.contextIdx = cIdx;
      }
    }
    if (this.isShuffle && this.shuffledIndices.length !== this.queue.length) {
      this.rebuildShuffle(true);
    } else if (!this.isShuffle) {
      this.shuffledIndices = [];
      this.shufflePos = 0;
    }
  }

  async queueSetContext(tracks: Track[], startIndex: number): Promise<QueueStateSnapshot> {
    this.contextQueue = [...tracks];
    this.queue = [...tracks];
    this.userQueue = [];
    this.history = [];
    if (this.queue.length === 0) {
      this.currentIdx = null;
      this.contextIdx = null;
      this.currentTrack = null;
      this.shuffledIndices = [];
      this.shufflePos = 0;
    } else {
      const validIndex = Math.min(Math.max(0, startIndex), this.queue.length - 1);
      this.currentIdx = validIndex;
      this.contextIdx = validIndex;
      this.currentTrack = this.queue[validIndex];
      if (this.isShuffle) {
        this.rebuildShuffle(true);
      }
      await this.playTrack(this.currentTrack);
    }
    return this.getQueueSnapshot();
  }

  async queueAddUser(tracks: Track[]): Promise<QueueStateSnapshot> {
    for (const track of tracks) {
      this.userQueue.push(track);
      this.queue.push(track);
      const newIndex = this.queue.length - 1;
      if (this.queue.length === 1) {
        this.currentIdx = 0;
        this.currentTrack = track;
        if (this.isShuffle) {
          this.shuffledIndices = [0];
          this.shufflePos = 0;
        }
      } else if (this.isShuffle) {
        if (this.shuffledIndices.length === 0) {
          this.rebuildShuffle(true);
        } else {
          this.shuffledIndices.push(newIndex);
        }
      }
    }
    return this.getQueueSnapshot();
  }

  async queuePlayNext(tracks: Track[]): Promise<QueueStateSnapshot> {
    for (const track of [...tracks].reverse()) {
      this.userQueue.unshift(track);
      if (this.queue.length === 0 || this.currentIdx === null) {
        this.queue.push(track);
        this.currentIdx = 0;
        this.currentTrack = track;
        if (this.isShuffle) {
          this.shuffledIndices = [0];
          this.shufflePos = 0;
        }
      } else {
        const insertAt = this.currentIdx + 1;
        if (insertAt >= this.queue.length) {
          this.queue.push(track);
        } else {
          this.queue.splice(insertAt, 0, track);
        }
        if (this.isShuffle) {
          if (this.shuffledIndices.length === 0) {
            this.rebuildShuffle(true);
          } else {
            for (let i = 0; i < this.shuffledIndices.length; i++) {
              if (this.shuffledIndices[i] >= insertAt) {
                this.shuffledIndices[i]++;
              }
            }
            const splicePos = Math.min(this.shufflePos + 1, this.shuffledIndices.length);
            this.shuffledIndices.splice(splicePos, 0, insertAt);
          }
        }
      }
    }
    return this.getQueueSnapshot();
  }

  async queueRemoveUserTrack(index: number): Promise<QueueStateSnapshot> {
    if (index >= 0 && index < this.userQueue.length) {
      const [removed] = this.userQueue.splice(index, 1);
      const startIdx = this.currentIdx !== null ? this.currentIdx + 1 : 0;
      const relPos = this.queue.slice(startIdx).findIndex((t) => t.id === removed.id);
      if (relPos !== -1) {
        this.queue.splice(startIdx + relPos, 1);
        if (this.isShuffle) {
          this.rebuildShuffle(true);
        }
      }
    }
    return this.getQueueSnapshot();
  }

  async queueReorderUser(from: number, to: number): Promise<QueueStateSnapshot> {
    if (from >= 0 && from < this.userQueue.length && to >= 0 && to < this.userQueue.length && from !== to) {
      const [track] = this.userQueue.splice(from, 1);
      this.userQueue.splice(to, 0, track);

      const startIdx = this.currentIdx !== null ? this.currentIdx + 1 : 0;
      const userIds = new Set(this.userQueue.map((t) => t.id));
      const userPositions: number[] = [];
      for (let i = startIdx; i < this.queue.length; i++) {
        if (userIds.has(this.queue[i].id)) {
          userPositions.push(i);
        }
      }
      if (userPositions.length === this.userQueue.length) {
        for (let i = 0; i < userPositions.length; i++) {
          this.queue[userPositions[i]] = this.userQueue[i];
        }
      }
    }
    return this.getQueueSnapshot();
  }

  async queueClearUser(): Promise<QueueStateSnapshot> {
    if (this.userQueue.length > 0) {
      const userIds = new Set(this.userQueue.map((t) => t.id));
      this.userQueue = [];
      if (this.currentIdx !== null) {
        let i = this.currentIdx + 1;
        while (i < this.queue.length) {
          if (userIds.has(this.queue[i].id)) {
            this.queue.splice(i, 1);
          } else {
            i++;
          }
        }
        if (this.isShuffle) {
          this.rebuildShuffle(true);
        }
      }
    }
    return this.getQueueSnapshot();
  }

  async queueNext(): Promise<QueueStateSnapshot> {
    if (this.queue.length === 0) {
      return this.getQueueSnapshot();
    }

    if (this.loopMode === "Track") {
      if (this.currentTrack) {
        await this.seek(0);
        await this.playTrack(this.currentTrack);
      }
      return this.getQueueSnapshot();
    }

    if (this.currentTrack) {
      this.history.push(this.currentTrack);
      if (this.history.length > 100) {
        this.history.shift();
      }
    }

    let nextIdx: number | null = null;
    let nextShufflePos: number | null = null;

    if (this.isShuffle) {
      if (this.shuffledIndices.length !== this.queue.length) {
        this.rebuildShuffle(true);
      }
      if (this.shufflePos + 1 < this.shuffledIndices.length) {
        nextShufflePos = this.shufflePos + 1;
        nextIdx = this.shuffledIndices[nextShufflePos];
      } else if (this.loopMode === "Queue") {
        this.rebuildShuffle(false);
        nextShufflePos = 0;
        nextIdx = this.shuffledIndices[0] ?? null;
      }
    } else if (this.currentIdx !== null) {
      if (this.currentIdx + 1 < this.queue.length) {
        nextIdx = this.currentIdx + 1;
      } else if (this.loopMode === "Queue") {
        nextIdx = 0;
      }
    } else {
      nextIdx = 0;
    }

    if (nextIdx !== null && nextIdx >= 0 && nextIdx < this.queue.length) {
      this.currentIdx = nextIdx;
      if (nextShufflePos !== null) {
        this.shufflePos = nextShufflePos;
      }
      const nextTrack = this.queue[nextIdx];
      this.currentTrack = nextTrack;

      const uPos = this.userQueue.findIndex((t) => t.id === nextTrack.id);
      if (uPos !== -1) {
        this.userQueue.splice(uPos, 1);
      } else {
        const cPos = this.contextQueue.findIndex((t) => t.id === nextTrack.id);
        if (cPos !== -1) {
          this.contextIdx = cPos;
        }
      }
      await this.playTrack(nextTrack);
      return this.getQueueSnapshot();
    } else if (this.isAutoplay) {
      const candidate = await this.getAutoplayNext();
      if (candidate) {
        this.contextQueue.push(candidate);
        this.queue.push(candidate);
        const newIdx = this.queue.length - 1;
        this.currentIdx = newIdx;
        this.contextIdx = this.contextQueue.length - 1;
        this.currentTrack = candidate;
        if (this.isShuffle) {
          this.shuffledIndices.push(newIdx);
          this.shufflePos = this.shuffledIndices.length - 1;
        }
        await this.playTrack(candidate);
        return this.getQueueSnapshot();
      } else if (this.contextQueue.length > 0) {
        this.currentIdx = 0;
        this.contextIdx = 0;
        this.currentTrack = this.queue[0];
        await this.playTrack(this.currentTrack);
        return this.getQueueSnapshot();
      } else {
        await this.stop();
        const snap = this.getQueueSnapshot();
        return { ...snap, currentTrack: null };
      }
    } else {
      await this.stop();
      const snap = this.getQueueSnapshot();
      return { ...snap, currentTrack: null };
    }
  }

  async queuePrevious(positionSecs: number = 0): Promise<QueueStateSnapshot> {
    if (this.queue.length === 0) {
      return this.getQueueSnapshot();
    }

    if (positionSecs > 3) {
      await this.seek(0);
      return this.getQueueSnapshot();
    }

    if (this.history.length > 0) {
      this.history.pop();
    }

    if (this.isShuffle) {
      if (this.shufflePos > 0) {
        this.shufflePos--;
        this.currentIdx = this.shuffledIndices[this.shufflePos];
      }
    } else if (this.currentIdx !== null) {
      if (this.currentIdx > 0) {
        this.currentIdx--;
      }
    } else {
      this.currentIdx = 0;
    }

    if (this.currentIdx !== null && this.currentIdx >= 0 && this.currentIdx < this.queue.length) {
      this.currentTrack = this.queue[this.currentIdx];
      const cPos = this.contextQueue.findIndex((t) => t.id === this.currentTrack?.id);
      if (cPos !== -1) {
        this.contextIdx = cPos;
      }
      await this.playTrack(this.currentTrack);
    }

    return this.getQueueSnapshot();
  }

  async queueJumpToIndex(index: number): Promise<QueueStateSnapshot> {
    if (index >= 0 && index < this.queue.length) {
      if (this.currentTrack) {
        this.history.push(this.currentTrack);
        if (this.history.length > 100) this.history.shift();
      }
      this.currentIdx = index;
      const track = this.queue[index];
      this.currentTrack = track;
      const uPos = this.userQueue.findIndex((t) => t.id === track.id);
      if (uPos !== -1) {
        this.userQueue.splice(uPos, 1);
      } else {
        const cPos = this.contextQueue.findIndex((t) => t.id === track.id);
        if (cPos !== -1) {
          this.contextIdx = cPos;
        }
      }
      if (this.isShuffle) {
        if (this.shuffledIndices.length !== this.queue.length) {
          this.rebuildShuffle(true);
        } else {
          const pos = this.shuffledIndices.indexOf(index);
          if (pos !== -1) {
            if (pos > this.shufflePos) {
              const [val] = this.shuffledIndices.splice(pos, 1);
              const targetPos = Math.min(this.shufflePos + 1, this.shuffledIndices.length);
              this.shuffledIndices.splice(targetPos, 0, val);
              this.shufflePos = targetPos;
            } else if (pos < this.shufflePos) {
              const [val] = this.shuffledIndices.splice(pos, 1);
              const targetPos = Math.min(this.shufflePos, this.shuffledIndices.length);
              this.shuffledIndices.splice(targetPos, 0, val);
              this.shufflePos = targetPos;
            }
          }
        }
      }
      await this.playTrack(track);
    }
    return this.getQueueSnapshot();
  }

  async queueJumpToContextTrack(contextIndex: number): Promise<QueueStateSnapshot> {
    if (contextIndex >= 0 && contextIndex < this.contextQueue.length) {
      const target = this.contextQueue[contextIndex];
      const qIdx = this.queue.findIndex((t) => t.id === target.id);
      if (qIdx !== -1) {
        return this.queueJumpToIndex(qIdx);
      }
    }
    return this.getQueueSnapshot();
  }

  async queueJumpToUserTrack(userIndex: number): Promise<QueueStateSnapshot> {
    if (userIndex >= 0 && userIndex < this.userQueue.length) {
      const target = this.userQueue[userIndex];
      const qIdx = this.queue.findIndex((t) => t.id === target.id);
      if (qIdx !== -1) {
        return this.queueJumpToIndex(qIdx);
      }
    }
    return this.getQueueSnapshot();
  }

  async queueSetShuffle(enabled: boolean): Promise<QueueStateSnapshot> {
    this.isShuffle = enabled;
    if (enabled) {
      this.rebuildShuffle(true);
    } else {
      this.shuffledIndices = [];
      this.shufflePos = 0;
    }
    return this.getQueueSnapshot();
  }

  async queueSetLoopMode(mode: LoopMode | string): Promise<QueueStateSnapshot> {
    const normMode: LoopMode = mode === "Track" || mode === "track" ? "Track" : mode === "Queue" || mode === "queue" ? "Queue" : "Off";
    this.loopMode = normMode;
    this.elements.forEach((el) => {
      el.loop = normMode === "Track";
    });
    return this.getQueueSnapshot();
  }

  async queueSetAutoplay(enabled: boolean): Promise<QueueStateSnapshot> {
    this.isAutoplay = enabled;
    return this.getQueueSnapshot();
  }

  async queueClear(): Promise<QueueStateSnapshot> {
    this.queue = [];
    this.currentIdx = null;
    this.contextQueue = [];
    this.contextIdx = null;
    this.userQueue = [];
    this.currentTrack = null;
    this.shuffledIndices = [];
    this.shufflePos = 0;
    await this.stop();
    return this.getQueueSnapshot();
  }

  async queueGetState(): Promise<QueueStateSnapshot> {
    return this.getQueueSnapshot();
  }

  async getAutoplayNext(candidatePool?: Track[]): Promise<Track | null> {
    let pool = candidatePool;
    if (!pool || pool.length === 0) {
      if (typeof globalThis !== "undefined") {
        const fn = (globalThis as unknown as { __waveryLibraryTracksGetter?: () => Track[] }).__waveryLibraryTracksGetter;
        if (fn) {
          try {
            pool = fn() || [];
          } catch {
            pool = [];
          }
        }
      }
    }
    if (!pool || pool.length === 0) {
      try {
        pool = await this.getTracks();
      } catch {
        pool = [];
      }
    }
    if (!pool || pool.length === 0) {
      return null;
    }

    const queuedIds = new Set(this.queue.map((t) => t.id));
    const historyIds = new Set(this.history.map((t) => t.id));

    let unqueued = pool.filter((t) => !queuedIds.has(t.id));
    if (unqueued.length === 0) {
      unqueued = pool.filter((t) => t.id !== this.currentTrack?.id);
    }
    if (unqueued.length === 0) {
      unqueued = [...pool];
    }
    if (unqueued.length === 0) {
      return null;
    }

    if (this.currentTrack) {
      const artist = this.currentTrack.metadata?.artist?.trim().toLowerCase();
      const album = this.currentTrack.metadata?.album?.trim().toLowerCase();
      const genre = this.currentTrack.metadata?.genre?.trim().toLowerCase();

      const scored = unqueued.map((t) => {
        let score = 0;
        const tArtist = t.metadata?.artist?.trim().toLowerCase();
        const tAlbum = t.metadata?.album?.trim().toLowerCase();
        const tGenre = t.metadata?.genre?.trim().toLowerCase();

        if (artist && artist !== "unknown artist" && tArtist === artist) score += 50;
        if (album && album !== "unknown album" && tAlbum === album) score += 30;
        if (genre && genre !== "unknown genre" && tGenre === genre) score += 20;
        if (historyIds.has(t.id)) score -= 100;

        return { track: t, score };
      });

      scored.sort((a, b) => b.score - a.score);
      if (scored.length > 0 && scored[0].score > 0) {
        const topScore = scored[0].score;
        const topCandidates = scored.filter((s) => s.score === topScore);
        return topCandidates[Math.floor(Math.random() * topCandidates.length)].track;
      }
    }

    const unplayed = unqueued.filter((t) => !historyIds.has(t.id));
    const finalPool = unplayed.length > 0 ? unplayed : unqueued;
    return finalPool[Math.floor(Math.random() * finalPool.length)] ?? null;
  }

  // Library Aggregation Fallbacks
  async getAlbums(): Promise<AlbumInfo[]> {
    const tracks = await this.getTracks();
    return groupTracksByAlbum(tracks);
  }

  async getArtists(): Promise<ArtistInfo[]> {
    const tracks = await this.getTracks();
    return groupTracksByArtist(tracks);
  }

  async getGenres(): Promise<GenreInfo[]> {
    const tracks = await this.getTracks();
    const raw = extractLibraryGenres(tracks);
    return raw.map((g) => ({
      name: g.name,
      tracks: g.tracks,
      trackCount: g.tracks.length,
    }));
  }

  async getAlbumDetails(title: string, artist?: string): Promise<AlbumInfo | null> {
    const albums = await this.getAlbums();
    const titleLower = title.trim().toLowerCase();
    const artistLower = artist?.trim().toLowerCase();
    return (
      albums.find((a) => {
        if (a.title.toLowerCase() !== titleLower) return false;
        if (artistLower && a.artist.toLowerCase() !== artistLower) return false;
        return true;
      }) ?? null
    );
  }

  async getArtistDetails(name: string): Promise<ArtistInfo | null> {
    const artists = await this.getArtists();
    const nameLower = name.trim().toLowerCase();
    return artists.find((a) => a.name.toLowerCase() === nameLower) ?? null;
  }

  async getConfig(): Promise<unknown> {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to fetch config");
    return res.json();
  }

  async getServerStatus(): Promise<ServerStatus> {
    try {
      const res = await fetch("/api/server/status");
      if (res.ok) {
        return (await res.json()) as ServerStatus;
      }
    } catch {
      // Fallback if endpoint is unreachable
    }
    return {
      host: "127.0.0.1",
      port: 4242,
      is_lan_enabled: false,
      local_ip: null,
      lan_url: null,
    };
  }

  async setServerLanMode(enabled: boolean): Promise<ServerStatus> {
    try {
      const currentCfg = (await this.getConfig().catch(() => null)) as Record<string, unknown> | null;
      const serverCfg =
        currentCfg && typeof currentCfg.server === "object" && currentCfg.server !== null
          ? (currentCfg.server as Record<string, unknown>)
          : {};
      const nextCfg = {
        ...(currentCfg || {}),
        server: {
          ...serverCfg,
          host: enabled ? "0.0.0.0" : "127.0.0.1",
          port: typeof serverCfg.port === "number" ? serverCfg.port : 4242,
          enable_browser_client:
            typeof serverCfg.enable_browser_client === "boolean"
              ? serverCfg.enable_browser_client
              : true,
        },
      };
      await this.saveConfig(nextCfg);
    } catch {
      // Fallback if config endpoint fails
    }
    return this.getServerStatus();
  }

  async getWaveform(trackId: string): Promise<WaveformData | null> {
    if (!trackId) return null;
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/waveform`);
      if (!res.ok) return null;
      const data = (await res.json()) as WaveformData;
      if (!data || !Array.isArray(data.points)) return null;
      return data;
    } catch {
      return null;
    }
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


let tauriInvokeFn: (<T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;
async function getTauriInvoke(): Promise<<T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>> {
  if (!tauriInvokeFn) {
    const { invoke } = await import("@tauri-apps/api/core");
    tauriInvokeFn = invoke;
  }
  return tauriInvokeFn;
}

class TauriAudioPlayer implements AudioPlayerAdapter {
  isTauri(): boolean {
    return (
      typeof window !== "undefined" &&
      (Boolean((window as unknown as { isTauri?: boolean }).isTauri) ||
        "__TAURI_INTERNALS__" in window)
    );
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

  private artworkCache: Map<string, string | null> = new Map();
  private pendingArtwork: Map<string, Promise<string | null>> = new Map();

  async getArtwork(trackId: string): Promise<string | null> {
    if (!trackId) return null;
    if (this.artworkCache.has(trackId)) {
      return this.artworkCache.get(trackId) ?? null;
    }
    if (this.pendingArtwork.has(trackId)) {
      return this.pendingArtwork.get(trackId)!;
    }
    const fetchPromise = (async () => {
      try {
        const invoke = await getTauriInvoke();
        const base64Url = await invoke<string | null>("get_artwork", { trackId });
        this.artworkCache.set(trackId, base64Url ?? null);
        return base64Url ?? null;
      } catch (err) {
        console.error("Failed to fetch artwork from Tauri backend:", err);
        this.artworkCache.set(trackId, null);
        return null;
      } finally {
        this.pendingArtwork.delete(trackId);
      }
    })();
    this.pendingArtwork.set(trackId, fetchPromise);
    return fetchPromise;
  }

  getArtworkUrl(trackId: string): string {
    if (!trackId) return "";
    const cached = this.artworkCache.get(trackId);
    if (cached) return cached;
    // Trigger background fetch so future renders can immediately use cached data
    void this.getArtwork(trackId);
    return "";
  }

  async getTracks(): Promise<Track[]> {
    const invoke = await getTauriInvoke();
    return invoke<Track[]>("get_tracks");
  }

  async pickFile(): Promise<string | null> {
    const invoke = await getTauriInvoke();
    return invoke<string | null>("pick_file");
  }

  async pickFolder(): Promise<string | null> {
    const invoke = await getTauriInvoke();
    return invoke<string | null>("pick_folder");
  }

  async pickPlaylistFile(): Promise<string | null> {
    const invoke = await getTauriInvoke();
    return invoke<string | null>("pick_playlist_file");
  }

  async importFile(sourcePath: string, strategy: ImportStrategy): Promise<Track> {
    const invoke = await getTauriInvoke();
    return invoke<Track>("import_file", { sourcePath, strategy });
  }

  async importFolder(dirPath: string, strategy: ImportStrategy): Promise<Track[]> {
    const invoke = await getTauriInvoke();
    return invoke<Track[]>("import_folder", { dirPath, strategy });
  }

  async importPlaylistFile(filePath: string): Promise<PlaylistImportSummary> {
    const invoke = await getTauriInvoke();
    return invoke<PlaylistImportSummary>("import_playlist_file", {
      filePath,
      jsonPath: filePath,
    });
  }

  async playTrack(track: Track): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("play_track", { trackId: track.id });
  }

  async pause(): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("pause_playback");
  }

  async resume(): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("resume_playback");
  }

  async stop(): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("stop_playback");
  }

  async seek(seconds: number): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("seek_playback", { positionSecs: seconds });
  }

  async setVolume(volume: number): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("set_volume", { volume });
  }

  async getStatus(): Promise<PlayerStatus> {
    const invoke = await getTauriInvoke();
    return invoke<PlayerStatus>("get_status");
  }

  async search(query: string): Promise<Track[]> {
    const invoke = await getTauriInvoke();
    return invoke<Track[]>("search_tracks", { query });
  }

  async updateTrackMetadata(payload: UpdateTrackMetadataPayload): Promise<Track> {
    const invoke = await getTauriInvoke();
    return invoke<Track>("update_track_metadata", { req: payload });
  }

  async updateArtistMetadata(payload: UpdateArtistMetadataPayload): Promise<Track[]> {
    const invoke = await getTauriInvoke();
    return invoke<Track[]>("update_artist_metadata", { req: payload });
  }

  async updateAlbumMetadata(payload: UpdateAlbumMetadataPayload): Promise<Track[]> {
    const invoke = await getTauriInvoke();
    return invoke<Track[]>("update_album_metadata", { req: payload });
  }

  async rebuildLibrary(): Promise<Track[]> {
    const invoke = await getTauriInvoke();
    return invoke<Track[]>("rebuild_library");
  }

  async vacuumDatabase(): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("vacuum_library");
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    const invoke = await getTauriInvoke();
    return invoke<DatabaseStats>("get_database_stats");
  }

  async checkDatabaseHealth(): Promise<DatabaseHealth> {
    const invoke = await getTauriInvoke();
    return invoke<DatabaseHealth>("check_database_health");
  }

  async pruneMissingTracks(): Promise<number> {
    const invoke = await getTauriInvoke();
    return invoke<number>("prune_missing_tracks");
  }

  async backupDatabase(): Promise<DatabaseBackup | null> {
    const invoke = await getTauriInvoke();
    return invoke<DatabaseBackup | null>("backup_database");
  }

  async revealDatabaseLocation(location: DatabaseLocation): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("reveal_database_location", { location });
  }

  async clearArtworkCache(): Promise<void> {
    this.artworkCache.clear();
    const invoke = await getTauriInvoke();
    return invoke("clear_artwork_cache");
  }

  async switchToWeb(): Promise<void> {
    this.pause();
    const invoke = await getTauriInvoke();
    return invoke("switch_to_web");
  }

  async switchToNative(): Promise<void> {
    return Promise.resolve();
  }

  async getLikedTracks(): Promise<Track[]> {
    const invoke = await getTauriInvoke();
    return invoke<Track[]>("get_liked_tracks");
  }

  async getLikedTrackIds(): Promise<string[]> {
    const invoke = await getTauriInvoke();
    return invoke<string[]>("get_liked_track_ids");
  }

  async toggleLike(trackId: string): Promise<boolean> {
    const invoke = await getTauriInvoke();
    return invoke<boolean>("toggle_like", { trackId });
  }

  async likeTrack(trackId: string): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("like_track", { trackId });
  }

  async unlikeTrack(trackId: string): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("unlike_track", { trackId });
  }

  async listPlaylists(): Promise<Playlist[]> {
    const invoke = await getTauriInvoke();
    return invoke<Playlist[]>("list_playlists");
  }

  async createPlaylist(name: string): Promise<Playlist> {
    const invoke = await getTauriInvoke();
    return invoke<Playlist>("create_playlist", { name });
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const invoke = await getTauriInvoke();
    return invoke<Playlist | null>("get_playlist", { id });
  }

  async getPlaylistTracks(id: string): Promise<Track[]> {
    const invoke = await getTauriInvoke();
    return invoke<Track[]>("get_playlist_tracks", { id });
  }

  async renamePlaylist(id: string, name: string): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("rename_playlist", { id, name });
  }

  async deletePlaylist(id: string): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("delete_playlist", { id });
  }

  async deleteTrack(id: string, removeFile = false): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("delete_track", { trackId: id, removeFile: Boolean(removeFile) });
  }

  async addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("add_tracks_to_playlist", { playlistId, trackIds });
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("remove_track_from_playlist", { playlistId, trackId });
  }

  async savePlaylist(playlist: Playlist): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("save_playlist", { playlist });
  }

  async saveConfig(config: unknown): Promise<void> {
    const invoke = await getTauriInvoke();
    return invoke("save_config", { config });
  }

  async syncQueue(payload: {
    user_queue: Track[];
    context_queue: Track[];
    current_track_id?: string;
    is_shuffle: boolean;
    loop_mode: string;
  }): Promise<void> {
    try {
      const invoke = await getTauriInvoke();
      await invoke("sync_queue", { payload });
    } catch (e) {
      console.warn("Failed to sync queue with Tauri backend:", e);
    }
  }

  async getConfig(): Promise<unknown> {
    const invoke = await getTauriInvoke();
    return invoke("get_config");
  }

  async getServerStatus(): Promise<ServerStatus> {
    try {
      const invoke = await getTauriInvoke();
      return await invoke<ServerStatus>("get_server_status");
    } catch {
      // Fallback
    }
    return {
      host: "127.0.0.1",
      port: 4242,
      is_lan_enabled: false,
      local_ip: null,
      lan_url: null,
    };
  }

  async setServerLanMode(enabled: boolean): Promise<ServerStatus> {
    try {
      const invoke = await getTauriInvoke();
      return await invoke<ServerStatus>("set_server_lan_mode", { enabled });
    } catch {
      return this.getServerStatus();
    }
  }

  async getWaveform(trackId: string): Promise<WaveformData | null> {
    if (!trackId) return null;
    try {
      const invoke = await getTauriInvoke();
      return await invoke<WaveformData | null>("get_waveform", { trackId });
    } catch {
      return null;
    }
  }

  async exportConfigJson(): Promise<string> {
    const invoke = await getTauriInvoke();
    return invoke<string>("export_config_json");
  }

  async importConfigJson(jsonStr: string): Promise<unknown> {
    const invoke = await getTauriInvoke();
    return invoke("import_config_json", { jsonStr });
  }

  // Queue Authority Methods (Milestone M4)
  async queueSetContext(tracks: Track[], startIndex: number): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_set_context", { tracks, startIndex });
  }

  async queueAddUser(tracks: Track[]): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_add_user", { tracks });
  }

  async queuePlayNext(tracks: Track[]): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_play_next", { tracks });
  }

  async queueRemoveUserTrack(index: number): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_remove_user_track", { index });
  }

  async queueReorderUser(from: number, to: number): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_reorder_user", { from, to });
  }

  async queueClearUser(): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_clear_user");
  }

  async queueNext(): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_next");
  }

  async queuePrevious(positionSecs: number = 0): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_previous", { positionSecs });
  }

  async queueJumpToIndex(index: number): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_jump_to_index", { index });
  }

  async queueJumpToContextTrack(contextIndex: number): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_jump_to_context_track", { contextIndex });
  }

  async queueJumpToUserTrack(userIndex: number): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_jump_to_user_track", { userIndex });
  }

  async queueSetShuffle(enabled: boolean): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_set_shuffle", { enabled });
  }

  async queueSetLoopMode(mode: LoopMode | string): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_set_loop_mode", { mode: String(mode) });
  }

  async queueSetAutoplay(enabled: boolean): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_set_autoplay", { enabled });
  }

  async queueClear(): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_clear");
  }

  async queueGetState(): Promise<QueueStateSnapshot> {
    const invoke = await getTauriInvoke();
    return invoke<QueueStateSnapshot>("queue_get_state");
  }

  async getAutoplayNext(candidatePool?: Track[]): Promise<Track | null> {
    const invoke = await getTauriInvoke();
    return invoke<Track | null>("get_autoplay_next", { candidatePool });
  }

  // Library Aggregation Methods (Milestone M4)
  async getAlbums(): Promise<AlbumInfo[]> {
    const invoke = await getTauriInvoke();
    return invoke<AlbumInfo[]>("get_albums");
  }

  async getArtists(): Promise<ArtistInfo[]> {
    const invoke = await getTauriInvoke();
    return invoke<ArtistInfo[]>("get_artists");
  }

  async getGenres(): Promise<GenreInfo[]> {
    const invoke = await getTauriInvoke();
    return invoke<GenreInfo[]>("get_genres");
  }

  async getAlbumDetails(title: string, artist?: string): Promise<AlbumInfo | null> {
    const invoke = await getTauriInvoke();
    return invoke<AlbumInfo | null>("get_album_details", { title, artist });
  }

  async getArtistDetails(name: string): Promise<ArtistInfo | null> {
    const invoke = await getTauriInvoke();
    return invoke<ArtistInfo | null>("get_artist_details", { name });
  }
}


export const isTauri: boolean =
  typeof window !== "undefined" &&
  (Boolean((window as unknown as { isTauri?: boolean }).isTauri) ||
    "__TAURI_INTERNALS__" in window);

export const playerAdapter: AudioPlayerAdapter =
  isTauri
    ? new TauriAudioPlayer()
    : new BrowserAudioPlayer();

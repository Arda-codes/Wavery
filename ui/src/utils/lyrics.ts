export interface LyricLine {
  /** Time in seconds when this line is sung, or -1 if the lyrics are unsynced plain text. */
  time: number;
  text: string;
}

/**
 * Checks whether a raw lyrics string contains LRC timestamp markers (e.g. `[01:23.45]`).
 */
export function hasLrcTimestamps(raw?: string | null): boolean {
  if (!raw || !raw.trim()) return false;
  return /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(raw);
}

/**
 * Parses raw LRC string into structured lines.
 * If the string contains LRC timestamps, lines are parsed with their exact time offsets and sorted.
 * If the string is plain text, lines have `time: -1` and are preserved in natural order without fake timestamps.
 */
export function parseLrc(raw: string): LyricLine[] {
  if (!raw || !raw.trim()) return [];

  const isSynced = hasLrcTimestamps(raw);
  const lines = raw.split(/\r?\n/);
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip metadata tags like [ar: Artist], [ti: Title], etc.
    if (/^\[[a-zA-Z]+:/.test(trimmed)) continue;

    if (isSynced) {
      const matches = Array.from(trimmed.matchAll(timeRegex));
      if (matches.length > 0) {
        const text = trimmed.replace(timeRegex, "").trim();
        for (const match of matches) {
          const mins = parseInt(match[1], 10);
          const secs = parseInt(match[2], 10);
          const msStr = match[3] || "0";
          const ms = parseInt(msStr.padEnd(3, "0").slice(0, 3), 10);
          const totalSeconds = mins * 60 + secs + ms / 1000;
          result.push({ time: totalSeconds, text });
        }
      }
    } else {
      // Plain text line without timestamps: time is -1 so the UI treats it as static plain lyrics
      result.push({ time: -1, text: trimmed });
    }
  }

  return isSynced ? result.sort((a, b) => a.time - b.time) : result;
}

/**
 * Binary search to find currently active lyric line index.
 * Returns -1 if the lyrics are unsynced plain text or before playback starts.
 */
export function getActiveLyricIndex(lines: LyricLine[], positionSecs: number): number {
  if (lines.length === 0) return -1;
  // If lyrics are unsynced (time is -1), do not highlight any active line
  if (lines[0].time < 0) return -1;
  if (positionSecs < lines[0].time) return -1;

  let low = 0;
  let high = lines.length - 1;
  let activeIndex = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= positionSecs) {
      activeIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return activeIndex;
}

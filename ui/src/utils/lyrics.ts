interface LyricLine {
  time: number;
  text: string;
}

/**
 * Parses raw LRC string into structured time-synchronized lines.
 */
export function parseLrc(raw: string): LyricLine[] {
  if (!raw || !raw.trim()) return [];

  const lines = raw.split(/\r?\n/);
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for metadata tags like [ar: Artist], [ti: Title], etc.
    if (/^\[[a-zA-Z]+:/.test(trimmed)) continue;

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
    } else if (trimmed) {
      // Plain text line without timestamp
      result.push({ time: result.length * 4, text: trimmed });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Binary search to find currently active lyric line index.
 */
export function getActiveLyricIndex(lines: LyricLine[], positionSecs: number): number {
  if (lines.length === 0) return -1;
  if (positionSecs < lines[0].time) return 0;

  let low = 0;
  let high = lines.length - 1;
  let activeIndex = 0;

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

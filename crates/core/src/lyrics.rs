//! LRC lyrics parsing, candidate scoring, and active line binary search.
//!
//! Conforms strictly to zero driver dependencies in `crates/core`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single line of lyrics, either synchronized with a timestamp or unsynchronized.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    /// Time in seconds when this line is sung, or -1.0 if the line is unsynchronized plain text.
    pub time: f64,
    /// Lyric text payload.
    pub text: String,
}

/// Metadata extracted from standard LRC header tags.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LrcMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub author: Option<String>,
    pub creator: Option<String>,
    pub length: Option<String>,
    /// Global millisecond offset specified via `[offset:+/-ms]`.
    pub offset_ms: Option<i64>,
    /// Additional custom or unrecognized tags.
    #[serde(default)]
    pub additional: HashMap<String, String>,
}

/// Fully parsed LRC structure containing lines and metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLyrics {
    /// True if the lyrics contained at least one valid LRC timestamp tag.
    pub is_synced: bool,
    /// All lyric lines in chronological order (or original order if unsynced).
    pub lines: Vec<LyricLine>,
    /// Extracted LRC header metadata.
    pub metadata: LrcMetadata,
    /// Applied global millisecond offset.
    pub offset_ms: i64,
}

/// Target track information for scoring lyrics candidates.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricTargetInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_secs: Option<f64>,
}

/// A candidate lyric response (e.g. from LRCLIB `/api/search` or `/api/get`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricCandidate {
    pub id: Option<u64>,
    #[serde(alias = "track_name", alias = "name")]
    pub track_name: Option<String>,
    #[serde(alias = "artist_name")]
    pub artist_name: Option<String>,
    #[serde(alias = "album_name")]
    pub album_name: Option<String>,
    pub duration: Option<f64>,
    pub instrumental: Option<bool>,
    #[serde(alias = "synced_lyrics")]
    pub synced_lyrics: Option<String>,
    #[serde(alias = "plain_lyrics")]
    pub plain_lyrics: Option<String>,
}

/// Scored candidate with calculated ranking and best lyrics selection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredLyricCandidate {
    pub candidate: LyricCandidate,
    pub score: i32,
    pub is_synced: bool,
    pub is_instrumental: bool,
    pub best_lyrics: Option<String>,
}

/// Attempts to parse an inner bracket substring into seconds.
///
/// Supports `mm:ss`, `mm:ss.xx`, `mm:ss.xxx`, `mm:ss,xx`, variable minute lengths (`120:05.00`),
/// and returns `None` for metadata tags or non-timestamp text.
#[must_use]
pub fn parse_timestamp(inner: &str) -> Option<f64> {
    let trimmed = inner.trim();
    if trimmed.len() > 30 || trimmed.contains('[') {
        return None;
    }

    let (min_str, sec_str) = trimmed.split_once(':')?;
    let min_str = min_str.trim();
    if min_str.is_empty() || !min_str.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mins: f64 = min_str.parse().ok()?;

    let sec_str = sec_str.trim();
    if let Some((sec_whole, frac_str)) = sec_str.split_once(['.', ',']) {
        let sec_whole = sec_whole.trim();
        let frac_str = frac_str.trim();
        if sec_whole.is_empty() || !sec_whole.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        if !frac_str.is_empty() && !frac_str.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let secs: f64 = sec_whole.parse().ok()?;
        let frac: f64 = if frac_str.is_empty() {
            0.0
        } else {
            let val: f64 = frac_str.parse().ok()?;
            let divisor = 10f64.powi(frac_str.len() as i32);
            val / divisor
        };
        Some(mins * 60.0 + secs + frac)
    } else {
        if sec_str.is_empty() || !sec_str.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let secs: f64 = sec_str.parse().ok()?;
        Some(mins * 60.0 + secs)
    }
}

/// Checks whether a raw lyrics string contains bracketed LRC timestamps like `[01:23.45]`.
#[must_use]
pub fn has_lrc_timestamps(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            let start = i;
            let mut j = i + 1;
            while j < bytes.len() && j - start <= 30 {
                if bytes[j] == b'[' {
                    break;
                }
                if bytes[j] == b']' {
                    if let Some(inner) = raw.get(start + 1..j) {
                        if parse_timestamp(inner).is_some() {
                            return true;
                        }
                    }
                    break;
                }
                j += 1;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    false
}

/// Attempts to parse an LRC metadata tag line like `[ar: Radiohead]`.
fn parse_metadata_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return None;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    let (tag, val) = inner.split_once(':')?;
    let tag = tag.trim();
    if tag.is_empty() || !tag.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some((tag.to_lowercase(), val.trim().to_string()))
}

/// Scans a single line, extracting all valid timestamp markers and returning the remaining text payload.
fn extract_line_timestamps_and_text(line: &str) -> (Vec<f64>, String) {
    let mut timestamps = Vec::new();
    let mut text = String::with_capacity(line.len());
    let mut i = 0;
    let bytes = line.as_bytes();

    while i < bytes.len() {
        if bytes[i] == b'[' {
            let start = i;
            let mut end = None;
            let mut j = i + 1;
            while j < bytes.len() {
                if bytes[j] == b'[' {
                    break;
                }
                if bytes[j] == b']' {
                    end = Some(j);
                    break;
                }
                j += 1;
            }

            if let Some(end_idx) = end {
                if let Some(inner) = line.get(start + 1..end_idx) {
                    if let Some(ts) = parse_timestamp(inner) {
                        timestamps.push(ts);
                        i = end_idx + 1;
                        continue;
                    }
                }
                if let Some(slice) = line.get(start..=end_idx) {
                    text.push_str(slice);
                }
                i = end_idx + 1;
            } else {
                if let Some(slice) = line.get(start..j) {
                    text.push_str(slice);
                }
                i = j;
            }
        } else if let Some(ch) = line[i..].chars().next() {
            text.push(ch);
            i += ch.len_utf8();
        } else {
            break;
        }
    }

    (timestamps, text.trim().to_string())
}

/// Parses raw LRC lyrics string into structured parsed lines and metadata.
///
/// Features:
/// - Robust zero-regex timestamp parser supporting variable precision and European comma separators.
/// - Unfolds multi-timestamp lines (e.g. `[00:10.00][00:20.00] Chorus`) into separate sorted lines.
/// - Extracts metadata tags (`[ti:...]`, `[ar:...]`, `[al:...]`, `[offset:+/-ms]`).
/// - Applies global millisecond offsets with `0.0` second lower bound clamping.
/// - Preserves natural order for unsynced plain lyrics with `time = -1.0`.
#[must_use]
pub fn parse_lrc(raw: &str) -> ParsedLyrics {
    let mut metadata = LrcMetadata::default();
    let mut offset_ms: i64 = 0;
    let is_synced = has_lrc_timestamps(raw);

    // First pass: extract all metadata tags and determine global offset
    for line in raw.lines() {
        if let Some((tag, val)) = parse_metadata_line(line) {
            match tag.as_str() {
                "offset" => {
                    if let Ok(parsed_offset) = val.parse::<i64>() {
                        offset_ms = parsed_offset;
                        metadata.offset_ms = Some(parsed_offset);
                    }
                }
                "ti" => metadata.title = Some(val),
                "ar" => metadata.artist = Some(val),
                "al" => metadata.album = Some(val),
                "au" => metadata.author = Some(val),
                "by" => metadata.creator = Some(val),
                "length" => metadata.length = Some(val),
                _ => {
                    metadata.additional.insert(tag, val);
                }
            }
        }
    }

    let mut lines = Vec::new();

    if is_synced {
        for line in raw.lines() {
            if parse_metadata_line(line).is_some() {
                continue;
            }
            let (timestamps, text) = extract_line_timestamps_and_text(line);
            if !timestamps.is_empty() {
                for ts in timestamps {
                    let adjusted = (ts + (offset_ms as f64 / 1000.0)).max(0.0);
                    lines.push(LyricLine {
                        time: adjusted,
                        text: text.clone(),
                    });
                }
            }
        }
        lines.sort_by(|a, b| a.time.total_cmp(&b.time));
    } else {
        for line in raw.lines() {
            if parse_metadata_line(line).is_some() {
                continue;
            }
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                lines.push(LyricLine {
                    time: -1.0,
                    text: trimmed.to_string(),
                });
            }
        }
    }

    ParsedLyrics {
        is_synced,
        lines,
        metadata,
        offset_ms,
    }
}

/// Binary search finding the currently active lyric line index for the given playback position.
///
/// Returns `None` if lyrics are unsynced plain text, empty, or if playback position is before the first timestamped line.
/// Guarantees zero integer underflow when `mid == 0`.
#[must_use]
pub fn get_active_lyric_index(lines: &[LyricLine], position_secs: f64) -> Option<usize> {
    if lines.is_empty() {
        return None;
    }
    // If the first line is unsynced (time < 0), lyrics are plain text
    if lines[0].time < 0.0 {
        return None;
    }
    // If playback has not reached the first lyric line
    if position_secs < lines[0].time {
        return None;
    }

    let mut low: usize = 0;
    let mut high: usize = lines.len() - 1;
    let mut active_index: Option<usize> = None;

    while low <= high {
        let mid = low + (high - low) / 2;
        if lines[mid].time <= position_secs {
            active_index = Some(mid);
            low = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            high = mid - 1;
        }
    }

    active_index
}

/// Strips outer enclosing parentheses or square brackets if the entire title is enclosed.
///
/// Example: `"(Nice Dream)"` -> `"Nice Dream"`.
#[must_use]
pub fn strip_enclosing_parentheses(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('(') && trimmed.ends_with(')'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']')))
    {
        return trimmed[1..trimmed.len() - 1].trim().to_string();
    }
    trimmed.to_string()
}

/// Extracts primary artist name by splitting on delimiter punctuation and collaboration tags.
#[must_use]
pub fn extract_clean_artist(artist: &str) -> String {
    let trimmed = artist.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Preserve atomic protected artists
    for protected in crate::heuristics::DEFAULT_PROTECTED_ARTISTS {
        if trimmed.eq_ignore_ascii_case(protected) {
            return trimmed.to_string();
        }
    }

    let first_segment = trimmed
        .split([',', ';', '/', '&'])
        .next()
        .unwrap_or(trimmed);

    let lower = first_segment.to_lowercase();
    let mut split_pos = None;
    for pattern in &[" feat. ", " ft. ", " feat ", " ft "] {
        if let Some(pos) = lower.find(pattern) {
            split_pos = match split_pos {
                Some(p) => Some(std::cmp::min(p, pos)),
                None => Some(pos),
            };
        }
    }

    if let Some(pos) = split_pos {
        first_segment[..pos].trim().to_string()
    } else {
        first_segment.trim().to_string()
    }
}

/// Normalizes query string for metadata matching by stripping track numbers and edition tags.
#[must_use]
pub fn normalize_query(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // 1. Strip leading track numbers: 1 to 3 digits followed by space, '.', '-', '_'
    let bytes = trimmed.as_bytes();
    let mut digit_count = 0;
    while digit_count < bytes.len() && digit_count < 3 && bytes[digit_count].is_ascii_digit() {
        digit_count += 1;
    }

    let mut start_idx = 0;
    if digit_count > 0 && digit_count < bytes.len() {
        let mut sep_idx = digit_count;
        while sep_idx < bytes.len()
            && (bytes[sep_idx] == b' '
                || bytes[sep_idx] == b'.'
                || bytes[sep_idx] == b'-'
                || bytes[sep_idx] == b'_')
        {
            sep_idx += 1;
        }
        if sep_idx > digit_count {
            start_idx = sep_idx;
        }
    }

    let remaining = &trimmed[start_idx..];

    // 2. Remove edition parentheticals and square brackets
    let edition_keywords = [
        "remaster",
        "live",
        "version",
        "edit",
        "deluxe",
        "mix",
        "anniversary",
        "re-recorded",
        "bonus",
        "feat.",
        "ft.",
    ];

    let mut result = String::with_capacity(remaining.len());
    let mut chars = remaining.char_indices().peekable();

    while let Some((idx, ch)) = chars.next() {
        if ch == '(' || ch == '[' {
            let close_char = if ch == '(' { ')' } else { ']' };
            let mut close_idx = None;
            for (c_idx, c) in chars.by_ref() {
                if c == close_char {
                    close_idx = Some(c_idx);
                    break;
                }
            }

            if let Some(end_idx) = close_idx {
                let inner = &remaining[idx + 1..end_idx];
                let inner_lower = inner.to_lowercase();
                let is_edition =
                    ch == '[' || edition_keywords.iter().any(|kw| inner_lower.contains(kw));
                if !is_edition {
                    result.push_str(&remaining[idx..=end_idx]);
                }
            } else {
                result.push_str(&remaining[idx..]);
                break;
            }
        } else {
            result.push(ch);
        }
    }

    // 3. Collapse multiple whitespace characters into single space
    let mut collapsed = String::with_capacity(result.len());
    let mut prev_space = false;
    for c in result.chars() {
        if c.is_whitespace() {
            if !prev_space {
                collapsed.push(' ');
                prev_space = true;
            }
        } else {
            collapsed.push(c);
            prev_space = false;
        }
    }

    collapsed.trim().to_string()
}

/// Scores a single candidate lyric item against target track metadata.
///
/// Weighting criteria:
/// - Synced lyrics bonus: +1000 for synced, +800 for instrumental, +100 for plain.
/// - Duration proximity within ±4s: +300 for diff <= 2s, +150 for diff <= 4s, progressive penalty for diff > 8s.
/// - Title match: +200 for clean title match, +100 for substring match.
/// - Artist match: +150 for clean artist match, +75 for substring match.
/// - Album match: +100 for album match, +50 for substring match.
#[must_use]
pub fn score_single_candidate(candidate: &LyricCandidate, target: &LyricTargetInfo) -> i32 {
    let mut score = 0;

    // 1. Synced lyrics preference bonus
    if let Some(synced) = &candidate.synced_lyrics {
        if !synced.trim().is_empty() {
            score += 1000;
        }
    } else if candidate.instrumental == Some(true) {
        score += 800;
    } else if let Some(plain) = &candidate.plain_lyrics {
        if !plain.trim().is_empty() {
            score += 100;
        }
    }

    // 2. Duration proximity within ±4s (+300 for diff <= 2s, +150 for diff <= 4s, progressive penalty for large duration mismatches >8s)
    if let (Some(target_dur), Some(cand_dur)) = (target.duration_secs, candidate.duration) {
        if target_dur > 0.0 && cand_dur > 0.0 {
            let diff = (cand_dur - target_dur).abs();
            if diff <= 2.0 {
                score += 300;
            } else if diff <= 4.0 {
                score += 150;
            } else if diff <= 8.0 {
                score += 50;
            } else {
                let excess = diff - 8.0;
                let penalty = (excess * 10.0).clamp(50.0, 1500.0) as i32;
                score -= penalty;
            }
        }
    }

    // 3. Title match bonus
    if let (Some(target_title), Some(cand_title)) = (&target.title, &candidate.track_name) {
        let norm_target = normalize_query(target_title).to_lowercase();
        let norm_cand = normalize_query(cand_title).to_lowercase();
        if !norm_target.is_empty() && !norm_cand.is_empty() {
            if norm_target == norm_cand {
                score += 200;
            } else if norm_target.contains(&norm_cand) || norm_cand.contains(&norm_target) {
                score += 100;
            }
        }
    }

    // 4. Artist match bonus
    if let (Some(target_artist), Some(cand_artist)) = (&target.artist, &candidate.artist_name) {
        let clean_target = extract_clean_artist(target_artist).to_lowercase();
        let clean_cand = extract_clean_artist(cand_artist).to_lowercase();
        if !clean_target.is_empty() && !clean_cand.is_empty() {
            if clean_target == clean_cand {
                score += 150;
            } else if clean_target.contains(&clean_cand) || clean_cand.contains(&clean_target) {
                score += 75;
            }
        }
    }

    // 5. Album match bonus
    if let (Some(target_album), Some(cand_album)) = (&target.album, &candidate.album_name) {
        let norm_target = normalize_query(target_album).to_lowercase();
        let norm_cand = normalize_query(cand_album).to_lowercase();
        if !norm_target.is_empty() && !norm_cand.is_empty() {
            if norm_target == norm_cand {
                score += 100;
            } else if norm_target.contains(&norm_cand) || norm_cand.contains(&norm_target) {
                score += 50;
            }
        }
    }

    score
}

/// Scores and ranks a list of candidate lyrics, sorting them descending by calculated score.
#[must_use]
pub fn score_lyric_candidates(
    target: &LyricTargetInfo,
    candidates: Vec<LyricCandidate>,
) -> Vec<ScoredLyricCandidate> {
    let mut scored: Vec<ScoredLyricCandidate> = candidates
        .into_iter()
        .map(|c| {
            let score = score_single_candidate(&c, target);
            let is_synced = c
                .synced_lyrics
                .as_ref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            let is_instrumental = c.instrumental.unwrap_or(false);
            let best_lyrics = if is_synced {
                c.synced_lyrics.clone()
            } else if is_instrumental {
                Some("[00:00.00] ♪ Instrumental ♪".to_string())
            } else if let Some(plain) = &c.plain_lyrics {
                if !plain.trim().is_empty() {
                    Some(plain.clone())
                } else {
                    None
                }
            } else {
                None
            };

            ScoredLyricCandidate {
                candidate: c,
                score,
                is_synced,
                is_instrumental,
                best_lyrics,
            }
        })
        .collect();

    scored.sort_by_key(|a| std::cmp::Reverse(a.score));
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_lrc_timestamps_matrix() {
        assert!(has_lrc_timestamps("[01:23.45] Test"));
        assert!(has_lrc_timestamps("[01:23,45] Test"));
        assert!(has_lrc_timestamps("[00:15.345] Test"));
        assert!(has_lrc_timestamps("[120:05.00] Long mix"));
        assert!(has_lrc_timestamps("[01:23] No fraction"));
        assert!(!has_lrc_timestamps("Plain text lyrics without timestamps"));
        assert!(!has_lrc_timestamps("[ar: Radiohead]"));
        assert!(!has_lrc_timestamps("[ti: Creep]"));
        assert!(!has_lrc_timestamps(""));
        assert!(!has_lrc_timestamps("[12:"));
    }

    #[test]
    fn test_parse_lrc_standard_and_fractions() {
        let raw = "[01:23.45] First line\n[02:00.00] Second line";
        let parsed = parse_lrc(raw);
        assert!(parsed.is_synced);
        assert_eq!(parsed.lines.len(), 2);
        assert!((parsed.lines[0].time - 83.45).abs() < 1e-4);
        assert_eq!(parsed.lines[0].text, "First line");
        assert!((parsed.lines[1].time - 120.0).abs() < 1e-4);
        assert_eq!(parsed.lines[1].text, "Second line");

        let raw_3digit = "[00:15.345] High precision millisecond line";
        let parsed_3digit = parse_lrc(raw_3digit);
        assert_eq!(parsed_3digit.lines.len(), 1);
        assert!((parsed_3digit.lines[0].time - 15.345).abs() < 1e-4);

        let raw_comma = "[01:23,45] European comma format";
        let parsed_comma = parse_lrc(raw_comma);
        assert_eq!(parsed_comma.lines.len(), 1);
        assert!((parsed_comma.lines[0].time - 83.45).abs() < 1e-4);

        let raw_no_frac = "[01:23] No fraction line";
        let parsed_no_frac = parse_lrc(raw_no_frac);
        assert_eq!(parsed_no_frac.lines.len(), 1);
        assert!((parsed_no_frac.lines[0].time - 83.0).abs() < 1e-4);

        let raw_long = "[120:05.00] 2 hour mix line";
        let parsed_long = parse_lrc(raw_long);
        assert_eq!(parsed_long.lines.len(), 1);
        assert!((parsed_long.lines[0].time - 7205.0).abs() < 1e-4);
    }

    #[test]
    fn test_parse_lrc_multi_timestamp_lines() {
        let raw = "[00:10.00][00:20.00] Repeated refrain text";
        let parsed = parse_lrc(raw);
        assert!(parsed.is_synced);
        assert_eq!(parsed.lines.len(), 2);
        assert!((parsed.lines[0].time - 10.0).abs() < 1e-4);
        assert_eq!(parsed.lines[0].text, "Repeated refrain text");
        assert!((parsed.lines[1].time - 20.0).abs() < 1e-4);
        assert_eq!(parsed.lines[1].text, "Repeated refrain text");

        // Out of order timestamps on same or multiple lines
        let raw_out_of_order = "[00:30.00] Third\n[00:10.00] First\n[00:20.00] Second";
        let parsed_ooo = parse_lrc(raw_out_of_order);
        assert_eq!(parsed_ooo.lines.len(), 3);
        assert!((parsed_ooo.lines[0].time - 10.0).abs() < 1e-4);
        assert_eq!(parsed_ooo.lines[0].text, "First");
        assert!((parsed_ooo.lines[1].time - 20.0).abs() < 1e-4);
        assert_eq!(parsed_ooo.lines[1].text, "Second");
        assert!((parsed_ooo.lines[2].time - 30.0).abs() < 1e-4);
        assert_eq!(parsed_ooo.lines[2].text, "Third");
    }

    #[test]
    fn test_parse_lrc_offset_tag() {
        let raw_pos = "[offset: +500]\n[00:10.00] Shifted forward";
        let parsed_pos = parse_lrc(raw_pos);
        assert_eq!(parsed_pos.offset_ms, 500);
        assert!((parsed_pos.lines[0].time - 10.5).abs() < 1e-4);

        let raw_neg = "[offset: -250]\n[00:10.00] Shifted backward";
        let parsed_neg = parse_lrc(raw_neg);
        assert_eq!(parsed_neg.offset_ms, -250);
        assert!((parsed_neg.lines[0].time - 9.75).abs() < 1e-4);

        // Clamping to 0.0
        let raw_clamp = "[offset: -15000]\n[00:10.00] Clamped to zero";
        let parsed_clamp = parse_lrc(raw_clamp);
        assert!((parsed_clamp.lines[0].time - 0.0).abs() < 1e-4);
    }

    #[test]
    fn test_parse_lrc_metadata_extraction() {
        let raw = "[ar: Radiohead]\n[ti: Creep]\n[al: Pablo Honey]\n[by: Wavery]\n[custom: tag]\n[00:05.00] When you were here before";
        let parsed = parse_lrc(raw);
        assert_eq!(parsed.metadata.artist.as_deref(), Some("Radiohead"));
        assert_eq!(parsed.metadata.title.as_deref(), Some("Creep"));
        assert_eq!(parsed.metadata.album.as_deref(), Some("Pablo Honey"));
        assert_eq!(parsed.metadata.creator.as_deref(), Some("Wavery"));
        assert_eq!(parsed.metadata.additional.get("custom").map(|s| s.as_str()), Some("tag"));
        assert_eq!(parsed.lines.len(), 1);
        assert_eq!(parsed.lines[0].text, "When you were here before");
    }

    #[test]
    fn test_parse_lrc_unsynced_plain_lyrics() {
        let raw = "Line one without timestamps\nLine two without timestamps\n\nLine three";
        let parsed = parse_lrc(raw);
        assert!(!parsed.is_synced);
        assert_eq!(parsed.lines.len(), 3);
        assert_eq!(parsed.lines[0].time, -1.0);
        assert_eq!(parsed.lines[0].text, "Line one without timestamps");
        assert_eq!(parsed.lines[1].time, -1.0);
        assert_eq!(parsed.lines[1].text, "Line two without timestamps");
        assert_eq!(parsed.lines[2].time, -1.0);
        assert_eq!(parsed.lines[2].text, "Line three");
    }

    #[test]
    fn test_parse_lrc_multilingual_turkish_cyrillic() {
        let raw = "[00:10.00] Şafak söktü, İstanbul uyanıyor\n[00:20.00] Группа крови на рукаве\n[00:30.00] 君の名は希望";
        let parsed = parse_lrc(raw);
        assert_eq!(parsed.lines.len(), 3);
        assert_eq!(parsed.lines[0].text, "Şafak söktü, İstanbul uyanıyor");
        assert_eq!(parsed.lines[1].text, "Группа крови на рукаве");
        assert_eq!(parsed.lines[2].text, "君の名は希望");
    }

    #[test]
    fn test_active_lyric_binary_search() {
        let lines = vec![
            LyricLine { time: 10.0, text: "Line 1".into() },
            LyricLine { time: 20.0, text: "Line 2".into() },
            LyricLine { time: 30.0, text: "Line 3".into() },
            LyricLine { time: 40.0, text: "Line 4".into() },
        ];

        // Before first line
        assert_eq!(get_active_lyric_index(&lines, 5.0), None);
        // Exact match line 0
        assert_eq!(get_active_lyric_index(&lines, 10.0), Some(0));
        // Between line 0 and line 1
        assert_eq!(get_active_lyric_index(&lines, 15.0), Some(0));
        // Exact match line 1
        assert_eq!(get_active_lyric_index(&lines, 20.0), Some(1));
        // Interpolated between line 1 and 2
        assert_eq!(get_active_lyric_index(&lines, 25.0), Some(1));
        // Beyond last line
        assert_eq!(get_active_lyric_index(&lines, 55.0), Some(3));

        // Empty lines
        assert_eq!(get_active_lyric_index(&[], 15.0), None);

        // Unsynced lines
        let unsynced = vec![LyricLine { time: -1.0, text: "Plain".into() }];
        assert_eq!(get_active_lyric_index(&unsynced, 15.0), None);

        // Duplicate timestamps
        let dupes = vec![
            LyricLine { time: 10.0, text: "Line 1".into() },
            LyricLine { time: 10.0, text: "Line 1 duplicate".into() },
            LyricLine { time: 20.0, text: "Line 2".into() },
        ];
        assert_eq!(get_active_lyric_index(&dupes, 10.0), Some(1));
    }

    #[test]
    fn test_candidate_scoring_and_ranking() {
        let target = LyricTargetInfo {
            title: Some("Paranoid Android (Remastered)".into()),
            artist: Some("Radiohead feat. Friends".into()),
            album: Some("OK Computer".into()),
            duration_secs: Some(180.0),
        };

        let c_perfect = LyricCandidate {
            id: Some(1),
            track_name: Some("Paranoid Android".into()),
            artist_name: Some("Radiohead".into()),
            album_name: Some("OK Computer".into()),
            duration: Some(180.5),
            synced_lyrics: Some("[00:01.00] Please could you stop the noise".into()),
            plain_lyrics: Some("Please could you stop the noise".into()),
            instrumental: Some(false),
        };

        let c_inst = LyricCandidate {
            id: Some(2),
            track_name: Some("Paranoid Android".into()),
            artist_name: Some("Radiohead".into()),
            album_name: Some("OK Computer".into()),
            duration: Some(181.0),
            synced_lyrics: None,
            plain_lyrics: None,
            instrumental: Some(true),
        };

        let c_plain = LyricCandidate {
            id: Some(3),
            track_name: Some("Paranoid Android".into()),
            artist_name: Some("Radiohead".into()),
            album_name: Some("OK Computer".into()),
            duration: Some(180.0),
            synced_lyrics: None,
            plain_lyrics: Some("Please could you stop the noise".into()),
            instrumental: Some(false),
        };

        let c_mismatched_duration = LyricCandidate {
            id: Some(4),
            track_name: Some("Paranoid Android (Extended Live)".into()),
            artist_name: Some("Radiohead".into()),
            album_name: Some("OK Computer Live".into()),
            duration: Some(350.0), // Off by 170s -> -300 penalty
            synced_lyrics: Some("[00:01.00] Live noise".into()),
            plain_lyrics: None,
            instrumental: Some(false),
        };

        let ranked = score_lyric_candidates(&target, vec![c_mismatched_duration, c_plain, c_inst, c_perfect]);
        assert_eq!(ranked.len(), 4);
        assert_eq!(ranked[0].candidate.id, Some(1)); // Perfect synced match should be rank #1
        assert!(ranked[0].score > 1600); // 1000 + 300 + 200 + 150 + 100 = 1750
        assert_eq!(ranked[1].candidate.id, Some(2)); // Instrumental rank #2 (800 base)
        assert_eq!(ranked[2].candidate.id, Some(3)); // Plain rank #3 (100 base)
        assert_eq!(ranked[3].candidate.id, Some(4)); // Long duration mismatch penalized
    }

    #[test]
    fn test_string_cleaning_helpers() {
        assert_eq!(strip_enclosing_parentheses("(Nice Dream)"), "Nice Dream");
        assert_eq!(strip_enclosing_parentheses("[Nice Dream]"), "Nice Dream");
        assert_eq!(strip_enclosing_parentheses("Creep"), "Creep");

        assert_eq!(extract_clean_artist("Radiohead; Thom Yorke"), "Radiohead");
        assert_eq!(extract_clean_artist("Kendrick Lamar feat. Rihanna"), "Kendrick Lamar");
        assert_eq!(extract_clean_artist("Earth, Wind & Fire"), "Earth, Wind & Fire"); // Protected artist preserved

        assert_eq!(normalize_query("01 - Creep (Remastered 2021)"), "Creep");
        assert_eq!(normalize_query("02. Paranoid Android [Official Video]"), "Paranoid Android");
        assert_eq!(normalize_query("Karma Police (Live at Glastonbury)"), "Karma Police");
    }

    #[test]
    fn test_adversarial_redos_fuzzing() {
        let mut adversarial = String::new();
        for _ in 0..10_000 {
            adversarial.push_str("[[[[[[01:23.45");
        }
        let parsed = parse_lrc(&adversarial);
        assert!(!parsed.is_synced);
        assert_eq!(parsed.lines.len(), 1);

        // Check active lyric index with extreme inputs
        let lines = vec![LyricLine { time: 10.0, text: "A".into() }];
        assert_eq!(get_active_lyric_index(&lines, f64::NAN), None);
        assert_eq!(get_active_lyric_index(&lines, f64::NEG_INFINITY), None);
    }
}

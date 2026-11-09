//! Parser and matcher for M3U and M3U8 playlist files.
//!
//! Conforms strictly to standard M3U and Extended M3U (#EXTM3U) formats,
//! supporting relative and absolute filesystem paths, `file://` URIs,
//! `#EXTINF` duration, artist and title metadata, and `#PLAYLIST:` directives.

use std::fs;
use std::path::{Path, PathBuf};
use wavery_core::error::LibraryError;
use wavery_core::models::Track;

use crate::playlist_import::{artist_matches, push_unique, title_variants};

/// Maximum characters kept when deriving a playlist name.
const MAX_PLAYLIST_NAME_CHARS: usize = 128;

/// An individual track entry parsed from an M3U or M3U8 playlist.
#[derive(Debug, Clone, PartialEq)]
pub struct M3uEntry {
    /// Resolved filesystem path if relative to M3U location, or raw absolute path.
    pub resolved_path: PathBuf,
    /// Raw path string as specified in the M3U file.
    pub raw_path: String,
    /// Parsed title from #EXTINF, if present.
    pub title: Option<String>,
    /// Parsed artist from #EXTINF ("Artist - Title"), if present.
    pub artist: Option<String>,
    /// Duration in seconds from #EXTINF, if positive.
    pub duration_secs: Option<f64>,
}

impl M3uEntry {
    /// Friendly display title for reporting matched or unmatched entries.
    #[must_use]
    pub fn display_title(&self) -> String {
        match (&self.artist, &self.title) {
            (Some(artist), Some(title)) => format!("{artist} - {title}"),
            (None, Some(title)) => title.clone(),
            _ => {
                let clean = self.raw_path.replace('\\', "/");
                Path::new(&clean)
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or(&self.raw_path)
                    .to_string()
            }
        }
    }
}

/// A parsed M3U or M3U8 playlist document.
#[derive(Debug, Clone, PartialEq)]
pub struct M3uPlaylist {
    /// Playlist title from #PLAYLIST directive, or derived from the file stem.
    pub name: String,
    /// Ordered list of playlist track entries.
    pub entries: Vec<M3uEntry>,
}

/// Parses an M3U or M3U8 string into structured playlist entries.
///
/// # Errors
/// Returns [`LibraryError::ParseError`] when the playlist contains zero valid track entries.
pub fn parse_m3u(m3u_path: &Path, content: &str) -> Result<M3uPlaylist, LibraryError> {
    // Strip UTF-8 BOM if present
    let content = content.strip_prefix('\u{FEFF}').unwrap_or(content);

    let mut playlist_name = None;
    let mut current_extinf: Option<(Option<f64>, Option<String>, Option<String>)> = None;
    let mut entries = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        // #EXTM3U header marker
        if line.eq_ignore_ascii_case("#EXTM3U") {
            continue;
        }

        // Optional #PLAYLIST:<name> tag
        if let Some(name_candidate) = line.strip_prefix("#PLAYLIST:") {
            let trimmed = name_candidate.trim();
            if !trimmed.is_empty() && playlist_name.is_none() {
                playlist_name = Some(trimmed.to_string());
            }
            continue;
        }

        // #EXTINF:<duration>,[<artist> - ]<title>
        if line.starts_with("#EXTINF:") {
            current_extinf = Some(parse_extinf(line));
            continue;
        }

        // Any other comment or directive
        if line.starts_with('#') {
            continue;
        }

        // Audio path or URI line
        let (duration_secs, title, artist) = current_extinf.take().unwrap_or((None, None, None));
        let raw_path = line.to_string();
        let normalized = normalize_m3u_path(&raw_path);
        let resolved_path = resolve_entry_path(m3u_path, &normalized);

        entries.push(M3uEntry {
            resolved_path,
            raw_path,
            title,
            artist,
            duration_secs,
        });
    }

    if entries.is_empty() {
        return Err(LibraryError::IndexError(format!(
            "Playlist \"{}\" does not contain any audio entries.",
            m3u_path.display()
        )));
    }

    let raw_name = playlist_name.unwrap_or_else(|| fallback_playlist_name(m3u_path));
    let name = clean_playlist_name(&raw_name);

    Ok(M3uPlaylist { name, entries })
}

/// Parses the duration, artist, and title from an `#EXTINF:` line.
fn parse_extinf(line: &str) -> (Option<f64>, Option<String>, Option<String>) {
    let rest = line.strip_prefix("#EXTINF:").unwrap_or(line).trim();
    let (duration_part, title_part) = rest.split_once(',').unwrap_or((rest, ""));

    let duration_secs = duration_part
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|secs| *secs > 0.0);

    let title_part = title_part.trim();
    if title_part.is_empty() {
        return (duration_secs, None, None);
    }

    for separator in [" - ", " – ", " — "] {
        if let Some((artist, title)) = title_part.split_once(separator) {
            let artist_trimmed = artist.trim();
            let title_trimmed = title.trim();
            if !artist_trimmed.is_empty() && !title_trimmed.is_empty() {
                return (
                    duration_secs,
                    Some(title_trimmed.to_string()),
                    Some(artist_trimmed.to_string()),
                );
            }
        }
    }

    (duration_secs, Some(title_part.to_string()), None)
}

/// Normalizes a path or `file://` URI from an M3U entry.
fn normalize_m3u_path(raw: &str) -> String {
    let unescaped = percent_decode(raw.trim());
    let stripped = if let Some(after) = unescaped.strip_prefix("file://") {
        // file:///home/user/... -> /home/user/...
        // file:///C:/path/...   -> C:/path/...
        if after.starts_with('/') && after.len() >= 3 && after.as_bytes()[2] == b':' {
            &after[1..]
        } else {
            after
        }
    } else {
        &unescaped
    };

    stripped.to_string()
}

/// Resolves an entry path against the M3U parent folder if relative.
fn resolve_entry_path(m3u_path: &Path, normalized: &str) -> PathBuf {
    // If running on Linux/macOS and normalized has backslashes, convert to standard slashes
    let portable = normalized.replace('\\', "/");
    let path = Path::new(&portable);

    if path.is_absolute() {
        return path.to_path_buf();
    }

    // Windows drive-letter path check (e.g. "C:/Music/song.mp3" on Linux)
    if portable.len() >= 3 && portable.as_bytes()[1] == b':' && portable.as_bytes()[2] == b'/' {
        return PathBuf::from(portable);
    }

    match m3u_path.parent() {
        Some(parent) => parent.join(path),
        None => path.to_path_buf(),
    }
}

/// Decodes percent-encoded bytes (e.g. `%20` -> ` `).
fn percent_decode(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let mut iter = input.bytes();
    while let Some(b) = iter.next() {
        if b == b'%' {
            let h1 = iter.next();
            let h2 = iter.next();
            match (h1, h2) {
                (Some(c1), Some(c2)) => {
                    let hex_val = match (hex_digit(c1), hex_digit(c2)) {
                        (Some(v1), Some(v2)) => Some((v1 << 4) | v2),
                        _ => None,
                    };
                    if let Some(val) = hex_val {
                        bytes.push(val);
                    } else {
                        bytes.push(b'%');
                        bytes.push(c1);
                        bytes.push(c2);
                    }
                }
                (Some(c1), None) => {
                    bytes.push(b'%');
                    bytes.push(c1);
                }
                (None, _) => {
                    bytes.push(b'%');
                }
            }
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Derives a clean playlist name from the file stem.
fn fallback_playlist_name(m3u_path: &Path) -> String {
    m3u_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Imported Playlist")
        .to_string()
}

/// Truncates and cleans playlist name.
fn clean_playlist_name(name: &str) -> String {
    let trimmed = name.trim();
    let truncated: String = trimmed
        .chars()
        .take(MAX_PLAYLIST_NAME_CHARS)
        .collect::<String>()
        .trim()
        .to_string();

    if truncated.is_empty() {
        "Imported Playlist".to_string()
    } else {
        truncated
    }
}

/// Matches M3U entries to library tracks in order.
///
/// Returns ordered track IDs and the list of titles that could not be resolved.
/// A library track is used at most once per import.
#[must_use]
pub fn match_m3u_entries(entries: &[M3uEntry], tracks: &[Track]) -> (Vec<String>, Vec<String>) {
    let mut used = vec![false; tracks.len()];
    let mut matched = Vec::new();
    let mut unmatched = Vec::new();

    for entry in entries {
        match find_m3u_track_index(entry, tracks, &used) {
            Some(index) => {
                used[index] = true;
                matched.push(tracks[index].id.clone());
            }
            None => unmatched.push(entry.display_title()),
        }
    }

    (matched, unmatched)
}

/// Resolves one M3U entry to an unused library track.
fn find_m3u_track_index(entry: &M3uEntry, tracks: &[Track], used: &[bool]) -> Option<usize> {
    // 1. Exact path match on resolved_path
    for (i, track) in tracks.iter().enumerate() {
        if !used[i] && track.source.path() == &entry.resolved_path {
            return Some(i);
        }
    }

    // 2. Canonicalized path match if files exist on disk
    if let Ok(canonical_entry) = fs::canonicalize(&entry.resolved_path) {
        for (i, track) in tracks.iter().enumerate() {
            if !used[i] {
                if let Ok(canonical_track) = fs::canonicalize(track.source.path()) {
                    if canonical_track == canonical_entry {
                        return Some(i);
                    }
                }
            }
        }
    }

    // 3. Filename match
    let clean_raw = entry.raw_path.replace('\\', "/");
    let entry_filename = Path::new(&clean_raw)
        .file_name()
        .or_else(|| entry.resolved_path.file_name());

    if let Some(entry_name) = entry_filename {
        let filename_matches: Vec<usize> = tracks
            .iter()
            .enumerate()
            .filter(|(i, track)| {
                !used[*i]
                    && track
                        .source
                        .path()
                        .file_name()
                        .is_some_and(|name| name.eq_ignore_ascii_case(entry_name))
            })
            .map(|(i, _)| i)
            .collect();

        if filename_matches.len() == 1 {
            return filename_matches.first().copied();
        }

        if filename_matches.len() > 1 {
            // Disambiguate by duration if available
            if let Some(duration) = entry.duration_secs {
                let narrowed: Vec<usize> = filename_matches
                    .iter()
                    .copied()
                    .filter(|&i| (tracks[i].metadata.duration.as_secs_f64() - duration).abs() <= 2.0)
                    .collect();
                if narrowed.len() == 1 {
                    return narrowed.first().copied();
                }
            }

            // Disambiguate by parent directory name
            if let Some(entry_parent) = entry.resolved_path.parent().and_then(|p| p.file_name()) {
                let narrowed: Vec<usize> = filename_matches
                    .iter()
                    .copied()
                    .filter(|&i| {
                        tracks[i]
                            .source
                            .path()
                            .parent()
                            .and_then(|p| p.file_name())
                            .is_some_and(|p| p.eq_ignore_ascii_case(entry_parent))
                    })
                    .collect();
                if narrowed.len() == 1 {
                    return narrowed.first().copied();
                }
            }
        }
    }

    // 4. Metadata matching fallback if title was extracted from #EXTINF
    if let Some(title) = entry.title.as_deref() {
        let variants = title_variants(title, entry.artist.as_deref());
        if !variants.is_empty() {
            let candidates: Vec<usize> = tracks
                .iter()
                .enumerate()
                .filter(|(i, _)| !used[*i])
                .filter(|(_, track)| {
                    let mut track_variants =
                        title_variants(track.metadata.title.as_deref().unwrap_or_default(), None);
                    if let Some(stem) = track.source.path().file_stem().and_then(|s| s.to_str()) {
                        for variant in title_variants(stem, None) {
                            push_unique(&mut track_variants, variant);
                        }
                    }
                    variants.iter().any(|v| track_variants.contains(v))
                })
                .map(|(i, _)| i)
                .collect();

            if candidates.len() == 1 {
                return candidates.first().copied();
            }

            if let Some(artist) = entry.artist.as_deref() {
                let narrowed: Vec<usize> = candidates
                    .iter()
                    .copied()
                    .filter(|&i| artist_matches(artist, &tracks[i]))
                    .collect();
                if narrowed.len() == 1 {
                    return narrowed.first().copied();
                }
            }

            if let Some(duration) = entry.duration_secs {
                let narrowed: Vec<usize> = candidates
                    .iter()
                    .copied()
                    .filter(|&i| (tracks[i].metadata.duration.as_secs_f64() - duration).abs() <= 2.0)
                    .collect();
                if narrowed.len() == 1 {
                    return narrowed.first().copied();
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_m3u_parser_basic_and_extended() {
        let content = "\
#EXTM3U
#PLAYLIST:Chill Beats
#EXTINF:210,Lo-Fi Producer - Rainy Afternoon
music/rainy.mp3
#EXTINF:180,Coffee Break
file:///home/user/Music/coffee%20break.flac
# Comment line to ignore
relative/song.opus
";
        let path = Path::new("/home/user/Music/playlist.m3u");
        let parsed = parse_m3u(path, content).unwrap();

        assert_eq!(parsed.name, "Chill Beats");
        assert_eq!(parsed.entries.len(), 3);

        let e0 = &parsed.entries[0];
        assert_eq!(e0.artist.as_deref(), Some("Lo-Fi Producer"));
        assert_eq!(e0.title.as_deref(), Some("Rainy Afternoon"));
        assert_eq!(e0.duration_secs, Some(210.0));
        assert_eq!(e0.resolved_path, PathBuf::from("/home/user/Music/music/rainy.mp3"));

        let e1 = &parsed.entries[1];
        assert_eq!(e1.artist, None);
        assert_eq!(e1.title.as_deref(), Some("Coffee Break"));
        assert_eq!(e1.duration_secs, Some(180.0));
        assert_eq!(e1.resolved_path, PathBuf::from("/home/user/Music/coffee break.flac"));

        let e2 = &parsed.entries[2];
        assert_eq!(e2.title, None);
        assert_eq!(e2.duration_secs, None);
        assert_eq!(e2.resolved_path, PathBuf::from("/home/user/Music/relative/song.opus"));
    }

    #[test]
    fn test_m3u_bom_and_fallback_name() {
        let content = "\u{FEFF}track1.opus\ntrack2.opus\n";
        let path = Path::new("/var/music/Gym Playlist.m3u8");
        let parsed = parse_m3u(path, content).unwrap();

        assert_eq!(parsed.name, "Gym Playlist");
        assert_eq!(parsed.entries.len(), 2);
    }

    #[test]
    fn test_m3u_empty_file_fails() {
        let content = "#EXTM3U\n# Comment only\n\n";
        let path = Path::new("empty.m3u");
        let res = parse_m3u(path, content);
        assert!(res.is_err());
    }

    #[test]
    fn test_percent_decoding() {
        assert_eq!(percent_decode("hello%20world"), "hello world");
        assert_eq!(percent_decode("special%23tag"), "special#tag");
        assert_eq!(percent_decode("invalid%2"), "invalid%2");
        assert_eq!(percent_decode("invalid%"), "invalid%");
        assert_eq!(percent_decode("normal_text.mp3"), "normal_text.mp3");
    }
}

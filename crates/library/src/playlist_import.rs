//! Imports yt-dlp JSON metadata as a Wavery playlist.
//!
//! Two shapes are understood, because `yt-dlp` can produce either:
//!
//! - A **playlist dump** (`yt-dlp -J` / `--dump-single-json`): one object with
//!   `_type: "playlist"` and an `entries` array.
//! - A **per-video sidecar** (`--write-info-json`): `Song [id].info.json` next
//!   to every download. When the sidecar carries `playlist_id` or
//!   `playlist_title`, sibling sidecars of the same playlist are collected and
//!   ordered by `playlist_index`.
//!
//! Entries are resolved against tracks that are already in the library. This
//! module never downloads, moves, or re-tags audio; it only records playlist
//! order, so importing the same JSON twice appends nothing new.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use wavery_core::error::LibraryError;
use wavery_core::models::Track;

/// Maximum number of unmatched titles echoed back to the UI.
const UNMATCHED_PREVIEW_LIMIT: usize = 12;

/// Maximum playlist name length, in characters.
const MAX_PLAYLIST_NAME_CHARS: usize = 180;

/// Words that appear in YouTube titles but never in a clean library title.
/// They are dropped before comparing, so "(Official Video)" and "feat. X"
/// variants still resolve to the same song.
const NOISE_WORDS: &[&str] = &[
    "official",
    "video",
    "music",
    "lyric",
    "lyrics",
    "audio",
    "visualizer",
    "visualiser",
    "remaster",
    "remastered",
    "feat",
    "ft",
    "featuring",
    "mv",
    "hd",
    "hq",
    "4k",
    "8k",
    "explicit",
    "topic",
    "provided",
    "auto",
    "generated",
];

/// A single track reference read from a yt-dlp JSON document.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct JsonEntry {
    /// yt-dlp video id (11 characters for YouTube).
    pub video_id: Option<String>,
    /// Cleanest available title: `track` when present, otherwise `title`.
    pub title: Option<String>,
    /// `artist` → `creator` → `uploader` → `channel`, first non-empty.
    pub artist: Option<String>,
    /// Runtime in seconds, used to break ties between same-titled tracks.
    pub duration_secs: Option<f64>,
    /// 1-based position inside the source playlist.
    pub playlist_index: Option<i64>,
    /// Stable id of the source playlist, when known.
    pub playlist_id: Option<String>,
    /// Human name of the source playlist, when known.
    pub playlist_title: Option<String>,
}

impl JsonEntry {
    /// Reads one entry object, returning `None` for JSON `null` placeholders.
    fn from_value(value: &Value) -> Option<Self> {
        let object = value.as_object()?;

        let text = |key: &str| -> Option<String> {
            object
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };

        Some(Self {
            video_id: text("id"),
            title: text("track").or_else(|| text("title")),
            artist: text("artist")
                .or_else(|| text("creator"))
                .or_else(|| text("uploader"))
                .or_else(|| text("channel")),
            duration_secs: object.get("duration").and_then(Value::as_f64),
            playlist_index: object.get("playlist_index").and_then(Value::as_i64),
            playlist_id: text("playlist_id"),
            playlist_title: text("playlist_title"),
        })
        .filter(|entry| entry.video_id.is_some() || entry.title.is_some())
    }

    /// Human-readable label used in the "not found" part of the import summary.
    fn display_title(&self) -> String {
        self.title
            .clone()
            .or_else(|| self.video_id.clone())
            .unwrap_or_else(|| "Untitled entry".to_string())
    }
}

/// A parsed yt-dlp document, normalized into entries plus naming hints.
#[derive(Debug, Clone, Default)]
pub struct ParsedJson {
    /// `_type` from the document (`playlist`, `url`, `video`, …).
    pub kind: Option<String>,
    /// Top-level playlist name, when the document is a playlist dump.
    pub title: Option<String>,
    /// Stable playlist id carried by a sidecar.
    pub playlist_id: Option<String>,
    /// Playlist name carried by a sidecar.
    pub playlist_title: Option<String>,
    /// Entries from a playlist dump, in document order.
    pub entries: Vec<JsonEntry>,
    /// The single video described by a per-file sidecar.
    pub single: Option<JsonEntry>,
}

/// Summary returned to the UI after a JSON playlist import.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaylistImportSummary {
    /// Id of the created (or reused) Wavery playlist.
    pub playlist_id: String,
    /// Display name of the playlist.
    pub playlist_name: String,
    /// Number of entries found in the JSON.
    pub total_entries: usize,
    /// Number of entries resolved to a library track.
    pub matched_tracks: usize,
    /// Number of entries with no library match.
    pub unmatched_entries: usize,
    /// Matched tracks that were already in the playlist before this import.
    pub already_in_playlist: usize,
    /// First few unmatched titles, so the UI can explain what was skipped.
    pub unmatched_titles: Vec<String>,
}

/// Summary returned to the UI after importing one or more folders as playlists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderPlaylistImportResult {
    /// Per-playlist summaries for every created or updated playlist.
    pub playlists: Vec<PlaylistImportSummary>,
    /// Total audio tracks imported or updated across all selected folders.
    pub total_tracks_imported: usize,
    /// Folder paths that contained no supported audio files and were skipped.
    pub skipped_folders: Vec<String>,
}

/// Parses a yt-dlp JSON document.
///
/// # Errors
/// Returns [`LibraryError::IndexError`] when the text is not a JSON object or
/// when a playlist dump has no usable entries.
pub fn parse_json(text: &str) -> Result<ParsedJson, LibraryError> {
    let value: Value = serde_json::from_str(text)
        .map_err(|err| LibraryError::IndexError(format!("Invalid yt-dlp JSON: {err}")))?;
    let object = value.as_object().ok_or_else(|| {
        LibraryError::IndexError("yt-dlp JSON must be a single object".to_string())
    })?;

    let text_field = |key: &str| -> Option<String> {
        object
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };

    let kind = text_field("_type");
    let entries = object
        .get("entries")
        .and_then(Value::as_array)
        .map(|array| {
            array
                .iter()
                .filter_map(JsonEntry::from_value)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let parsed = ParsedJson {
        kind,
        title: text_field("title"),
        playlist_id: text_field("playlist_id"),
        playlist_title: text_field("playlist_title"),
        entries,
        single: JsonEntry::from_value(&value),
    };

    if parsed.entries.is_empty() && parsed.single.is_none() {
        return Err(LibraryError::IndexError(
            "yt-dlp JSON contains no track information".to_string(),
        ));
    }

    // A playlist header with no entries must not be mistaken for a one-track
    // document: its `title`/`id` describe the playlist, not a song.
    if parsed.entries.is_empty() && parsed.kind.as_deref() == Some("playlist") {
        return Err(LibraryError::IndexError(
            "yt-dlp playlist contains no entries".to_string(),
        ));
    }

    Ok(parsed)
}

/// Normalizes a title/artist for comparison: lowercase, drop bracketed
/// suffixes, collapse punctuation, and remove YouTube noise words.
#[must_use]
pub fn normalize_for_match(value: &str) -> String {
    let mut letters = String::with_capacity(value.len());
    let mut bracket_depth = 0usize;
    for ch in value.chars() {
        match ch {
            '(' | '[' | '{' => bracket_depth = bracket_depth.saturating_add(1),
            ')' | ']' | '}' => bracket_depth = bracket_depth.saturating_sub(1),
            _ if bracket_depth > 0 => {}
            _ if ch.is_alphanumeric() => letters.extend(ch.to_lowercase()),
            _ => letters.push(' '),
        }
    }

    let mut normalized = String::with_capacity(letters.len());
    for word in letters.split_whitespace() {
        if NOISE_WORDS.contains(&word) {
            continue;
        }
        if !normalized.is_empty() {
            normalized.push(' ');
        }
        normalized.push_str(word);
    }
    normalized
}

/// Adds a value to a list unless it is empty or already present.
pub(crate) fn push_unique(values: &mut Vec<String>, value: String) {
    if !value.is_empty() && !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

/// Builds the comparison variants of a title: the whole normalized title, the
/// part after `Artist - `, and the part before `feat.`.
pub(crate) fn title_variants(raw: &str, artist: Option<&str>) -> Vec<String> {
    let mut variants = Vec::new();
    let full = normalize_for_match(raw);

    if !full.is_empty() {
        if let Some(artist) = artist {
            let normalized_artist = normalize_for_match(artist);
            if !normalized_artist.is_empty() {
                let prefix = format!("{normalized_artist} ");
                if let Some(stripped) = full.strip_prefix(&prefix) {
                    push_unique(&mut variants, stripped.to_string());
                }
            }
        }
        push_unique(&mut variants, full);
    }

    let ascii_lower = raw.to_ascii_lowercase();
    for marker in [" feat. ", " feat ", " ft. ", " ft ", " featuring "] {
        if let Some(position) = ascii_lower.find(marker) {
            push_unique(&mut variants, normalize_for_match(&raw[..position]));
        }
    }

    for separator in [" - ", " – ", " — ", " | "] {
        if let Some((_, tail)) = raw.split_once(separator) {
            push_unique(&mut variants, normalize_for_match(tail));
        }
        if let Some((_, tail)) = raw.rsplit_once(separator) {
            push_unique(&mut variants, normalize_for_match(tail));
        }
    }

    variants
}

/// True when the track's filename carries this yt-dlp video id, either as
/// `[id]`, `(id)`, or a trailing `id` token.
fn file_stem_has_id(track: &Track, id_lower: &str) -> bool {
    let Some(stem) = track.source.path().file_stem().and_then(|s| s.to_str()) else {
        return false;
    };
    let stem = stem.to_lowercase();

    if stem.contains(&format!("[{id_lower}]")) || stem.contains(&format!("({id_lower})")) {
        return true;
    }

    match stem.strip_suffix(id_lower) {
        Some(prefix) => match prefix.chars().last() {
            Some(ch) => !ch.is_alphanumeric(),
            None => true,
        },
        None => false,
    }
}

/// Compares an entry artist against a track's artist or album artist.
pub(crate) fn artist_matches(entry_artist: &str, track: &Track) -> bool {
    let needle = normalize_for_match(entry_artist);
    if needle.is_empty() {
        return false;
    }

    [
        track.metadata.artist.as_deref(),
        track.metadata.album_artist.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(normalize_for_match)
    .filter(|candidate| !candidate.is_empty())
    .any(|candidate| {
        candidate == needle || candidate.contains(&needle) || needle.contains(&candidate)
    })
}

/// Resolves one entry to an unused library track.
///
/// Order of evidence: the yt-dlp video id in the filename, then title plus
/// artist, then title plus duration, then a unique title match. Ambiguous
/// matches are deliberately rejected instead of guessed.
fn find_track_index(entry: &JsonEntry, tracks: &[Track], used: &[bool]) -> Option<usize> {
    if let Some(video_id) = entry.video_id.as_deref() {
        let video_id = video_id.to_ascii_lowercase();
        let id_matches: Vec<usize> = tracks
            .iter()
            .enumerate()
            .filter(|(index, track)| !used[*index] && file_stem_has_id(track, &video_id))
            .map(|(index, _)| index)
            .collect();
        if id_matches.len() == 1 {
            return id_matches.first().copied();
        }
    }

    let variants = title_variants(
        entry.title.as_deref().unwrap_or_default(),
        entry.artist.as_deref(),
    );
    if variants.is_empty() {
        return None;
    }

    let candidates: Vec<usize> = tracks
        .iter()
        .enumerate()
        .filter(|(index, _)| !used[*index])
        .filter(|(_, track)| {
            let mut track_variants =
                title_variants(track.metadata.title.as_deref().unwrap_or_default(), None);
            if let Some(stem) = track.source.path().file_stem().and_then(|s| s.to_str()) {
                for variant in title_variants(stem, None) {
                    push_unique(&mut track_variants, variant);
                }
            }
            variants
                .iter()
                .any(|variant| track_variants.contains(variant))
        })
        .map(|(index, _)| index)
        .collect();

    if candidates.is_empty() {
        return None;
    }
    if candidates.len() == 1 {
        return candidates.first().copied();
    }

    if let Some(artist) = entry.artist.as_deref() {
        let narrowed: Vec<usize> = candidates
            .iter()
            .copied()
            .filter(|index| artist_matches(artist, &tracks[*index]))
            .collect();
        if narrowed.len() == 1 {
            return narrowed.first().copied();
        }
    }

    if let Some(duration) = entry.duration_secs {
        let narrowed: Vec<usize> = candidates
            .iter()
            .copied()
            .filter(|index| {
                (tracks[*index].metadata.duration.as_secs_f64() - duration).abs() <= 2.0
            })
            .collect();
        if narrowed.len() == 1 {
            return narrowed.first().copied();
        }
    }

    None
}

/// Matches entries to library tracks in order.
///
/// Returns the ordered track ids and the titles that could not be resolved.
/// A library track is used at most once per import.
#[must_use]
pub fn match_entries(entries: &[JsonEntry], tracks: &[Track]) -> (Vec<String>, Vec<String>) {
    let mut used = vec![false; tracks.len()];
    let mut matched = Vec::new();
    let mut unmatched = Vec::new();

    for entry in entries {
        match find_track_index(entry, tracks, &used) {
            Some(index) => {
                used[index] = true;
                matched.push(tracks[index].id.clone());
            }
            None => unmatched.push(entry.display_title()),
        }
    }

    (matched, unmatched)
}

/// True when two sidecars belong to the same source playlist.
fn same_playlist(entry: &JsonEntry, playlist_id: &str, playlist_title: &str) -> bool {
    if !playlist_id.is_empty()
        && entry
            .playlist_id
            .as_deref()
            .is_some_and(|id| id.eq_ignore_ascii_case(playlist_id))
    {
        return true;
    }
    !playlist_title.is_empty()
        && entry
            .playlist_title
            .as_deref()
            .is_some_and(|title| title.trim().eq_ignore_ascii_case(playlist_title))
}

/// True when `candidate` duplicates an entry already collected.
fn is_duplicate(candidate: &JsonEntry, collected: &[JsonEntry]) -> bool {
    collected.iter().any(|existing| {
        match (candidate.video_id.as_deref(), existing.video_id.as_deref()) {
            (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
            _ => {
                normalize_for_match(candidate.title.as_deref().unwrap_or_default())
                    == normalize_for_match(existing.title.as_deref().unwrap_or_default())
                    && candidate.title.is_some()
            }
        }
    })
}

/// Collects every sibling `*.info.json` belonging to `single`'s playlist.
///
/// Unreadable or unrelated files are skipped: one malformed sidecar must not
/// abort an otherwise valid import.
fn collect_sibling_entries(json_path: &Path, single: &JsonEntry) -> Vec<JsonEntry> {
    let playlist_id = single.playlist_id.clone().unwrap_or_default();
    let playlist_title = single.playlist_title.clone().unwrap_or_default();
    if playlist_id.is_empty() && playlist_title.is_empty() {
        return vec![single.clone()];
    }

    let Some(directory) = json_path.parent() else {
        return vec![single.clone()];
    };
    let Ok(read_dir) = fs::read_dir(directory) else {
        return vec![single.clone()];
    };

    let mut collected = vec![single.clone()];
    for entry in read_dir.flatten() {
        let path = PathBuf::from(entry.file_name());
        let is_sidecar = path
            .to_string_lossy()
            .to_lowercase()
            .ends_with(".info.json");
        if !is_sidecar || entry.path() == json_path {
            continue;
        }
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(document) = parse_json(&text) else {
            continue;
        };
        let candidate = match document.single {
            Some(candidate) => candidate,
            None => continue,
        };
        if same_playlist(&candidate, &playlist_id, &playlist_title)
            && !is_duplicate(&candidate, &collected)
        {
            collected.push(candidate);
        }
    }

    // A playlist dump lists entries in order; sibling sidecars only carry
    // playlist_index, so fall back to directory order for untagged files.
    collected.sort_by_key(|entry| entry.playlist_index.unwrap_or(i64::MAX));
    collected
}

/// Coerces a playlist name from JSON metadata, truncating absurdly long ones.
fn clean_playlist_name(raw: Option<String>, json_path: &Path) -> String {
    let candidate = raw
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| fallback_playlist_name(json_path));

    let truncated: String = candidate
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

/// Derives a playlist name from the JSON filename when the document has none.
fn fallback_playlist_name(json_path: &Path) -> String {
    let stem = json_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Imported Playlist");

    // `Song [id].info.json` has a file stem of `Song [id].info`.
    stem.strip_suffix(".info").unwrap_or(stem).to_string()
}

/// Picks the entries and name represented by a parsed document.
///
/// # Errors
/// Returns [`LibraryError::IndexError`] when a playlist dump contains no
/// usable entries.
pub fn resolve_playlist(
    json_path: &Path,
    document: ParsedJson,
) -> Result<(String, Vec<JsonEntry>), LibraryError> {
    if !document.entries.is_empty() {
        let name = clean_playlist_name(
            document
                .playlist_title
                .clone()
                .or_else(|| document.title.clone()),
            json_path,
        );
        return Ok((name, document.entries));
    }

    let single = document.single.clone().ok_or_else(|| {
        LibraryError::IndexError("yt-dlp JSON contains no usable entries".to_string())
    })?;

    let has_playlist_key = single.playlist_id.is_some() || single.playlist_title.is_some();
    let entries = if has_playlist_key {
        collect_sibling_entries(json_path, &single)
    } else {
        vec![single.clone()]
    };

    let name = clean_playlist_name(
        document
            .playlist_title
            .clone()
            .or_else(|| single.playlist_title.clone())
            .or_else(|| document.title.clone())
            .or_else(|| single.title.clone()),
        json_path,
    );

    Ok((name, entries))
}

/// Collects the unmatched titles to echo back to the UI.
#[must_use]
pub fn unmatched_preview(mut unmatched: Vec<String>) -> Vec<String> {
    unmatched.truncate(UNMATCHED_PREVIEW_LIMIT);
    unmatched
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use wavery_core::models::{TrackMetadata, TrackSource};

    fn track(id: &str, title: &str, artist: &str, duration: u64, path: &str) -> Track {
        Track {
            id: id.to_string(),
            source: TrackSource::Managed(PathBuf::from(path)),
            metadata: TrackMetadata {
                title: Some(title.to_string()),
                artist: Some(artist.to_string()),
                duration: Duration::from_secs(duration),
                ..TrackMetadata::default()
            },
            date_added: 0,
        }
    }

    const PLAYLIST_DUMP: &str = r#"{
        "_type": "playlist",
        "id": "PL123",
        "title": "Road Trip",
        "entries": [
            {"id": "aaaaaaaaaaa", "title": "First Song", "duration": 201},
            {"id": "bbbbbbbbbbb", "title": "Second Song", "duration": 180},
            null
        ]
    }"#;

    const SIDECAR: &str = r#"{
        "_type": "url",
        "id": "ccccccccccc",
        "title": "Third Song (Official Video)",
        "track": "Third Song",
        "creator": "Some Artist",
        "duration": 199,
        "playlist_id": "PL123",
        "playlist_title": "Road Trip",
        "playlist_index": 3
    }"#;

    #[test]
    fn parses_playlist_dump_and_skips_null_entries() {
        let parsed = parse_json(PLAYLIST_DUMP).expect("playlist dump should parse");
        assert_eq!(parsed.kind.as_deref(), Some("playlist"));
        assert_eq!(parsed.title.as_deref(), Some("Road Trip"));
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[0].title.as_deref(), Some("First Song"));
        assert_eq!(parsed.entries[0].video_id.as_deref(), Some("aaaaaaaaaaa"));
    }

    #[test]
    fn parses_sidecar_with_clean_track_title() {
        let parsed = parse_json(SIDECAR).expect("sidecar should parse");
        let entry = parsed.single.expect("sidecar has one entry");
        assert_eq!(entry.title.as_deref(), Some("Third Song"));
        assert_eq!(entry.artist.as_deref(), Some("Some Artist"));
        assert_eq!(entry.playlist_index, Some(3));
    }

    #[test]
    fn rejects_non_object_and_empty_documents() {
        assert!(parse_json("[]").is_err());
        assert!(parse_json("{}").is_err());
        assert!(parse_json("not json").is_err());
        assert!(parse_json(r#"{"_type":"playlist","title":"Empty","entries":[]}"#).is_err());
    }

    #[test]
    fn normalization_drops_brackets_and_noise_words() {
        assert_eq!(
            normalize_for_match("Third Song (Official Video)"),
            "third song"
        );
        assert_eq!(
            normalize_for_match("Song feat. Other Artist"),
            "song other artist"
        );
        assert_eq!(normalize_for_match("  Björk  "), "björk");
    }

    #[test]
    fn matches_by_video_id_in_filename() {
        let tracks = vec![
            track(
                "1",
                "First Song",
                "Artist",
                201,
                "/music/First Song [aaaaaaaaaaa].opus",
            ),
            track(
                "2",
                "First Song",
                "Artist",
                201,
                "/music/First Song [different1].opus",
            ),
        ];
        let entries = vec![JsonEntry {
            video_id: Some("aaaaaaaaaaa".to_string()),
            title: Some("First Song".to_string()),
            ..JsonEntry::default()
        }];
        let (matched, unmatched) = match_entries(&entries, &tracks);
        assert_eq!(matched, vec!["1".to_string()]);
        assert!(unmatched.is_empty());
    }

    #[test]
    fn same_title_is_disambiguated_by_artist() {
        let tracks = vec![
            track("1", "Dreams", "Fleetwood Mac", 257, "/music/dreams.opus"),
            track("2", "Dreams", "The Cranberries", 276, "/music/dreams2.opus"),
        ];
        let entries = vec![JsonEntry {
            title: Some("Dreams".to_string()),
            artist: Some("Fleetwood Mac - Topic".to_string()),
            ..JsonEntry::default()
        }];
        let (matched, _) = match_entries(&entries, &tracks);
        assert_eq!(matched, vec!["1".to_string()]);
    }

    #[test]
    fn same_title_without_artist_uses_duration() {
        let tracks = vec![
            track("1", "Intro", "A", 40, "/music/a.opus"),
            track("2", "Intro", "B", 120, "/music/b.opus"),
        ];
        let entries = vec![JsonEntry {
            title: Some("Intro".to_string()),
            duration_secs: Some(119.0),
            ..JsonEntry::default()
        }];
        let (matched, _) = match_entries(&entries, &tracks);
        assert_eq!(matched, vec!["2".to_string()]);
    }

    #[test]
    fn ambiguous_title_is_not_guessed() {
        let tracks = vec![
            track("1", "Intro", "A", 40, "/music/a.opus"),
            track("2", "Intro", "B", 120, "/music/b.opus"),
        ];
        let entries = vec![JsonEntry {
            title: Some("Intro".to_string()),
            ..JsonEntry::default()
        }];
        let (matched, unmatched) = match_entries(&entries, &tracks);
        assert!(matched.is_empty());
        assert_eq!(unmatched, vec!["Intro".to_string()]);
    }

    #[test]
    fn a_track_is_never_matched_twice() {
        let tracks = vec![track("1", "Only Song", "A", 100, "/music/only.opus")];
        let entries = vec![
            JsonEntry {
                title: Some("Only Song".to_string()),
                ..JsonEntry::default()
            },
            JsonEntry {
                title: Some("Only Song".to_string()),
                ..JsonEntry::default()
            },
        ];
        let (matched, unmatched) = match_entries(&entries, &tracks);
        assert_eq!(matched, vec!["1".to_string()]);
        assert_eq!(unmatched.len(), 1);
    }

    #[test]
    fn playlist_dump_resolves_name_and_entries() {
        let parsed = parse_json(PLAYLIST_DUMP).expect("playlist dump should parse");
        let (name, entries) =
            resolve_playlist(Path::new("/music/road-trip.json"), parsed).expect("resolve");
        assert_eq!(name, "Road Trip");
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn sidecar_without_playlist_is_a_single_entry() {
        let parsed = parse_json(
            SIDECAR
                .replace("\"playlist_id\": \"PL123\",", "")
                .replace("\"playlist_title\": \"Road Trip\",", "")
                .as_str(),
        )
        .expect("sidecar should parse");
        let (name, entries) = resolve_playlist(
            Path::new("/music/Third Song [ccccccccccc].info.json"),
            parsed,
        )
        .expect("resolve");
        assert_eq!(entries.len(), 1);
        assert_eq!(name, "Third Song (Official Video)");
    }

    #[test]
    fn sibling_sidecars_are_grouped_and_ordered() {
        let directory = std::env::temp_dir().join(format!(
            "wavery-playlist-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&directory).expect("temp dir");

        let selected = directory.join("Second [bbbbbbbbbbb].info.json");
        std::fs::write(
            &selected,
            r#"{"id":"bbbbbbbbbbb","title":"Second","playlist_id":"PL9","playlist_title":"Mix","playlist_index":2}"#,
        )
        .expect("write sidecar");
        std::fs::write(
            directory.join("First [aaaaaaaaaaa].info.json"),
            r#"{"id":"aaaaaaaaaaa","title":"First","playlist_id":"PL9","playlist_title":"Mix","playlist_index":1}"#,
        )
        .expect("write sibling");
        std::fs::write(
            directory.join("Other [ddddddddddd].info.json"),
            r#"{"id":"ddddddddddd","title":"Other","playlist_id":"PLOTHER","playlist_title":"Other Mix","playlist_index":1}"#,
        )
        .expect("write unrelated sidecar");
        std::fs::write(directory.join("broken.info.json"), "{ nope").expect("write broken");

        let text = std::fs::read_to_string(&selected).expect("read selected");
        let parsed = parse_json(&text).expect("parse selected");
        let single = parsed.single.expect("single entry");
        let collected = collect_sibling_entries(&selected, &single);

        assert_eq!(collected.len(), 2);
        assert_eq!(collected[0].title.as_deref(), Some("First"));
        assert_eq!(collected[1].title.as_deref(), Some("Second"));

        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn unmatched_preview_is_capped() {
        let titles: Vec<String> = (0..40).map(|index| format!("Song {index}")).collect();
        assert_eq!(unmatched_preview(titles).len(), UNMATCHED_PREVIEW_LIMIT);
    }
}

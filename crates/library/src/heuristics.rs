//! Filesystem path and filename fallback heuristics for metadata extraction.

use std::path::Path;

/// Blacklist of generic directory names ignored during artist inference.
pub static GENERIC_FOLDERS: &[&str] = &[
    "music", "downloads", "desktop", "documents", "audio", "songs", "tracks", "flac", "mp3",
    "media", "cd1", "cd2", "disc 1", "disc 2", "disc1", "disc2", "album", "albums", "singles",
    "single", "eps", "ep", "home", "user", "root", "library", "various", "various artists",
    "wavery", "tmp", "temp", "var", "opt", "usr", "private",
];

/// Checks if a folder is a system, OS temp, or library root boundary that an artist folder
/// cannot legitimately sit above (e.g. `Users`, `AppData`, `Local`, `Temp`, `Music`, `Downloads`).
fn is_root_boundary_folder(segments: &[&str], index: usize) -> bool {
    let lower = segments[index].trim().to_lowercase();
    if matches!(
        lower.as_str(),
        "music"
            | "downloads"
            | "desktop"
            | "documents"
            | "home"
            | "users"
            | "user"
            | "root"
            | "library"
            | "tmp"
            | "temp"
            | "var"
            | "opt"
            | "usr"
            | "private"
            | "appdata"
            | "local"
            | "roaming"
            | "folders"
    ) {
        return true;
    }

    // macOS per-user temporary directories live under `/var/folders/<2>/<hash>/T`
    if lower == "t"
        && index >= 2
        && segments[..index]
            .iter()
            .any(|s| s.eq_ignore_ascii_case("folders"))
        && segments[..index]
            .iter()
            .any(|s| s.eq_ignore_ascii_case("var"))
    {
        return true;
    }

    false
}

/// Checks if a folder name is in the generic folder blacklist or is a system temp folder.
fn is_generic_folder(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if GENERIC_FOLDERS.iter().any(|&g| g == lower) {
        return true;
    }
    if crate::clustering::is_disc_folder(name) {
        return true;
    }
    if lower.starts_with("wavery") || lower.starts_with("tmp") || lower.starts_with("temp") {
        return true;
    }
    if uuid::Uuid::parse_str(&lower).is_ok() {
        return true;
    }
    false
}

/// Strips leading track number prefix from filename candidate.
/// Handles forms like "01 ", "01. ", "01 - ", "track 01 ", "track01 - ".
fn strip_track_number_prefix(s: &str) -> &str {
    let trimmed = s.trim_start();
    if trimmed.len() >= 5
        && trimmed.is_char_boundary(5)
        && trimmed[..5].eq_ignore_ascii_case("track")
    {
        let rest = &trimmed[5..];
        let rest_trimmed = rest.trim_start();
        let digits_len = rest_trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits_len > 0 {
            let after_digits = &rest_trimmed[digits_len..];
            let after_punct = after_digits.trim_start_matches(|c: char| {
                c.is_whitespace() || c == '.' || c == '-' || c == '_'
            });
            return after_punct.trim();
        }
    }

    let digits_len = trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits_len > 0 {
        let after_digits = &trimmed[digits_len..];
        let after_punct = after_digits.trim_start_matches(|c: char| {
            c.is_whitespace() || c == '.' || c == '-' || c == '_'
        });
        return after_punct.trim();
    }

    trimmed.trim()
}

/// Checks if string is numeric or a track prefix placeholder.
fn is_numeric_or_track(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.parse::<f64>().is_ok() {
        return true;
    }
    let lower = trimmed.to_lowercase();
    if let Some(rest) = lower.strip_prefix("track") {
        if rest.trim().parse::<u32>().is_ok() {
            return true;
        }
    }
    false
}

/// Extracts artist name from directory structure or filename when tags lack artist metadata.
///
/// # Examples
/// - `/Music/Radiohead/In Rainbows/01.flac` -> `Some("Radiohead")`
/// - `/Music/Led Zeppelin - Physical Graffiti/01.mp3` -> `Some("Led Zeppelin")`
/// - `/Downloads/01 - Radiohead - Creep.flac` -> `Some("Radiohead")`
/// - `/Downloads/01. Led Zeppelin - Kashmir.mp3` -> `Some("Led Zeppelin")`
#[must_use]
pub fn extract_artist_from_path(file_path: &Path, album_title: Option<&str>) -> Option<String> {
    let mut segments = Vec::new();
    for comp in file_path.components() {
        if let std::path::Component::Normal(os_str) = comp {
            if let Some(s) = os_str.to_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    segments.push(trimmed);
                }
            }
        }
    }

    if segments.len() < 2 {
        return None;
    }

    let file_name = segments[segments.len() - 1];

    // 1. Check parent folders from deepest to highest
    for i in (0..segments.len() - 1).rev() {
        if is_root_boundary_folder(&segments, i) {
            break;
        }
        let folder = segments[i];
        if is_generic_folder(folder) {
            continue;
        }

        // Check if folder is "Artist - Album"
        if folder.contains(" - ") {
            let parts: Vec<&str> = folder.split(" - ").collect();
            if parts.len() >= 2 {
                let candidate = parts[0].trim();
                if !candidate.is_empty() && !is_generic_folder(candidate) {
                    return Some(candidate.to_string());
                }
            }
        }

        // If folder doesn't match album title, it's the artist folder!
        let matches_album = album_title.is_some_and(|at| {
            folder.to_lowercase().contains(&at.trim().to_lowercase())
        });

        if !matches_album {
            return Some(folder.to_string());
        }
    }

    // 2. Check filename patterns
    let file_stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);

    if file_stem.contains(" - ") {
        let parts: Vec<&str> = file_stem.split(" - ").collect();
        if parts.len() == 2 {
            let candidate = strip_track_number_prefix(parts[0]);
            if !candidate.is_empty() && !is_numeric_or_track(candidate) {
                return Some(candidate.to_string());
            }
        } else if parts.len() >= 3 {
            let candidate = parts[1].trim();
            if !candidate.is_empty() && !is_numeric_or_track(candidate) {
                return Some(candidate.to_string());
            }
        }
    }

    // Filename pattern "01. Artist - Title"
    if let Some((_, second_part)) = file_stem.split_once(". ") {
        if second_part.contains(" - ") {
            if let Some((cand, _)) = second_part.split_once(" - ") {
                let candidate = cand.trim();
                if !candidate.is_empty() && !is_numeric_or_track(candidate) {
                    return Some(candidate.to_string());
                }
            }
        }
    }

    None
}

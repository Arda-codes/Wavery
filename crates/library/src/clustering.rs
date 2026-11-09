//! Relational data clustering and library aggregation algorithms.
//!
//! Groups raw tracks into cohesive albums and artist profiles, detecting
//! compilations ("Various Artists") and resolving composer rosters.

use crate::heuristics::extract_artist_from_path;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use wavery_core::heuristics::{
    extract_primary_artist, is_roster_string, split_artists, split_genres,
};
use wavery_core::models::{Album, Artist, GenreInfo, Track};

/// Returns true if the artist string explicitly designates a compilation.
#[must_use]
pub fn is_compilation_artist(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    matches!(
        lower.as_str(),
        "various artists"
            | "various artist"
            | "various"
            | "va"
            | "v.a."
            | "v.a"
            | "v/a"
            | "compilation"
            | "compilations"
    )
}

/// Parses a disc number from a folder name (e.g. "Disc 1", "CD 2", "Vol 1", "Side A").
///
/// Handles arabic numerals, roman numerals (i..x), and vinyl sides (a..h).
/// Returns `None` if the folder is not a multi-disc subfolder (avoiding false positives like "Discovery").
#[must_use]
pub fn parse_disc_number(name: &str) -> Option<u32> {
    let trimmed = name.trim();
    let stripped = trimmed
        .trim_matches(|c: char| c == '[' || c == ']' || c == '(' || c == ')' || c == '{' || c == '}')
        .trim();
    let lower = stripped.to_lowercase();

    let prefixes = [
        "disc", "disk", "cd", "volume", "vol.", "vol", "part", "pt.", "pt", "side",
    ];

    for prefix in &prefixes {
        if let Some(rest) = lower.strip_prefix(prefix) {
            let remainder = rest
                .trim_start_matches(|c: char| {
                    c.is_whitespace() || c == '.' || c == '-' || c == '_' || c == '#' || c == ':'
                })
                .trim();

            if remainder.is_empty() {
                continue;
            }

            // Case A: Arabic digits (e.g. "1", "02", "10")
            let digit_str: String = remainder.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !digit_str.is_empty() {
                if let Ok(num) = digit_str.parse::<u32>() {
                    return Some(num);
                }
            }

            // Case B: Roman numerals ("i" through "x")
            let roman_num = match remainder {
                "i" => Some(1),
                "ii" => Some(2),
                "iii" => Some(3),
                "iv" => Some(4),
                "v" => Some(5),
                "vi" => Some(6),
                "vii" => Some(7),
                "viii" => Some(8),
                "ix" => Some(9),
                "x" => Some(10),
                _ => None,
            };
            if let Some(num) = roman_num {
                return Some(num);
            }

            // Case C: Single vinyl side letter ('a' through 'h')
            if remainder.len() == 1 {
                let ch = remainder.chars().next().unwrap_or(' ');
                if matches!(ch, 'a'..='h') {
                    return Some((ch as u32 - 'a' as u32) + 1);
                }
            }
        }
    }

    None
}

/// Returns true if the folder name is a multi-disc directory.
#[must_use]
pub fn is_disc_folder(name: &str) -> bool {
    parse_disc_number(name).is_some()
}

/// Resolves the effective parent album directory for a file by stripping
/// intermediate multi-disc subdirectories (e.g. "The Wall/Disc 1/01.flac" -> "The Wall").
#[must_use]
pub fn get_album_parent_dir(file_path: &std::path::Path) -> Option<&std::path::Path> {
    let mut current = file_path.parent()?;
    while let Some(folder_name) = current.file_name().and_then(|f| f.to_str()) {
        let lower = folder_name.trim().to_lowercase();
        if is_disc_folder(folder_name) || matches!(lower.as_str(), "discs" | "cds" | "disks") {
            if let Some(parent) = current.parent() {
                if parent.file_name().is_some() {
                    current = parent;
                    continue;
                }
            }
        }
        break;
    }
    Some(current)
}

/// Extracts a disc number from directory hierarchy when metadata tags lack disc number.
#[must_use]
pub fn extract_disc_number_from_path(path: &std::path::Path) -> Option<u32> {
    let mut current = path.parent();
    while let Some(dir) = current {
        if let Some(folder_name) = dir.file_name().and_then(|f| f.to_str()) {
            if let Some(disc) = parse_disc_number(folder_name) {
                return Some(disc);
            }
        }
        current = dir.parent();
    }
    None
}

/// Resolves dominant album artist name and compilation status for a cluster of tracks.
fn resolve_dominant_album_artist(
    tracks: &[Track],
    protected_artists: &[String],
) -> (String, Option<String>, bool) {
    let representative_track = match tracks.first() {
        Some(t) => t,
        None => return ("Unknown Artist".to_string(), None, false),
    };

    let album_title = representative_track
        .metadata
        .album
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let path_artist = extract_artist_from_path(representative_track.source.path(), album_title);

    // 1. Check for explicit album_artist tag on representative track or across cluster
    let explicit_aa = representative_track
        .metadata
        .album_artist
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            tracks.iter().find_map(|t| {
                t.metadata
                    .album_artist
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            })
        });

    // If explicit album_artist is "Various Artists" (or equivalent compilation tag),
    // this album IS a compilation regardless of song artist or track count.
    if let Some(aa) = explicit_aa {
        if is_compilation_artist(aa) {
            return ("Various Artists".to_string(), Some(aa.to_string()), true);
        }
    }

    // Also check if ANY track explicitly declares a compilation album_artist
    if tracks.iter().any(|t| {
        t.metadata
            .album_artist
            .as_deref()
            .map(str::trim)
            .is_some_and(is_compilation_artist)
    }) {
        let tag = explicit_aa
            .map(str::to_string)
            .unwrap_or_else(|| "Various Artists".to_string());
        return ("Various Artists".to_string(), Some(tag), true);
    }

    let has_clean_explicit_aa = explicit_aa.is_some_and(|aa| {
        !is_roster_string(aa, protected_artists) && aa.to_lowercase() != "unknown artist"
    });

    // 2. Tally song/track artists across the album
    let mut artist_counts: HashMap<String, usize> = HashMap::new();
    for t in tracks {
        let raw = t
            .metadata
            .artist
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Unknown Artist");
        *artist_counts.entry(raw.to_string()).or_default() += 1;
    }

    let mut sorted_candidates: Vec<(String, usize)> = artist_counts.into_iter().collect();
    sorted_candidates.sort_by(|a, b| {
        if b.1 != a.1 {
            b.1.cmp(&a.1)
        } else {
            a.0.len().cmp(&b.0.len())
        }
    });

    let top_candidate = sorted_candidates
        .first()
        .cloned()
        .unwrap_or_else(|| ("Unknown Artist".to_string(), 0));

    let mut best_song_artist = top_candidate.0.clone();
    for (cand, _) in &sorted_candidates {
        if !is_roster_string(cand, protected_artists) && cand.to_lowercase() != "unknown artist" {
            best_song_artist = cand.clone();
            break;
        }
    }

    // 3. Automatic compilation detection:
    // When no explicit album_artist is provided, 3+ tracks, 3+ distinct artists,
    // and top candidate has strictly less than 50% of the tracks.
    // Fixed: uses `top_candidate.1 * 2 < tracks.len()` to prevent integer division truncation.
    if !has_clean_explicit_aa
        && tracks.len() >= 3
        && sorted_candidates.len() >= 3
        && top_candidate.1 * 2 < tracks.len()
    {
        return (
            "Various Artists".to_string(),
            Some("Various Artists".to_string()),
            true,
        );
    }

    // 4. Derive from clean song artist
    if !is_roster_string(&best_song_artist, protected_artists)
        && best_song_artist.to_lowercase() != "unknown artist"
    {
        let primary = extract_primary_artist(&best_song_artist, protected_artists);
        let explicit = if has_clean_explicit_aa {
            explicit_aa.map(str::to_string)
        } else {
            Some(primary.clone())
        };
        return (primary, explicit, false);
    }

    // 5. If song artist is a composer roster, resolve from clean explicit album_artist or folder path
    if has_clean_explicit_aa {
        let aa = explicit_aa.unwrap_or("Unknown Artist").to_string();
        let is_comp = is_compilation_artist(&aa);
        return (aa.clone(), Some(aa), is_comp);
    }

    if let Some(ref pa) = path_artist {
        if !is_roster_string(pa, protected_artists) {
            return (pa.clone(), Some(pa.clone()), false);
        }
    }

    let primary = extract_primary_artist(&best_song_artist, protected_artists);
    (primary, None, false)
}

/// Groups a slice of tracks into cohesive albums.
///
/// Handles directory containment, multi-disc albums, release years,
/// and compilation ("Various Artists") detection.
#[must_use]
pub fn group_tracks_by_album(tracks: &[Track], protected_artists: &[String]) -> Vec<Album> {
    let mut cluster_map: HashMap<String, Vec<Track>> = HashMap::new();
    let mut cluster_keys: Vec<String> = Vec::new();

    for track in tracks {
        let album_title = track
            .metadata
            .album
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Unknown Album");

        // Strip multi-disc subdirectories ("Disc 1", "CD 2") so all discs unite
        let parent_dir = get_album_parent_dir(track.source.path())
            .and_then(|p| p.to_str())
            .unwrap_or("");

        let explicit_aa = track
            .metadata
            .album_artist
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let year = track.metadata.year;

        let cluster_key = if !parent_dir.is_empty() && album_title != "Unknown Album" {
            format!(
                "dir:{}___title:{}",
                parent_dir.to_lowercase(),
                album_title.to_lowercase()
            )
        } else if let Some(aa) = explicit_aa {
            format!(
                "aa:{}___title:{}",
                aa.to_lowercase(),
                album_title.to_lowercase()
            )
        } else if album_title != "Unknown Album" {
            format!(
                "title:{}___year:{}",
                album_title.to_lowercase(),
                year.map_or_else(|| "any".to_string(), |y| y.to_string())
            )
        } else {
            let artist = track
                .metadata
                .artist
                .as_deref()
                .map(str::trim)
                .unwrap_or("Unknown Artist");
            format!("loose:{}___id:{}", artist.to_lowercase(), track.id)
        };

        let entry = cluster_map.entry(cluster_key.clone()).or_insert_with(|| {
            cluster_keys.push(cluster_key);
            Vec::new()
        });
        entry.push(track.clone());
    }

    let mut results: Vec<Album> = Vec::with_capacity(cluster_keys.len());

    for key in cluster_keys {
        let mut cluster_tracks = match cluster_map.remove(&key) {
            Some(t) => t,
            None => continue,
        };

        if cluster_tracks.is_empty() {
            continue;
        }

        // Backfill disc_number if missing from file tags
        for t in &mut cluster_tracks {
            if t.metadata.disc_number.is_none() {
                t.metadata.disc_number = extract_disc_number_from_path(t.source.path());
            }
        }

        // Sort tracks by disc number and track number
        cluster_tracks.sort_by(|a, b| {
            let disc_a = a.metadata.disc_number.unwrap_or(1);
            let disc_b = b.metadata.disc_number.unwrap_or(1);
            if disc_a != disc_b {
                return disc_a.cmp(&disc_b);
            }
            let track_a = a.metadata.track_number.unwrap_or(0);
            let track_b = b.metadata.track_number.unwrap_or(0);
            track_a.cmp(&track_b)
        });

        let representative_track = cluster_tracks[0].clone();
        let album_title = representative_track
            .metadata
            .album
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Unknown Album")
            .to_string();

        let (artist_name, explicit_album_artist, is_compilation) =
            resolve_dominant_album_artist(&cluster_tracks, protected_artists);

        let mut total_duration_secs: u64 = 0;
        let mut album_year: Option<i32> = None;

        for t in &cluster_tracks {
            total_duration_secs += t.metadata.duration.as_secs();
            if album_year.is_none() && t.metadata.year.is_some() {
                album_year = t.metadata.year;
            }
        }

        let track_count = cluster_tracks.len();
        let total_duration = Duration::from_secs(total_duration_secs);
        let artwork_track_id = Some(representative_track.id);

        results.push(Album {
            title: album_title,
            artist: artist_name,
            album_artist: explicit_album_artist,
            is_compilation,
            year: album_year,
            artwork_track_id,
            tracks: cluster_tracks,
            track_count,
            total_duration,
            total_duration_secs,
        });
    }

    results.sort_by(|a, b| a.title.cmp(&b.title));
    results
}

/// Accumulator for building artist profiles.
struct ArtistEntry {
    name: String,
    own_albums: Vec<Album>,
    appears_on: Vec<Album>,
    track_map: HashMap<String, Track>,
}

/// Clusters tracks and albums into comprehensive artist profiles.
#[must_use]
pub fn group_tracks_by_artist(tracks: &[Track], protected_artists: &[String]) -> Vec<Artist> {
    let all_albums = group_tracks_by_album(tracks, protected_artists);
    let mut artist_map: HashMap<String, ArtistEntry> = HashMap::new();

    for album in &all_albums {
        if album.is_compilation || album.artist.to_lowercase() == "various artists" {
            for track in &album.tracks {
                let track_artist = track
                    .metadata
                    .artist
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("");

                if !track_artist.is_empty() && !is_roster_string(track_artist, protected_artists) {
                    let primary = extract_primary_artist(track_artist, protected_artists);
                    let trimmed = primary.trim();
                    if !trimmed.is_empty() && trimmed.to_lowercase() != "unknown artist" {
                        let key = trimmed.to_lowercase();
                        let entry = artist_map.entry(key).or_insert_with(|| ArtistEntry {
                            name: trimmed.to_string(),
                            own_albums: Vec::new(),
                            appears_on: Vec::new(),
                            track_map: HashMap::new(),
                        });
                        entry.track_map.insert(track.id.clone(), track.clone());
                        if !entry
                            .appears_on
                            .iter()
                            .any(|a| a.title == album.title && a.artist == album.artist)
                        {
                            entry.appears_on.push(album.clone());
                        }
                    }
                }
            }
            continue;
        }

        let primary_artists = split_artists(&album.artist, protected_artists);
        for p_artist in &primary_artists {
            let trimmed = p_artist.trim();
            if !trimmed.is_empty() && trimmed.to_lowercase() != "unknown artist" {
                let key = trimmed.to_lowercase();
                let entry = artist_map.entry(key).or_insert_with(|| ArtistEntry {
                    name: trimmed.to_string(),
                    own_albums: Vec::new(),
                    appears_on: Vec::new(),
                    track_map: HashMap::new(),
                });
                if !entry
                    .own_albums
                    .iter()
                    .any(|a| a.title == album.title && a.artist == album.artist)
                {
                    entry.own_albums.push(album.clone());
                }
                for track in &album.tracks {
                    entry.track_map.insert(track.id.clone(), track.clone());
                }
            }
        }

        // Process tracks with distinct collaborating or featured artists inside this album
        for track in &album.tracks {
            let track_artist = track
                .metadata
                .artist
                .as_deref()
                .map(str::trim)
                .unwrap_or("");

            if !track_artist.is_empty() && !is_roster_string(track_artist, protected_artists) {
                let t_artists = split_artists(track_artist, protected_artists);
                for ta in t_artists {
                    let ta_trimmed = ta.trim();
                    let ta_lower = ta_trimmed.to_lowercase();
                    if !primary_artists
                        .iter()
                        .any(|pa| pa.to_lowercase() == ta_lower)
                        && !ta_trimmed.is_empty()
                        && ta_lower != "unknown artist"
                    {
                        let entry = artist_map.entry(ta_lower).or_insert_with(|| ArtistEntry {
                            name: ta_trimmed.to_string(),
                            own_albums: Vec::new(),
                            appears_on: Vec::new(),
                            track_map: HashMap::new(),
                        });
                        entry.track_map.insert(track.id.clone(), track.clone());
                        if !entry
                            .own_albums
                            .iter()
                            .any(|a| a.title == album.title && a.artist == album.artist)
                            && !entry
                                .appears_on
                                .iter()
                                .any(|a| a.title == album.title && a.artist == album.artist)
                        {
                            entry.appears_on.push(album.clone());
                        }
                    }
                }
            }
        }
    }

    let mut artists = Vec::with_capacity(artist_map.len());
    for (_, entry) in artist_map {
        let track_list: Vec<Track> = entry.track_map.into_values().collect();
        if track_list.is_empty() && entry.own_albums.is_empty() && entry.appears_on.is_empty() {
            continue;
        }

        let artwork_track_id = track_list
            .first()
            .map(|t| t.id.clone())
            .or_else(|| entry.own_albums.first().and_then(|a| a.artwork_track_id.clone()));

        artists.push(Artist {
            name: entry.name,
            album_count: entry.own_albums.len(),
            track_count: track_list.len(),
            albums: entry.own_albums,
            appears_on: entry.appears_on,
            tracks: track_list,
            artwork_track_id,
        });
    }

    artists.sort_by_key(|a| a.name.to_lowercase());
    artists
}

/// Groups library tracks by normalized genre and sorts descending by popularity.
#[must_use]
pub fn extract_library_genres(
    tracks: &[Track],
    custom_mappings: Option<&HashMap<String, String>>,
) -> Vec<GenreInfo> {
    let mut genre_map: HashMap<String, (String, Vec<Track>, HashSet<String>)> = HashMap::new();

    for track in tracks {
        let raw_genre = match track.metadata.genre.as_deref() {
            Some(g) if !g.trim().is_empty() => g,
            _ => continue,
        };

        let genres = split_genres(raw_genre, custom_mappings);
        for g in genres {
            let key = g.to_lowercase();
            let entry = genre_map
                .entry(key)
                .or_insert_with(|| (g, Vec::new(), HashSet::new()));
            if entry.2.insert(track.id.clone()) {
                entry.1.push(track.clone());
            }
        }
    }

    let mut result: Vec<GenreInfo> = genre_map
        .into_values()
        .map(|(name, tracks, _)| {
            let track_count = tracks.len();
            GenreInfo {
                name,
                tracks,
                track_count,
            }
        })
        .collect();

    result.sort_by(|a, b| {
        if b.track_count != a.track_count {
            b.track_count.cmp(&a.track_count)
        } else {
            a.name.cmp(&b.name)
        }
    });

    result
}

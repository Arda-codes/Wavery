//! Tag heuristics, delimiter tokenization, protected artist registry, and multilingual genre normalization.
//!
//! Conforms strictly to zero driver dependencies in `crates/core`.

use crate::models::ArtistToken;
use std::collections::HashMap;

/// Curated list of iconic artist and band names containing punctuation
/// (commas, ampersands, slashes, exclamation points) as part of their atomic identity,
/// preventing them from mistakenly being split into separate artists.
pub static DEFAULT_PROTECTED_ARTISTS: &[&str] = &[
    "Crosby, Stills, Nash & Young",
    "Crosby, Stills, Nash and Young",
    "Crosby, Stills & Nash",
    "Crosby, Stills and Nash",
    "Earth, Wind & Fire",
    "Earth, Wind and Fire",
    "Blood, Sweat & Tears",
    "Blood, Sweat and Tears",
    "Emerson, Lake & Palmer",
    "Emerson, Lake and Palmer",
    "Peter, Paul and Mary",
    "Peter, Paul & Mary",
    "Tyler, The Creator",
    "Tom Petty and the Heartbreakers",
    "Tom Petty & The Heartbreakers",
    "Grandmaster Flash and the Furious Five",
    "Grandmaster Flash & the Furious Five",
    "Frankie Lymon & The Teenagers",
    "Frankie Lymon and the Teenagers",
    "King Gizzard & The Lizard Wizard",
    "King Gizzard and the Lizard Wizard",
    "Bob Marley & The Wailers",
    "Bob Marley and the Wailers",
    "Sly & The Family Stone",
    "Sly and the Family Stone",
    "Toots and the Maytals",
    "Toots & The Maytals",
    "Siouxsie and the Banshees",
    "Siouxsie & The Banshees",
    "Huey Lewis & The News",
    "Huey Lewis and the News",
    "KC and the Sunshine Band",
    "KC & The Sunshine Band",
    "The Mamas & The Papas",
    "The Mamas and the Papas",
    "Derek & The Dominos",
    "Derek and the Dominos",
    "Echo & The Bunnymen",
    "Echo and the Bunnymen",
    "Katrina and the Waves",
    "Katrina & The Waves",
    "Marina and the Diamonds",
    "Marina & The Diamonds",
    "Florence + The Machine",
    "Florence and the Machine",
    "Joan Jett & the Blackhearts",
    "Joan Jett and the Blackhearts",
    "Sun Ra and His Intergalactic Solar Arkestra",
    "Sun Ra and His Arkestra",
    "Tony! Toni! Toné!",
    "Tony! Toni! Tone!",
    "Simon & Garfunkel",
    "Captain & Tennille",
    "Captain and Tennille",
    "Hall & Oates",
    "Sunn O)))",
    "Panic! At The Disco",
    "!!! (Chk Chk Chk)",
    "$uicideboy$",
    "AC/DC",
];

/// Default multilingual and transliterated genre aliases mapped to their canonical display name.
pub static DEFAULT_GENRE_MAPPINGS: &[(&str, &str)] = &[
    // Russian / Cyrillic aliases
    ("альтернатива", "Alternative"),
    ("альтернативный", "Alternative"),
    ("альтернативный рок", "Alternative"),
    ("альтернативный метал", "Alternative"),
    ("рок", "Rock"),
    ("русский рок", "Rock"),
    ("классический рок", "Rock"),
    ("хард-рок", "Rock"),
    ("хард рок", "Rock"),
    ("поп", "Pop"),
    ("поп-музыка", "Pop"),
    ("русский поп", "Pop"),
    ("электроника", "Electronic"),
    ("электронная музыка", "Electronic"),
    ("электро", "Electronic"),
    ("дэнс", "Dance"),
    ("танцевальная", "Dance"),
    ("танцевальная музыка", "Dance"),
    ("хип-хоп", "Hip-Hop"),
    ("хип хоп", "Hip-Hop"),
    ("рэп", "Hip-Hop"),
    ("русский рэп", "Hip-Hop"),
    ("русский хип-хоп", "Hip-Hop"),
    ("метал", "Metal"),
    ("металл", "Metal"),
    ("хэви-метал", "Metal"),
    ("тяжелый рок", "Metal"),
    ("панк", "Punk"),
    ("панк-рок", "Punk"),
    ("джаз", "Jazz"),
    ("блюз", "Blues"),
    ("классика", "Classical"),
    ("классическая музыка", "Classical"),
    ("эмбиент", "Ambient"),
    ("эмбиэнт", "Ambient"),
    ("инди", "Indie"),
    ("инди-рок", "Indie"),
    ("инди-поп", "Indie"),
    ("саундтрек", "Soundtrack"),
    ("саундтреки", "Soundtrack"),
    ("музыка из фильмов", "Soundtrack"),
    ("легкая музыка", "Easy Listening"),
    ("легкое слушание", "Easy Listening"),
    ("фолк", "Folk"),
    ("фолк-рок", "Folk"),
    ("соул", "Soul"),
    ("фанк", "Funk"),
    ("регги", "Reggae"),
    ("диско", "Disco"),
    ("техно", "Techno"),
    ("хаус", "House"),
    ("транс", "Trance"),
    ("акустика", "Acoustic"),
    ("инструментал", "Instrumental"),
    ("инструментальная", "Instrumental"),
    ("нью-эйдж", "New Age"),
    // English aliases and normalizations
    ("alternative rock", "Alternative"),
    ("alt rock", "Alternative"),
    ("alt-rock", "Alternative"),
    ("alt. rock", "Alternative"),
    ("electro", "Electronic"),
    ("electronic music", "Electronic"),
    ("electronica", "Electronic"),
    ("dance music", "Dance"),
    ("club", "Dance"),
    ("hip hop", "Hip-Hop"),
    ("hip-hop", "Hip-Hop"),
    ("rap", "Hip-Hop"),
    ("heavy metal", "Metal"),
    ("hard rock", "Rock"),
    ("punk rock", "Punk"),
    ("r&b", "R&B"),
    ("r & b", "R&B"),
    ("rnb", "R&B"),
    ("synthpop", "Synth-Pop"),
    ("synth-pop", "Synth-Pop"),
    ("lo-fi", "Lo-Fi"),
    ("lofi", "Lo-Fi"),
    ("k-pop", "K-Pop"),
    ("kpop", "K-Pop"),
    ("j-pop", "J-Pop"),
    ("jpop", "J-Pop"),
    ("edm", "EDM"),
    ("drum and bass", "Drum & Bass"),
    ("drum & bass", "Drum & Bass"),
    ("dnb", "Drum & Bass"),
    ("soundtrack", "Soundtrack"),
    ("ost", "Soundtrack"),
    ("score", "Soundtrack"),
    ("chillout", "Chillout"),
    ("chill-out", "Chillout"),
    ("chill", "Chillout"),
];

/// Returns true if a character is one of the recognized punctuation delimiters.
#[inline]
fn is_delimiter_char(c: char) -> bool {
    c == ';' || c == '/' || c == ',' || c == '&' || c == '|'
}

/// Returns true if a string consists entirely of whitespace and delimiter characters.
#[inline]
fn is_pure_delimiter_string(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_whitespace() || is_delimiter_char(c))
}

/// Case-insensitively checks if `haystack` starts with `needle_lower`.
/// `needle_lower` must already be lowercased (`needle.to_lowercase()`).
///
/// Returns `Some(matched_bytes_in_haystack)` on match, where `matched_bytes_in_haystack`
/// is the exact number of bytes in `haystack` consumed by the match.
#[inline]
fn match_prefix_ci(haystack: &str, needle_lower: &str) -> Option<usize> {
    if needle_lower.is_empty() {
        return Some(0);
    }
    if haystack.is_empty() {
        return None;
    }

    let mut needle_chars = needle_lower.chars();
    let mut haystack_bytes_consumed = 0;

    for (byte_offset, h_char) in haystack.char_indices() {
        for hl_char in h_char.to_lowercase() {
            match needle_chars.next() {
                Some(nc) if nc == hl_char => {}
                _ => return None,
            }
        }
        haystack_bytes_consumed = byte_offset + h_char.len_utf8();
        if needle_chars.as_str().is_empty() {
            return Some(haystack_bytes_consumed);
        }
    }

    if needle_chars.as_str().is_empty() {
        Some(haystack_bytes_consumed)
    } else {
        None
    }
}

/// Finds the next case-insensitive occurrence of `needle_lower` in `haystack`
/// starting from byte index `search_from`.
///
/// Returns `Some((match_start, match_end))` where both indices are guaranteed
/// to be valid UTF-8 character boundaries in `haystack`.
#[inline]
fn find_case_insensitive(
    haystack: &str,
    needle_lower: &str,
    search_from: usize,
) -> Option<(usize, usize)> {
    if search_from >= haystack.len() || needle_lower.is_empty() {
        return None;
    }

    let first_needle_char = needle_lower.chars().next()?;
    let slice = &haystack[search_from..];

    for (rel_byte_offset, c) in slice.char_indices() {
        let mut c_lower = c.to_lowercase();
        if c_lower.next() == Some(first_needle_char) {
            let abs_start = search_from + rel_byte_offset;
            if let Some(matched_len) = match_prefix_ci(&haystack[abs_start..], needle_lower) {
                return Some((abs_start, abs_start + matched_len));
            }
        }
    }

    None
}

/// Quick delimiter check matching punctuation and collaboration keywords.
fn has_delimiter(s: &str) -> bool {
    if s.contains(',') || s.contains(';') || s.contains('&') || s.contains('|') {
        return true;
    }

    // A slash is only considered a delimiter if it has whitespace or the string has no alphanumerics
    if s.contains('/') {
        let chars: Vec<char> = s.chars().collect();
        let has_alphanumeric = chars.iter().any(|c| c.is_alphanumeric());
        for (idx, &c) in chars.iter().enumerate() {
            if c == '/' {
                let space_before = idx > 0 && chars[idx - 1].is_whitespace();
                let space_after = idx + 1 < chars.len() && chars[idx + 1].is_whitespace();
                if space_before || space_after || !has_alphanumeric {
                    return true;
                }
            }
        }
    }

    // Check featuring keywords surrounded by word boundary
    let keywords = ["feat", "ft.", "ft", "featuring", "with", "vs.", "vs"];
    for kw in &keywords {
        let mut search_from = 0;
        while let Some((match_start, match_end)) = find_case_insensitive(s, kw, search_from) {
            let before_ok = if match_start == 0 {
                true
            } else {
                let prev_char = s[..match_start].chars().next_back();
                prev_char.is_none_or(|c| !c.is_alphanumeric())
            };

            let after_ok = if match_end >= s.len() {
                true
            } else {
                let next_char = s[match_end..].chars().next();
                next_char.is_none_or(|c| !c.is_alphanumeric())
            };

            if before_ok && after_ok {
                return true;
            }
            let next_char_len = s[match_start..]
                .chars()
                .next()
                .map_or(1, |c| c.len_utf8());
            search_from = match_start + next_char_len;
        }
    }

    false
}


/// Masks protected artist names with unique placeholders in a case-insensitive, UTF-8 safe manner.
fn mask_protected_artists(
    raw: &str,
    protected_artists: &[String],
) -> (String, Vec<(String, String)>) {
    let mut candidates: Vec<String> = Vec::new();
    let mut seen_lower = std::collections::HashSet::new();

    for pa in protected_artists {
        let trimmed = pa.trim();
        if !trimmed.is_empty() && seen_lower.insert(trimmed.to_lowercase()) {
            candidates.push(trimmed.to_string());
        }
    }
    for &pa in DEFAULT_PROTECTED_ARTISTS {
        let trimmed = pa.trim();
        if !trimmed.is_empty() && seen_lower.insert(trimmed.to_lowercase()) {
            candidates.push(trimmed.to_string());
        }
    }

    // Sort descending by length so longer composite names match first
    candidates.sort_by_key(|a| std::cmp::Reverse(a.len()));

    let mut working = raw.to_string();
    let mut token_map = Vec::new();
    let mut counter = 0;

    for candidate in &candidates {
        let cand_lower = candidate.to_lowercase();
        let mut search_from = 0;

        while let Some((match_start, match_end)) =
            find_case_insensitive(&working, &cand_lower, search_from)
        {
            // Word boundary check: character before and character after must not be alphanumeric
            let before_ok = if match_start == 0 {
                true
            } else {
                let prev_char = working[..match_start].chars().next_back();
                prev_char.is_none_or(|c| !c.is_alphanumeric())
            };

            let after_ok = if match_end >= working.len() {
                true
            } else {
                let next_char = working[match_end..].chars().next();
                next_char.is_none_or(|c| !c.is_alphanumeric())
            };

            if before_ok && after_ok {
                let matched_original = working[match_start..match_end].to_string();
                let placeholder = format!("\u{1F}__PROT_{counter}__\u{1F}");
                counter += 1;

                working.replace_range(match_start..match_end, &placeholder);
                token_map.push((placeholder.clone(), matched_original));
                search_from = match_start + placeholder.len();
            } else {
                // Safely advance past the character at match_start using its UTF-8 byte length
                let next_char_len = working[match_start..]
                    .chars()
                    .next()
                    .map_or(1, |c| c.len_utf8());
                search_from = match_start + next_char_len;
            }
        }
    }

    (working, token_map)
}

/// Unmasks protected artist placeholders back to their original strings.
fn unmask_protected_artists(text: &str, token_map: &[(String, String)]) -> String {
    let mut result = text.to_string();
    for (placeholder, original) in token_map {
        result = result.replace(placeholder, original);
    }
    result
}

/// Splits multi-artist collaboration strings into individual unique artist names
/// while preserving protected atomic names (e.g. "Tyler, The Creator", "AC/DC").
#[must_use]
pub fn split_artists(raw: &str, protected_artists: &[String]) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || is_pure_delimiter_string(trimmed) {
        return vec!["Unknown Artist".to_string()];
    }

    if !has_delimiter(trimmed) {
        return vec![trimmed.to_string()];
    }

    let (protected_text, token_map) = mask_protected_artists(trimmed, protected_artists);

    // If protected text reduces entirely to delimiters and no protected names were masked
    if token_map.is_empty() && is_pure_delimiter_string(&protected_text) {
        return vec!["Unknown Artist".to_string()];
    }

    let chars: Vec<char> = protected_text.chars().collect();
    let has_alphanumeric = chars.iter().any(|c| c.is_alphanumeric());
    let mut normalized = String::with_capacity(protected_text.len() + 16);
    let mut idx = 0;

    while idx < chars.len() {
        let ch = chars[idx];

        // Semicolons and pipes: always delimiters
        if ch == ';' || ch == '|' {
            normalized.push_str(" & ");
            idx += 1;
            while idx < chars.len() && (chars[idx] == ';' || chars[idx] == '|' || chars[idx].is_whitespace()) {
                idx += 1;
            }
            continue;
        }

        // Commas: delimiters unless sandwiched strictly between two digits (e.g. 10,000)
        if ch == ',' {
            let is_digit_sandwich = idx > 0
                && chars[idx - 1].is_ascii_digit()
                && idx + 1 < chars.len()
                && chars[idx + 1].is_ascii_digit();

            if is_digit_sandwich {
                normalized.push(ch);
                idx += 1;
            } else {
                normalized.push_str(" & ");
                idx += 1;
                while idx < chars.len() && chars[idx].is_whitespace() {
                    idx += 1;
                }
            }
            continue;
        }

        // Slashes: delimiter ONLY IF bordered by whitespace or the string is non-alphanumeric
        if ch == '/' {
            let slash_start = idx;
            while idx < chars.len() && chars[idx] == '/' {
                idx += 1;
            }
            let slash_end = idx;

            let space_before = slash_start > 0 && chars[slash_start - 1].is_whitespace();
            let space_after = slash_end < chars.len() && chars[slash_end].is_whitespace();

            if space_before || space_after || !has_alphanumeric {
                normalized.push_str(" & ");
                while idx < chars.len() && chars[idx].is_whitespace() {
                    idx += 1;
                }
            } else {
                for &sc in &chars[slash_start..slash_end] {
                    normalized.push(sc);
                }
            }
            continue;
        }

        // Featuring keywords when preceded by whitespace or at start
        let is_word_boundary_start = idx == 0 || chars[idx - 1].is_whitespace();
        if is_word_boundary_start {
            let remaining_slice: String = chars[idx..].iter().collect();
            let remaining_lower = remaining_slice.to_lowercase();

            let keywords = [
                ("featuring", 9),
                ("feat.", 5),
                ("feat", 4),
                ("ft.", 3),
                ("ft", 2),
                ("with", 4),
                ("vs.", 3),
                ("vs", 2),
            ];

            let mut matched_kw_len = 0;
            for (kw, len) in keywords {
                if remaining_lower.starts_with(kw) {
                    let end_idx = idx + len;
                    let is_word_boundary_end = end_idx >= chars.len() || chars[end_idx].is_whitespace();
                    if is_word_boundary_end {
                        matched_kw_len = len;
                        break;
                    }
                }
            }

            if matched_kw_len > 0 {
                normalized.push_str(" & ");
                idx += matched_kw_len;
                while idx < chars.len() && chars[idx].is_whitespace() {
                    idx += 1;
                }
                continue;
            }
        }

        normalized.push(ch);
        idx += 1;
    }

    let raw_parts = normalized.split('&');
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for part in raw_parts {
        let unmasked = unmask_protected_artists(part, &token_map);
        let trimmed_part = unmasked.trim();
        // Skip empty parts and parts that reduce strictly to delimiter punctuation
        if !trimmed_part.is_empty() && !is_pure_delimiter_string(trimmed_part) {
            let lower = trimmed_part.to_lowercase();
            if seen.insert(lower) {
                result.push(trimmed_part.to_string());
            }
        }
    }

    if result.is_empty() {
        vec!["Unknown Artist".to_string()]
    } else {
        result
    }
}

/// Extracts primary artist name by stripping featured/collaborating artist suffixes.
#[must_use]
pub fn extract_primary_artist(raw: &str, protected_artists: &[String]) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "Unknown Artist".to_string();
    }
    if !has_delimiter(trimmed) {
        return trimmed.to_string();
    }
    let split = split_artists(trimmed, protected_artists);
    split.into_iter().next().unwrap_or_else(|| trimmed.to_string())
}

/// Parses raw artist string into interactive artist name tokens and connective delimiters.
#[must_use]
pub fn parse_artist_tokens(raw: &str, protected_artists: &[String]) -> Vec<ArtistToken> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || is_pure_delimiter_string(trimmed) {
        return vec![ArtistToken {
            text: "Unknown Artist".to_string(),
            is_artist: true,
        }];
    }
    if !has_delimiter(trimmed) {
        return vec![ArtistToken {
            text: trimmed.to_string(),
            is_artist: true,
        }];
    }

    let (protected_text, token_map) = mask_protected_artists(trimmed, protected_artists);

    let mut tokens = Vec::new();
    let chars: Vec<char> = protected_text.chars().collect();
    let has_alphanumeric = chars.iter().any(|c| c.is_alphanumeric());
    let mut current_artist = String::new();
    let mut idx = 0;

    while idx < chars.len() {
        let ch = chars[idx];

        // Semicolons, pipes, and ampersands
        if ch == ';' || ch == '|' || ch == '&' {
            if !current_artist.trim().is_empty() {
                tokens.push(ArtistToken {
                    text: unmask_protected_artists(current_artist.trim(), &token_map),
                    is_artist: true,
                });
                current_artist.clear();
            }

            let mut delim_str = String::new();
            while idx < chars.len() && (chars[idx].is_whitespace() || chars[idx] == ch) {
                delim_str.push(chars[idx]);
                idx += 1;
            }
            tokens.push(ArtistToken {
                text: unmask_protected_artists(&delim_str, &token_map),
                is_artist: false,
            });
            continue;
        }

        // Commas
        if ch == ',' {
            let is_digit_sandwich = idx > 0
                && chars[idx - 1].is_ascii_digit()
                && idx + 1 < chars.len()
                && chars[idx + 1].is_ascii_digit();

            if is_digit_sandwich {
                current_artist.push(ch);
                idx += 1;
            } else {
                if !current_artist.trim().is_empty() {
                    tokens.push(ArtistToken {
                        text: unmask_protected_artists(current_artist.trim(), &token_map),
                        is_artist: true,
                    });
                    current_artist.clear();
                }

                let mut delim_str = String::new();
                while idx < chars.len() && (chars[idx].is_whitespace() || chars[idx] == ',') {
                    delim_str.push(chars[idx]);
                    idx += 1;
                }
                tokens.push(ArtistToken {
                    text: unmask_protected_artists(&delim_str, &token_map),
                    is_artist: false,
                });
            }
            continue;
        }

        // Slashes: check whitespace boundaries
        if ch == '/' {
            let slash_start = idx;
            while idx < chars.len() && chars[idx] == '/' {
                idx += 1;
            }
            let slash_end = idx;

            let space_before = slash_start > 0 && chars[slash_start - 1].is_whitespace();
            let space_after = slash_end < chars.len() && chars[slash_end].is_whitespace();

            if space_before || space_after || !has_alphanumeric {
                if !current_artist.trim().is_empty() {
                    tokens.push(ArtistToken {
                        text: unmask_protected_artists(current_artist.trim(), &token_map),
                        is_artist: true,
                    });
                    current_artist.clear();
                }

                let mut delim_str: String = chars[slash_start..slash_end].iter().collect();
                while idx < chars.len() && chars[idx].is_whitespace() {
                    delim_str.push(chars[idx]);
                    idx += 1;
                }
                tokens.push(ArtistToken {
                    text: unmask_protected_artists(&delim_str, &token_map),
                    is_artist: false,
                });
            } else {
                for &sc in &chars[slash_start..slash_end] {
                    current_artist.push(sc);
                }
            }
            continue;
        }

        // Featuring keywords
        if ch.is_whitespace() {
            let remaining_slice: String = chars[idx..].iter().collect();
            let remaining_lower = remaining_slice.to_lowercase();
            let trimmed_remaining = remaining_lower.trim_start();
            let leading_spaces = remaining_lower.len() - trimmed_remaining.len();

            let keywords = [
                ("featuring", 9),
                ("feat.", 5),
                ("feat", 4),
                ("ft.", 3),
                ("ft", 2),
                ("with", 4),
                ("vs.", 3),
                ("vs", 2),
            ];

            let mut matched_len = 0;
            for (kw, len) in keywords {
                if trimmed_remaining.starts_with(kw) {
                    let end_pos = leading_spaces + len;
                    let is_boundary = end_pos >= chars[idx..].len()
                        || chars[idx + end_pos].is_whitespace()
                        || chars[idx + end_pos] == ','
                        || chars[idx + end_pos] == ';';
                    if is_boundary {
                        matched_len = end_pos;
                        break;
                    }
                }
            }

            if matched_len > 0 {
                if !current_artist.trim().is_empty() {
                    tokens.push(ArtistToken {
                        text: unmask_protected_artists(current_artist.trim(), &token_map),
                        is_artist: true,
                    });
                    current_artist.clear();
                }

                let mut delim_token: String = chars[idx..idx + matched_len].iter().collect();
                idx += matched_len;
                while idx < chars.len() && chars[idx].is_whitespace() {
                    delim_token.push(chars[idx]);
                    idx += 1;
                }
                tokens.push(ArtistToken {
                    text: unmask_protected_artists(&delim_token, &token_map),
                    is_artist: false,
                });
                continue;
            }
        }

        current_artist.push(ch);
        idx += 1;
    }

    if !current_artist.trim().is_empty() {
        tokens.push(ArtistToken {
            text: unmask_protected_artists(current_artist.trim(), &token_map),
            is_artist: true,
        });
    }

    // Filter out delimiter-only tokens masquerading as artists
    let has_any_real_artist = tokens.iter().any(|t| t.is_artist && !is_pure_delimiter_string(&t.text));
    if !has_any_real_artist {
        vec![ArtistToken {
            text: "Unknown Artist".to_string(),
            is_artist: true,
        }]
    } else {
        tokens
    }
}

/// Determines whether a string represents a composite composer or orchestra member roster.
#[must_use]
pub fn is_roster_string(s: &str, protected_artists: &[String]) -> bool {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_lowercase();
    for pa in protected_artists {
        if pa.trim().to_lowercase() == lower {
            return false;
        }
    }
    for &pa in DEFAULT_PROTECTED_ARTISTS {
        if pa.to_lowercase() == lower {
            return false;
        }
    }
    split_artists(trimmed, protected_artists).len() >= 3
}

/// Extracts featured artists from title clauses like `"(feat. Artist B & Artist C)"`.
#[must_use]
pub fn extract_featured_artists_from_title(title: &str, protected_artists: &[String]) -> Vec<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let keywords = ["feat.", "feat", "ft.", "ft", "featuring", "with"];

    for kw in &keywords {
        let kw_lower = kw.to_lowercase();
        let mut search_from = 0;
        while let Some((match_start, match_end)) = find_case_insensitive(trimmed, &kw_lower, search_from) {
            // Must be preceded by '(', '[', '{', or '-'
            let prefix = trimmed[..match_start].trim_end();
            let is_prefixed = prefix.ends_with('(')
                || prefix.ends_with('[')
                || prefix.ends_with('{')
                || prefix.ends_with('-');

            if is_prefixed {
                let rest = trimmed[match_end..].trim_start();
                // Find closing delimiter if present
                let closing_idx = rest.find([')', ']', '}']);
                let captured = match closing_idx {
                    Some(idx) => &rest[..idx],
                    None => rest,
                };
                let result = split_artists(captured, protected_artists);
                if !result.is_empty() {
                    return result;
                }
            }
            let next_char_len = trimmed[match_start..]
                .chars()
                .next()
                .map_or(1, |c| c.len_utf8());
            search_from = match_start + next_char_len;
        }
    }

    Vec::new()
}

/// Converts a string to Title Case across whitespace and hyphen delimiters.
fn title_case(s: &str) -> String {
    let mut result = Vec::new();
    for word in s.split_whitespace() {
        if word.contains('-') {
            let hyphenated: Vec<String> = word
                .split('-')
                .map(|part| {
                    let mut chars = part.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
                    }
                })
                .collect();
            result.push(hyphenated.join("-"));
        } else {
            let mut chars = word.chars();
            let capitalized = match chars.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
            };
            result.push(capitalized);
        }
    }
    result.join(" ")
}

/// Normalizes multilingual and Cyrillic genre tags using dictionary rules and prefix heuristics.
#[must_use]
pub fn normalize_genre(raw: &str, custom_mappings: Option<&HashMap<String, String>>) -> String {
    let mut clean = raw.trim();
    // Strip trailing ellipsis, dots, or dashes from tag truncation
    while let Some(last) = clean.chars().next_back() {
        if last.is_whitespace() || last == '.' || last == '…' || last == '-' {
            clean = &clean[..clean.len() - last.len_utf8()];
        } else {
            break;
        }
    }
    let clean = clean.trim();
    if clean.is_empty() {
        return String::new();
    }

    let lower = clean.to_lowercase();

    // 1. Configurable user mappings lookup
    if let Some(mappings) = custom_mappings {
        if let Some(val) = mappings.get(&lower) {
            return val.clone();
        }
    }

    // 2. Default dictionary mappings lookup
    for &(alias, canonical) in DEFAULT_GENRE_MAPPINGS {
        if alias == lower {
            return canonical.to_string();
        }
    }

    // 3. Prefix matching for truncated Cyrillic/English tags
    if lower.starts_with("альтернатив") || lower.starts_with("alternat") {
        return "Alternative".to_string();
    }
    if lower.starts_with("электрон") || lower.starts_with("electron") {
        return "Electronic".to_string();
    }
    if lower.starts_with("классич") || lower.starts_with("classic") {
        return "Classical".to_string();
    }
    if lower.starts_with("инструмент") || lower.starts_with("instrument") {
        return "Instrumental".to_string();
    }

    // 4. Fallback: Clean Title-Casing
    title_case(clean)
}

/// Splits compound genre strings (e.g. "Alternative / Rock & Pop") while protecting
/// compound terms like "R&B" and "Drum & Bass".
#[must_use]
pub fn split_genres(raw_genre: &str, custom_mappings: Option<&HashMap<String, String>>) -> Vec<String> {
    let trimmed = raw_genre.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    // Protect "R&B", "Drum & Bass", "Rock & Roll"
    let mut masked = trimmed.to_string();
    let protected_terms = [
        ("r & b", "__R_AND_B__"),
        ("r&b", "__R_AND_B__"),
        ("rnb", "__R_AND_B__"),
        ("drum and bass", "__D_AND_B__"),
        ("drum & bass", "__D_AND_B__"),
        ("dnb", "__D_AND_B__"),
        ("rock and roll", "__ROCK_AND_ROLL__"),
        ("rock & roll", "__ROCK_AND_ROLL__"),
    ];

    for (term, placeholder) in protected_terms {
        let term_lower = term.to_lowercase();
        let mut search_from = 0;
        while let Some((match_start, match_end)) =
            find_case_insensitive(&masked, &term_lower, search_from)
        {
            // Word boundary check
            let before_ok = if match_start == 0 {
                true
            } else {
                let prev_char = masked[..match_start].chars().next_back();
                prev_char.is_none_or(|c| !c.is_alphanumeric())
            };

            let after_ok = if match_end >= masked.len() {
                true
            } else {
                let next_char = masked[match_end..].chars().next();
                next_char.is_none_or(|c| !c.is_alphanumeric())
            };

            if before_ok && after_ok {
                masked.replace_range(match_start..match_end, placeholder);
                search_from = match_start + placeholder.len();
            } else {
                let next_char_len = masked[match_start..]
                    .chars()
                    .next()
                    .map_or(1, |c| c.len_utf8());
                search_from = match_start + next_char_len;
            }
        }
    }

    // Split by [,/;&|]
    let parts = masked.split([',', '/', ';', '|', '&']);
    let mut results = Vec::new();

    for p in parts {
        let mut unmasked = p.to_string();
        unmasked = unmasked.replace("__R_AND_B__", "R&B");
        unmasked = unmasked.replace("__D_AND_B__", "Drum & Bass");
        unmasked = unmasked.replace("__ROCK_AND_ROLL__", "Rock & Roll");

        let normalized = normalize_genre(&unmasked, custom_mappings);
        if !normalized.is_empty() && !results.contains(&normalized) {
            results.push(normalized);
        }
    }

    results
}

//! Adversarial Empirical Challenger Suite 3 for Milestone M1
//!
//! Specifically validates:
//! 1. Pathological Unicode cases across Turkish (`İ`, `ı`), German (`ẞ`, `ß`), Cyrillic, and emoji.
//! 2. Extreme delimiter strings and boundary ratios.
//! 3. Multi-disc hierarchies with different folder naming conventions (`Disc 1`, `CD 02`, `Vol. 3`, `Side A`, etc.).
//! 4. Mathematical compilation detection dominance thresholds and explicit tag overrides.

use std::path::{Path, PathBuf};
use std::time::Duration;
use wavery_core::heuristics::{
    extract_featured_artists_from_title, extract_primary_artist,
    normalize_genre, parse_artist_tokens, split_artists, split_genres,
};
use wavery_core::models::{Track, TrackMetadata, TrackSource};
use wavery_library::clustering::{
    get_album_parent_dir, group_tracks_by_album, group_tracks_by_artist, is_compilation_artist,
    is_disc_folder, parse_disc_number,
};

#[allow(clippy::too_many_arguments)]
fn make_test_track(
    id: &str,
    path: &str,
    title: &str,
    artist: &str,
    album: &str,
    album_artist: Option<&str>,
    track_num: Option<u32>,
    disc_num: Option<u32>,
    duration_secs: u64,
) -> Track {
    Track {
        id: id.to_string(),
        source: TrackSource::Managed(PathBuf::from(path)),
        metadata: TrackMetadata {
            title: Some(title.to_string()),
            artist: Some(artist.to_string()),
            album: Some(album.to_string()),
            album_artist: album_artist.map(str::to_string),
            track_number: track_num,
            disc_number: disc_num,
            year: Some(2024),
            duration: Duration::from_secs(duration_secs),
            ..Default::default()
        },
        date_added: 1700000000,
    }
}

// =========================================================================
// 1. PATHOLOGICAL UNICODE CASES
// =========================================================================

#[test]
fn test_pathological_unicode_turkish_dotted_and_dotless_i() {
    // Turkish uppercase dotted 'İ' (\u{0130}) and lowercase dotless 'ı' (\u{0131})
    let custom = vec!["İpek Yolu".to_string(), "İlhan Erşahin".to_string()];

    // Test 1: Protected artist starting with 'İ'
    let res = split_artists("Tribute to İpek Yolu, İlhan Erşahin & AC/DC", &custom);
    assert_eq!(
        res,
        vec!["Tribute to İpek Yolu", "İlhan Erşahin", "AC/DC"]
    );

    // Test 2: Case folding search when needle has 'İ'
    let tokens = parse_artist_tokens("İlhan Erşahin feat. İpek Yolu", &custom);
    assert_eq!(tokens.len(), 3);
    assert_eq!(tokens[0].text, "İlhan Erşahin");
    assert!(tokens[0].is_artist);
    assert_eq!(tokens[2].text, "İpek Yolu");
    assert!(tokens[2].is_artist);

    // Test 3: Dotless 'ı' in artist strings
    let res_dotless = split_artists("Barış Manço & Erkin Koray", &[]);
    assert_eq!(res_dotless, vec!["Barış Manço", "Erkin Koray"]);

    // Test 4: Mixed 'İ' and 'ı' alongside delimiters
    let mixed = "İ / Barış Manço ; İlhan Erşahin & İpek Yolu";
    let split_mixed = split_artists(mixed, &custom);
    assert_eq!(
        split_mixed,
        vec!["İ", "Barış Manço", "İlhan Erşahin", "İpek Yolu"]
    );
}

#[test]
fn test_pathological_unicode_german_sharp_s() {
    // German capital sharp 'ẞ' (\u{1E9E}) and lowercase 'ß' (\u{00DF})
    let custom = vec!["Die Ärzte".to_string(), "Weiß & Blau".to_string()];

    let res = split_artists("Die Ärzte & Weiß & Blau / Rammstein", &custom);
    assert_eq!(res, vec!["Die Ärzte", "Weiß & Blau", "Rammstein"]);

    // Test uppercase ẞ in input
    let res_upper = split_artists("WEIẞ & BLAU feat. Die Ärzte", &custom);
    assert_eq!(res_upper.len(), 2);

    // Test isolated ẞ
    assert_eq!(split_artists("ẞ", &[]), vec!["ẞ"]);
    assert_eq!(split_artists("ß", &[]), vec!["ß"]);
}

#[test]
fn test_pathological_unicode_cyrillic_complex() {
    // Russian, Ukrainian, and Serbian Cyrillic characters
    let custom = vec!["БИ-2".to_string(), "Океан Ельзи".to_string()];

    let input = "БИ-2 & Океан Ельзи feat. Земфира / Мумий Тролль ; Кино";
    let split = split_artists(input, &custom);
    assert_eq!(
        split,
        vec![
            "БИ-2",
            "Океан Ельзи",
            "Земфира",
            "Мумий Тролль",
            "Кино"
        ]
    );

    // Word boundary with Cyrillic prefixes (must not split "НеБИ-2")
    let boundary_test = split_artists("НеБИ-2 & БИ-2", &custom);
    assert_eq!(boundary_test, vec!["НеБИ-2", "БИ-2"]);

    // Cyrillic genre normalization
    assert_eq!(normalize_genre("русский рок", None), "Rock");
    assert_eq!(normalize_genre("ХАРД-РОК", None), "Rock");
    assert_eq!(normalize_genre("электроника...", None), "Electronic");
}

#[test]
fn test_pathological_unicode_emoji_and_zwj_sequences() {
    // Complex compound emojis (ZWJ sequences, skin tones, flags)
    let custom = vec!["✨ Sparkle Band ✨".to_string(), "👨‍🎤 Rock Star".to_string()];

    let emoji_input = "✨ Sparkle Band ✨ & 👨‍🎤 Rock Star / 👩‍🎤 Pop Queen, 🇺🇸 Flag Hero";
    let split = split_artists(emoji_input, &custom);
    assert_eq!(
        split,
        vec![
            "✨ Sparkle Band ✨",
            "👨‍🎤 Rock Star",
            "👩‍🎤 Pop Queen",
            "🇺🇸 Flag Hero"
        ]
    );

    // Pure emojis with delimiters
    let pure_emoji = "🔥🔥🔥 / ⚡⚡⚡ & 🎵🎵🎵";
    let split_pure = split_artists(pure_emoji, &[]);
    assert_eq!(split_pure, vec!["🔥🔥🔥", "⚡⚡⚡", "🎵🎵🎵"]);

    // Emojis in genre tags
    let genre_emoji = "🔥 Synthwave ⚡ / 🎸 Rock";
    let split_genre = split_genres(genre_emoji, None);
    assert_eq!(split_genre.len(), 2);
}

// =========================================================================
// 2. EXTREME DELIMITER STRINGS
// =========================================================================

#[test]
fn test_extreme_delimiter_strings_matrix() {
    // 1. Strings consisting purely of delimiter punctuation must fall back cleanly
    let pure_delims = [
        ";,/,&&,",
        ";;;;;;;",
        ",,,,,,,",
        "///////",
        "&&&&&&&",
        "|||||||",
        ", ; / & | / ; ,",
        "\t;\n/\r&\t",
        " / / ,,, ;;; &&& ||| ",
        "  ;;;  ///  ,,,  |||  &&&  ",
    ];

    for d in pure_delims {
        let artists = split_artists(d, &[]);
        assert_eq!(
            artists,
            vec!["Unknown Artist"],
            "Pure delimiter string '{d}' must normalize to 'Unknown Artist'"
        );

        let primary = extract_primary_artist(d, &[]);
        assert_eq!(
            primary, "Unknown Artist",
            "Primary artist for pure delimiter '{d}' must be 'Unknown Artist'"
        );

        let tokens = parse_artist_tokens(d, &[]);
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].text, "Unknown Artist");
        assert!(tokens[0].is_artist);
    }

    // 2. Delimiters with whitespace, leading, trailing, and repeated
    let messy = "  &  Artist A  ; ; ;  Artist B  / / /  Artist C  |  ";
    let split_messy = split_artists(messy, &[]);
    assert_eq!(split_messy, vec!["Artist A", "Artist B", "Artist C"]);

    // 3. Digit sandwiches must NOT be split
    let digit_sandwich = "10,000 Maniacs feat. Blink-182";
    let split_digits = split_artists(digit_sandwich, &[]);
    assert_eq!(split_digits, vec!["10,000 Maniacs", "Blink-182"]);

    // 4. Unspaced slashes vs spaced slashes
    assert_eq!(split_artists("NotAC/DC", &[]), vec!["NotAC/DC"]);
    assert_eq!(split_artists("TCP/IP", &[]), vec!["TCP/IP"]);
    assert_eq!(split_artists("OS/2 & DOS", &[]), vec!["OS/2", "DOS"]);
    assert_eq!(split_artists("AC/DC", &[]), vec!["AC/DC"]);
    assert_eq!(
        split_artists("Band A / Band B", &[]),
        vec!["Band A", "Band B"]
    );

    // 5. Featured title extraction with extreme brackets
    let feat1 = extract_featured_artists_from_title("Track Title (feat. Artist B & Artist C)", &[]);
    assert_eq!(feat1, vec!["Artist B", "Artist C"]);

    let feat2 = extract_featured_artists_from_title("Track Title [with Artist D]", &[]);
    assert_eq!(feat2, vec!["Artist D"]);

    let feat3 = extract_featured_artists_from_title("Track Title - feat. Artist E", &[]);
    assert_eq!(feat3, vec!["Artist E"]);

    let feat_empty = extract_featured_artists_from_title("Regular Track Title", &[]);
    assert!(feat_empty.is_empty());
}

#[test]
fn test_track_number_prefix_with_unicode_case_shift_vulnerabilities() {
    use wavery_library::heuristics::extract_artist_from_path;

    // Vulnerability: Runtime Panic when case contraction shifts offset into middle of multi-byte UTF-8 character
    // In "/Music/Downloads/Track 01 ЖWEIẞ - Song.flac", the German 'ẞ' contracts from 3 bytes to 2 bytes ("ss")
    // under to_lowercase(). Line 45 in crates/library/src/heuristics.rs computes:
    // `let offset = s.len() - after_punct.len();`
    // which results in offset = 17 - 7 = 10.
    // In `s`, byte 10 is inside Cyrillic 'Ж' (bytes 9..11), triggering a thread panic:
    // `start byte index 10 is not a char boundary; it is inside 'Ж'`
    let p_panic = Path::new("/Music/Downloads/Track 01 ЖWEIẞ - Song.flac");
    let artist = extract_artist_from_path(p_panic, None);
    assert_eq!(artist, Some("ЖWEIẞ".to_string()));
}

// =========================================================================
// 3. MULTI-DISC HIERARCHIES WITH DIFFERENT FOLDER CONVENTIONS
// =========================================================================

#[test]
fn test_multi_disc_folder_naming_conventions() {
    // 1. Standard "Disc 1", "Disc 2", "Disc 01", "DISC 10"
    assert_eq!(parse_disc_number("Disc 1"), Some(1));
    assert_eq!(parse_disc_number("disc 2"), Some(2));
    assert_eq!(parse_disc_number("DISC 03"), Some(3));
    assert_eq!(parse_disc_number("Disc 10"), Some(10));
    assert_eq!(parse_disc_number("Disc-1"), Some(1));
    assert_eq!(parse_disc_number("Disc_2"), Some(2));
    assert_eq!(parse_disc_number("Disc#1"), Some(1));

    // 2. "CD 02", "CD1", "cd 2", "CD-03"
    assert_eq!(parse_disc_number("CD 02"), Some(2));
    assert_eq!(parse_disc_number("CD1"), Some(1));
    assert_eq!(parse_disc_number("cd 2"), Some(2));
    assert_eq!(parse_disc_number("CD-03"), Some(3));
    assert_eq!(parse_disc_number("CD_4"), Some(4));

    // 3. "Vol. 3", "Vol 1", "Volume 2", "Vol-04"
    assert_eq!(parse_disc_number("Vol. 3"), Some(3));
    assert_eq!(parse_disc_number("Vol 1"), Some(1));
    assert_eq!(parse_disc_number("volume 2"), Some(2));
    assert_eq!(parse_disc_number("Volume 04"), Some(4));
    assert_eq!(parse_disc_number("Vol-2"), Some(2));

    // 4. "Disk 1", "Part 1", "pt. 2"
    assert_eq!(parse_disc_number("Disk 1"), Some(1));
    assert_eq!(parse_disc_number("disk 2"), Some(2));
    assert_eq!(parse_disc_number("Part 1"), Some(1));
    assert_eq!(parse_disc_number("pt. 2"), Some(2));
    assert_eq!(parse_disc_number("Pt 03"), Some(3));

    // 5. Roman numerals ("Disc I", "CD II", "Vol. III", "Part IV", "Disc X")
    assert_eq!(parse_disc_number("Disc I"), Some(1));
    assert_eq!(parse_disc_number("CD II"), Some(2));
    assert_eq!(parse_disc_number("Vol. III"), Some(3));
    assert_eq!(parse_disc_number("Part IV"), Some(4));
    assert_eq!(parse_disc_number("Disc V"), Some(5));
    assert_eq!(parse_disc_number("Disc X"), Some(10));

    // 6. Vinyl sides ("Side A", "Side B", "Side C", "Side D")
    assert_eq!(parse_disc_number("Side A"), Some(1));
    assert_eq!(parse_disc_number("side b"), Some(2));
    assert_eq!(parse_disc_number("Side C"), Some(3));
    assert_eq!(parse_disc_number("Side D"), Some(4));

    // 7. Bracketed variations
    assert_eq!(parse_disc_number("[Disc 1]"), Some(1));
    assert_eq!(parse_disc_number("(CD 02)"), Some(2));
    assert_eq!(parse_disc_number("{Vol. 3}"), Some(3));

    // 8. False positive rejection (words that start with prefix but are NOT disc folders)
    assert_eq!(parse_disc_number("Discovery"), None);
    assert_eq!(parse_disc_number("Discontent"), None);
    assert_eq!(parse_disc_number("Volume"), None);
    assert_eq!(parse_disc_number("CDbaby"), None);
    assert_eq!(parse_disc_number("Participant"), None);
    assert_eq!(parse_disc_number("Sidekick"), None);
    assert!(!is_disc_folder("Discovery"));
    assert!(!is_disc_folder("Volume"));
}

#[test]
fn test_multi_disc_clustering_and_sorting_end_to_end() {
    // 3 discs organized in diverse folder conventions under one album:
    // Disc 1 in "Disc 1", Disc 2 in "CD 02", Disc 3 in "Vol. 3"
    let t1 = make_test_track(
        "t1",
        "/Music/Led Zeppelin/Physical Graffiti/Disc 1/01.flac",
        "Custard Pie",
        "Led Zeppelin",
        "Physical Graffiti",
        Some("Led Zeppelin"),
        Some(1),
        None, // missing disc_number in tag!
        253,
    );
    let t2 = make_test_track(
        "t2",
        "/Music/Led Zeppelin/Physical Graffiti/Disc 1/02.flac",
        "The Rover",
        "Led Zeppelin",
        "Physical Graffiti",
        Some("Led Zeppelin"),
        Some(2),
        None,
        337,
    );
    let t3 = make_test_track(
        "t3",
        "/Music/Led Zeppelin/Physical Graffiti/CD 02/01.flac",
        "In the Light",
        "Led Zeppelin",
        "Physical Graffiti",
        Some("Led Zeppelin"),
        Some(1),
        None, // missing disc_number in tag!
        526,
    );
    let t4 = make_test_track(
        "t4",
        "/Music/Led Zeppelin/Physical Graffiti/Vol. 3/01.flac",
        "Bonus Track",
        "Led Zeppelin",
        "Physical Graffiti",
        Some("Led Zeppelin"),
        Some(1),
        None, // missing disc_number in tag!
        200,
    );

    let albums = group_tracks_by_album(&[t3.clone(), t1.clone(), t4.clone(), t2.clone()], &[]);

    assert_eq!(
        albums.len(),
        1,
        "All 3 discs with different folder names ('Disc 1', 'CD 02', 'Vol. 3') MUST cluster into ONE album"
    );

    let album = &albums[0];
    assert_eq!(album.title, "Physical Graffiti");
    assert_eq!(album.artist, "Led Zeppelin");
    assert_eq!(album.track_count, 4);
    assert_eq!(album.total_duration_secs, 253 + 337 + 526 + 200);

    // Verify disc numbers were backfilled from folder paths
    assert_eq!(album.tracks[0].metadata.disc_number, Some(1));
    assert_eq!(album.tracks[0].metadata.track_number, Some(1));
    assert_eq!(album.tracks[0].metadata.title.as_deref(), Some("Custard Pie"));

    assert_eq!(album.tracks[1].metadata.disc_number, Some(1));
    assert_eq!(album.tracks[1].metadata.track_number, Some(2));
    assert_eq!(album.tracks[1].metadata.title.as_deref(), Some("The Rover"));

    assert_eq!(album.tracks[2].metadata.disc_number, Some(2));
    assert_eq!(album.tracks[2].metadata.track_number, Some(1));
    assert_eq!(album.tracks[2].metadata.title.as_deref(), Some("In the Light"));

    assert_eq!(album.tracks[3].metadata.disc_number, Some(3));
    assert_eq!(album.tracks[3].metadata.track_number, Some(1));
    assert_eq!(album.tracks[3].metadata.title.as_deref(), Some("Bonus Track"));
}

#[test]
fn test_multi_disc_intermediate_parent_directories() {
    // Nested container e.g. "/Music/Pink Floyd/The Wall/Discs/Disc 1/01.flac"
    let p = Path::new("/Music/Pink Floyd/The Wall/Discs/Disc 1/01.flac");
    let parent = get_album_parent_dir(p);
    assert_eq!(
        parent,
        Some(Path::new("/Music/Pink Floyd/The Wall")),
        "get_album_parent_dir must traverse past both 'Disc 1' and 'Discs' container"
    );
}

// =========================================================================
// 4. COMPILATION DETECTION BOUNDARY RATIOS & EXPLICIT METADATA
// =========================================================================

#[test]
fn test_compilation_explicit_tags() {
    // 1. Explicit compilation markers in album_artist
    let explicit_comp_tags = [
        "Various Artists",
        "various artists",
        "VARIOUS ARTISTS",
        "Various",
        "VA",
        "V.A.",
        "V.A",
        "v/a",
        "Compilation",
        "Compilations",
    ];

    for tag in explicit_comp_tags {
        assert!(
            is_compilation_artist(tag),
            "'{tag}' should be recognized as a compilation artist"
        );

        // Single track with explicit compilation tag MUST be flagged as compilation
        let t = make_test_track(
            "single_t",
            "/Music/Comp/01.flac",
            "Track 1",
            "Artist X",
            "Comp Album",
            Some(tag),
            Some(1),
            Some(1),
            200,
        );
        let albums = group_tracks_by_album(&[t], &[]);
        assert_eq!(albums.len(), 1);
        assert!(
            albums[0].is_compilation,
            "Album with explicit '{tag}' MUST be flagged as compilation even with 1 track"
        );
        assert_eq!(albums[0].artist, "Various Artists");
    }
}

#[test]
fn test_compilation_dominance_boundary_ratios() {
    // Test Case A: 3 tracks, 3 distinct artists (1 track each, dominance = 1/3 = 33.3% < 50%)
    // top_candidate.1 * 2 < tracks.len() => 1 * 2 < 3 => 2 < 3 (TRUE) => COMPILATION
    let tracks_3_comp = vec![
        make_test_track("t1", "/Music/Sampler/01.flac", "Track 1", "Artist A", "Sampler", None, Some(1), Some(1), 180),
        make_test_track("t2", "/Music/Sampler/02.flac", "Track 2", "Artist B", "Sampler", None, Some(2), Some(1), 180),
        make_test_track("t3", "/Music/Sampler/03.flac", "Track 3", "Artist C", "Sampler", None, Some(3), Some(1), 180),
    ];
    let albums_a = group_tracks_by_album(&tracks_3_comp, &[]);
    assert_eq!(albums_a.len(), 1);
    assert!(albums_a[0].is_compilation, "3 tracks, 3 artists MUST be compilation");
    assert_eq!(albums_a[0].artist, "Various Artists");

    // Test Case B: 3 tracks, 2 artists (Artist A has 2 tracks, Artist B has 1 track; dominance = 2/3 = 66.7%)
    // top_candidate.1 * 2 < tracks.len() => 2 * 2 < 3 => 4 < 3 (FALSE) => NOT compilation, Artist A dominant
    let tracks_3_single = vec![
        make_test_track("t1", "/Music/EP/01.flac", "Track 1", "Artist A", "EP", None, Some(1), Some(1), 180),
        make_test_track("t2", "/Music/EP/02.flac", "Track 2", "Artist A", "EP", None, Some(2), Some(1), 180),
        make_test_track("t3", "/Music/EP/03.flac", "Track 3", "Artist B", "EP", None, Some(3), Some(1), 180),
    ];
    let albums_b = group_tracks_by_album(&tracks_3_single, &[]);
    assert_eq!(albums_b.len(), 1);
    assert!(!albums_b[0].is_compilation, "3 tracks, 2 by Artist A MUST NOT be compilation");
    assert_eq!(albums_b[0].artist, "Artist A");

    // Test Case C: 4 tracks, exactly 50% dominance (Artist A has 2 tracks, Artist B has 1, Artist C has 1)
    // top_candidate.1 * 2 < tracks.len() => 2 * 2 < 4 => 4 < 4 (FALSE) => NOT compilation, Artist A dominant
    let tracks_4_boundary = vec![
        make_test_track("t1", "/Music/Album4/01.flac", "Track 1", "Artist A", "Album4", None, Some(1), Some(1), 180),
        make_test_track("t2", "/Music/Album4/02.flac", "Track 2", "Artist A", "Album4", None, Some(2), Some(1), 180),
        make_test_track("t3", "/Music/Album4/03.flac", "Track 3", "Artist B", "Album4", None, Some(3), Some(1), 180),
        make_test_track("t4", "/Music/Album4/04.flac", "Track 4", "Artist C", "Album4", None, Some(4), Some(1), 180),
    ];
    let albums_c = group_tracks_by_album(&tracks_4_boundary, &[]);
    assert_eq!(albums_c.len(), 1);
    assert!(!albums_c[0].is_compilation, "4 tracks with 50% dominance MUST NOT be compilation");
    assert_eq!(albums_c[0].artist, "Artist A");

    // Test Case D: 5 tracks, strictly less than 50% dominance (Artist A has 2 tracks, Artist B has 2 tracks, Artist C has 1 track)
    // top_candidate.1 * 2 < tracks.len() => 2 * 2 < 5 => 4 < 5 (TRUE) => COMPILATION!
    let tracks_5_comp = vec![
        make_test_track("t1", "/Music/Album5/01.flac", "Track 1", "Artist A", "Album5", None, Some(1), Some(1), 180),
        make_test_track("t2", "/Music/Album5/02.flac", "Track 2", "Artist A", "Album5", None, Some(2), Some(1), 180),
        make_test_track("t3", "/Music/Album5/03.flac", "Track 3", "Artist B", "Album5", None, Some(3), Some(1), 180),
        make_test_track("t4", "/Music/Album5/04.flac", "Track 4", "Artist B", "Album5", None, Some(4), Some(1), 180),
        make_test_track("t5", "/Music/Album5/05.flac", "Track 5", "Artist C", "Album5", None, Some(5), Some(1), 180),
    ];
    let albums_d = group_tracks_by_album(&tracks_5_comp, &[]);
    assert_eq!(albums_d.len(), 1);
    assert!(albums_d[0].is_compilation, "5 tracks with max artist 2/5 (40% < 50%) MUST be compilation");
    assert_eq!(albums_d[0].artist, "Various Artists");

    // Test Case E: 2 tracks, 2 distinct artists (Split single without explicit VA tag)
    // tracks.len() < 3 => NOT compilation automatically (per contract)
    let tracks_2_split = vec![
        make_test_track("t1", "/Music/Split/01.flac", "Track 1", "Artist A", "Split 7\"", None, Some(1), Some(1), 180),
        make_test_track("t2", "/Music/Split/02.flac", "Track 2", "Artist B", "Split 7\"", None, Some(2), Some(1), 180),
    ];
    let albums_e = group_tracks_by_album(&tracks_2_split, &[]);
    assert_eq!(albums_e.len(), 1);
    assert!(!albums_e[0].is_compilation, "2-track split single without explicit tag should not automatically be VA");
}

#[test]
fn test_artist_profile_appears_on_with_compilations() {
    // When an album is a compilation, participating artists must list it under `appears_on`
    let t1 = make_test_track(
        "t1",
        "/Music/Sampler/01.flac",
        "Song 1",
        "Artist A",
        "Summer Sampler",
        Some("Various Artists"),
        Some(1),
        Some(1),
        200,
    );
    let t2 = make_test_track(
        "t2",
        "/Music/Artist A/Solo Album/01.flac",
        "Solo Song",
        "Artist A",
        "Solo Album",
        Some("Artist A"),
        Some(1),
        Some(1),
        200,
    );

    let artists = group_tracks_by_artist(&[t1, t2], &[]);
    let artist_a = artists.iter().find(|a| a.name == "Artist A").expect("Found Artist A");

    assert_eq!(artist_a.albums.len(), 1, "Artist A owns Solo Album");
    assert_eq!(artist_a.albums[0].title, "Solo Album");
    assert_eq!(artist_a.appears_on.len(), 1, "Artist A appears on Summer Sampler");
    assert_eq!(artist_a.appears_on[0].title, "Summer Sampler");
    assert_eq!(artist_a.tracks.len(), 2, "Artist A has 2 tracks total");
}

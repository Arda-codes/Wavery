//! Metadata and album artwork extractor utilizing Lofty.

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use std::path::Path;
use std::time::Duration;
use wavery_core::error::LibraryError;
use wavery_core::models::TrackMetadata;
use wavery_core::traits::{ExtractedArtwork, MetadataReader};

/// Lofty-backed implementation of MetadataReader.
#[derive(Default, Clone)]
pub struct LoftyMetadataReader;

impl LoftyMetadataReader {
    /// Creates a new LoftyMetadataReader.
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// Write updated metadata fields to the physical audio file using Lofty.
    pub fn write_metadata(
        &self,
        path: &Path,
        metadata: &TrackMetadata,
    ) -> Result<(), LibraryError> {
        use lofty::tag::TagExt;

        let mut tagged_file = Probe::open(path)
            .map_err(|e| LibraryError::TagReadError(format!("Failed to probe file: {e}")))?
            .read()
            .map_err(|e| LibraryError::TagReadError(format!("Failed to read tags: {e}")))?;

        let tag = match tagged_file.primary_tag_mut() {
            Some(t) => t,
            None => match tagged_file.first_tag_mut() {
                Some(t) => t,
                None => {
                    let tag_type = tagged_file.primary_tag_type();
                    tagged_file.insert_tag(lofty::tag::Tag::new(tag_type));
                    match tagged_file.primary_tag_mut() {
                        Some(t) => t,
                        None => {
                            return Err(LibraryError::TagReadError(
                                "Failed to create tag in audio file".to_string(),
                            ))
                        }
                    }
                }
            },
        };

        if let Some(title) = &metadata.title {
            tag.set_title(title.clone());
        }
        if let Some(artist) = &metadata.artist {
            tag.set_artist(artist.clone());
        }
        if let Some(album) = &metadata.album {
            tag.set_album(album.clone());
        }
        if let Some(album_artist) = &metadata.album_artist {
            tag.insert_text(ItemKey::AlbumArtist, album_artist.clone());
        }
        if let Some(year) = metadata.year {
            if year > 0 {
                tag.set_year(year as u32);
            }
        }
        if let Some(track_number) = metadata.track_number {
            tag.set_track(track_number);
        }
        if let Some(disc_number) = metadata.disc_number {
            tag.set_disk(disc_number);
        }
        if let Some(genre) = &metadata.genre {
            tag.set_genre(genre.clone());
        }
        if let Some(lyrics) = &metadata.lyrics {
            tag.insert_text(ItemKey::Lyrics, lyrics.clone());
        }
        if let Some(rg_tg) = metadata.replaygain_track_gain {
            tag.insert_text(ItemKey::ReplayGainTrackGain, format!("{rg_tg:.2} dB"));
        }
        if let Some(rg_tp) = metadata.replaygain_track_peak {
            tag.insert_text(ItemKey::ReplayGainTrackPeak, format!("{rg_tp:.6}"));
        }
        if let Some(rg_ag) = metadata.replaygain_album_gain {
            tag.insert_text(ItemKey::ReplayGainAlbumGain, format!("{rg_ag:.2} dB"));
        }
        if let Some(rg_ap) = metadata.replaygain_album_peak {
            tag.insert_text(ItemKey::ReplayGainAlbumPeak, format!("{rg_ap:.6}"));
        }

        tag.save_to_path(path, lofty::config::WriteOptions::default())
            .map_err(|e| {
                LibraryError::TagReadError(format!("Failed to write tags to disk: {e}"))
            })?;

        Ok(())
    }
}

fn read_sidecar_lrc(path: &Path) -> Option<String> {
    let lrc_path = path.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&lrc_path) {
            if !content.trim().is_empty() {
                return Some(content);
            }
        }
    }
    let lrc_upper = path.with_extension("LRC");
    if lrc_upper.is_file() {
        if let Ok(content) = std::fs::read_to_string(&lrc_upper) {
            if !content.trim().is_empty() {
                return Some(content);
            }
        }
    }
    None
}

/// Parses a ReplayGain gain string (e.g. `"-6.50 dB"`, `"+1.25 dB"`, `"-4.0 LU"`, or `"-6.50"`) into decibels.
#[must_use]
pub fn parse_replaygain_db(s: &str) -> Option<f32> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    let numeric_part = if let Some(stripped) = lower.strip_suffix("db") {
        stripped.trim()
    } else if let Some(stripped) = lower.strip_suffix("lu") {
        stripped.trim()
    } else if let Some(stripped) = lower.strip_suffix("lufs") {
        stripped.trim()
    } else {
        trimmed
    };

    let val = numeric_part.parse::<f32>().ok()?;
    if val.is_finite() {
        Some(val)
    } else {
        None
    }
}

/// Parses a ReplayGain linear peak amplitude string (e.g. `"0.9885"`).
#[must_use]
pub fn parse_replaygain_peak(s: &str) -> Option<f32> {
    let val = s.trim().parse::<f32>().ok()?;
    if val.is_finite() && val >= 0.0 {
        Some(val)
    } else {
        None
    }
}

/// Parses an EBU R128 gain string (`R128_TRACK_GAIN`, `R128_ALBUM_GAIN`) and converts it
/// to the ReplayGain2 (`-18 LUFS`) reference by applying the standard `+5.0 dB` offset.
///
/// Supports both RFC 7845 Q7.8 fixed-point integer values (in 1/256th dB) and float dB strings.
#[must_use]
pub fn parse_r128_gain_db(s: &str) -> Option<f32> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(q78) = trimmed.parse::<i32>() {
        let r128_db = (q78 as f32) / 256.0;
        let rg2_db = r128_db + 5.0;
        if rg2_db.is_finite() {
            return Some(rg2_db);
        }
    }

    parse_replaygain_db(trimmed).map(|db| db + 5.0)
}

/// Parses an Apple Sound Check (`iTunNORM`) 10-field hexadecimal string into
/// `(track_gain_db, track_peak, album_gain_db, album_peak)`.
#[must_use]
pub fn parse_itunnorm(s: &str) -> Option<(f32, f32, f32, f32)> {
    let mut vals = [0_u32; 10];
    let mut count = 0;

    for token in s.split_whitespace().take(10) {
        let clean = token
            .trim_start_matches("0x")
            .trim_start_matches("0X");
        let parsed = u32::from_str_radix(clean, 16).ok()?;
        vals[count] = parsed;
        count += 1;
    }

    if count < 10 {
        return None;
    }

    let track_norm = vals[0].max(vals[1]).max(1);
    let album_norm = vals[2].max(vals[3]).max(1);
    let track_peak_raw = vals[4].max(vals[5]);
    let album_peak_raw = vals[6].max(vals[7]);

    let track_gain = -10.0 * (track_norm as f32 / 1000.0).log10();
    let track_peak = track_peak_raw as f32 / 32768.0;
    let album_gain = -10.0 * (album_norm as f32 / 1000.0).log10();
    let album_peak = album_peak_raw as f32 / 32768.0;

    Some((track_gain, track_peak, album_gain, album_peak))
}

fn extract_replaygain_from_tags(
    tags: &[lofty::tag::Tag],
) -> (Option<f32>, Option<f32>, Option<f32>, Option<f32>) {
    let mut rg_track_gain: Option<f32> = None;
    let mut rg_track_peak: Option<f32> = None;
    let mut rg_album_gain: Option<f32> = None;
    let mut rg_album_peak: Option<f32> = None;

    let mut r128_track_gain: Option<f32> = None;
    let mut r128_album_gain: Option<f32> = None;
    let mut itunnorm_vals: Option<(f32, f32, f32, f32)> = None;

    for tag in tags {
        if rg_track_gain.is_none() {
            if let Some(s) = tag.get_string(&ItemKey::ReplayGainTrackGain) {
                rg_track_gain = parse_replaygain_db(s);
            }
        }
        if rg_track_peak.is_none() {
            if let Some(s) = tag.get_string(&ItemKey::ReplayGainTrackPeak) {
                rg_track_peak = parse_replaygain_peak(s);
            }
        }
        if rg_album_gain.is_none() {
            if let Some(s) = tag.get_string(&ItemKey::ReplayGainAlbumGain) {
                rg_album_gain = parse_replaygain_db(s);
            }
        }
        if rg_album_peak.is_none() {
            if let Some(s) = tag.get_string(&ItemKey::ReplayGainAlbumPeak) {
                rg_album_peak = parse_replaygain_peak(s);
            }
        }

        for item in tag.items() {
            let Some(val) = item.value().text() else {
                continue;
            };
            match item.key() {
                ItemKey::ReplayGainTrackGain if rg_track_gain.is_none() => {
                    rg_track_gain = parse_replaygain_db(val);
                }
                ItemKey::ReplayGainTrackPeak if rg_track_peak.is_none() => {
                    rg_track_peak = parse_replaygain_peak(val);
                }
                ItemKey::ReplayGainAlbumGain if rg_album_gain.is_none() => {
                    rg_album_gain = parse_replaygain_db(val);
                }
                ItemKey::ReplayGainAlbumPeak if rg_album_peak.is_none() => {
                    rg_album_peak = parse_replaygain_peak(val);
                }
                ItemKey::Comment if itunnorm_vals.is_none() => {
                    itunnorm_vals = parse_itunnorm(val);
                }
                ItemKey::Unknown(raw_key) => {
                    let normalized_key = raw_key
                        .rsplit(':')
                        .next()
                        .unwrap_or(raw_key.as_str())
                        .trim()
                        .to_ascii_uppercase();
                    match normalized_key.as_str() {
                        "REPLAYGAIN_TRACK_GAIN" if rg_track_gain.is_none() => {
                            rg_track_gain = parse_replaygain_db(val);
                        }
                        "REPLAYGAIN_TRACK_PEAK" if rg_track_peak.is_none() => {
                            rg_track_peak = parse_replaygain_peak(val);
                        }
                        "REPLAYGAIN_ALBUM_GAIN" if rg_album_gain.is_none() => {
                            rg_album_gain = parse_replaygain_db(val);
                        }
                        "REPLAYGAIN_ALBUM_PEAK" if rg_album_peak.is_none() => {
                            rg_album_peak = parse_replaygain_peak(val);
                        }
                        "R128_TRACK_GAIN" if r128_track_gain.is_none() => {
                            r128_track_gain = parse_r128_gain_db(val);
                        }
                        "R128_ALBUM_GAIN" if r128_album_gain.is_none() => {
                            r128_album_gain = parse_r128_gain_db(val);
                        }
                        "ITUNNORM" if itunnorm_vals.is_none() => {
                            itunnorm_vals = parse_itunnorm(val);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }

    let final_track_gain = rg_track_gain
        .or(r128_track_gain)
        .or_else(|| itunnorm_vals.map(|v| v.0));
    let final_track_peak = rg_track_peak.or_else(|| itunnorm_vals.map(|v| v.1));
    let final_album_gain = rg_album_gain
        .or(r128_album_gain)
        .or_else(|| itunnorm_vals.map(|v| v.2));
    let final_album_peak = rg_album_peak.or_else(|| itunnorm_vals.map(|v| v.3));

    (
        final_track_gain,
        final_track_peak,
        final_album_gain,
        final_album_peak,
    )
}

impl MetadataReader for LoftyMetadataReader {
    fn read_metadata(&self, path: &Path) -> Result<TrackMetadata, LibraryError> {
        let format = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("unknown")
            .to_uppercase();

        let file_stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());

        let probe = match Probe::open(path) {
            Ok(p) => p,
            Err(_) => {
                let inferred_artist = crate::heuristics::extract_artist_from_path(path, None);
                return Ok(TrackMetadata {
                    title: file_stem,
                    artist: inferred_artist,
                    album: None,
                    album_artist: None,
                    track_number: None,
                    disc_number: None,
                    year: None,
                    genre: None,
                    duration: Duration::from_secs(0),
                    sample_rate: None,
                    bit_depth: None,
                    channels: None,
                    format,
                    lyrics: read_sidecar_lrc(path),
                    ..Default::default()
                });
            }
        };

        let tagged_file = match probe.read() {
            Ok(tf) => tf,
            Err(_) => {
                // Fallback for files without readable tag headers / corrupt / zero-byte
                let inferred_artist = crate::heuristics::extract_artist_from_path(path, None);
                return Ok(TrackMetadata {
                    title: file_stem,
                    artist: inferred_artist,
                    album: None,
                    album_artist: None,
                    track_number: None,
                    disc_number: None,
                    year: None,
                    genre: None,
                    duration: Duration::from_secs(0),
                    sample_rate: None,
                    bit_depth: None,
                    channels: None,
                    format,
                    lyrics: read_sidecar_lrc(path),
                    ..Default::default()
                });
            }
        };

        let properties = tagged_file.properties();
        let duration = properties.duration();
        let sample_rate = properties.sample_rate();
        let bit_depth = properties.bit_depth().map(|b| b as u16);
        let channels = properties.channels().map(|c| c as u16);

        let tag = tagged_file
            .primary_tag()
            .or_else(|| tagged_file.first_tag());

        let title = tag.as_ref().and_then(|t| t.title().map(|s| s.to_string()));
        let album = tag.as_ref().and_then(|t| t.album().map(|s| s.to_string()));
        let mut artist = tag.as_ref().and_then(|t| t.artist().map(|s| s.to_string()));
        if artist
            .as_deref()
            .is_none_or(|a| a.trim().is_empty() || a.trim().to_lowercase() == "unknown artist")
        {
            if let Some(inferred) = crate::heuristics::extract_artist_from_path(path, album.as_deref()) {
                artist = Some(inferred);
            }
        }

        let genre = tag
            .as_ref()
            .and_then(|t| t.genre().map(|s| s.to_string()))
            .map(|g| wavery_core::heuristics::normalize_genre(&g, None))
            .filter(|g| !g.trim().is_empty());
        let track_number = tag.as_ref().and_then(|t| t.track());
        let disc_number = tag.as_ref().and_then(|t| t.disk());

        let album_artist = tag
            .as_ref()
            .and_then(|t| t.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string()));

        let year = tag.as_ref().and_then(|t| {
            t.year().filter(|&y| y > 0).map(|y| y as i32).or_else(|| {
                t.get_string(&ItemKey::RecordingDate)
                    .and_then(|d| d.chars().take(4).collect::<String>().parse::<i32>().ok())
                    .filter(|&y| y > 0)
            })
        });

        let lyrics = tag
            .as_ref()
            .and_then(|t| {
                t.get_string(&ItemKey::Lyrics)
                    .or_else(|| t.get_string(&ItemKey::Unknown("UNSYNCEDLYRICS".to_string())))
                    .map(|s| s.to_string())
            })
            .filter(|s| !s.trim().is_empty())
            .or_else(|| read_sidecar_lrc(path));

        let (
            replaygain_track_gain,
            replaygain_track_peak,
            replaygain_album_gain,
            replaygain_album_peak,
        ) = extract_replaygain_from_tags(tagged_file.tags());

        Ok(TrackMetadata {
            title: title.or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            }),
            artist,
            album,
            album_artist,
            track_number,
            disc_number,
            year,
            genre,
            duration: if duration.is_zero() {
                Duration::from_secs(0)
            } else {
                duration
            },
            sample_rate,
            bit_depth,
            channels,
            format,
            lyrics,
            replaygain_track_gain,
            replaygain_track_peak,
            replaygain_album_gain,
            replaygain_album_peak,
        })
    }

    fn read_artwork(&self, path: &Path) -> Result<Option<ExtractedArtwork>, LibraryError> {
        let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
            Ok(tf) => tf,
            Err(_) => return Ok(None),
        };

        let tag = match tagged_file
            .primary_tag()
            .or_else(|| tagged_file.first_tag())
        {
            Some(t) => t,
            None => return Ok(None),
        };

        if let Some(picture) = tag.pictures().first() {
            let mime = picture
                .mime_type()
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| "image/jpeg".to_string());
            return Ok(Some(ExtractedArtwork {
                mime_type: mime,
                data: picture.data().to_vec(),
            }));
        }

        Ok(None)
    }
}

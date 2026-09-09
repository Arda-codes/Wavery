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
    pub fn write_metadata(&self, path: &Path, metadata: &TrackMetadata) -> Result<(), LibraryError> {
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

        tag.save_to_path(path, lofty::config::WriteOptions::default())
            .map_err(|e| LibraryError::TagReadError(format!("Failed to write tags to disk: {e}")))?;

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
                return Ok(TrackMetadata {
                    title: file_stem,
                    artist: None,
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
                });
            }
        };

        let tagged_file = match probe.read() {
            Ok(tf) => tf,
            Err(_) => {
                // Fallback for files without readable tag headers / corrupt / zero-byte
                return Ok(TrackMetadata {
                    title: file_stem,
                    artist: None,
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
                });
            }
        };

        let properties = tagged_file.properties();
        let duration = properties.duration();
        let sample_rate = properties.sample_rate();
        let bit_depth = properties.bit_depth().map(|b| b as u16);
        let channels = properties.channels().map(|c| c as u16);

        let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

        let title = tag.as_ref().and_then(|t| t.title().map(|s| s.to_string()));
        let artist = tag.as_ref().and_then(|t| t.artist().map(|s| s.to_string()));
        let album = tag.as_ref().and_then(|t| t.album().map(|s| s.to_string()));
        let genre = tag.as_ref().and_then(|t| t.genre().map(|s| s.to_string()));
        let track_number = tag.as_ref().and_then(|t| t.track());
        let disc_number = tag.as_ref().and_then(|t| t.disk());

        let album_artist = tag
            .as_ref()
            .and_then(|t| t.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string()));

        let year = tag.as_ref().and_then(|t| {
            t.year()
                .filter(|&y| y > 0)
                .map(|y| y as i32)
                .or_else(|| {
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
        })
    }

    fn read_artwork(&self, path: &Path) -> Result<Option<ExtractedArtwork>, LibraryError> {
        let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
            Ok(tf) => tf,
            Err(_) => return Ok(None),
        };

        let tag = match tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
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

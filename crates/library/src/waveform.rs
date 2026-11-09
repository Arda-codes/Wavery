//! Audio waveform amplitude peak envelope extraction using Symphonia.
//!
//! Decodes audio streams into a normalized 100-point peak envelope (`[0.0, 1.0]`)
//! for instant O(1) waveform scrubber rendering.

use std::fs::File;
use std::path::Path;
use symphonia::core::audio::{AudioBufferRef, SampleBuffer};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use wavery_core::error::LibraryError;
use wavery_core::models::WaveformData;

/// Canonical number of normalized amplitude peak points in a Wavery waveform envelope.
pub const WAVEFORM_POINT_COUNT: usize = 100;

/// Current schema/algorithm version for persisted waveform envelopes.
pub const WAVEFORM_VERSION: u32 = 1;

/// Decodes an audio file at `path` and computes a normalized 100-point `WaveformData` peak envelope.
///
/// # Errors
///
/// Returns `LibraryError::Io` if the file cannot be opened, or `LibraryError::TagReadError`
/// if the container format or audio codec stream cannot be probed or decoded.
pub fn compute_waveform_peaks(track_id: &str, path: &Path) -> Result<WaveformData, LibraryError> {
    let file = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| LibraryError::TagReadError(format!("Failed to probe audio for waveform: {e}")))?;

    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| {
            LibraryError::TagReadError("No supported audio stream found for waveform".to_string())
        })?;

    let codec_track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| {
            LibraryError::TagReadError(format!("Failed to initialize audio decoder: {e}"))
        })?;

    let mut raw_peaks: Vec<f32> = Vec::with_capacity(2048);
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(_) => {
                break;
            }
        };

        if packet.track_id() != codec_track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                extract_packet_peaks(&audio_buf, &mut sample_buf, &mut raw_peaks);
            }
            Err(SymphoniaError::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::DecodeError(_)) => {
                continue;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(_) => {
                break;
            }
        }
    }

    let points = resample_peaks_to_100(&raw_peaks);
    Ok(WaveformData::new(track_id, WAVEFORM_VERSION, points))
}

/// Extracts peak absolute sample amplitudes from a decoded `AudioBufferRef` across all sample formats.
fn extract_packet_peaks(
    audio_buf: &AudioBufferRef<'_>,
    sample_buf: &mut Option<SampleBuffer<f32>>,
    raw_peaks: &mut Vec<f32>,
) {
    let frames = audio_buf.frames();
    if frames == 0 {
        return;
    }

    let spec = *audio_buf.spec();
    let channels = spec.channels.count().max(1);
    let required_samples = audio_buf.capacity().saturating_mul(channels);

    let needs_realloc = match sample_buf {
        Some(buf) => buf.capacity() < required_samples,
        None => true,
    };

    if needs_realloc {
        *sample_buf = Some(SampleBuffer::<f32>::new(audio_buf.capacity() as u64, spec));
    }

    if let Some(buf) = sample_buf {
        buf.copy_interleaved_ref(audio_buf.clone());
        let samples = buf.samples();
        if samples.is_empty() {
            return;
        }

        // Use fine-grained sub-packet chunks when total accumulated peaks are small
        // so short audio files still yield high resolution, and 1 peak per packet for long streams.
        let frames_per_chunk = if raw_peaks.len() < 1000 {
            (frames / WAVEFORM_POINT_COUNT).max(1)
        } else {
            frames.max(1)
        };
        let chunk_size = frames_per_chunk.saturating_mul(channels).max(1);

        for chunk in samples.chunks(chunk_size) {
            let mut max_abs = 0.0_f32;
            for &s in chunk {
                let abs = s.abs();
                if abs.is_finite() && abs > max_abs {
                    max_abs = abs;
                }
            }
            raw_peaks.push(max_abs);
        }
    }
}

/// Resamples and normalizes a slice of raw amplitude peaks into exactly 100 points in `[0.0, 1.0]`.
///
/// Handles silent audio (returning all `0.0` without `NaN` or division by zero) and inputs
/// shorter than 100 samples (via linear interpolation).
#[must_use]
pub fn resample_peaks_to_100(raw_peaks: &[f32]) -> Vec<f32> {
    if raw_peaks.is_empty() {
        return vec![0.0; WAVEFORM_POINT_COUNT];
    }

    let sanitized: Vec<f32> = raw_peaks
        .iter()
        .map(|&v| if v.is_finite() { v.abs() } else { 0.0 })
        .collect();

    let n = sanitized.len();
    let mut bins = Vec::with_capacity(WAVEFORM_POINT_COUNT);

    if n == WAVEFORM_POINT_COUNT {
        bins.extend_from_slice(&sanitized);
    } else if n > WAVEFORM_POINT_COUNT {
        for i in 0..WAVEFORM_POINT_COUNT {
            let start = (i * n) / WAVEFORM_POINT_COUNT;
            let end = (((i + 1) * n) / WAVEFORM_POINT_COUNT)
                .max(start + 1)
                .min(n);
            let mut peak = 0.0_f32;
            for &v in &sanitized[start..end] {
                if v > peak {
                    peak = v;
                }
            }
            bins.push(peak);
        }
    } else if n == 1 {
        bins.resize(WAVEFORM_POINT_COUNT, sanitized[0]);
    } else {
        let max_idx = (n - 1) as f32;
        let denom = (WAVEFORM_POINT_COUNT - 1) as f32;
        for i in 0..WAVEFORM_POINT_COUNT {
            let pos = (i as f32) * max_idx / denom;
            let idx = (pos.floor() as usize).min(n - 1);
            let next_idx = (idx + 1).min(n - 1);
            let frac = pos - (idx as f32);
            let interpolated = sanitized[idx] * (1.0 - frac) + sanitized[next_idx] * frac;
            bins.push(interpolated);
        }
    }

    let max_peak = bins.iter().copied().fold(0.0_f32, f32::max);
    if !max_peak.is_finite() || max_peak <= f32::EPSILON {
        return vec![0.0; WAVEFORM_POINT_COUNT];
    }

    for v in &mut bins {
        *v = (*v / max_peak).clamp(0.0, 1.0);
    }

    bins
}

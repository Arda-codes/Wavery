//! Opus audio decoding source implementing `rodio::Source`.
//!
//! Provides pure-Rust Opus audio streaming and Ogg demuxing (RFC 6716 & RFC 7845)
//! supporting mono, stereo, and multichannel surround layouts.

use std::io::{Read, Seek};
use std::time::Duration;

use opus_pure::multistream::OpusMSDecoder;
use opus_pure::{MAX_PACKET_SAMPLES, OggOpusReader, OpusDecoder, OpusHead, Trim};
use rodio::source::{SeekError, Source};
use wavery_core::error::AudioError;

enum DecoderBackend {
    Single(Box<OpusDecoder>),
    Multi(OpusMSDecoder),
}

impl DecoderBackend {
    fn decode_s16(
        &mut self,
        packet: &[u8],
        frame_size: usize,
        output: &mut [i16],
    ) -> Result<usize, opus_pure::Error> {
        match self {
            Self::Single(d) => d.decode_s16(packet, frame_size, output),
            Self::Multi(d) => d.decode_s16(packet, frame_size, output),
        }
    }

    fn reset_state(&mut self) -> Result<(), opus_pure::Error> {
        match self {
            Self::Single(d) => d.reset_state(),
            Self::Multi(d) => d.reset_state(),
        }
    }
}

/// An audio source that reads and decodes Ogg Opus streams into 16-bit PCM samples.
pub struct OpusSource<R: Read + Seek> {
    reader: OggOpusReader<R>,
    backend: DecoderBackend,
    trim: Trim,
    head: OpusHead,
    channels: u16,
    sample_rate: u32,
    buffer: Vec<i16>,
    buffer_idx: usize,
    decode_scratch: Vec<i16>,
}

impl<R: Read + Seek> OpusSource<R> {
    /// Creates a new `OpusSource` from a readable and seekable stream.
    pub fn new(source: R) -> Result<Self, AudioError> {
        let reader = OggOpusReader::new(source)
            .map_err(|e| AudioError::DecoderError(format!("Invalid Ogg Opus stream: {e}")))?;

        let head = reader.head().clone();
        let channels = head.channel_count as usize;
        if channels == 0 {
            return Err(AudioError::DecoderError(
                "Invalid Opus stream: 0 audio channels".into(),
            ));
        }

        let backend = if head.mapping_family == 0 {
            let mut d = OpusDecoder::new(48_000, channels)
                .map_err(|e| AudioError::DecoderError(format!("Opus decoder init error: {e}")))?;
            d.gain_q8 = i32::from(head.output_gain_q8);
            DecoderBackend::Single(Box::new(d))
        } else {
            let d = OpusMSDecoder::new(48_000, channels, head.mapping_family)
                .map_err(|e| AudioError::DecoderError(format!("Opus MS decoder init error: {e}")))?;
            DecoderBackend::Multi(d)
        };

        let trim = Trim::new(&head, 48_000, channels)
            .map_err(|e| AudioError::DecoderError(format!("Opus trim init error: {e}")))?;

        let decode_scratch = vec![0i16; MAX_PACKET_SAMPLES * channels];

        Ok(Self {
            reader,
            backend,
            trim,
            head,
            channels: channels as u16,
            sample_rate: 48_000,
            buffer: Vec::new(),
            buffer_idx: 0,
            decode_scratch,
        })
    }
}

impl<R: Read + Seek> Iterator for OpusSource<R> {
    type Item = i16;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        if self.buffer_idx < self.buffer.len() {
            let sample = self.buffer[self.buffer_idx];
            self.buffer_idx += 1;
            return Some(sample);
        }

        loop {
            match self.reader.read_packet() {
                Ok(Some(packet)) => {
                    let samples_per_channel = match self.backend.decode_s16(
                        &packet.data,
                        MAX_PACKET_SAMPLES,
                        &mut self.decode_scratch,
                    ) {
                        Ok(n) => n,
                        Err(_) => continue,
                    };

                    let total_samples = samples_per_channel * (self.channels as usize);
                    if total_samples > self.decode_scratch.len() {
                        continue;
                    }

                    let kept = self
                        .trim
                        .keep(&packet, &self.decode_scratch[..total_samples]);
                    if kept.is_empty() {
                        continue;
                    }

                    self.buffer.clear();
                    self.buffer.extend_from_slice(kept);
                    self.buffer_idx = 1;
                    return Some(self.buffer[0]);
                }
                _ => return None,
            }
        }
    }
}

impl<R: Read + Seek> Source for OpusSource<R> {
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        let remaining = self.buffer.len().saturating_sub(self.buffer_idx);
        if remaining > 0 {
            Some(remaining)
        } else {
            None
        }
    }

    #[inline]
    fn channels(&self) -> u16 {
        self.channels
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        None
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        if self.reader.rewind().is_err() {
            return Err(SeekError::NotSupported {
                underlying_source: "OpusSource",
            });
        }
        if self.backend.reset_state().is_err() {
            return Err(SeekError::NotSupported {
                underlying_source: "OpusSource",
            });
        }
        self.trim = match Trim::new(&self.head, 48_000, self.channels as usize) {
            Ok(t) => t,
            Err(_) => {
                return Err(SeekError::NotSupported {
                    underlying_source: "OpusSource",
                });
            }
        };
        self.buffer.clear();
        self.buffer_idx = 0;

        let target_samples = (pos.as_secs_f64() * 48_000.0) as u64;
        let channels = self.channels as usize;

        while self.trim.samples_emitted() < target_samples {
            match self.reader.read_packet() {
                Ok(Some(packet)) => {
                    let samples_per_ch = match self.backend.decode_s16(
                        &packet.data,
                        MAX_PACKET_SAMPLES,
                        &mut self.decode_scratch,
                    ) {
                        Ok(n) => n,
                        Err(_) => continue,
                    };
                    let total_samples = samples_per_ch * channels;
                    if total_samples > self.decode_scratch.len() {
                        continue;
                    }
                    let kept = self
                        .trim
                        .keep(&packet, &self.decode_scratch[..total_samples]);
                    if self.trim.samples_emitted() >= target_samples {
                        let future_samples =
                            (self.trim.samples_emitted() - target_samples) as usize;
                        let future_values = future_samples * channels;
                        if future_values > 0 && future_values <= kept.len() {
                            let offset = kept.len() - future_values;
                            self.buffer.extend_from_slice(&kept[offset..]);
                            self.buffer_idx = 0;
                        }
                        break;
                    }
                }
                _ => break,
            }
        }

        Ok(())
    }
}

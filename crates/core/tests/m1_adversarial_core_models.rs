//! Empirical adversarial stress test harness for Milestone M1 core domain models:
//! - WaveformData envelope validation and serde fuzzing
//! - TrackMetadata ReplayGain fields, extreme floats, aliases, and malformed inputs

use std::time::Duration;
use wavery_core::models::{TrackMetadata, WaveformData};

/// Deterministic, zero-dependency PRNG (XorShift64) for fuzzing.
struct FuzzRng {
    state: u64,
}

impl FuzzRng {
    fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 { 0x517cc1b727220a95 } else { seed },
        }
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        x
    }

    fn next_u32(&mut self) -> u32 {
        self.next_u64() as u32
    }

    fn next_usize(&mut self, max: usize) -> usize {
        if max == 0 {
            0
        } else {
            (self.next_u64() % (max as u64)) as usize
        }
    }

    fn next_f32_clamped(&mut self) -> f32 {
        (self.next_u32() as f64 / u32::MAX as f64) as f32
    }

    fn next_f32_arbitrary(&mut self) -> f32 {
        f32::from_bits(self.next_u32())
    }
}

// ============================================================================
// 1. WaveformData::is_valid_100_point_envelope Point Count Boundary Tests
// ============================================================================

#[test]
fn test_adversarial_waveform_envelope_point_count_boundaries() {
    let test_counts = [0, 1, 2, 50, 98, 99, 100, 101, 102, 150, 200, 1000];

    for &count in &test_counts {
        let points = vec![0.5f32; count];
        let wf = WaveformData::new(format!("track-count-{}", count), 1, points);

        if count == 100 {
            assert!(
                wf.is_valid_100_point_envelope(),
                "100 points with 0.5 must be a valid envelope"
            );
        } else {
            assert!(
                !wf.is_valid_100_point_envelope(),
                "Point count {} must NOT be accepted as a 100-point envelope",
                count
            );
        }
    }
}

// ============================================================================
// 2. WaveformData Float Boundaries and Extreme Values (NaN, +/-Inf, Subnormals)
// ============================================================================

#[test]
fn test_adversarial_waveform_envelope_float_boundaries_and_special_values() {
    // Exact valid boundary values
    let valid_points = vec![
        0.0f32,
        1.0f32,
        0.5f32,
        1e-7f32,
        1.0f32 - 1e-7f32,
        -0.0f32, // In IEEE 754: -0.0 == 0.0, (0.0..=1.0).contains(&-0.0) is true
        f32::MIN_POSITIVE, // Min normal positive float (~1.175e-38) is in [0.0, 1.0]
        f32::MIN_POSITIVE / 2.0, // Subnormal positive float is in [0.0, 1.0]
    ];

    for &val in &valid_points {
        let points = vec![val; 100];
        let wf = WaveformData::new("track-valid-float", 1, points);
        assert!(
            wf.is_valid_100_point_envelope(),
            "Expected float {} to be valid in 100-point envelope",
            val
        );
    }

    // Invalid float values: Out-of-bounds, NaN, Infinity, Subnormal negative
    let invalid_values = [
        f32::NAN,
        f32::INFINITY,
        f32::NEG_INFINITY,
        -0.00001f32,
        -1.0f32,
        -100.0f32,
        f32::MIN,
        1.00001f32,
        1.05f32,
        2.0f32,
        100.0f32,
        f32::MAX,
        -(f32::MIN_POSITIVE / 2.0), // Negative subnormal float
    ];

    for &invalid_val in &invalid_values {
        // Case A: All 100 points have the invalid value
        let all_invalid = vec![invalid_val; 100];
        let wf_all = WaveformData::new("track-invalid-all", 1, all_invalid);
        assert!(
            !wf_all.is_valid_100_point_envelope(),
            "Envelope with all points = {} must be rejected",
            invalid_val
        );

        // Case B: Single invalid point placed at index 0, 50, and 99
        for &bad_idx in &[0, 50, 99] {
            let mut points = vec![0.5f32; 100];
            points[bad_idx] = invalid_val;
            let wf_single = WaveformData::new("track-invalid-single", 1, points);
            assert!(
                !wf_single.is_valid_100_point_envelope(),
                "Envelope with invalid point {} at index {} must be rejected",
                invalid_val,
                bad_idx
            );
        }
    }
}

// ============================================================================
// 3. WaveformData Randomized Fuzzing (Zero Panics, Invariant Checks)
// ============================================================================

#[test]
fn test_adversarial_waveform_envelope_fuzz_randomized() {
    let mut rng = FuzzRng::new(0xABCD1234F00DCAFE);

    for iteration in 0..10_000 {
        let len = rng.next_usize(200);
        let mut points = Vec::with_capacity(len);

        for _ in 0..len {
            let kind = rng.next_usize(8);
            let val = match kind {
                0 => 0.0f32,
                1 => 1.0f32,
                2 => rng.next_f32_clamped(), // valid [0.0, 1.0]
                3 => f32::NAN,
                4 => f32::INFINITY,
                5 => f32::NEG_INFINITY,
                6 => rng.next_f32_arbitrary(), // completely random 32-bit float
                _ => (rng.next_f32_clamped() - 0.5) * 4.0, // [-2.0, 2.0]
            };
            points.push(val);
        }

        let wf = WaveformData::new(format!("fuzz-{}", iteration), rng.next_u32(), points.clone());

        // Invariant: MUST NEVER PANIC
        let is_valid = wf.is_valid_100_point_envelope();

        // Independent oracle computation
        let oracle_valid = points.len() == 100
            && points.iter().all(|&p| !p.is_nan() && (0.0..=1.0).contains(&p));

        assert_eq!(
            is_valid, oracle_valid,
            "Fuzz iteration {} failed oracle comparison for len {}",
            iteration, len
        );
    }
}

// ============================================================================
// 4. WaveformData Serde Roundtrip (JSON & TOML), Aliases, and Malformed Inputs
// ============================================================================

#[test]
fn test_adversarial_waveform_serde_json_and_toml_roundtrip_and_aliases() {
    let points: Vec<f32> = (0..100).map(|i| i as f32 / 100.0).collect();
    let wf = WaveformData::new("track-uuid-9999", 2, points.clone());

    // --- JSON Roundtrip ---
    let json_str = serde_json::to_string(&wf).expect("JSON serialization must succeed");
    assert!(json_str.contains("\"track_id\":\"track-uuid-9999\""));
    assert!(json_str.contains("\"version\":2"));

    let json_de: WaveformData = serde_json::from_str(&json_str).expect("JSON deserialization must succeed");
    assert_eq!(json_de, wf);
    assert!(json_de.is_valid_100_point_envelope());

    // --- TOML Roundtrip ---
    let toml_str = toml::to_string(&wf).expect("TOML serialization must succeed");
    assert!(toml_str.contains("track_id = \"track-uuid-9999\""));
    assert!(toml_str.contains("version = 2"));

    let toml_de: WaveformData = toml::from_str(&toml_str).expect("TOML deserialization must succeed");
    assert_eq!(toml_de, wf);
    assert!(toml_de.is_valid_100_point_envelope());

    // --- camelCase Alias (`trackId`) in JSON ---
    let camel_json = format!(
        r#"{{"trackId": "track-camel-1", "version": 1, "points": {:?}}}"#,
        points
    );
    let camel_de_json: WaveformData = serde_json::from_str(&camel_json).expect("camelCase JSON alias must parse");
    assert_eq!(camel_de_json.track_id, "track-camel-1");
    assert_eq!(camel_de_json.points.len(), 100);

    // --- camelCase Alias (`trackId`) in TOML ---
    let camel_toml = format!(
        "trackId = \"track-camel-toml\"\nversion = 1\npoints = {:?}\n",
        points
    );
    let camel_de_toml: WaveformData = toml::from_str(&camel_toml).expect("camelCase TOML alias must parse");
    assert_eq!(camel_de_toml.track_id, "track-camel-toml");
    assert_eq!(camel_de_toml.points.len(), 100);
}

#[test]
fn test_adversarial_waveform_serde_malformed_inputs() {
    let malformed_jsons = [
        "", // empty
        "{", // incomplete
        "{}", // missing required fields
        r#"{"track_id": "t1"}"#, // missing version and points
        r#"{"track_id": "t1", "version": 1}"#, // missing points
        r#"{"points": [0.5, 0.6]}"#, // missing track_id and version
        r#"{"track_id": 12345, "version": 1, "points": [0.5]}"#, // track_id wrong type (int)
        r#"{"track_id": "t1", "version": "v1", "points": [0.5]}"#, // version wrong type (string)
        r#"{"track_id": "t1", "version": -1, "points": [0.5]}"#, // version negative
        r#"{"track_id": "t1", "version": 1, "points": "not_an_array"}"#, // points wrong type (string)
        r#"{"track_id": "t1", "version": 1, "points": [0.5, "corrupt", 0.8]}"#, // array element string
        r#"{"track_id": "t1", "version": 1, "points": [null]}"#, // array element null
        r#"{"track_id": "t1", "version": 1, "points": [true]}"#, // array element bool
        r#"{"track_id": null, "version": 1, "points": [0.5]}"#, // null track_id
    ];

    for &bad_json in &malformed_jsons {
        let res: Result<WaveformData, _> = serde_json::from_str(bad_json);
        assert!(res.is_err(), "Expected deserialization failure for bad JSON: {}", bad_json);
    }

    let malformed_tomls = [
        "", // empty
        "track_id = \"t1\"\n", // missing version and points
        "track_id = 123\nversion = 1\npoints = [0.5]\n", // wrong track_id type
        "track_id = \"t1\"\nversion = -5\npoints = [0.5]\n", // negative version
        "track_id = \"t1\"\nversion = 1\npoints = \"scalar\"\n", // string points
        "track_id = \"t1\"\nversion = 1\npoints = [0.5, \"corrupt\"]\n", // mixed array
    ];

    for &bad_toml in &malformed_tomls {
        let res: Result<WaveformData, _> = toml::from_str(bad_toml);
        assert!(res.is_err(), "Expected deserialization failure for bad TOML: {}", bad_toml);
    }
}

// ============================================================================
// 5. TrackMetadata ReplayGain Extreme Float Values (-100 dB, +100 dB, Subnormal, Inf, NaN)
// ============================================================================

#[test]
fn test_adversarial_track_metadata_replaygain_extreme_floats() {
    let extreme_cases = [
        (-100.0f32, 0.00001f32, -80.0f32, 0.0001f32),
        (100.0f32, 10.0f32, 80.0f32, 5.0f32),
        (0.0f32, 1.0f32, 0.0f32, 1.0f32),
        (-18.55f32, 0.9887f32, -14.22f32, 1.0000f32),
        (
            f32::MIN_POSITIVE, // subnormal / min positive float
            f32::MIN_POSITIVE / 2.0,
            f32::MIN_POSITIVE,
            f32::MIN_POSITIVE / 2.0,
        ),
        (-0.0f32, -0.0f32, -0.0f32, -0.0f32),
    ];

    for (tg, tp, ag, ap) in extreme_cases {
        let meta = TrackMetadata {
            title: Some("Extreme ReplayGain Song".into()),
            duration: Duration::from_secs(120),
            format: "FLAC".into(),
            replaygain_track_gain: Some(tg),
            replaygain_track_peak: Some(tp),
            replaygain_album_gain: Some(ag),
            replaygain_album_peak: Some(ap),
            ..Default::default()
        };

        // --- JSON Roundtrip ---
        let json = serde_json::to_string(&meta).expect("JSON serialize extreme floats must succeed");
        let de_json: TrackMetadata = serde_json::from_str(&json).expect("JSON deserialize extreme floats must succeed");
        assert_eq!(de_json.replaygain_track_gain, Some(tg));
        assert_eq!(de_json.replaygain_track_peak, Some(tp));
        assert_eq!(de_json.replaygain_album_gain, Some(ag));
        assert_eq!(de_json.replaygain_album_peak, Some(ap));

        // --- TOML Roundtrip ---
        let toml_str = toml::to_string(&meta).expect("TOML serialize extreme floats must succeed");
        let de_toml: TrackMetadata = toml::from_str(&toml_str).expect("TOML deserialize extreme floats must succeed");
        assert_eq!(de_toml.replaygain_track_gain, Some(tg));
        assert_eq!(de_toml.replaygain_track_peak, Some(tp));
        assert_eq!(de_toml.replaygain_album_gain, Some(ag));
        assert_eq!(de_toml.replaygain_album_peak, Some(ap));
    }
}

#[test]
fn test_adversarial_track_metadata_replaygain_nan_and_inf_handling() {
    // In TOML, nan, inf, -inf are explicitly valid float representations per spec.
    let toml_inf = r#"
title = "Inf Song"
format = "FLAC"
replaygain_track_gain = inf
replaygain_track_peak = -inf
replaygain_album_gain = nan
replaygain_album_peak = 1.0

[duration]
secs = 100
nanos = 0
"#;

    let meta: TrackMetadata = toml::from_str(toml_inf).expect("TOML with inf and nan must deserialize without panic");
    assert_eq!(meta.replaygain_track_gain, Some(f32::INFINITY));
    assert_eq!(meta.replaygain_track_peak, Some(f32::NEG_INFINITY));
    assert!(meta.replaygain_album_gain.unwrap().is_nan());
    assert_eq!(meta.replaygain_album_peak, Some(1.0));

    // In JSON, IEEE 754 NaN and Inf are not part of JSON spec RFC 8259.
    // serde_json serializes NaN and Inf as null by default, or returns an error on non-finite floats if configured.
    // Deserializing a JSON with null turns Option<f32> into None without panicking.
    let json_nulls = r#"{
        "title": "Null RG",
        "duration": {"secs": 10, "nanos": 0},
        "format": "MP3",
        "replaygain_track_gain": null,
        "replaygain_track_peak": null,
        "replaygain_album_gain": null,
        "replaygain_album_peak": null
    }"#;
    let de_nulls: TrackMetadata = serde_json::from_str(json_nulls).expect("JSON with null ReplayGain must deserialize as None");
    assert_eq!(de_nulls.replaygain_track_gain, None);
    assert_eq!(de_nulls.replaygain_track_peak, None);
    assert_eq!(de_nulls.replaygain_album_gain, None);
    assert_eq!(de_nulls.replaygain_album_peak, None);
}

// ============================================================================
// 6. TrackMetadata ReplayGain Serde Aliases (camelCase & snake_case)
// ============================================================================

#[test]
fn test_adversarial_track_metadata_replaygain_casing_variations() {
    // Variation 1: Strict camelCase (`replayGainTrackGain`, etc.)
    let v1 = r#"{
        "format": "WAV",
        "duration": {"secs": 100, "nanos": 0},
        "replayGainTrackGain": -6.5,
        "replayGainTrackPeak": 0.98,
        "replayGainAlbumGain": -5.1,
        "replayGainAlbumPeak": 1.0
    }"#;
    let m1: TrackMetadata = serde_json::from_str(v1).expect("camelCase v1 must deserialize");
    assert_eq!(m1.replaygain_track_gain, Some(-6.5));
    assert_eq!(m1.replaygain_track_peak, Some(0.98));
    assert_eq!(m1.replaygain_album_gain, Some(-5.1));
    assert_eq!(m1.replaygain_album_peak, Some(1.0));

    // Variation 2: Alternative camelCase (`replaygainTrackGain`, etc.)
    let v2 = r#"{
        "format": "WAV",
        "duration": {"secs": 100, "nanos": 0},
        "replaygainTrackGain": -7.2,
        "replaygainTrackPeak": 0.95,
        "replaygainAlbumGain": -4.8,
        "replaygainAlbumPeak": 0.99
    }"#;
    let m2: TrackMetadata = serde_json::from_str(v2).expect("camelCase v2 must deserialize");
    assert_eq!(m2.replaygain_track_gain, Some(-7.2));
    assert_eq!(m2.replaygain_track_peak, Some(0.95));
    assert_eq!(m2.replaygain_album_gain, Some(-4.8));
    assert_eq!(m2.replaygain_album_peak, Some(0.99));

    // Variation 3: Mixed casing across fields in TOML
    let v3_toml = r#"
format = "OGG"
replayGainTrackGain = -3.2
replaygainTrackPeak = 0.88
replaygain_album_gain = -2.1
replayGainAlbumPeak = 0.94

[duration]
secs = 100
nanos = 0
"#;
    let m3: TrackMetadata = toml::from_str(v3_toml).expect("Mixed casing in TOML must deserialize");
    assert_eq!(m3.replaygain_track_gain, Some(-3.2));
    assert_eq!(m3.replaygain_track_peak, Some(0.88));
    assert_eq!(m3.replaygain_album_gain, Some(-2.1));
    assert_eq!(m3.replaygain_album_peak, Some(0.94));
}

// ============================================================================
// 7. TrackMetadata ReplayGain Malformed and Type Fuzzing
// ============================================================================

#[test]
fn test_adversarial_track_metadata_replaygain_malformed_types() {
    let bad_cases = [
        r#"{"duration":{"secs":1,"nanos":0},"format":"FLAC","replaygain_track_gain":"loud"}"#,
        r#"{"duration":{"secs":1,"nanos":0},"format":"FLAC","replaygain_track_gain":true}"#,
        r#"{"duration":{"secs":1,"nanos":0},"format":"FLAC","replaygain_track_gain":[1.0]}"#,
        r#"{"duration":{"secs":1,"nanos":0},"format":"FLAC","replaygain_track_gain":{"val":1.0}}"#,
        r#"{"duration":{"secs":1,"nanos":0},"format":"FLAC","replaygain_track_peak":"invalid"}"#,
        r#"{"duration":{"secs":1,"nanos":0},"format":"FLAC","replaygain_album_gain":"invalid"}"#,
        r#"{"duration":{"secs":1,"nanos":0},"format":"FLAC","replaygain_album_peak":"invalid"}"#,
    ];

    for &bad in &bad_cases {
        let res: Result<TrackMetadata, _> = serde_json::from_str(bad);
        assert!(res.is_err(), "Malformed type in JSON must be rejected: {}", bad);
    }

    let bad_tomls = [
        "format = \"FLAC\"\n[duration]\nsecs = 1\nnanos = 0\nreplaygain_track_gain = \"loud\"\n",
        "format = \"FLAC\"\n[duration]\nsecs = 1\nnanos = 0\nreplaygain_track_gain = true\n",
        "format = \"FLAC\"\n[duration]\nsecs = 1\nnanos = 0\nreplaygain_track_gain = [1.0]\n",
    ];

    for &bad in &bad_tomls {
        let res: Result<TrackMetadata, _> = toml::from_str(bad);
        assert!(res.is_err(), "Malformed type in TOML must be rejected: {}", bad);
    }
}

// ============================================================================
// 8. TrackMetadata ReplayGain Omitted Fields / Backward Compatibility
// ============================================================================

#[test]
fn test_adversarial_track_metadata_replaygain_omitted_roundtrip_skip_none() {
    let meta_none = TrackMetadata {
        title: Some("No RG Track".into()),
        duration: Duration::from_secs(180),
        format: "MP3".into(),
        replaygain_track_gain: None,
        replaygain_track_peak: None,
        replaygain_album_gain: None,
        replaygain_album_peak: None,
        ..Default::default()
    };

    // In JSON, skip_serializing_if = "Option::is_none" ensures zero ReplayGain keys
    let json = serde_json::to_string(&meta_none).expect("Serialization must succeed");
    assert!(!json.contains("replaygain"));
    assert!(!json.contains("replayGain"));

    // In TOML, None fields should also be omitted
    let toml_str = toml::to_string(&meta_none).expect("TOML serialization must succeed");
    assert!(!toml_str.contains("replaygain"));
    assert!(!toml_str.contains("replayGain"));

    // Deserialization with keys omitted must reconstruct None
    let de_json: TrackMetadata = serde_json::from_str(&json).expect("Deserialization must succeed");
    assert_eq!(de_json.replaygain_track_gain, None);
    assert_eq!(de_json.replaygain_track_peak, None);
    assert_eq!(de_json.replaygain_album_gain, None);
    assert_eq!(de_json.replaygain_album_peak, None);

    let de_toml: TrackMetadata = toml::from_str(&toml_str).expect("TOML deserialization must succeed");
    assert_eq!(de_toml.replaygain_track_gain, None);
    assert_eq!(de_toml.replaygain_track_peak, None);
    assert_eq!(de_toml.replaygain_album_gain, None);
    assert_eq!(de_toml.replaygain_album_peak, None);
}

// ============================================================================
// 9. Large-Scale Randomized Fuzzing on Serde (Zero Panics)
// ============================================================================

#[test]
fn test_adversarial_serde_randomized_fuzzing_zero_panics() {
    let mut rng = FuzzRng::new(0x9E3779B97F4A7C15);

    // 10,000 randomized byte chunks tested against JSON and TOML deserializers
    for _iteration in 0..10_000 {
        let len = rng.next_usize(256);
        let mut bytes = Vec::with_capacity(len);
        for _ in 0..len {
            bytes.push(rng.next_u64() as u8);
        }

        // Test as UTF-8 string if valid, or with lossy conversion
        let text = String::from_utf8_lossy(&bytes);

        // WaveformData deserialization from arbitrary garbage must NEVER panic
        let _ = serde_json::from_str::<WaveformData>(&text);
        let _ = toml::from_str::<WaveformData>(&text);

        // TrackMetadata deserialization from arbitrary garbage must NEVER panic
        let _ = serde_json::from_str::<TrackMetadata>(&text);
        let _ = toml::from_str::<TrackMetadata>(&text);
    }
}

// ============================================================================
// 10. Scientific Notation, Integer Values, and Duplicate Aliases
// ============================================================================

#[test]
fn test_adversarial_serde_scientific_notation_and_integers() {
    // 1. Integer values for float fields in JSON
    let json_ints = r#"{
        "track_id": "track-ints",
        "version": 1,
        "points": [0, 1, 0, 1]
    }"#;
    let wf_ints: WaveformData = serde_json::from_str(json_ints).expect("Integers in points array must deserialize to f32");
    assert_eq!(wf_ints.points, vec![0.0, 1.0, 0.0, 1.0]);

    // 2. Scientific notation in points
    let json_sci = r#"{
        "track_id": "track-sci",
        "version": 1,
        "points": [1e-1, 5e-1, 1e0, 2.5e-2]
    }"#;
    let wf_sci: WaveformData = serde_json::from_str(json_sci).expect("Scientific notation in points must deserialize");
    assert_eq!(wf_sci.points, vec![0.1, 0.5, 1.0, 0.025]);

    // 3. Integer and scientific notation in TrackMetadata ReplayGain
    let meta_json = r#"{
        "format": "FLAC",
        "duration": {"secs": 180, "nanos": 0},
        "replaygain_track_gain": -6,
        "replaygain_track_peak": 1,
        "replaygain_album_gain": -5.5e0,
        "replaygain_album_peak": 9.88e-1
    }"#;
    let meta: TrackMetadata = serde_json::from_str(meta_json).expect("Integer and scientific ReplayGain values must deserialize");
    assert_eq!(meta.replaygain_track_gain, Some(-6.0));
    assert_eq!(meta.replaygain_track_peak, Some(1.0));
    assert_eq!(meta.replaygain_album_gain, Some(-5.5));
    assert_eq!(meta.replaygain_album_peak, Some(0.988));

    // 4. Duplicate alias keys in JSON: serde cleanly rejects duplicate keys without panicking
    let dup_json = r#"{
        "format": "FLAC",
        "duration": {"secs": 100, "nanos": 0},
        "replaygain_track_gain": -6.0,
        "replayGainTrackGain": -7.5
    }"#;
    let dup_meta: Result<TrackMetadata, _> = serde_json::from_str(dup_json);
    assert!(dup_meta.is_err(), "Duplicate alias keys must be rejected cleanly by serde without panic");
}

// ============================================================================
// 11. Unicode, Extreme String Lengths, and Control Characters
// ============================================================================

#[test]
fn test_adversarial_waveform_track_id_special_strings() {
    let special_ids = [
        "", // empty track ID
        "   ", // whitespace only
        "track/with/forward/slashes",
        "track\\with\\backslashes",
        "../../etc/shadow",
        "null\0byte\0injection",
        "🔥🎧🎵🚀⚡️", // multi-byte emojis
        "日本語のタイトル_композиция", // Cyrillic and CJK
        "\t\r\n\x01\x1F", // ASCII control chars
    ];

    for &id in &special_ids {
        let wf = WaveformData::new(id, 1, vec![0.5; 100]);
        let json = serde_json::to_string(&wf).expect("Serialization with special track_id must succeed");
        let parsed: WaveformData = serde_json::from_str(&json).expect("Deserialization with special track_id must succeed");
        assert_eq!(parsed.track_id, id);
        assert!(parsed.is_valid_100_point_envelope());
    }

    // 100,000 character track ID
    let huge_id = "A".repeat(100_000);
    let wf_huge = WaveformData::new(&huge_id, 1, vec![0.2; 100]);
    let json_huge = serde_json::to_string(&wf_huge).expect("Serialization of huge ID must succeed");
    let de_huge: WaveformData = serde_json::from_str(&json_huge).expect("Deserialization of huge ID must succeed");
    assert_eq!(de_huge.track_id.len(), 100_000);
    assert!(de_huge.is_valid_100_point_envelope());
}

// ============================================================================
// 12. Quiet and Signaling NaNs, Subnormals, and IEEE 754 Bit Patterns
// ============================================================================

#[test]
fn test_adversarial_waveform_ieee754_nan_variants() {
    // Quiet NaN and Signaling NaN bit patterns
    let qnan = f32::from_bits(0x7fc00000);
    let snan = f32::from_bits(0x7f800001);
    let pos_inf = f32::from_bits(0x7f800000);
    let neg_inf = f32::from_bits(0xff800000);
    let subnormal_min = f32::from_bits(1); // smallest non-zero denormal float
    let subnormal_max = f32::from_bits(0x007fffff); // largest denormal float

    assert!(qnan.is_nan());
    assert!(snan.is_nan());
    assert!(pos_inf.is_infinite());
    assert!(neg_inf.is_infinite());

    // Subnormals are positive and in [0.0, 1.0]
    let subnormal_envelope = vec![subnormal_min; 100];
    let wf_sub = WaveformData::new("subnormal-min", 1, subnormal_envelope);
    assert!(wf_sub.is_valid_100_point_envelope());

    let subnormal_max_envelope = vec![subnormal_max; 100];
    let wf_sub_max = WaveformData::new("subnormal-max", 1, subnormal_max_envelope);
    assert!(wf_sub_max.is_valid_100_point_envelope());

    // NaNs must be rejected
    let mut qnan_points = vec![0.5f32; 100];
    qnan_points[42] = qnan;
    assert!(!WaveformData::new("qnan", 1, qnan_points).is_valid_100_point_envelope());

    let mut snan_points = vec![0.5f32; 100];
    snan_points[42] = snan;
    assert!(!WaveformData::new("snan", 1, snan_points).is_valid_100_point_envelope());

    // Infinities must be rejected
    let mut pos_inf_points = vec![0.5f32; 100];
    pos_inf_points[0] = pos_inf;
    assert!(!WaveformData::new("pos-inf", 1, pos_inf_points).is_valid_100_point_envelope());

    let mut neg_inf_points = vec![0.5f32; 100];
    neg_inf_points[99] = neg_inf;
    assert!(!WaveformData::new("neg-inf", 1, neg_inf_points).is_valid_100_point_envelope());
}

// ============================================================================
// 13. Concurrency, Send + Sync Bounds, and Thread Safety
// ============================================================================

#[test]
fn test_adversarial_thread_safety_and_send_sync_bounds() {
    use std::sync::Arc;
    use std::thread;

    let points = vec![0.5f32; 100];
    let wf = Arc::new(WaveformData::new("thread-test", 1, points));
    let meta = Arc::new(TrackMetadata {
        title: Some("Thread Song".into()),
        duration: Duration::from_secs(180),
        format: "FLAC".into(),
        replaygain_track_gain: Some(-6.5),
        replaygain_track_peak: Some(0.98),
        replaygain_album_gain: Some(-5.0),
        replaygain_album_peak: Some(1.0),
        ..Default::default()
    });

    let mut handles = Vec::new();
    for thread_idx in 0..16 {
        let wf_clone = Arc::clone(&wf);
        let meta_clone = Arc::clone(&meta);

        handles.push(thread::spawn(move || {
            for _ in 0..100 {
                assert!(wf_clone.is_valid_100_point_envelope());
                let json = serde_json::to_string(&*wf_clone).expect("Thread JSON failed");
                let de_wf: WaveformData = serde_json::from_str(&json).expect("Thread de failed");
                assert_eq!(de_wf.version, 1);

                let meta_json = serde_json::to_string(&*meta_clone).expect("Thread meta JSON failed");
                let de_meta: TrackMetadata = serde_json::from_str(&meta_json).expect("Thread meta de failed");
                assert_eq!(de_meta.replaygain_track_gain, Some(-6.5));
            }
            thread_idx
        }));
    }

    for handle in handles {
        let _ = handle.join().expect("Worker thread panicked");
    }
}

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use std::fs::{self, File};
use std::io::Write;
use std::sync::Arc;
use tower::ServiceExt;
use wavery_core::models::ImportStrategy;
use wavery_core::traits::LibraryManager;
use wavery_library::{LoftyMetadataReader, SqliteLibraryManager};
use wavery_server::{build_router, AppState};

struct TestFixture {
    temp_dir: std::path::PathBuf,
    app: axum::Router,
    track_id: String,
    expected_data: Vec<u8>,
}

impl TestFixture {
    async fn new(file_size: usize) -> Self {
        let temp_dir = std::env::temp_dir().join(format!("wavery_srv_challenge_{}", uuid::Uuid::new_v4()));
        let lib_dir = temp_dir.join("library");
        let db_path = temp_dir.join("library.db");
        fs::create_dir_all(&lib_dir).unwrap();

        let mut manager = SqliteLibraryManager::new(lib_dir.clone(), db_path).unwrap();

        let expected_data: Vec<u8> = (0..file_size).map(|i| ((i * 7 + 13) % 256) as u8).collect();
        let song_path = temp_dir.join("challenge_track.mp3");
        {
            let mut f = File::create(&song_path).unwrap();
            f.write_all(&expected_data).unwrap();
        }

        let track = manager.import_track(&song_path, ImportStrategy::Copy).await.unwrap();

        let state = Arc::new(AppState::new(
            Arc::new(tokio::sync::Mutex::new(manager)),
            LoftyMetadataReader::new(),
            None,
        ));

        let app = build_router(state);

        Self {
            temp_dir,
            app,
            track_id: track.id,
            expected_data,
        }
    }
}

impl Drop for TestFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp_dir);
    }
}

/// Adversarial Challenge 1: Single-byte file boundary conditions.
#[tokio::test]
async fn test_challenge_single_byte_file_range_boundaries() {
    let fixture = TestFixture::new(1).await;
    let track_id = &fixture.track_id;

    // 1. bytes=0-0 -> 206 Partial Content (1 byte)
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=0-0")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-0/1");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1");
    let body = to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], &fixture.expected_data[0..1]);

    // 2. bytes=0- -> 206 Partial Content (1 byte)
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=0-")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-0/1");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1");

    // 3. bytes=-1 -> 206 Partial Content (1 byte)
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=-1")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-0/1");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1");

    // 4. Out-of-bounds start: bytes=1-1 -> 416
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=1-1")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes */1");

    // 5. Out-of-bounds open: bytes=1- -> 416
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=1-")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);

    // 6. Suffix larger than 1 byte: bytes=-10 -> 206 clamped to full representation
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=-10")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-0/1");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1");
}

/// Adversarial Challenge 2: Large payload exact boundaries (5,000 bytes).
#[tokio::test]
async fn test_challenge_exact_byte_boundaries_and_clamping() {
    let size = 5000;
    let fixture = TestFixture::new(size).await;
    let track_id = &fixture.track_id;

    // 1. Exact first byte (0-0)
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=0-0")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-0/5000");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1");
    let body = to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], &fixture.expected_data[0..1]);

    // 2. Exact last byte (4999-4999)
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=4999-4999")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 4999-4999/5000");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1");
    let body = to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], &fixture.expected_data[4999..5000]);

    // 3. Exact last 100 bytes (4900-4999)
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=4900-4999")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 4900-4999/5000");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "100");
    let body = to_bytes(res.into_body(), 2048).await.unwrap();
    assert_eq!(&body[..], &fixture.expected_data[4900..5000]);

    // 4. Suffix range -100 (bytes 4900-4999)
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=-100")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 4900-4999/5000");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "100");
    let body = to_bytes(res.into_body(), 2048).await.unwrap();
    assert_eq!(&body[..], &fixture.expected_data[4900..5000]);

    // 5. Open-ended range: bytes=4500-
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=4500-")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 4500-4999/5000");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "500");
    let body = to_bytes(res.into_body(), 2048).await.unwrap();
    assert_eq!(&body[..], &fixture.expected_data[4500..5000]);

    // 6. Oversized end clamped to max_pos: bytes=4900-99999
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=4900-99999")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 4900-4999/5000");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "100");

    // 7. Suffix larger than file: bytes=-100000
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=-100000")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-4999/5000");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "5000");
    let body = to_bytes(res.into_body(), 10000).await.unwrap();
    assert_eq!(&body[..], &fixture.expected_data[..]);

    // 8. Out of bounds start at boundary: bytes=5000-5000 -> 416
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=5000-5000")
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes */5000");
}

/// Adversarial Challenge 3: Negative byte ranges, inverted bounds, and malformed syntax.
#[tokio::test]
async fn test_challenge_negative_inverted_and_malformed_ranges() {
    let size = 2000;
    let fixture = TestFixture::new(size).await;
    let track_id = &fixture.track_id;

    let invalid_headers = [
        // Suffix length of zero (RFC 9110 §14.1.2)
        "bytes=-0",
        // Inverted range (start > end)
        "bytes=1000-500",
        "bytes=1999-0",
        "bytes=500-499",
        // Malformed dashes / negative numbers
        "bytes=-100-200",
        "bytes=100--200",
        "bytes=--100",
        "bytes=---",
        "bytes=-",
        "bytes= - ",
        "bytes=0- -5",
        "bytes=500--600",
        // Missing range values
        "bytes=",
        "bytes=abc",
        "bytes=abc-def",
        "bytes=100-abc",
        "bytes=abc-100",
        // Multi-range requests (not supported, safely rejected with 416)
        "bytes=0-100, 200-300",
        "bytes=0-50, 25-75",
        "bytes=0-10, 20-30, 40-50",
        // Alternate units
        "items=0-100",
        "characters=0-100",
        "bits=0-1000",
        // Malformed prefix
        "byte=0-100",
        "bytes 0-100",
        "bytes: 0-100",
        // Special character payloads
        "bytes=' OR 1=1 --",
        "bytes=1e2-1e3",
        "bytes=0x10-0x20",
    ];

    for hdr in invalid_headers {
        let req = Request::builder()
            .uri(format!("/api/stream/{track_id}"))
            .header(header::RANGE, hdr)
            .body(Body::empty())
            .unwrap();
        let res = fixture.app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::RANGE_NOT_SATISFIABLE,
            "Header '{hdr}' should yield 416 Range Not Satisfiable, got {:?}",
            res.status()
        );
        assert_eq!(
            res.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes */2000",
            "Header '{hdr}' Content-Range header mismatch"
        );
        assert_eq!(
            res.headers().get(header::ACCEPT_RANGES).unwrap(),
            "bytes"
        );
    }

    // Explicitly test plus-signed range parsing behavior
    let plus_req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, "bytes=+0-+100")
        .body(Body::empty())
        .unwrap();
    let plus_res = fixture.app.clone().oneshot(plus_req).await.unwrap();
    assert_eq!(plus_res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(plus_res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-100/2000");
}

/// Adversarial Challenge 4: Extreme ranges, integer overflows, and u64 bounds.
#[tokio::test]
async fn test_challenge_extreme_ranges_and_u64_limits() {
    let size = 1000;
    let fixture = TestFixture::new(size).await;
    let track_id = &fixture.track_id;

    // 1. u64::MAX as upper bound -> clamped to file length - 1
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, format!("bytes=0-{}", u64::MAX))
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-999/1000");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1000");

    // 2. u64::MAX as start bound -> 416 Range Not Satisfiable
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, format!("bytes={}-{}", u64::MAX, u64::MAX))
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);

    // 3. Integer overflow string (> u64::MAX)
    let overflow_str = "18446744073709551616";
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, format!("bytes=0-{overflow_str}"))
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);

    // 4. Extreme number of digits
    let massive_digits = "99999999999999999999999999999999999999999999999999";
    let req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .header(header::RANGE, format!("bytes=0-{massive_digits}"))
        .body(Body::empty())
        .unwrap();
    let res = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

/// Adversarial Challenge 5: Concurrent stream ranges and full content validation.
#[tokio::test]
async fn test_challenge_concurrent_streaming_and_full_content() {
    let size = 10_000;
    let fixture = TestFixture::new(size).await;
    let track_id = fixture.track_id.clone();
    let app = fixture.app.clone();
    let expected = fixture.expected_data.clone();

    // 1. Full content request without Range header -> 200 OK
    let full_req = Request::builder()
        .uri(format!("/api/stream/{track_id}"))
        .body(Body::empty())
        .unwrap();
    let full_res = app.clone().oneshot(full_req).await.unwrap();
    assert_eq!(full_res.status(), StatusCode::OK);
    assert_eq!(full_res.headers().get(header::CONTENT_LENGTH).unwrap(), "10000");
    assert_eq!(full_res.headers().get(header::ACCEPT_RANGES).unwrap(), "bytes");
    let full_body = to_bytes(full_res.into_body(), 20_000).await.unwrap();
    assert_eq!(&full_body[..], &expected[..]);

    // 2. 25 concurrent range slice requests verifying zero data corruption
    let mut tasks = Vec::new();
    for i in 0..25 {
        let app_clone = app.clone();
        let tid = track_id.clone();
        let exp = expected.clone();

        let start = i * 400;
        let end = start + 399;

        tasks.push(tokio::spawn(async move {
            let req = Request::builder()
                .uri(format!("/api/stream/{tid}"))
                .header(header::RANGE, format!("bytes={start}-{end}"))
                .body(Body::empty())
                .unwrap();
            let res = app_clone.oneshot(req).await.unwrap();
            assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(
                res.headers().get(header::CONTENT_RANGE).unwrap(),
                &format!("bytes {start}-{end}/10000")
            );
            assert_eq!(
                res.headers().get(header::CONTENT_LENGTH).unwrap(),
                "400"
            );
            let body = to_bytes(res.into_body(), 1024).await.unwrap();
            assert_eq!(&body[..], &exp[start..=end]);
        }));
    }

    for t in tasks {
        t.await.unwrap();
    }
}

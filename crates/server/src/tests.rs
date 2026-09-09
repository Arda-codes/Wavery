use crate::{build_router, parse_range_header, AppState, ArtworkCache, CachedArtwork};
use axum::body::{to_bytes, Body, Bytes};
use axum::http::{header, Request, StatusCode};
use std::fs::{self, File};
use std::io::Write;
use std::sync::Arc;
use tower::ServiceExt;
use wavery_core::models::ImportStrategy;
use wavery_core::traits::LibraryManager;
use wavery_library::{LoftyMetadataReader, SqliteLibraryManager};

#[tokio::test]
async fn test_server_health_and_stream_range() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_srv_{}", uuid::Uuid::new_v4()));
    let lib_dir = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&lib_dir).unwrap();

    let mut manager = SqliteLibraryManager::new(lib_dir.clone(), db_path).unwrap();

    // Create sample audio file with 14 bytes
    let song_path = temp_dir.join("sample.mp3");
    {
        let mut f = File::create(&song_path).unwrap();
        f.write_all(&[0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xAA, 0xBB, 0xCC, 0xDD]).unwrap();
    }

    let track = manager.import_track(&song_path, ImportStrategy::Copy).await.unwrap();

    let state = Arc::new(AppState::new(
        Arc::new(tokio::sync::Mutex::new(manager)),
        LoftyMetadataReader::new(),
        None,
    ));

    let app = build_router(state);

    // 1. Test /api/health
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);

    // 2. Test Range Request on /api/stream/{id}
    let stream_req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=0-3")
        .body(Body::empty())
        .unwrap();

    let stream_res = app.clone().oneshot(stream_req).await.unwrap();
    assert_eq!(stream_res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        stream_res.headers().get(header::CONTENT_RANGE).unwrap(),
        "bytes 0-3/14"
    );

    // 3. Test Suffix Range Request
    let suffix_req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=-4")
        .body(Body::empty())
        .unwrap();

    let suffix_res = app.clone().oneshot(suffix_req).await.unwrap();
    assert_eq!(suffix_res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        suffix_res.headers().get(header::CONTENT_RANGE).unwrap(),
        "bytes 10-13/14"
    );

    // 4. Test Out-of-Bounds Range (Expect 416 Range Not Satisfiable)
    let bad_range_req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=100-200")
        .body(Body::empty())
        .unwrap();

    let bad_range_res = app.clone().oneshot(bad_range_req).await.unwrap();
    assert_eq!(bad_range_res.status(), StatusCode::RANGE_NOT_SATISFIABLE);

    // 5. Test Full Content Request (No Range Header)
    let full_stream_req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .body(Body::empty())
        .unwrap();

    let full_res = app.oneshot(full_stream_req).await.unwrap();
    assert_eq!(full_res.status(), StatusCode::OK);
    assert_eq!(
        full_res.headers().get(header::CONTENT_LENGTH).unwrap(),
        "14"
    );

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_server_comprehensive_range_streaming_and_edge_cases() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_srv_range_{}", uuid::Uuid::new_v4()));
    let lib_dir = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&lib_dir).unwrap();

    let mut manager = SqliteLibraryManager::new(lib_dir.clone(), db_path).unwrap();

    // 20-byte test file with sequential bytes 0..20
    let test_bytes: Vec<u8> = (0..20).collect();
    let file_path = temp_dir.join("stream_test.mp3");
    fs::write(&file_path, &test_bytes).unwrap();

    let track = manager.import_track(&file_path, ImportStrategy::Copy).await.unwrap();

    let state = Arc::new(AppState::new(
        Arc::new(tokio::sync::Mutex::new(manager)),
        LoftyMetadataReader::new(),
        None,
    ));

    let app = build_router(state.clone());

    // Case 1: Exact single-byte start: bytes=0-0
    let req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=0-0")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-0/20");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1");
    let body = to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], &[0]);

    // Case 2: Exact single-byte end: bytes=19-19
    let req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=19-19")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 19-19/20");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "1");
    let body = to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], &[19]);

    // Case 3: Middle slice: bytes=5-10
    let req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=5-10")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 5-10/20");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "6");
    let body = to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], &[5, 6, 7, 8, 9, 10]);

    // Case 4: Open-ended range: bytes=15-
    let req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=15-")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 15-19/20");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "5");
    let body = to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], &[15, 16, 17, 18, 19]);

    // Case 5: Suffix range larger than file: bytes=-50
    let req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=-50")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes 0-19/20");
    assert_eq!(res.headers().get(header::CONTENT_LENGTH).unwrap(), "20");
    let body = to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], &test_bytes[..]);

    // Case 6: Invalid start > end: bytes=15-10
    let req = Request::builder()
        .uri(format!("/api/stream/{}", track.id))
        .header(header::RANGE, "bytes=15-10")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(res.headers().get(header::CONTENT_RANGE).unwrap(), "bytes */20");

    // Case 7: Non-existent track ID: /api/stream/ghost_id -> 404
    let req = Request::builder()
        .uri("/api/stream/ghost_id")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // Case 8: Track in DB but underlying file removed from disk -> 404
    let deleted_song = temp_dir.join("deleted.mp3");
    fs::write(&deleted_song, b"temp content").unwrap();
    let deleted_track = {
        let mut lib = state.library.lock().await;
        lib.import_track(&deleted_song, ImportStrategy::Move).await.unwrap()
    };
    // Physically delete file from disk
    let _ = fs::remove_file(deleted_track.source.path());

    let req = Request::builder()
        .uri(format!("/api/stream/{}", deleted_track.id))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_server_mime_types_for_audio_formats() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_srv_mimes_{}", uuid::Uuid::new_v4()));
    let lib_dir = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&lib_dir).unwrap();

    let mut manager = SqliteLibraryManager::new(lib_dir.clone(), db_path).unwrap();

    let formats = [
        ("flac", "audio/flac"),
        ("ogg", "audio/ogg"),
        ("opus", "audio/opus"),
        ("m4a", "audio/mp4"),
        ("wav", "audio/wav"),
        ("aac", "audio/aac"),
        ("unknown", "application/octet-stream"),
    ];

    let mut track_map = Vec::new();

    for (ext, expected_mime) in formats {
        let file_path = temp_dir.join(format!("audio.{ext}"));
        fs::write(&file_path, b"test_audio_data_content").unwrap();
        let track = manager.import_track(&file_path, ImportStrategy::Copy).await.unwrap();
        track_map.push((track.id, expected_mime));
    }

    let state = Arc::new(AppState::new(
        Arc::new(tokio::sync::Mutex::new(manager)),
        LoftyMetadataReader::new(),
        None,
    ));

    let app = build_router(state);

    for (track_id, expected_mime) in track_map {
        let req = Request::builder()
            .uri(format!("/api/stream/{track_id}"))
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get(header::CONTENT_TYPE).unwrap(),
            expected_mime
        );
    }

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_artwork_cache_bounded_lru_eviction() {
    let mut cache = ArtworkCache::new(3, 1000);

    let art1 = CachedArtwork {
        data: Bytes::from_static(b"art1data"),
        mime_type: "image/jpeg".into(),
    };
    let art2 = CachedArtwork {
        data: Bytes::from_static(b"art2data"),
        mime_type: "image/jpeg".into(),
    };
    let art3 = CachedArtwork {
        data: Bytes::from_static(b"art3data"),
        mime_type: "image/jpeg".into(),
    };
    let art4 = CachedArtwork {
        data: Bytes::from_static(b"art4data"),
        mime_type: "image/jpeg".into(),
    };

    cache.insert("t1".into(), Some(art1));
    cache.insert("t2".into(), Some(art2));
    cache.insert("t3".into(), Some(art3));
    assert_eq!(cache.len(), 3);

    // Access t1 so recency becomes: t2 (oldest), t3, t1 (newest)
    assert!(cache.get("t1").is_some());

    // Insert t4: should evict t2 (the least recently used)
    cache.insert("t4".into(), Some(art4));
    assert_eq!(cache.len(), 3);
    assert!(cache.get("t2").is_none());
    assert!(cache.get("t1").is_some());
    assert!(cache.get("t3").is_some());
    assert!(cache.get("t4").is_some());
}

#[test]
fn test_artwork_cache_byte_bound_eviction() {
    // 50 bytes total capacity, max 10 entries
    let mut cache = ArtworkCache::new(10, 50);

    let art1 = CachedArtwork {
        data: Bytes::from(vec![0u8; 20]),
        mime_type: "image/png".into(),
    };
    let art2 = CachedArtwork {
        data: Bytes::from(vec![0u8; 20]),
        mime_type: "image/png".into(),
    };

    cache.insert("track_1".into(), Some(art1));
    assert!(cache.size_bytes() > 0);

    cache.insert("track_2".into(), Some(art2));

    // Large payload that exceeds 50 bytes total capacity
    let big_art = CachedArtwork {
        data: Bytes::from(vec![0u8; 35]),
        mime_type: "image/png".into(),
    };
    cache.insert("track_3".into(), Some(big_art));

    // Should have evicted older entries to stay within bounds
    assert!(cache.size_bytes() <= 50 || cache.len() == 1);
    assert!(cache.get("track_3").is_some());
}

#[test]
fn test_artwork_cache_replacement_and_capacity_hardening() {
    // 1. Minimum capacity clamping
    let zero_cache = ArtworkCache::new(0, 0);
    assert_eq!(zero_cache.max_entries(), 1);
    assert_eq!(zero_cache.max_bytes(), 1);

    // 2. Entry replacement byte accounting
    let mut cache = ArtworkCache::new(5, 500);

    let art_30 = CachedArtwork {
        data: Bytes::from(vec![0xAA; 30]),
        mime_type: "image/jpeg".into(), // 10 bytes
    };
    // Initial insert: "track_1" (7) + data (30) + mime (10) = 47 bytes
    cache.insert("track_1".into(), Some(art_30));
    let initial_bytes = cache.size_bytes();
    assert_eq!(initial_bytes, 47);

    // Replace with 40-byte artwork: "track_1" (7) + data (40) + mime (10) = 57 bytes
    let art_40 = CachedArtwork {
        data: Bytes::from(vec![0xBB; 40]),
        mime_type: "image/jpeg".into(),
    };
    cache.insert("track_1".into(), Some(art_40));
    assert_eq!(cache.len(), 1);
    assert_eq!(cache.size_bytes(), 57);

    // Replace with 10-byte artwork: "track_1" (7) + data (10) + mime (10) = 27 bytes
    let art_10 = CachedArtwork {
        data: Bytes::from(vec![0xCC; 10]),
        mime_type: "image/jpeg".into(),
    };
    cache.insert("track_1".into(), Some(art_10));
    assert_eq!(cache.len(), 1);
    assert_eq!(cache.size_bytes(), 27);

    // Replace with negative cache entry (None): "track_1" (7 bytes)
    cache.insert("track_1".into(), None);
    assert_eq!(cache.len(), 1);
    assert_eq!(cache.size_bytes(), 7);

    // 3. Oversized single entry eviction
    let mut small_cache = ArtworkCache::new(5, 80);
    small_cache.insert("t1".into(), Some(CachedArtwork {
        data: Bytes::from(vec![0x01; 20]),
        mime_type: "image/png".into(),
    }));
    small_cache.insert("t2".into(), Some(CachedArtwork {
        data: Bytes::from(vec![0x02; 20]),
        mime_type: "image/png".into(),
    }));
    assert_eq!(small_cache.len(), 2);

    // Insert oversized 80-byte artwork
    small_cache.insert("oversized".into(), Some(CachedArtwork {
        data: Bytes::from(vec![0x03; 80]),
        mime_type: "image/jpeg".into(),
    }));
    // All previous entries evicted
    assert_eq!(small_cache.len(), 1);
    assert!(small_cache.get("t1").is_none());
    assert!(small_cache.get("t2").is_none());
    assert!(small_cache.get("oversized").is_some());
}

#[test]
fn test_artwork_cache_negative_and_clear() {
    let mut cache = ArtworkCache::new(5, 1024);
    cache.insert("no_art".into(), None);

    assert_eq!(cache.len(), 1);
    let cached = cache.get("no_art");
    assert_eq!(cached, Some(None));

    cache.clear();
    assert_eq!(cache.len(), 0);
    assert!(cache.is_empty());
    assert_eq!(cache.size_bytes(), 0);
}

#[test]
fn test_range_parser() {
    assert_eq!(parse_range_header("bytes=0-100", 1000), Some((0, 100)));
    assert_eq!(parse_range_header("bytes=500-", 1000), Some((500, 999)));
    assert_eq!(parse_range_header("bytes=-200", 1000), Some((800, 999)));
    assert_eq!(parse_range_header("bytes=0-2000", 1000), Some((0, 999)));
    assert_eq!(parse_range_header("bytes=1000-1500", 1000), None);
    assert_eq!(parse_range_header("bytes=500-200", 1000), None);
    assert_eq!(parse_range_header("invalid", 1000), None);
    assert_eq!(parse_range_header("bytes=0-10", 0), None);
    assert_eq!(parse_range_header("bytes=-0", 1000), None);
    assert_eq!(parse_range_header("bytes=abc-def", 1000), None);
    assert_eq!(parse_range_header("items=0-10", 1000), None);
}

#[tokio::test]
async fn test_artwork_cache_concurrent_rwlock_stress() {
    let cache = Arc::new(tokio::sync::RwLock::new(ArtworkCache::new(32, 10 * 1024)));
    let mut handles = Vec::new();

    for t in 0..8 {
        let c = Arc::clone(&cache);
        handles.push(tokio::spawn(async move {
            for i in 0..1000 {
                let track_id = format!("track_{}", (t * 50 + i) % 100);
                if i % 3 == 0 {
                    let mut write_guard = c.write().await;
                    let payload = CachedArtwork {
                        data: Bytes::from(vec![0xAA; (i % 50) + 1]),
                        mime_type: "image/jpeg".into(),
                    };
                    write_guard.insert(track_id, Some(payload));
                    assert!(write_guard.len() <= 32);
                } else {
                    let mut write_guard = c.write().await;
                    let _ = write_guard.get(&track_id);
                    assert!(write_guard.len() <= 32);
                }
            }
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    let final_guard = cache.read().await;
    assert!(final_guard.len() <= 32);
}

#[tokio::test]
async fn test_server_config_endpoints_and_persistence() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_srv_cfg_{}", uuid::Uuid::new_v4()));
    let lib_dir = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    let cfg_path = temp_dir.join("config.toml");
    fs::create_dir_all(&lib_dir).unwrap();

    let manager = SqliteLibraryManager::new(lib_dir, db_path).unwrap();
    let initial_config = wavery_config::Config::default();
    wavery_config::save(&cfg_path, &initial_config).unwrap();

    let state = Arc::new(AppState::with_config(
        Arc::new(tokio::sync::Mutex::new(manager)),
        LoftyMetadataReader::new(),
        None,
        initial_config,
        cfg_path.clone(),
    ));

    let app = build_router(state);

    // 1. GET /api/config
    let req = Request::builder()
        .uri("/api/config")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = to_bytes(res.into_body(), 1024 * 64).await.unwrap();
    let fetched_cfg: wavery_config::Config = serde_json::from_slice(&body).unwrap();
    assert_eq!(fetched_cfg.general.language, "en");

    // 2. POST /api/config (update settings)
    let mut updated_cfg = fetched_cfg.clone();
    updated_cfg.general.language = "de".into();
    updated_cfg.theme.mode = wavery_config::ThemeMode::Midnight;
    updated_cfg.audio.default_volume = 0.55;
    updated_cfg.ui.simplify_mode = true;
    updated_cfg.ui.album_grid_size = "compact".into();

    let save_body = serde_json::to_vec(&updated_cfg).unwrap();
    let save_req = Request::builder()
        .uri("/api/config")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(save_body))
        .unwrap();
    let save_res = app.clone().oneshot(save_req).await.unwrap();
    assert_eq!(save_res.status(), StatusCode::OK);

    // Verify it was persisted to config.toml on disk
    let disk_cfg = wavery_config::load_or_create(&cfg_path).unwrap();
    assert_eq!(disk_cfg.general.language, "de");
    assert_eq!(disk_cfg.theme.mode, wavery_config::ThemeMode::Midnight);
    assert!((disk_cfg.audio.default_volume - 0.55).abs() < f32::EPSILON);
    assert!(disk_cfg.ui.simplify_mode);
    assert_eq!(disk_cfg.ui.album_grid_size, "compact");

    // 3. GET /api/config/export
    let export_req = Request::builder()
        .uri("/api/config/export")
        .body(Body::empty())
        .unwrap();
    let export_res = app.clone().oneshot(export_req).await.unwrap();
    assert_eq!(export_res.status(), StatusCode::OK);
    let export_body = to_bytes(export_res.into_body(), 1024 * 64).await.unwrap();
    let exported_cfg: wavery_config::Config = serde_json::from_slice(&export_body).unwrap();
    assert_eq!(exported_cfg.general.language, "de");

    // 4. POST /api/config/import
    let mut imported_target = disk_cfg.clone();
    imported_target.general.language = "es".into();
    let import_payload = serde_json::json!({
        "json_str": serde_json::to_string(&imported_target).unwrap()
    });
    let import_req = Request::builder()
        .uri("/api/config/import")
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&import_payload).unwrap()))
        .unwrap();
    let import_res = app.clone().oneshot(import_req).await.unwrap();
    assert_eq!(import_res.status(), StatusCode::OK);

    let disk_reloaded = wavery_config::load_or_create(&cfg_path).unwrap();
    assert_eq!(disk_reloaded.general.language, "es");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_server_tray_initialization_and_display_urls() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_tray_test_{}", uuid::Uuid::new_v4()));
    let lib_dir = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&lib_dir).unwrap();

    let manager = SqliteLibraryManager::new(lib_dir, db_path).unwrap();
    let mut config = wavery_config::Config::default();
    config.server.host = "127.0.0.1".into();
    config.server.port = 8765;

    let state = Arc::new(AppState::with_config(
        Arc::new(tokio::sync::Mutex::new(manager)),
        LoftyMetadataReader::new(),
        None,
        config.clone(),
        temp_dir.join("config.toml"),
    ));

    // Verify display target URL format
    let target_web_url = format!("http://{}:{}", config.server.host, config.server.port);
    assert_eq!(target_web_url, "http://127.0.0.1:8765");

    // Test project root discovery
    let root = crate::find_project_root();
    assert!(root.exists(), "Project root directory must exist");

    // Verify WaveryServerTray menu item generation
    let tray = crate::tray::WaveryServerTray::new(state.clone());
    assert_eq!(tray.id(), "wavery-server");
    assert_eq!(tray.title(), "Wavery");

    #[cfg(target_os = "linux")]
    {
        use ksni::Tray;
        let menu_items = tray.menu();
        assert!(!menu_items.is_empty(), "Tray menu items must not be empty");
    }

    #[cfg(not(target_os = "linux"))]
    {
        let manager = crate::tray::ServerTrayManager::try_new(state);
        assert!(manager.is_none());
    }

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_app_close_signal_broadcasting() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_signal_{}", uuid::Uuid::new_v4()));
    let lib_dir = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&lib_dir).unwrap();

    let manager = SqliteLibraryManager::new(lib_dir, db_path).unwrap();
    let state = Arc::new(AppState::new(
        Arc::new(tokio::sync::Mutex::new(manager)),
        LoftyMetadataReader::new(),
        None,
    ));

    let app = build_router(state.clone());

    // 1. Subscribe to app_signal_tx
    let mut rx = state.app_signal_tx.subscribe();

    // 2. Trigger /api/app/close-web
    let req = Request::builder()
        .method("POST")
        .uri("/api/app/close-web")
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 3. Verify signal received
    let sig = rx.recv().await.unwrap();
    assert_eq!(sig, "close");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_delete_track_endpoint_and_artwork_cache_eviction() {
    let temp_dir = std::env::temp_dir().join(format!("wavery_srv_del_{}", uuid::Uuid::new_v4()));
    let lib_dir = temp_dir.join("library");
    let db_path = temp_dir.join("library.db");
    fs::create_dir_all(&lib_dir).unwrap();

    let mut manager = SqliteLibraryManager::new(lib_dir.clone(), db_path).unwrap();

    let song_path = temp_dir.join("song_to_delete.mp3");
    {
        let mut f = File::create(&song_path).unwrap();
        f.write_all(&[0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xAA, 0xBB, 0xCC, 0xDD]).unwrap();
    }

    let track = manager.import_track(&song_path, ImportStrategy::Copy).await.unwrap();

    let state = Arc::new(AppState::new(
        Arc::new(tokio::sync::Mutex::new(manager)),
        LoftyMetadataReader::new(),
        None,
    ));

    // Prepopulate artwork cache for this track
    {
        let mut cache = state.artwork_cache.write().await;
        cache.insert(
            track.id.clone(),
            Some(CachedArtwork {
                data: Bytes::from_static(b"fake-art"),
                mime_type: "image/jpeg".to_string(),
            }),
        );
        assert_eq!(cache.len(), 1);
    }

    let app = build_router(state.clone());

    // 1. Send DELETE request to /api/tracks/{id}?remove_file=false
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/tracks/{}?remove_file=false", track.id))
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // 2. Verify track is removed from library
    {
        let lib = state.library.lock().await;
        assert!(lib.get_track(&track.id).is_none());
    }

    // 3. Verify artwork was evicted from cache
    {
        let mut cache = state.artwork_cache.write().await;
        assert!(cache.get(&track.id).is_none());
        assert_eq!(cache.len(), 0);
    }

    // 4. File should still exist since remove_file was false
    assert!(track.source.path().exists());

    // Import again and delete with remove_file=true
    let track2 = {
        let mut lib = state.library.lock().await;
        lib.import_track(&song_path, ImportStrategy::Copy).await.unwrap()
    };
    assert!(track2.source.path().exists());

    let req2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/tracks/{}?remove_file=true", track2.id))
        .body(Body::empty())
        .unwrap();

    let res2 = app.oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::NO_CONTENT);

    // File should be removed from disk
    assert!(!track2.source.path().exists());

    let _ = fs::remove_dir_all(&temp_dir);
}

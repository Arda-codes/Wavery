# Changelog

All notable changes to **Wavery** are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-11-09

Initial public release of **Wavery**, a modular, high-performance desktop and browser music player built with Rust, Tauri v2, and React.

### Added
- **Core Architecture**:
  - Pure domain traits (`PlayerEngine`, `LibraryManager`, `MetadataReader`, `QueueManager`, `MprisBridge`) decoupled from drivers.
  - Typed error handling across all workspace crates with zero `unwrap()` / `expect()` in production.
  - Atomic TOML configuration persistence with XDG path routing.
  - Crash handling with local XDG panic hook writing to `$XDG_DATA_HOME/wavery/crash.log`.
- **Audio Engine (`wavery-audio`)**:
  - High-precision playback backend powered by Rodio with 64KB ring buffers.
  - ReplayGain loudness normalization with anti-clipping peak limiter.
  - Equal-power mathematical crossfade curves.
  - Two-tier priority queue manager with shuffle history preservation and repeat modes (`Off`, `Track`, `Queue`).
  - Native playback support for FLAC, WAV, ALAC, MP3, AAC, OGG Vorbis, and Opus audio formats.
- **Library & Search (`wavery-library`)**:
  - SQLite storage with write-ahead logging (WAL) and memory-mapped I/O.
  - Full-text search (FTS5) with BM25 relevance ranking across 100,000+ tracks under 5ms.
  - High-performance parallel directory scanner with metadata extraction via Lofty.
  - Database health diagnostics, pruning, vacuuming, and automatic corrupted database quarantine.
  - Playlist import and export support (M3U, M3U8, JSON sidecars).
  - Waveform peak envelope generation (100-point normalized envelopes).
- **Desktop Shell (`wavery-tauri`)**:
  - Frameless desktop interface with native resize dragging physics and titlebar controls.
  - Linux MPRIS D-Bus integration via `zbus` supporting hardware media keys and notification widgets (`org.mpris.MediaPlayer2`).
  - System tray icon with quick playback controls and window minimize-to-tray.
  - Strict Content Security Policy (CSP) and capability isolation.
  - Native Linux package bundling for `.deb`, `.rpm`, and Arch Linux `.pkg.tar.zst`.
- **Local Streaming Server (`wavery-server`)**:
  - Standalone Axum daemon supporting RFC 7233 byte-range audio streaming (`206 Partial Content`).
  - Memory-bounded LRU album art cache with ETag caching.
  - Localhost security boundary middleware with CSRF protection against cross-origin requests.
  - UDP route-based LAN IP auto-discovery (RFC 1122).
  - Web UI fallback and responsive mobile Progressive Web App (PWA) client.
- **User Interface (`wavery-ui`)**:
  - Apple HIG aesthetic with translucent acrylic materials, subtle borders, and smooth spring physics.
  - Fully virtualized track tables using `@tanstack/react-virtual` maintaining O(1) DOM footprint.
  - Isolated 60fps / 120fps volume sliders and playback scrubber with VSync alignment.
  - Fullscreen playback view with synchronized live LRC lyrics scrolling and click-to-seek.
  - Offline cover indicator with automatic reconnection polling.
  - Customizable theme accents (Nord, Latte, Mocha, Sunset, OLED Dark, Glass).
  - Discord Rich Presence integration with track and album artwork display.
  - Keyboard navigation with configurable hotkeys.

### Security & Privacy
- **Zero Telemetry**: No tracking, analytics, user accounts, or external analytics SDKs.
- **Local-First**: All metadata, playback history, and configuration reside exclusively on the user's local disk.

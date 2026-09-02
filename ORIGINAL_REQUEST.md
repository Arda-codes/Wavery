# Original User Request

## 2026-08-31T14:59:33Z

Optimize the UI rendering performance, state management, library scanning throughput, and SQLite query efficiency across the Wavery desktop music player application.

Working directory: /home/arda/Desktop/Wavery
Integrity mode: development

## Requirements

### R1. Frontend UI & State Optimization
Optimize the React/Tauri frontend for maximum rendering efficiency and responsiveness:
- Ensure smooth, high-framerate virtualized track list and album grid rendering without stutter or frame drops.
- Optimize Zustand store subscriptions and component memoization to eliminate unnecessary re-renders during playback updates, seek events, and library changes.
- Ensure UI interactions (search filtering, track selection, queue reordering) feel instant.

### R2. Library Scanning & Database Query Optimization
Optimize the backend library indexing, tag extraction, and SQLite database operations in `wavery-library`:
- Improve scan and ingestion throughput for local audio directories using efficient parallel processing and batched database transactions.
- Optimize SQLite schema indexes and query execution for search, album/artist aggregation, track lookups, and playlist management.
- Ensure minimal memory footprint and fast startup retrieval when loading the cached library.

### R3. Architectural Boundaries & Code Integrity
Maintain the modular architecture and reliability standards across all modified crates and frontend code:
- Preserve hard crate boundaries (no concrete backend leakage across boundaries).
- Maintain robust typed error handling with zero `unwrap()` or `expect()` in production Rust code.
- Ensure all new or modified code passes full workspace tests and TypeScript compilation.

## Acceptance Criteria

### Automated Quality & Build Gates
- [ ] `cargo check --workspace` and `cargo test --workspace` succeed with zero compile errors and zero failing tests.
- [ ] `npm --prefix ui run build` (TypeScript check & Vite production build) completes with zero errors.

### Performance & User Experience
- [ ] Smooth scrolling and snappy navigation through large music libraries without UI freezes or dropped frames.
- [ ] Library scanning and query execution demonstrate measurable efficiency improvements with batched transactions and proper SQLite indexes.
- [ ] Clean, idiomatic Rust and TypeScript code adhering to workspace architectural guidelines.

## 2026-08-31T19:19:53Z

Comprehensive Codebase Polish, Strict Error Handling & Test Suite Expansion

Working directory: /home/arda/Desktop/Wavery
Integrity mode: development

Polish the entire Wavery codebase to production-grade quality, eliminating all compiler warnings, enforcing strict typed error handling without unwrap/expect, and substantially expanding automated unit tests, stress benchmarks, and integration coverage across all workspace crates and frontend components.

## Requirements

### R1. Zero Warnings, Strict Typed Error Handling & Code Quality
- Perform a thorough audit of all Rust workspace crates (`wavery-core`, `wavery-audio`, `wavery-library`, `wavery-server`, `wavery-tauri`, `wavery-config`, `wavery-mpris`):
  - Eliminate all compiler warnings (`cargo check --workspace --all-targets`), unused variables, dead code, and redundant clones.
  - Guarantee strict zero `unwrap()` or `expect()` policy in production code, converting any remaining unwraps to typed `thiserror` errors.
  - Hardened Tauri IPC command error reporting with clear, structured messages.
- Clean up frontend TypeScript codebase:
  - Ensure 100% clean `tsc` compilation with no untyped `any` leaks in critical state stores or service adapters.

### R2. Test Suite Expansion & Edge Case Hardening
- Substantially expand unit tests and integration tests in `crates/library`, `crates/audio`, `crates/server`, and `crates/config`:
  - Test SQLite FTS5 trigger sync, concurrent reads/writes under WAL mode, and database rebuild resilience.
  - Test corrupt audio file handling, missing metadata fallbacks, and multi-artist parser edge cases.
  - Test queue state transitions (shuffle, repeat, loop queue/track, linear boundaries).
  - Expand frontend empirical test suite to cover all views, settings actions, and store mutations.

### R3. Hard Architectural Boundary Verification
- Verify that crate boundaries remain impenetrable (no concrete backends like `rusqlite`, `lofty`, `rodio` leaking outside their designated crates).
- Ensure all backend actions are exposed via core trait abstractions (`LibraryManager`, `AudioBackend`).

## Acceptance Criteria

### Automated Gates & Verification
- [ ] `cargo check --workspace --all-targets` succeeds with zero warnings.
- [ ] `cargo test --workspace` passes all unit tests, integration tests, and benchmark suites with 100% success.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` completes with zero errors/warnings.
- [ ] `npm --prefix ui run build` and `npm --prefix ui test` succeed with zero errors.

## 2026-09-01T11:14:27Z

Implement and wire all unwired settings across the Wavery codebase (notifications on track change, dynamic keybindings, library auto-scan on startup, and system tray management), build a full system tray lifecycle allowing the player to live in the background and launch clients, and verify all functionality through automated test suites.

Working directory: /home/arda/Desktop/Wavery
Integrity mode: development

## Requirements

### R1. Complete Settings Wiring & Runtime Integration
- **Track Change Notifications (`notificationsEnabled`)**: Trigger desktop system notifications containing song title, artist, and album art whenever playback advances to a new track, respecting user notification permissions.
- **Dynamic Keybinding Engine (`keybindings`)**: Wire all configurable key combinations (`togglePlay`, `nextTrack`, `prevTrack`, `volumeUp`, `volumeDown`, `seekForward`, `seekBackward`, `openSearch`, `toggleMute`, `toggleFullscreen`, `toggleLyrics`) to active player and navigation actions dynamically from the settings store rather than hardcoded event checks.
- **Library Startup Scan (`autoScanOnStartup` / `scan_on_startup`)**: Trigger music directory scanning and tag indexing upon application startup when enabled, and bypass when disabled.

### R2. System Tray Integration & Client Launcher (`minimizeToTray`)
- Build a native system tray icon and menu integration.
- When `minimizeToTray` is enabled, closing or minimizing the main window hides it to the system tray while keeping the audio engine and streaming server active in the background.
- Include tray menu items for:
  - **Show / Hide Main Window**
  - **Playback Controls**: Play / Pause, Next Track, Previous Track
  - **Open Web Client**: Launches default browser at `http://127.0.0.1:4242`
  - **Quit Application**: Cleanly tears down the server, audio engine, and closes all processes.

### R3. Comprehensive Verification & Automated Tests
- Create unit and integration test suites covering:
  - Settings persistence, export/import, and runtime reactivity.
  - Notification dispatch on track transitions.
  - Keybinding dispatch and modifier key handling.
  - Tray event handlers and window lifecycle state management.
  - `cargo test --workspace` and `npm test` passing with zero failures.

## Acceptance Criteria

### Settings & Audio Engine
- [ ] Changing any setting in the UI immediately updates runtime behavior without requiring an application restart.
- [ ] Notifications display with correct metadata on track transition when `notificationsEnabled` is true, and remain silent when false.
- [ ] All configured keybindings in `keybindings` trigger their respective actions in the UI.
- [ ] When `autoScanOnStartup` is active, newly added audio files in the managed library directory are indexed on launch.

### System Tray & Background Lifecycle
- [ ] The app lives in the system tray when window is closed (if `minimizeToTray` is true).
- [ ] Clicking tray menu items triggers window toggle, playback actions, browser client launch, and clean exit.

### Automated Tests
- [ ] `cargo test --workspace` passes cleanly with all unit and integration tests green.
- [ ] Frontend tests in `ui/` pass with zero failures.

## 2026-09-01T20:51:33Z

Refine, harden, and elevate the Wavery backend and audio engine codebase across all Rust crates, ensuring strict modular boundary enforcement, robust audio playback and queue management, performant SQLite FTS5 indexing, and strict code quality standards.

Working directory: /home/arda/Desktop/Wavery
Integrity mode: development

## Requirements

### R1. Backend Architecture & Crate Boundary Enforcement
- Enforce strict crate boundaries and trait contracts (`wavery-core`, `wavery-config`, `wavery-audio`, `wavery-library`, `wavery-mpris`, `wavery-server`, `wavery-tauri`).
- Ensure domain models and core traits in `wavery-core` remain 100% agnostic of concrete driver crates (`rodio`, `rusqlite`, `lofty`, `zbus`, `axum`).
- Ensure all configurable paths, keys, and values route through `wavery-config` with atomic file persistence and zero hardcoded magic constants.

### R2. Audio Pipeline & Playback Engine Hardening
- Audit and refine `wavery-audio` rodio playback pipeline, queue management (linear, shuffle, repeat modes), seeking precision, and state transition synchronization.
- Implement resilient error handling and recovery for audio decoding, CPAL device disconnection/switching, and streaming boundary conditions.

### R3. Library Database, FTS5 Indexing & Parallel Scanner Optimization
- Harden `wavery-library` SQLite database operations with proper WAL mode configuration, transaction batching, and full-text search (FTS5) queries.
- Optimize parallel metadata extraction and track scanning, ensuring safe tag reading (Lofty) without crashing on corrupted or malformed media files.

### R4. Code Quality, Zero-Panic Policy & Comprehensive Verification
- Eliminate any remaining `unwrap()` or `expect()` calls in production code paths, ensuring every error is represented via typed `thiserror` enums and handled gracefully.
- Add and expand unit and integration tests for critical playback and indexing flows.
- Ensure 100% clean compilation under strict clippy warnings.

## Verification Criteria

### Compilation & Static Analysis
- [ ] `cargo check --workspace --all-targets` passes with zero compilation errors.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` completes with zero warnings.

### Automated Test Suite
- [ ] `cargo test --workspace` executes and all backend unit and integration tests pass cleanly.
- [ ] Crate boundary integrity is verified with no illegal cross-crate imports.

### Code Quality & Safety
- [ ] Zero instances of `.unwrap()` or `.expect()` in non-test production Rust source code.
- [ ] All public traits, structs, and modules include descriptive doc comments (`///`).

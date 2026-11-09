# Contributing to Wavery

Thank you for your interest in contributing to **Wavery**!

Wavery is a modular, high-performance desktop and browser music player designed with strict engineering standards: zero telemetry, zero unwrap/expect in production code, modular crate boundaries, and an Apple HIG aesthetic.

---

## 1. Modular Architecture & Hard Boundaries

Wavery separates its codebase into isolated Cargo workspace crates with clear responsibilities:

- **`crates/core` (`wavery-core`)**: Pure domain models (`Track`, `Album`, `Artist`, `Playlist`) and trait interfaces (`PlayerEngine`, `LibraryManager`, `MetadataReader`, `QueueManager`, `MprisBridge`). Zero concrete driver dependencies.
- **`crates/config` (`wavery-config`)**: XDG path resolution, TOML config persistence, and atomic saves.
- **`crates/audio` (`wavery-audio`)**: Audio playback engine using Rodio, ReplayGain limiter, and queue manager.
- **`crates/library` (`wavery-library`)**: SQLite database persistence (WAL + FTS5), tag parsing with Lofty, and parallel directory scanner.
- **`crates/mpris` (`wavery-mpris`)**: Linux D-Bus MPRIS bridge using `zbus`.
- **`crates/server` (`wavery-server`)**: Standalone Axum HTTP streaming and REST server with LRU artwork caching.
- **`ui/src-tauri` (`wavery-tauri`)**: Tauri v2 desktop composition root, system tray, window lifecycle, and native IPC.
- **`ui/` (`wavery-ui`)**: React 18, TypeScript, TailwindCSS, and Zustand stores.

> [!CAUTION]
> **Boundary Rule**: Never import concrete backend drivers (`rodio`, `rusqlite`, `lofty`, `zbus`, `axum`) outside their designated crates. Subsystems communicate exclusively via `wavery-core` traits and models.

---

## 2. Style, Safety & Code Quality

### Rust Backend
- **Zero `unwrap()` / `expect()`**: Forbidden in production code. Strictly permitted only inside unit tests (`#[test]`) and integration tests (`tests/*.rs`).
- **Typed Errors**: Every crate defines explicit error enums using `thiserror`. Tauri commands wrap errors in a structured `IpcError`.
- **Zero Magic Constants**: All configurable parameters route through `wavery-config::Config` backed by persistent TOML storage.
- **Documentation**: All public traits, functions, and structs must include `///` doc comments.

### TypeScript Frontend
- **Strict Typing**: No `any`. Explicit interfaces for all stores, services, and utility functions.
- **Virtualization**: Tables and large lists must be virtualized with `@tanstack/react-virtual` to keep DOM overhead O(1).
- **Isolation**: High-frequency scrubber updates must not trigger re-renders of library lists.

---

## 3. Development Workflow & Verification

Before submitting a pull request, ensure all tests and lints pass cleanly:

```bash
# 1. Rust workspace compilation
cargo check --workspace --all-targets

# 2. Rust unit, integration, and fuzz stress tests
cargo test --workspace

# 3. Strict Clippy verification
cargo clippy --workspace --all-targets -- -D warnings

# 4. Frontend automated test suite & empirical benchmarks
npm --prefix ui test

# 5. Frontend TypeScript typecheck and production build
npm --prefix ui run build
```

---

## 4. Submitting Pull Requests

1. Fork the repository and create your branch from `main`.
2. Keep commits atomic, well-described, and focused on a single change.
3. Verify that all 5 verification commands pass.
4. Submit a pull request describing the motivation, implementation, and test verification.

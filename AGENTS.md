# Wavery Development Guidelines & System Prompt Rules

Welcome to **Wavery**, a modular, high-performance desktop & web music player built with a Rust Cargo workspace backend, a Tauri v2 desktop shell, and a modern React + TypeScript frontend.
These rules are binding for every agent session working on this codebase.

---

## 1. Modular Architecture & Hard Boundaries

### Workspace Crate Layout

```text
wavery/
├── Cargo.toml                  # Workspace root manifest
├── crates/
│   ├── core/                   # (wavery-core) Domain models, trait interfaces, typed errors
│   ├── config/                 # (wavery-config) XDG path resolution, TOML config, atomic saves
│   ├── audio/                  # (wavery-audio) Rodio audio playback backend, queue manager
│   ├── library/                # (wavery-library) SQLite storage (WAL/FTS5), Lofty tag parsing, scanner
│   ├── mpris/                  # (wavery-mpris) Linux MPRIS D-Bus interface (zbus)
│   └── server/                 # (wavery-server) Axum HTTP audio streaming & REST server, LRU art cache
├── ui/
│   ├── src-tauri/              # (wavery-tauri) Tauri desktop shell, system tray, window lifecycle, IPC
│   ├── src/                    # React 18 + TypeScript + TailwindCSS + Zustand frontend
│   └── tests/                  # Automated frontend & empirical benchmark test suite
└── PROJECT.md                  # Project feature inventory and milestone roadmap
```

### Crate Dependency Matrix & Anti-Spaghetti Boundary Rules

| Crate | Allowed Dependencies | Forbidden Dependencies | Role |
| :--- | :--- | :--- | :--- |
| **`wavery-core`** | `serde`, `thiserror`, `tokio` (primitives), `async-trait` | `rodio`, `rusqlite`, `lofty`, `zbus`, `axum`, `tauri` | Pure domain models, trait contracts, typed errors. Zero driver dependencies. |
| **`wavery-config`** | `serde`, `toml`, `directories`, `thiserror` | `rodio`, `rusqlite`, `lofty`, `zbus`, `axum`, `tauri` | Central configuration schema, XDG path resolution, atomic persistence. |
| **`wavery-audio`** | `wavery-core`, `rodio`, `cpal`, `tokio`, `thiserror` | `wavery-library`, `wavery-mpris`, `wavery-server`, `rusqlite`, `lofty`, `zbus` | Concrete audio engine with dedicated playback thread and queue manager. |
| **`wavery-library`** | `wavery-core`, `rusqlite`, `lofty`, `walkdir`, `rayon`, `tokio`, `thiserror` | `wavery-audio`, `wavery-mpris`, `wavery-server`, `rodio`, `zbus` | SQLite database persistence (WAL + FTS5), metadata parsing, parallel scanner. |
| **`wavery-mpris`** | `wavery-core`, `zbus`, `tokio`, `thiserror` | `wavery-audio`, `wavery-library`, `wavery-server`, `rodio`, `rusqlite` | Linux MPRIS D-Bus integration bridge. |
| **`wavery-server`** | `wavery-core`, `wavery-config`, `wavery-library`, `axum`, `tower-http`, `tokio` | `wavery-audio`, `rodio`, `zbus` | Audio HTTP range streaming, REST endpoints, LRU artwork cache, web hosting. |
| **`wavery-tauri`** | `wavery-core`, `wavery-config`, `wavery-audio`, `wavery-library`, `wavery-mpris`, `wavery-server`, `tauri` | None (composition root for desktop app) | Desktop lifecycle, system tray, window minimize-to-tray, IPC bridge. |
| **`wavery-ui` (React)** | React 18, TypeScript, TailwindCSS, Zustand, `@tanstack/react-virtual`, `@tauri-apps/api` | Direct backend access without IPC / HTTP | Modern declarative UI, virtualization, audio adapters, dynamic keybindings. |

> [!CAUTION]
> **STRICT BOUNDARY RULE**: Never import a concrete backend driver crate (`rodio`, `rusqlite`, `lofty`, `zbus`, `axum`) outside its designated crate.
> `crates/core` must remain 100% agnostic of concrete drivers. All subsystems communicate via core traits and data transfer models.

---

## 2. Configuration Conventions (Zero Magic Constants)

> [!IMPORTANT]
> **NO path, color, keybinding, or magic number may be hardcoded anywhere in the codebase.**
> All configurable parameters must route through `wavery-config::Config` and be backed by persistent TOML storage.

- **Config Path**: `$XDG_CONFIG_HOME/wavery/config.toml` (or `~/.config/wavery/config.toml`).
- **Data Path**: `$XDG_DATA_HOME/wavery/library` and `library.db`.
- **Cache Path**: `$XDG_CACHE_HOME/wavery/album_art`.
- **Atomic Persistence**: Always write to a temporary file in the target directory and atomically rename to prevent corruption on crash or power failure.
- **Backward Compatibility**: Deserialization must support missing fields (`#[serde(default)]`) and legacy aliases (`#[serde(alias = "...")]`).

---

## 3. Core Trait Interfaces & Domain Models

All implementations must conform strictly to the trait signatures in `crates/core/src/traits.rs`:

1. **`PlayerEngine`**: Load tracks, start/pause/stop playback, seek, set/get volume, inspect position/duration/state.
2. **`LibraryManager`**: Manage storage directory, import individual tracks or folders (Copy / Move strategies), delete tracks, query/search index, update tags.
3. **`MetadataReader`**: Decode ID3, Vorbis, FLAC, and MP4 tags, extract embedded artwork payloads.
4. **`QueueManager`**: Linear queue management, shuffle ordering, repeat modes (`Off`, `Track`, `Queue`), linear and insert-next transitions.
5. **`MprisBridge`**: Export playback state, position, track metadata, and art URI to Linux D-Bus MPRIS clients; poll incoming transport commands.

---

## 4. Frontend & IPC Architecture

- **Unidirectional State Flow**: UI state is centralized in Zustand stores (`playerStore`, `libraryStore`, `settingsStore`, `navigationStore`, `queueStore`, `contextMenuStore`).
- **Intent-Driven Actions**: User actions express clear domain intent (e.g. `playTrack`, `seekTo`, `saveSettings`), decoupled from mechanical widget events.
- **Audio Adapters**:
  - **Tauri Mode**: Uses `TauriAudioPlayer` invoking native IPC commands with low-latency hardware decoding.
  - **Browser Mode**: Uses `BrowserAudioPlayer` with HTML5 `Audio` elements, equal-power mathematical crossfade curves, and streaming from `wavery-server`.
- **Performance & Scale**: Large track tables (100,000+ items) must be virtualized using `@tanstack/react-virtual` with O(1) DOM node footprint.
- **Dynamic Keybinding Engine**: Parse combos, match modifiers cross-platform (`⌘` on macOS, `Ctrl` on Linux/Windows), and filter out inputs when focus is inside editable form fields.

---

## 5. Style, Safety & Code Quality Standards

### Rust Backend
- **Zero `unwrap()` / `expect()`**: Forbidden in production code. Permitted **strictly only** inside unit tests (`#[test]`) and integration tests (`tests/*.rs`).
- **Typed Error Handling**: Every crate defines its own explicit error enum using `thiserror`. Tauri commands wrap errors in a structured `IpcError`.
- **Doc Comments**: Every public struct, enum, trait, and function must include clear `///` doc comments.
- **Lints**: Code must compile with zero warnings under `cargo clippy --workspace --all-targets -- -D warnings`.

### TypeScript Frontend
- **Strict Typing**: No `any`. Explicit interfaces and return types for all stores, services, and utility functions.
- **Memory & Re-render Isolation**: Playback scrubber updates (500ms intervals) must isolate state re-renders to prevent re-rendering entire library tables.
- **ReDoS Prevention**: Tokenizers and string parsers (artists, durations, brackets) must avoid nested quantifiers and catastrophic backtracking.

---

## 6. Design & Aesthetic Standards

- **Apple Human Interface Guidelines (HIG)**:
  - **Clarity**: High-contrast typography hierarchy, clean iconography (1.5–2.0px stroke).
  - **Deference**: Album artwork and audio content are heroes; UI chrome recedes into the background.
  - **Depth & Materials**: Translucent surfaces, frosted glass layering, subtle 1px border outlines (`rgba(255, 255, 255, 0.08)` / `rgba(0, 0, 0, 0.08)`).
  - **Spatial Rhythm**: Strictly follow the 4px/8px rhythm (`4, 8, 12, 16, 20, 24, 32, 48, 64px`).
- **Impeccable Design Quality & Hardening**:
  - **Anti-AI-Slop**: Zero gratuitous purple/cyan gradients. Single focal point per view. 3-tier contrast system.
  - **5-State Completeness**: Every interactive button, row, and input must define `Default`, `Hover`, `Active`, `Focused`, and `Disabled` states.
  - **Graceful Fallbacks**: Smart string truncation with tooltips, fallback artwork placeholders, clear actionable empty states, and non-blocking toast notifications.

---

## 7. Verification Commands

Before completing any task or milestone, verify that all workspace checks pass cleanly:

```bash
# 1. Rust Workspace Compilation Check
cargo check --workspace --all-targets

# 2. Rust Unit, Integration & Adversarial Benchmark Tests
cargo test --workspace

# 3. Rust Clippy Strict Linting
cargo clippy --workspace --all-targets -- -D warnings

# 4. Frontend Automated Test Suite & Empirical Benchmarks
npm --prefix ui test

# 5. Frontend TypeScript Typecheck & Production Build
npm --prefix ui run build
```


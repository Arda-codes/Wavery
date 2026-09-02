# Project: Wavery Backend & Audio Engine Hardening

## Architecture
Wavery is a modular desktop and browser music player structured as a Cargo workspace with strict crate boundaries and a React/Tauri frontend:
- `crates/core` (`wavery-core`): Pure domain models (`Track`, `Album`, `Artist`, `Playlist`, `TrackMetadata`, `PlaybackState`, `ImportStrategy`), trait definitions (`PlayerEngine`, `LibraryManager`, `MetadataReader`, `QueueManager`, `MprisBridge`), and typed errors (`AudioError`, `LibraryError`, `MprisError`). 100% driver agnostic.
- `crates/config` (`wavery-config`): XDG path routing and atomic TOML configuration (`Config`, `GeneralConfig`, `KeybindsConfig`, `AudioConfig`, `LibraryConfig`, `ServerConfig`, `ThemeConfig`, `ThemeMode`, `UiConfig`). Zero magic constants.
- `crates/audio` (`wavery-audio`): Rodio audio playback backend with dedicated OS thread isolation, automatic CPAL device recovery, 64KB I/O buffering, non-disruptive shuffle queue splicing, and `StandardQueueManager`.
- `crates/library` (`wavery-library`): SQLite database persistence with WAL mode, FTS5 BM25 ranking, metadata extraction (`lofty`), parallel directory scanner (`WalkDir` + `JoinSet`), and library management.
- `crates/mpris` (`wavery-mpris`): Linux MPRIS D-Bus bridge using `zbus`.
- `crates/server` (`wavery-server`): Axum HTTP API and RFC 7233 audio range streaming server with bounded artwork cache.
- `ui/src-tauri` (`wavery-tauri`): Tauri desktop bridge, structured `IpcError`, system tray manager, window lifecycle manager, background auto-scan.
- `ui/` (`wavery-ui`): React 18 + TypeScript + TailwindCSS + TanStack Virtual + Zustand frontend, dynamic keybinding engine, track change desktop notification dispatcher.

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | Crate Boundary & Pure Domain Verification | Audit `wavery-core` driver agnosticism, `wavery-config` path resolution & zero magic constants, and workspace crate decoupling | M1 | Survey | DONE |
| 2 | Non-Disruptive Shuffle Queue Splicing | Splicing dynamic track additions (`play_next`, `push_back`) into unplayed shuffle history without resetting playback state | M1 | Survey | DONE |
| 3 | CPAL Audio Output Auto-Reinitialization | Automatic `OutputStream::try_default()` re-binding on device disconnection/switching during audio load | M1 | Survey | DONE |
| 4 | High-Throughput 64KB Audio File Buffering | Replace standard `BufReader` with 64KB buffer capacity for high-bitrate lossless audio playback | M1 | Survey | DONE |
| 5 | Sync Player Trait Method Decoupling | Decouple synchronous trait methods (`play`, `pause`, `stop`, `seek`) from Tokio runtime thread dependencies | M1 | Survey | DONE |
| 6 | SQLite FTS5 BM25 Query Ranking | Implement BM25 weighted ranking (`bm25(tracks_fts, 10.0, 5.0, 3.0, 2.0, 1.0)`) for relevant title and artist search results | M2 | Survey | DONE |
| 7 | Metadata Reader Defensive Year Guard | Positive year validation guard in `LoftyMetadataReader::write_metadata` to prevent negative year wrapping | M2 | Survey | DONE |
| 8 | Corrupt Media Ingestion & Scanner Resilience | Expand tests verifying graceful fallback for corrupt headers, missing tags, and parallel directory scans | M2 | Survey | DONE |
| 9 | Zero-Panic Verification & Strict Linter Enforcement | Enforce zero `unwrap()`/`expect()` across production code, 0 compiler warnings, 0 clippy warnings | M3 | Survey | DONE |
| 10 | Comprehensive Workspace & Adversarial Verification | Full test execution (`cargo test --workspace`, `npm test`, `npm run build`), stress benchmarks, and forensic integrity audit | M3 | Survey | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Audio Pipeline Hardening & Resilient Playback Engine | `crates/audio/src/player.rs`, `crates/audio/src/queue.rs`, `crates/audio/src/lib.rs`, audio unit & stress tests | none | DONE |
| M2 | Library Database, FTS5 BM25 Ranking & Scanner Hardening | `crates/library/src/db.rs`, `crates/library/src/reader.rs`, `crates/library/src/manager.rs`, library tests | none | DONE |
| M3 | Comprehensive Quality Assurance, Adversarial Verification & Audit | Full workspace build, clippy, unit/integration/stress tests, forensic audit | M1, M2 | DONE |

## Interface Contracts
### `crates/audio`
- `StandardQueueManager::play_next(&mut self, track: Track)`: Inserts track immediately following current index and splices into upcoming shuffle indices.
- `StandardQueueManager::push_back(&mut self, track: Track)`: Appends track to linear queue and appends index to shuffle order.
- `RodioPlayer::load(&mut self, track: &Track, start_pos: Option<Duration>) -> Result<(), AudioError>`: Buffers file with 64KB capacity and auto-rebinds output stream if device was disconnected.

### `crates/library`
- `LibraryDatabase::search_fts(&self, query: &str) -> Result<Vec<Track>, LibraryError>`: Executes FTS5 query with BM25 ranking.
- `LoftyMetadataReader::write_metadata(&self, path: &Path, metadata: &TrackMetadata) -> Result<(), LibraryError>`: Defensively guards year values before writing tags.

## Code Layout
- `crates/core/`: Domain models and traits (`src/models.rs`, `src/traits.rs`, `src/error.rs`, `src/lib.rs`, `src/tests.rs`).
- `crates/config/`: Configuration manager (`src/lib.rs`, `src/tests.rs`).
- `crates/audio/`: Rodio playback engine (`src/player.rs`, `src/queue.rs`, `src/lib.rs`, `src/tests.rs`).
- `crates/library/`: SQLite persistence & scanner (`src/db.rs`, `src/manager.rs`, `src/reader.rs`, `src/lib.rs`, `src/tests.rs`).
- `crates/mpris/`: MPRIS bridge (`src/lib.rs`).
- `crates/server/`: HTTP server & streaming (`src/lib.rs`, `src/main.rs`, `src/tests.rs`).
- `ui/src-tauri/`: Tauri backend bridge, system tray, window lifecycle (`Cargo.toml`, `src/main.rs`).
- `ui/src/`: React frontend (`components/`, `stores/`, `services/`, `utils/`, `types/`, `App.tsx`).
- `ui/tests/`: Empirical test suites (`runner.cjs`, `test_keybindings.ts`, `test_settings.ts`, etc.).

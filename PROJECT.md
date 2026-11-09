# Project: Wavery LAN Streaming, Waveform Peak Caching, Loudness Normalization & Mobile PWA

## Architecture
Wavery is a modular, high-performance music player with a Rust workspace backend, Tauri v2 desktop shell, and React 18 + TypeScript frontend.
- `crates/core`: Pure domain models (`Track`, `TrackMetadata`, `WaveformData`), trait interfaces (`PlayerEngine`, `LibraryManager`), typed errors. Zero driver dependencies.
- `crates/config`: XDG path resolution, TOML config (`Config`, `ServerConfig`, `AudioConfig`), atomic persistence with tempfile rename.
- `crates/library`: SQLite storage (`library.db` in WAL mode), tag parsing (`Lofty`), audio waveform peak calculation (`Symphonia`), parallel scanner.
- `crates/audio`: Dedicated Rodio playback thread, queue manager, perceptual loudness attenuation with anti-clipping.
- `crates/mpris`: Linux MPRIS D-Bus integration bridge.
- `crates/server`: Axum HTTP audio streaming, REST API (`/api/tracks/{id}/waveform`), security middleware rejecting remote destructive requests, LRU cache.
- `ui/src-tauri`: Tauri v2 desktop shell, server lifecycle management, local LAN IP detection, IPC bridge.
- `ui`: React + TypeScript frontend, PWA manifest, service worker, mobile touch UI, Web Audio/HTML5 streaming player adapter.

```
                      ┌──────────────────────┐
                      │    ui (Frontend)     │
                      │ React / Zustand / PWA│
                      └──────────┬───────────┘
                                 │ IPC / REST
            ┌────────────────────┴────────────────────┐
            ▼                                         ▼
  ┌──────────────────┐                      ┌──────────────────┐
  │   ui/src-tauri   │                      │  crates/server   │
  │ Desktop Shell    │                      │ Axum HTTP & REST │
  └─────────┬────────┘                      └─────────┬────────┘
            │                                         │
            ├────────────────────┬────────────────────┤
            ▼                    ▼                    ▼
  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
  │   crates/audio   │ │  crates/library  │ │  crates/config   │
  │ Rodio & Loudness │ │ SQLite & Waveform│ │ TOML Persistence│
  └─────────┬────────┘ └─────────┬────────┘ └─────────┬────────┘
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 ▼
                      ┌──────────────────────┐
                      │     crates/core      │
                      │ Domain Models/Traits │
                      └──────────────────────┘
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Core Waveform & Metadata Models | `WaveformData` model and ReplayGain fields on `TrackMetadata` in `crates/core` | M1 | Survey E2, E3 |
| 2 | Config LAN & ReplayGain Alignment | `ServerConfig` host toggle helpers (`is_lan_enabled`, `set_lan_enabled`) and sanitization in `crates/config` | M1 | Survey E1 |
| 3 | SQLite Waveform Table & ReplayGain Schema | Create `track_waveforms` table with cascade delete and add ReplayGain columns to `tracks` in `crates/library` | M2 | Survey E2, E3 |
| 4 | ReplayGain, EBU R128 & Sound Check Tag Parsing | Lofty tag extraction for track/album gain/peak, R128 offset (+5.0 dB), and iTunNORM conversion in `crates/library` | M2 | Survey E3 |
| 5 | Waveform 100-Point Peak Envelope Calculation | Symphonia-based audio decoding and 100-point normalized peak envelope computation in `crates/library` | M2 | Survey E2 |
| 6 | Library Waveform Persistence & Query API | SQLite storage and retrieval of waveform BLOBs with O(1) indexed lookup in `crates/library` | M2 | Survey E2 |
| 7 | Rodio Native Perceptual Loudness Attenuation | Mathematical gain attenuation ($10^{\text{gain}/20}$) with anti-clipping safeguards in `crates/audio` | M3 | Survey E3 |
| 8 | Dynamic Loudness Mode Switching | Instant gain transition between off, track, and album modes in `crates/audio` | M3 | Survey E3 |
| 9 | Axum ConnectInfo & Security Middleware | Reject non-loopback clients for destructive operations with 403 Forbidden in `crates/server` | M4 | Survey E1 |
| 10 | Waveform REST Endpoint | `GET /api/tracks/{id}/waveform` with caching headers in `crates/server` | M4 | Survey E2 |
| 11 | Local LAN IP Detection | UDP socket kernel routing inspection (RFC 1122) without magic constants in `ui/src-tauri` | M5 | Survey E1 |
| 12 | Dynamic Server Rebind & Atomic Rollback | Server graceful restart on host change with fallback to 127.0.0.1 on socket error in `ui/src-tauri` | M5 | Survey E1 |
| 13 | Waveform & Server Status IPC Commands | Expose `get_waveform`, `get_server_status`, and `set_server_lan_mode` via Tauri IPC in `ui/src-tauri` | M5 | Survey E1, E2 |
| 14 | Server Settings LAN Switcher UI | Apple HIG toggle, LAN IP display, quick-copy URL button, and SVG QR code indicator in `ui/src` | M6 | Survey E1 |
| 15 | Waveform Scrubber Component Integration | `PlayerBar.tsx` consuming cached waveform peaks with instant synthetic fallback morphing | M6 | Survey E2 |
| 16 | Browser Player Loudness Normalization | Perceptual attenuation and peak anti-clipping with live store subscription in `ui/src/services/adapter.ts` | M6 | Survey E3 |
| 17 | PWA Manifest & Service Worker | `manifest.webmanifest`, lightweight static shell `sw.js` (bypassing `/api/stream/*`), and iOS meta tags | M6 | Survey E3 |
| 18 | Mobile Touch UX & Safe Area Insets | Safe area inset padding, touch target compliance, and mobile drawer refinements in `ui/src` | M6 | Survey E3 |
| 19 | Mobile Media Session Continuity | Absolute artwork URL resolution and iOS Safari dual-audio background playback unlocking | M6 | Survey E3 |
| 20 | E2E Regression & Adversarial Verification | Full workspace test suite, clippy zero warnings, TypeScript check, opaque-box E2E tests | M7 | Survey E1, E2, E3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Domain Models & Config Schema | `crates/core`, `crates/config`: `WaveformData`, ReplayGain metadata fields, `ServerConfig` LAN methods & sanitization | None | DONE |
| M2 | Library Waveform Decoding, Tag Parsing & Storage | `crates/library`: SQLite `track_waveforms` table, ReplayGain columns, Lofty tag extraction (RG/R128/iTunNORM), Symphonia 100-point peak calculation | M1 | DONE |
| M3 | Audio Engine Loudness Normalization | `crates/audio`: Rodio perceptual loudness attenuation with anti-clipping safeguards and live mode switching | M1 | DONE |
| M4 | Server Security Middleware & Waveform REST API | `crates/server`: Axum ConnectInfo, security boundary middleware (blocking remote destructive operations), `/api/tracks/{id}/waveform` | M1, M2 | DONE |
| M5 | Desktop Shell IPC, LAN IP Discovery & Server Lifecycle | `ui/src-tauri`: RFC 1122 local IP detection, dynamic server rebinding with atomic rollback, `get_waveform` & `set_server_lan_mode` IPC | M1, M2, M4 | DONE |
| M6 | Frontend LAN Switcher, Waveform Scrubber & Mobile PWA | `ui/`: SettingsView LAN switch & QR code, PlayerBar waveform integration, browser loudness normalization, PWA manifest, service worker, MediaSession | M3, M4, M5 | DONE |
| M7 | E2E Testing Track & Full Workspace Verification | Comprehensive E2E tests (Tiers 1-4) + Adversarial hardening (Tier 5) + `cargo check`, `cargo test`, `cargo clippy`, `npm test`, `npm run build` | M1-M6 | DONE |

## Interface Contracts
### `crates/core` ↔ `crates/library` & `crates/server` & `ui/src-tauri`
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WaveformData {
    pub track_id: String,
    pub version: u32,
    pub points: Vec<f32>, // Exactly 100 normalized amplitude points in [0.0, 1.0]
}

// In TrackMetadata:
pub replaygain_track_gain: Option<f32>,
pub replaygain_track_peak: Option<f32>,
pub replaygain_album_gain: Option<f32>,
pub replaygain_album_peak: Option<f32>,
```

### `crates/config` ↔ `crates/server` & `ui/src-tauri`
```rust
impl ServerConfig {
    pub fn is_lan_enabled(&self) -> bool { self.host == "0.0.0.0" }
    pub fn set_lan_enabled(&mut self, enabled: bool) {
        self.host = if enabled { "0.0.0.0".to_string() } else { "127.0.0.1".to_string() };
    }
}
```

### `crates/server` REST API
```http
GET /api/tracks/{id}/waveform
Response 200 OK:
Content-Type: application/json
Cache-Control: public, max-age=604800, immutable
{
    "track_id": "...",
    "version": 1,
    "points": [0.12, 0.45, 0.89, ...]
}
```

### `ui/src-tauri` IPC Commands
```rust
#[tauri::command]
pub async fn get_server_status(state: State<'_, AppState>) -> Result<ServerStatusResponse, IpcError>;

#[tauri::command]
pub async fn set_server_lan_mode(enabled: bool, state: State<'_, AppState>) -> Result<ServerStatusResponse, IpcError>;

#[tauri::command]
pub async fn get_waveform(track_id: String, state: State<'_, AppState>) -> Result<Option<WaveformData>, IpcError>;
```

## Code Layout
- `crates/core/src/models.rs`: `WaveformData`, `TrackMetadata`
- `crates/config/src/lib.rs`: `ServerConfig`, `Config`
- `crates/library/src/db.rs`: `track_waveforms` schema, ReplayGain columns
- `crates/library/src/reader.rs`: Lofty metadata extraction
- `crates/library/src/waveform.rs`: Symphonia 100-point peak envelope computation
- `crates/audio/src/player.rs`: Perceptual loudness attenuation & anti-clipping
- `crates/server/src/lib.rs`: Security middleware, `/api/tracks/{id}/waveform`
- `ui/src-tauri/src/main.rs`: IPC commands, RFC 1122 IP resolution, server rebind
- `ui/src/components/SettingsView.tsx`: LAN toggle, LAN IP, QR code
- `ui/src/components/PlayerBar.tsx`: Waveform scrubber
- `ui/src/services/adapter.ts`: Waveform query, browser player loudness normalization
- `ui/public/manifest.webmanifest`: PWA manifest
- `ui/public/sw.js`: Service worker

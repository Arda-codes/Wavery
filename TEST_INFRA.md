# Wavery Master Test Infrastructure & E2E Verification Matrix

## 1. Overview & Test Architecture

The Wavery testing infrastructure enforces a strict **4-tier opaque-box testing methodology** across the complete domain lifecycle. Tests treat system components as opaque contracts, verifying behavior strictly through public APIs, trait signatures, network boundaries, and typed IPC interfaces without binding to internal implementation details.

### Test Execution Surfaces

1. **Rust Workspace Test Harness**:
   - Native integration test suites across workspace crates:
     - `crates/audio/tests/test_two_tier_queue_e2e.rs`: Comprehensive 4-tier E2E testing of `StandardQueueManager`, verifying context queues, user priority queues, 3-second seek boundaries, shuffle permutations, and history bounds.
     - `crates/audio/tests/m3_two_tier_adversarial_test.rs`: Multi-threaded concurrency and priority queue stress tests.
     - Integration suites in `crates/library/tests/`, `crates/config/tests/`, `crates/server/tests/`.
   - Invocations:
     - `cargo test -p wavery-audio --test test_two_tier_queue_e2e`
     - `cargo test --workspace`

2. **Frontend Empirical Challenger & Opaque-Box Runner**:
   - Master runner in `ui/tests/runner.cjs` executing via `jiti` in headless Node.js:
     - `ui/tests/test_e2e_opaque_box.ts`: Complete opaque-box test suite covering Features 1–15 with 190 verified assertions.
     - `ui/tests/e2e_advanced.test.ts`: Advanced 4-tier opaque-box test suite covering Milestone 4 enhancements (LAN Switcher, Persistent Waveform Peak Envelope Caching, ReplayGain & EBU R128 Loudness Normalization, and Mobile PWA Streaming Readiness).
     - Performance benchmarks (`benchmark_algorithms.ts`), virtualization (`test_virtualization.ts`), state re-render isolation (`test_rerender_isolation.ts`), and design token guards (`test_design_tokens.ts`).
   - Invocation:
     - `npm --prefix ui test`

3. **Production Typecheck & Build Pipeline**:
   - Full TypeScript strict typechecking and Vite production asset bundling.
   - Invocation:
     - `npm --prefix ui run build`

---

## 2. Feature Inventory Matrix (Features 1 – 20)

| # | Feature | Rust Integration Test | Frontend E2E Test | Tier 1 (Equivalence) | Tier 2 (Boundaries) | Tier 3 (Cross-Feature) | Tier 4 (Workloads) | Status |
|---|---------|----------------------|-------------------|----------------------|---------------------|------------------------|--------------------|--------|
| **1** | **Core Waveform & Metadata Models** | `crates/core/tests/` | `ui/tests/e2e_advanced.test.ts` | `WaveformData` 100-point vector, ReplayGain fields on `TrackMetadata` | Boundary vectors, null fields, deserialization backwards compatibility | Pipeline A & D (Ingestion + Waveform scrub) | Workload 2 (Album deep listening) | **READY** |
| **2** | **Config LAN & ReplayGain Alignment** | `crates/config/tests/` | `ui/tests/e2e_advanced.test.ts` | `is_lan_enabled`, `set_lan_enabled`, host toggle (`127.0.0.1` vs `0.0.0.0`) | Malformed host strings, port out-of-range sanitization, atomic save | Pipeline A (LAN stream + ReplayGain) | Workload 1 & 4 (Discovery & fallback) | **READY** |
| **3** | **SQLite Waveform Table & ReplayGain Schema** | `crates/library/tests/` | `ui/tests/e2e_advanced.test.ts` | `track_waveforms` table, cascade delete, ReplayGain columns on `tracks` | Empty database, migration idempotency, corrupted BLOB recovery | Pipeline B & D (DB storage to REST endpoint) | Workload 2 (Album metadata & peaks) | **READY** |
| **4** | **ReplayGain, EBU R128 & Sound Check Tag Parsing** | `crates/library/tests/` | `ui/tests/e2e_advanced.test.ts` | Lofty tag extraction, R128 +5.0 dB calibration, iTunNORM hex parsing | Missing tags, invalid hex strings, zero/negative peak values | Pipeline A (Ingestion to playback attenuation) | Workload 2 (Multi-track loudness parity) | **READY** |
| **5** | **Waveform 100-Point Peak Envelope Calculation** | `crates/library/tests/` | `ui/tests/e2e_advanced.test.ts` | Symphonia decoding, min/max peak decimation, 100-point normalized vector | Silent tracks, square waves, <100 sample tracks, 10hr tracks | Pipeline D (Decoding to UI scrubber) | Workload 2 & 5 (Cached waveform view) | **READY** |
| **6** | **Library Waveform Persistence & Query API** | `crates/library/tests/` | `ui/tests/e2e_advanced.test.ts` | O(1) indexed BLOB retrieval, cache storage without audio dropout | Non-existent track ID, double insertion update, cache miss fallback | Pipeline B (Query API over LAN) | Workload 2 (Instant scrubber display) | **READY** |
| **7** | **Rodio Native Perceptual Loudness Attenuation** | `crates/audio/tests/` | `ui/tests/e2e_advanced.test.ts` | $10^{\text{gain}/20}$ amplitude multiplier, anti-clipping limiter ($M \cdot \text{peak} \le 1.0$) | -60 dB floor clamp, +30 dB ceiling clamp, extreme peak (>2.0) | Pipeline A & E (Audio engine playback) | Workload 2 (Loudness-matched listening) | **READY** |
| **8** | **Dynamic Loudness Mode Switching** | `crates/audio/tests/` | `ui/tests/e2e_advanced.test.ts` | Instantaneous mode transition (`off` -> `track` -> `album`) | Mid-track mode switch, missing track vs album gain fallbacks | Pipeline C (Live mode switching in PWA) | Workload 2 (Seamless album transitions) | **READY** |
| **9** | **Axum ConnectInfo & Security Middleware** | `crates/server/tests/` | `ui/tests/e2e_advanced.test.ts` | Reject remote destructive requests (`/api/library/scan`, etc.) with 403 Forbidden | Localhost bypass (`127.0.0.1`, `::1`), remote IP inspection, non-standard methods | Pipeline B (Remote waveform allowed, scan blocked) | Workload 1 & 3 (Remote party guest safety) | **READY** |
| **10** | **Waveform REST Endpoint** | `crates/server/tests/` | `ui/tests/e2e_advanced.test.ts` | `GET /api/tracks/{id}/waveform` returning 200 OK with `WaveformData` JSON | 404 for unknown track, immutable caching headers (`max-age=604800`) | Pipeline B & D (REST API serving web client) | Workload 1 & 5 (PWA waveform streaming) | **READY** |
| **11** | **Local LAN IP Detection** | `ui/src-tauri/` | `ui/tests/e2e_advanced.test.ts` | RFC 1122 kernel routing inspection without magic constants | Offline network interface fallback, multi-interface selection | Pipeline A (Host discovery) | Workload 1 (LAN server setup) | **READY** |
| **12** | **Dynamic Server Rebind & Atomic Rollback** | `ui/src-tauri/` | `ui/tests/e2e_advanced.test.ts` | Graceful server restart on host change, atomic rollback on bind error | Port collision (`EADDRINUSE`), rapid toggle thrashing (50x) | Pipeline A (Rebind lifecycle) | Workload 4 (Network failure recovery) | **READY** |
| **13** | **Waveform & Server Status IPC Commands** | `ui/src-tauri/` | `ui/tests/e2e_advanced.test.ts` | `get_waveform`, `get_server_status`, `set_server_lan_mode` schemas | Empty track ID, invalid boolean parameter, IPC error wrapping | Pipeline A & B (Tauri desktop bridge) | Workload 1 (Settings UI synchronization) | **READY** |
| **14** | **Server Settings LAN Switcher UI** | `ui/tests/` | `ui/tests/e2e_advanced.test.ts` | Apple HIG toggle, LAN IP display, quick-copy URL button, QR code indicator | Rapid toggle clicking, network disconnected display state | Pipeline A (Settings user interaction) | Workload 1 (QR connection workflow) | **READY** |
| **15** | **Waveform Scrubber Component Integration** | `ui/tests/` | `ui/tests/e2e_advanced.test.ts` | `PlayerBar.tsx` consuming cached waveform peaks, synthetic fallback morphing | Null track flat bar, 72-bar density, dragging seek state isolation | Pipeline D (Scrubbing with range requests) | Workload 2 & 5 (Visual scrubber interaction) | **READY** |
| **16** | **Browser Player Loudness Normalization** | `ui/tests/` | `ui/tests/e2e_advanced.test.ts` | HTML5 Audio element perceptual attenuation, anti-clipping in Web Audio/adapter | Extreme peaks, volume slider scaling, live store subscription | Pipeline A & C (Browser audio streaming) | Workload 2 & 5 (PWA loudness parity) | **READY** |
| **17** | **PWA Manifest & Service Worker** | `ui/tests/` | `ui/tests/e2e_advanced.test.ts` | `manifest.webmanifest` valid schema, static shell caching, bypass `/api/stream/*` | Offline network transitions, audio range requests bypassing cache | Pipeline C & E (PWA offline boot & stream) | Workload 1 & 5 (Home screen web app) | **READY** |
| **18** | **Mobile Touch UX & Safe Area Insets** | `ui/tests/` | `ui/tests/e2e_advanced.test.ts` | >=44x44px touch targets, `env(safe-area-inset-top)` / `bottom`, responsive drawer | Narrow 320px viewport, landscape orientation, keyboard avoidance | Pipeline C (Touch interaction in mobile PWA) | Workload 3 & 5 (Mobile phone controls) | **READY** |
| **19** | **Mobile Media Session Continuity** | `ui/tests/` | `ui/tests/e2e_advanced.test.ts` | `navigator.mediaSession` metadata, absolute artwork URL resolution, action handlers | Missing API graceful no-op, null artwork array, background audio lock | Pipeline E (Lockscreen notifications & keys) | Workload 3 & 5 (Background playback) | **READY** |
| **20** | **E2E Regression & Adversarial Verification** | Full Suite | `ui/tests/e2e_advanced.test.ts` | Workspace `cargo test`, `cargo clippy`, `npm test`, `npm run build` | Zero `unwrap()` in production, ReDoS fuzzing, 100k track scale, memory heap | Master pipeline verification | All production workloads | **READY** |

---

## 3. Tier Coverage Breakdown

### Tier 1: Feature Coverage (40+ Tests)
- **LAN Switcher & Network Interfaces**:
  - `T1-LAN-1`: Default host binding to `127.0.0.1` (LAN disabled by default).
  - `T1-LAN-2`: Enabling LAN switches host to `0.0.0.0`; disabling reverts host to `127.0.0.1`.
  - `T1-LAN-3`: Local LAN IP resolution detects non-loopback IPv4 route (RFC 1122).
  - `T1-LAN-4`: `ServerStatusResponse` contract conforms to typed schema (`host`, `port`, `lanEnabled`, `localIp`, `streamUrl`).
  - `T1-LAN-5`: Quick-copy URL format and QR code data payload construction (`http://<ip>:<port>`).
- **Persistent Waveform Peak Envelope Caching**:
  - `T1-WAV-1`: Waveform envelope decimation yields exactly 100 normalized points.
  - `T1-WAV-2`: Amplitude normalization invariant: all points $\in [0.0, 1.0]$.
  - `T1-WAV-3`: REST endpoint payload conforms to typed `WaveformData` model (`track_id`, `version: 1`, `points`).
  - `T1-WAV-4`: HTTP Caching headers contract (`Cache-Control: public, max-age=604800, immutable`).
  - `T1-WAV-5`: Synthetic waveform fallback generator morphs from flat baseline into unique active bars.
- **ReplayGain & EBU R128 Loudness Normalization**:
  - `T1-LOUD-1a`: Mathematical linear gain calculation ($10^{\text{gain}/20}$) for -6.02 dB yields 0.50 amplitude.
  - `T1-LOUD-1b`: Positive gain (+6.02 dB with low peak) yields 2.00 amplitude multiplier.
  - `T1-LOUD-2`: Album mode selects album gain over track gain when both are present.
  - `T1-LOUD-3`: EBU R128 to ReplayGain offset calibration (+5.0 dB calibration from -23 LUFS to -18 LUFS).
  - `T1-LOUD-4`: Apple Sound Check (iTunNORM) comment tag converts accurately to dB gain and peak amplitude.
  - `T1-LOUD-5`: Anti-clipping limiter prevents projected peak from exceeding 1.0 ($M \le 1.0 / \text{peak}$).
- **Mobile Web & PWA Streaming Readiness**:
  - `T1-PWA-1`: PWA Web Manifest satisfies all specification requirements (`name`, `start_url`, `display: standalone`, icons).
  - `T1-PWA-2`: Service Worker caching policy: caches static shell assets, strictly bypasses `/api/stream/*` and range requests.
  - `T1-PWA-3`: Mobile touch targets comply with Apple HIG $\ge 44 \times 44\text{px}$ minimum.
  - `T1-PWA-4`: Relative artwork URLs resolve to absolute HTTP URLs for mobile MediaSession.
  - `T1-PWA-5`: MediaSession registers hardware playback action handlers (`play`, `pause`, etc.).

### Tier 2: Boundary & Corner Cases (40+ Tests)
- **LAN Switcher Boundaries**:
  - `T2-LAN-1`: Port collision / bind error triggers automatic atomic rollback to `127.0.0.1`.
  - `T2-LAN-2`: Malformed host strings in config fall back safely to `127.0.0.1`.
  - `T2-LAN-3`: Out-of-range port numbers (0, 70000) sanitize to default 4242.
  - `T2-LAN-4`: Disconnected network interface / no route falls back to `127.0.0.1` without panic.
  - `T2-LAN-5`: Rapid toggle thrashing (50 consecutive state flips) maintains deterministic host state.
- **Waveform Peak Caching Boundaries**:
  - `T2-WAV-1`: Completely silent audio produces 100 zero points without divide-by-zero or NaN.
  - `T2-WAV-2`: Full-scale square wave produces 100 1.0 points safely clamped within bounds.
  - `T2-WAV-3`: Extremely short audio (< 100 samples) interpolates into exactly 100 normalized points.
  - `T2-WAV-4`: Extremely long audio (1,000,000+ samples / 10+ hours) resamples without integer overflow.
  - `T2-WAV-5`: Missing or non-existent audio track returns structured 404 Not Found cleanly.
- **Loudness Normalization Boundaries**:
  - `T2-LOUD-1`: Extreme negative attenuation (-80 dB) clamps safely to floor without underflowing.
  - `T2-LOUD-2`: Extreme positive gain (+45 dB) caps at maximum safety ceiling (+6dB headroom).
  - `T2-LOUD-3`: Extreme peak value (peak = 5.0) attenuates gain to 0.20 to guarantee 1.0 maximum output.
  - `T2-LOUD-4`: Non-positive peak values (0.0, -1.5) fall back gracefully without zero division.
  - `T2-LOUD-5`: Completely missing ReplayGain tags yield neutral 1.0x multiplier.
- **Mobile PWA Streaming Boundaries**:
  - `T2-PWA-1`: Sudden network disconnection: audio element handles stalled state with transparent recovery.
  - `T2-PWA-2`: Missing/null artwork URL safely yields empty array for MediaSession.
  - `T2-PWA-3`: Environments without `navigator.mediaSession` silently no-op without uncaught exception.
  - `T2-PWA-4`: Narrow 320px viewport activates compact controls and swipeable mobile drawer without layout break.
  - `T2-PWA-5`: Rapid seek operations are debounced and previous pending stream requests are cleanly cancelled.

### Tier 3: Cross-Feature Combinations (5 Comprehensive Pipelines)
- **Pipeline 1 (LAN Streaming + Loudness Normalization)**: Remote mobile client connects via LAN URL (`0.0.0.0`), streams track, and applies ReplayGain loudness normalization with anti-clipping in the browser audio pipeline.
- **Pipeline 2 (Waveform Requests over LAN + Security Middleware)**: Remote LAN client requests `/api/tracks/{id}/waveform` (public GET allowed with 7-day cache headers) and attempts destructive `POST /api/library/scan` (blocked with 403 Forbidden by security middleware).
- **Pipeline 3 (Mobile PWA Continuous Playback + ReplayGain Mode Switching)**: Mobile browser in standalone PWA mode plays context queue, dynamically switches ReplayGain mode from `Off` -> `Track` -> `Album`, verifying instantaneous volume recalculation without pausing playback.
- **Pipeline 4 (Waveform Scrubber + Seeking during LAN Streaming)**: Remote client scrubs via waveform envelope data, initiating HTTP 206 Partial Content range requests over LAN with accurate byte offset calculation.
- **Pipeline 5 (PWA MediaSession + Background Audio Lock + ReplayGain)**: Mobile client locks screen while playing track with high ReplayGain peak; MediaSession metadata displays track title/artist/artwork, OS lockscreen controls trigger next/prev, and limiter prevents distortion.

### Tier 4: Real-World Application Scenarios (5 Production Workloads)
- **Workload 1 (Remote LAN Discovery & Session Ingestion)**: Host enables LAN mode in SettingsView -> LAN IP detected -> QR code generated -> Remote client opens `http://192.168.1.100:4242` -> PWA manifest loads -> Library tracks fetched.
- **Workload 2 (Multi-Track Album Loudness Normalization & Waveform Inspection)**: User selects album with diverse track masterings (loud -10.5 dB vs quiet -2.1 dB) -> Album mode applies unified acoustic gain multiplier -> User scrubs into track using cached 100-point waveform peaks.
- **Workload 3 (Remote Party Controller & Queue Modification)**: Mobile phone connects over LAN -> Views current queue -> Pushes guest tracks to priority queue via `queuePlayNext` -> Adjusts volume -> MediaSession reflects active track.
- **Workload 4 (Network Fluctuation & Loopback Fallback)**: Network disconnects -> Server attempts rebind -> Falls back to loopback `127.0.0.1` -> Desktop client continues local playback uninterrupted with zero data loss.
- **Workload 5 (Full Mobile PWA Lifecycle)**: PWA installed to home screen -> User opens offline app shell -> Connects to server -> Fetches track with pre-cached waveform -> Streams with EBU R128 normalization -> Locks device with active MediaSession background notification.

---

## 4. Verification Commands & Execution Instructions

```bash
# 1. Execute Frontend Empirical Challenger & Complete 4-Tier E2E Test Suite
npm --prefix ui test

# 2. Execute Frontend TypeScript Typecheck & Production Build
npm --prefix ui run build

# 3. Execute Rust Workspace Tests & Queue Integration Suite
cargo test --workspace

# 4. Execute Rust Clippy Strict Lints (Zero Warnings)
cargo clippy --workspace --all-targets -- -D warnings
```

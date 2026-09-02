# Wavery

Wavery is a local-first music player built in Rust and TypeScript. It runs either as a native Tauri desktop app or as a standalone HTTP streaming server with a web UI.

```
┌─────────────────────────────────────────────────────────────┐
│                       wavery-ui                             │
│       React 18 · TypeScript · Zustand · TanStack Virtual    │
└──────────────┬───────────────────────────────┬──────────────┘
               │ IPC                           │ HTTP / REST
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│        wavery-tauri         │ │        wavery-server        │
│    Tauri v2 Desktop Shell   │ │    Axum RFC 7233 Streamer   │
└──────────────┬──────────────┘ └──────────────┬──────────────┘
               │                               │
┌──────────────▼───────────────────────────────▼──────────────┐
│  wavery-audio   │  wavery-library  │  wavery-mpris          │
│  Rodio + CPAL   │  SQLite FTS5+WAL │  Linux D-Bus (zbus)    │
│  64KB Buffering │  Lofty Metadata  │                        │
└─────────────────┴──────────────────┴────────────────────────┘
               │                               │
┌──────────────▼───────────────────────────────▼──────────────┐
│            wavery-core          │       wavery-config       │
│     Domain Models & Traits      │    XDG Atomic TOML Config │
└─────────────────────────────────┴───────────────────────────┘
```

## Architecture

The codebase splits into isolated Cargo crates and a frontend package. Crates communicate only through domain traits defined in `wavery-core`, preventing direct driver coupling between playback, storage, and networking.

- **`crates/core` (`wavery-core`)**: Domain models (`Track`, `Album`, `Artist`, `Playlist`, `TrackMetadata`), traits (`PlayerEngine`, `LibraryManager`, `MetadataReader`, `QueueManager`, `MprisBridge`), and typed error enums. Contains zero audio or database driver dependencies.
- **`crates/config` (`wavery-config`)**: XDG directory resolution (`$XDG_CONFIG_HOME/wavery/config.toml`, `$XDG_DATA_HOME/wavery/library/`, `$XDG_CACHE_HOME/wavery/album_art/`) and atomic file persistence using temporary file replacement.
- **`crates/audio` (`wavery-audio`)**: Audio backend powered by Rodio. Decouples playback onto a dedicated OS thread, maintains 64KB I/O buffers for high-bitrate files, and auto-rebinds output streams if the default CPAL audio device drops. Includes a queue manager that splices new tracks into shuffle order without resetting playback state.
- **`crates/library` (`wavery-library`)**: SQLite database configured with write-ahead logging (WAL) and FTS5 full-text indexing with BM25 relevance scoring. Handles ID3, FLAC, Vorbis, and MP4 tag extraction via Lofty, plus parallel directory scanning with `walkdir` and Tokio tasks.
- **`crates/mpris` (`wavery-mpris`)**: Linux MPRIS D-Bus bridge using `zbus` to expose media keys, playback status, track metadata, and cover art URIs to desktop environments.
- **`crates/server` (`wavery-server`)**: Axum HTTP daemon serving the web client, REST endpoints, and RFC 7233 byte-range audio streaming with an LRU artwork cache.
- **`ui/src-tauri` (`wavery-tauri`)**: Desktop shell handling native windows, system tray controls, and IPC dispatch.
- **`ui/` (`wavery-ui`)**: Web interface built with React 18, TailwindCSS, Zustand stores, and `@tanstack/react-virtual` for virtualized rendering of 100k+ track libraries.

---

## Prerequisites

You need Rust (1.80+) and Node.js (18+) installed on your machine.

On Linux, install system development headers for audio and D-Bus:

```bash
# Debian / Ubuntu / Pop!_OS
sudo apt-get install -y libasound2-dev libdbus-1-dev libssl-dev pkg-config

# Fedora / RHEL
sudo dnf install -y alsa-lib-devel dbus-devel openssl-devel pkgconf-pkg-config

# Arch Linux
sudo pacman -S --needed alsa-lib dbus openssl pkgconf
```

---

## Quick Start

### 1. Running the Tauri Desktop App

Install frontend dependencies, then launch the app in development mode:

```bash
# Install frontend dependencies
cd ui && npm install

# Start Tauri development desktop app
npm run tauri dev
```

### 2. Running the Headless Streaming Server

To run Wavery as a standalone server that streams audio to any browser on your local network:

```bash
# Build the web frontend dist bundle
cd ui && npm install && npm run build
cd ..

# Run the server binary
cargo run -p wavery-server --bin wavery-server
```

By default, the server listens on `http://127.0.0.1:4040`. Open that address in your browser to access the web player.

---

## Configuration

Wavery stores its settings in a single TOML file located at `$XDG_CONFIG_HOME/wavery/config.toml` (or `~/.config/wavery/config.toml` on Linux):

```toml
[general]
check_for_updates = true

[audio]
volume = 0.85
bitrate = 320
exclusive_mode = false
buffer_size_ms = 100

[library]
managed_directory = "~/Music"
database_path = "~/.local/share/wavery/library/library.db"
scan_on_startup = true
follow_symlinks = false

[server]
host = "127.0.0.1"
port = 4040
allow_remote_control = true

[theme]
mode = "dark"
accent_color = "#3b82f6"

[ui]
sidebar_collapsed = false
active_view = "Tracks"
table_compact_mode = false

[keybinds]
play_pause = "Space"
next_track = "Ctrl+Right"
prev_track = "Ctrl+Left"
volume_up = "Ctrl+Up"
volume_down = "Ctrl+Down"
search = "Ctrl+F"
```

All settings load with fallback defaults if fields are missing. Saves write atomically to avoid corruption during system crashes.

---

## Testing & Quality Assurance

Run the test suites across the Rust workspace and frontend:

```bash
# 1. Rust workspace unit, integration, and stress tests
cargo test --workspace

# 2. Rust strict linter check
cargo clippy --workspace --all-targets -- -D warnings

# 3. Frontend empirical tests and benchmarks
npm --prefix ui test

# 4. Frontend TypeScript build verification
npm --prefix ui run build
```

---

## License

Dual-licensed under either the MIT License or the Apache License 2.0.

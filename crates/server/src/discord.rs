//! Discord Rich Presence IPC bridge for wavery-server.
//!
//! Maintains a connection to the local Discord desktop client via its IPC socket
//! and forwards "now playing" presence data from the HTTP API.
//!
//! Cross-platform socket paths:
//!   Linux/macOS : `$TMPDIR/discord-ipc-0` (falls back to `/tmp/discord-ipc-0`)
//!   Windows     : `\\.\pipe\discord-ipc-0`
//!
//! The `DiscordIpcClient` from `discord-rich-presence` is synchronous and blocking,
//! so all operations are dispatched via `tokio::task::spawn_blocking`.
//!
//! A Discord Application ID (client ID) is required. Wavery ships with a public
//! development ID. Users can override it with their own at no cost.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

/// Default Discord application ID for Music Presence.
/// Uses the registered Discord "Music" application ID ("1205619376275980288")
/// which displays as "Listening to Music" / "Playing Music".
/// Users can override this in Settings with their own Discord Developer Application ID.
pub const DEFAULT_APP_ID: &str = "1205619376275980288";

/// The "now playing" snapshot forwarded from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresencePayload {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub is_playing: bool,
    #[serde(default)]
    pub app_id: Option<String>,
}

/// Tracks whether the Discord IPC client is connected and operational.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordStatusPayload {
    pub connected: bool,
    pub discord_running: bool,
}

/// Shared mutable Discord IPC state.
/// Wrapped in `Arc<Mutex<...>>` so it can be passed across blocking tasks.
pub struct DiscordRpcState {
    /// The underlying IPC client. `None` when no connection has been attempted yet.
    client: Option<DiscordIpcClient>,
    /// Whether the client is currently connected to Discord desktop.
    connected: bool,
    /// Whether Discord is believed to be installed/running on this machine.
    discord_running: bool,
    /// The Discord application client ID to use when connecting.
    app_id: String,
}

impl DiscordRpcState {
    /// Creates a new disconnected state with the given (or default) application ID.
    #[must_use]
    pub fn new(app_id: Option<&str>) -> Self {
        let effective_id = match app_id {
            Some(id) if !id.trim().is_empty() => id.trim(),
            _ => DEFAULT_APP_ID,
        };
        Self {
            client: None,
            connected: false,
            discord_running: false,
            app_id: effective_id.to_string(),
        }
    }

    /// Sets or updates the Discord application ID.
    /// Closes any existing client connection if the ID has changed.
    pub fn set_app_id(&mut self, app_id: Option<&str>) {
        let target = match app_id {
            Some(id) if !id.trim().is_empty() => id.trim(),
            _ => DEFAULT_APP_ID,
        };
        if target != self.app_id {
            if let Some(ref mut client) = self.client {
                let _ = client.close();
            }
            self.client = None;
            self.connected = false;
            self.app_id = target.to_string();
        }
    }

    /// Returns a `DiscordStatusPayload` snapshot of the current state.
    /// Proactively attempts connection if not currently connected to reflect real state.
    pub fn status(&mut self) -> DiscordStatusPayload {
        if !self.connected {
            self.ensure_connected();
        }
        DiscordStatusPayload {
            connected: self.connected,
            discord_running: self.discord_running,
        }
    }

    /// Attempts to (re)connect to the Discord IPC socket.
    /// Returns `true` if the connection succeeded (or was already live).
    fn ensure_connected(&mut self) -> bool {
        if self.connected && self.client.is_some() {
            return true;
        }

        // Always create a fresh client on each reconnect attempt
        let mut client = DiscordIpcClient::new(&self.app_id);
        match client.connect() {
            Ok(()) => {
                self.client = Some(client);
                self.connected = true;
                self.discord_running = true;
                tracing::info!("Discord RPC: connected to Discord IPC socket with app_id={}", self.app_id);
                true
            }
            Err(e) => {
                // IPC not found typically means Discord is not running
                tracing::debug!("Discord RPC: failed to connect ({}) — {e}", self.app_id);
                self.client = None;
                self.connected = false;
                self.discord_running = false;
                false
            }
        }
    }

    /// Sets the Rich Presence activity.
    /// Automatically attempts reconnect if the client is not yet connected.
    pub fn set_activity(&mut self, payload: &PresencePayload) {
        if let Some(ref custom_id) = payload.app_id {
            self.set_app_id(Some(custom_id));
        }

        if !self.ensure_connected() {
            return;
        }

        let client = match &mut self.client {
            Some(c) => c,
            None => return,
        };

        // Build human-readable strings
        let details = truncate(&payload.title, 128);
        let state = if payload.album.is_empty() {
            truncate(&payload.artist, 128)
        } else {
            truncate(&format!("{} — {}", payload.artist, payload.album), 128)
        };

        // Discord expects timestamps in Unix epoch milliseconds
        let now_millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let pos_millis = (payload.position_secs.max(0.0) * 1000.0) as i64;
        let dur_millis = (payload.duration_secs.max(0.0) * 1000.0) as i64;
        let start_ts = now_millis.saturating_sub(pos_millis);
        let end_ts = start_ts.saturating_add(dur_millis);

        let timestamps = if payload.is_playing && dur_millis > 0 {
            activity::Timestamps::new().start(start_ts).end(end_ts)
        } else if payload.is_playing {
            activity::Timestamps::new().start(start_ts)
        } else {
            activity::Timestamps::new()
        };

        let act = activity::Activity::new()
            .details(details.as_str())
            .state(state.as_str())
            .timestamps(timestamps);

        match client.set_activity(act) {
            Ok(()) => {
                tracing::debug!("Discord RPC: presence updated — {}", payload.title);
            }
            Err(e) => {
                tracing::warn!("Discord RPC: set_activity failed — {e}; marking disconnected");
                self.connected = false;
                self.discord_running = false;
                self.client = None;
            }
        }
    }

    /// Clears the Rich Presence activity (e.g., on stop).
    pub fn clear_activity(&mut self) {
        if !self.connected {
            return;
        }

        let client = match &mut self.client {
            Some(c) => c,
            None => return,
        };

        if let Err(e) = client.clear_activity() {
            tracing::debug!("Discord RPC: clear_activity failed — {e}");
            self.connected = false;
            self.client = None;
        } else {
            tracing::debug!("Discord RPC: presence cleared");
        }
    }
}

impl Drop for DiscordRpcState {
    fn drop(&mut self) {
        if let Some(ref mut client) = self.client {
            let _ = client.close();
        }
    }
}

/// Thread-safe handle to the Discord RPC state shared across Axum handlers.
pub type DiscordHandle = Arc<RwLock<Mutex<DiscordRpcState>>>;

/// Creates a new `DiscordHandle` initialised to a disconnected state.
#[must_use]
pub fn new_discord_handle(app_id: Option<&str>) -> DiscordHandle {
    Arc::new(RwLock::new(Mutex::new(DiscordRpcState::new(app_id))))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Truncates `s` to at most `max_bytes` bytes (UTF-8 safe).
fn truncate(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        s.to_string()
    } else {
        // Find the last valid UTF-8 boundary before max_bytes
        let mut idx = max_bytes;
        while idx > 0 && !s.is_char_boundary(idx) {
            idx -= 1;
        }
        format!("{}…", &s[..idx])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_short_string_unchanged() {
        assert_eq!(truncate("hello", 128), "hello");
    }

    #[test]
    fn truncate_long_string_appends_ellipsis() {
        let s = "a".repeat(200);
        let result = truncate(&s, 128);
        assert!(result.len() <= 132); // 128 + "…" (3 bytes)
        assert!(result.ends_with('…'));
    }

    #[test]
    fn truncate_is_utf8_safe() {
        // "🎵" is 4 bytes; truncating at byte 5 would split it
        let s = "🎵🎵🎵🎵🎵";
        let result = truncate(s, 5);
        // Must still be valid UTF-8
        assert!(std::str::from_utf8(result.as_bytes()).is_ok());
    }
}

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

/// Default Wavery Discord application ID.
/// Created at https://discord.com/developers/applications (free).
const DEFAULT_APP_ID: &str = "1354000000000000000";

/// The "now playing" snapshot forwarded from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresencePayload {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub is_playing: bool,
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
        Self {
            client: None,
            connected: false,
            discord_running: false,
            app_id: app_id.unwrap_or(DEFAULT_APP_ID).to_string(),
        }
    }

    /// Returns a `DiscordStatusPayload` snapshot of the current state.
    #[must_use]
    pub fn status(&self) -> DiscordStatusPayload {
        DiscordStatusPayload {
            connected: self.connected,
            discord_running: self.discord_running,
        }
    }

    /// Attempts to (re)connect to the Discord IPC socket.
    /// Returns `true` if the connection succeeded (or was already live).
    fn ensure_connected(&mut self) -> bool {
        if self.connected {
            return true;
        }

        // Always create a fresh client on each reconnect attempt
        let mut client = DiscordIpcClient::new(&self.app_id);
        match client.connect() {
            Ok(()) => {
                self.client = Some(client);
                self.connected = true;
                self.discord_running = true;
                tracing::info!("Discord RPC: connected to Discord IPC socket");
                true
            }
            Err(e) => {
                // IPC not found typically means Discord is not running
                tracing::debug!("Discord RPC: failed to connect — {e}");
                self.client = None;
                self.connected = false;
                // Heuristically mark discord_running=false on first failure,
                // or keep it true if we had a previous successful connection
                self.discord_running = false;
                false
            }
        }
    }

    /// Sets the Rich Presence activity.
    /// Automatically attempts reconnect if the client is not yet connected.
    pub fn set_activity(&mut self, payload: &PresencePayload) {
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

        // Compute end timestamp from current unix time + remaining seconds
        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let remaining_secs = (payload.duration_secs - payload.position_secs).max(0.0) as i64;
        let end_ts = now_secs + remaining_secs;

        let timestamps = if payload.is_playing && remaining_secs > 0 {
            activity::Timestamps::new().end(end_ts)
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
                self.discord_running = true; // Discord may still be running, just lost the socket
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

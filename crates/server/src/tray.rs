//! System tray application for `wavery-server` using native StatusNotifierItem protocol.
//!
//! Provides a system tray icon with interactive menu controls for choosing between
//! different display targets (Web Browser client or Tauri Native Desktop window),
//! triggering background library scans, and managing server lifecycle.

use crate::{open_browser_url, spawn_native_process, AppState};
use ksni::{menu::StandardItem, Handle, MenuItem, Tray, TrayService};
use std::sync::Arc;
use tracing::{error, info};
use wavery_core::models::ImportStrategy;
use wavery_core::traits::LibraryManager;

/// Wavery Server StatusNotifierItem tray implementation.
pub struct WaveryServerTray {
    state: Arc<AppState>,
}

impl WaveryServerTray {
    /// Creates a new `WaveryServerTray` with the shared application state.
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }
}

impl Tray for WaveryServerTray {
    fn id(&self) -> String {
        "wavery-server".into()
    }

    fn title(&self) -> String {
        "Wavery".into()
    }

    fn category(&self) -> ksni::Category {
        ksni::Category::ApplicationStatus
    }

    fn status(&self) -> ksni::Status {
        ksni::Status::Active
    }

    fn icon_name(&self) -> String {
        "audio-player".into()
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        let (host, port) = {
            let guard = self.state.config.try_read();
            if let Ok(cfg) = guard {
                (cfg.server.host.clone(), cfg.server.port)
            } else {
                ("127.0.0.1".to_string(), 4242)
            }
        };
        let web_url = format!("http://{host}:{port}");
        info!("Tray activated: opening Web Player display ({web_url})...");
        let _ = open_browser_url(&web_url);
    }

    fn menu(&self) -> Vec<MenuItem<Self>> {
        let (host, port) = {
            let guard = self.state.config.try_read();
            if let Ok(cfg) = guard {
                (cfg.server.host.clone(), cfg.server.port)
            } else {
                ("127.0.0.1".to_string(), 4242)
            }
        };
        let web_url = format!("http://{host}:{port}");
        let web_url_clone = web_url.clone();
        let state_rescan = self.state.clone();
        let state_rebuild = self.state.clone();

        vec![
            StandardItem {
                label: format!("🌐 Open Web Player ({web_url})"),
                activate: Box::new(move |_| {
                    info!("Tray: Opening Web Player at {web_url_clone}");
                    if let Err(e) = open_browser_url(&web_url_clone) {
                        error!("Failed to open browser: {e}");
                    }
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "🖥️ Open Desktop App (Tauri)".into(),
                activate: Box::new(|_| {
                    info!("Tray: Launching Tauri Native Desktop Window...");
                    if let Err(e) = spawn_native_process() {
                        error!("Failed to launch native desktop process: {e}");
                    }
                }),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "🔄 Rescan Music Library".into(),
                activate: Box::new(move |_| {
                    info!("Tray: Starting background library rescan...");
                    let lib_arc = state_rescan.library.clone();
                    let managed_dir = {
                        let guard = state_rescan.config.try_read();
                        guard.map(|c| c.library.managed_directory.clone()).unwrap_or_default()
                    };
                    tokio::spawn(async move {
                        let mut lib = lib_arc.lock().await;
                        match lib.import_directory(&managed_dir, ImportStrategy::Copy).await {
                            Ok(tracks) => {
                                info!("Background library scan finished: {} tracks indexed", tracks.len());
                            }
                            Err(e) => {
                                error!("Background library scan error: {e}");
                            }
                        }
                    });
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "🧹 Rebuild Database & Clear Cache".into(),
                activate: Box::new(move |_| {
                    info!("Tray: Rebuilding music library database...");
                    let lib_arc = state_rebuild.library.clone();
                    let art_cache = state_rebuild.artwork_cache.clone();
                    tokio::spawn(async move {
                        let mut lib = lib_arc.lock().await;
                        match lib.rebuild_library().await {
                            Ok(tracks) => {
                                let mut cache = art_cache.write().await;
                                cache.clear();
                                info!("Library rebuild complete: {} tracks re-indexed", tracks.len());
                            }
                            Err(e) => {
                                error!("Library rebuild failed: {e}");
                            }
                        }
                    });
                }),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: format!("🟢 Server Status: Online ({host}:{port})"),
                enabled: false,
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: "🛑 Quit Wavery Server".into(),
                activate: Box::new(|_| {
                    info!("Tray: Shutting down Wavery Server...");
                    std::process::exit(0);
                }),
                ..Default::default()
            }
            .into(),
        ]
    }
}

/// Controller handle for the Wavery server tray service.
pub struct ServerTrayManager {
    _handle: Handle<WaveryServerTray>,
}

impl ServerTrayManager {
    /// Spawns the background system tray service.
    /// Returns `None` if running in a headless environment without D-Bus / display server.
    pub fn try_new(state: Arc<AppState>) -> Option<Self> {
        // Verify graphical/session bus is reachable
        if std::env::var("DBUS_SESSION_BUS_ADDRESS").is_err()
            && std::env::var("DISPLAY").is_err()
            && std::env::var("WAYLAND_DISPLAY").is_err()
        {
            info!("Headless environment detected. System tray service skipped.");
            return None;
        }

        let tray = WaveryServerTray::new(state);
        let service = TrayService::new(tray);
        let handle = service.handle();
        service.spawn();

        info!("Wavery Server Native System Tray spawned successfully.");
        Some(Self { _handle: handle })
    }
}

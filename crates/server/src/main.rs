//! Standalone HTTP streaming and browser UI server for Wavery with System Tray management.
//!
//! Hosts the REST API, audio streaming endpoints, serves the web player, and provides
//! a desktop System Tray application for controlling display options (Web vs Tauri).

use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing::info;
use wavery_config::{default_config_path, load_or_create};
use wavery_core::models::ImportStrategy;
use wavery_core::traits::LibraryManager;
use wavery_library::{LoftyMetadataReader, SqliteLibraryManager};
use wavery_server::{build_router, AppState, ServerTrayManager};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = tracing_subscriber::fmt::try_init();

    let cfg_path = default_config_path().unwrap_or_else(|_| PathBuf::from("config.toml"));
    let config = load_or_create(&cfg_path).unwrap_or_default();

    let library = SqliteLibraryManager::new(
        config.library.managed_directory.clone(),
        config.library.database_path.clone(),
    )?;

    // Resolve static UI dist directory — check standard locations in priority order
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let static_dir = [
        exe_dir.as_ref().map(|d| d.join("dist")),
        exe_dir.as_ref().map(|d| d.join("../dist")),
        Some(PathBuf::from("ui/dist")),
        Some(PathBuf::from("dist")),
    ]
    .into_iter()
    .flatten()
    .find(|p| p.exists());

    let library_arc = Arc::new(Mutex::new(library));

    let app_state = Arc::new(AppState::with_config(
        library_arc.clone(),
        LoftyMetadataReader::new(),
        static_dir,
        config.clone(),
        cfg_path,
    ));

    // Background startup scan: rescans managed directory and populates in-memory cache
    if config.library.scan_on_startup {
        let scan_lib = library_arc.clone();
        let managed_dir = config.library.managed_directory.clone();
        tokio::spawn(async move {
            let mut lib = scan_lib.lock().await;
            match lib.import_directory(&managed_dir, ImportStrategy::Copy).await {
                Ok(tracks) => info!("Startup scan complete: {} tracks indexed", tracks.len()),
                Err(e) => eprintln!("[wavery-server] Startup scan error: {e}"),
            }
        });
    }

    let router = build_router(app_state.clone());
    let addr = format!("{}:{}", config.server.host, config.server.port);
    let mut listener = None;
    for attempt in 1..=20 {
        match TcpListener::bind(&addr).await {
            Ok(l) => {
                listener = Some(l);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                if attempt == 20 {
                    return Err(Box::new(e) as Box<dyn std::error::Error>);
                }
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            }
            Err(e) => return Err(Box::new(e) as Box<dyn std::error::Error>),
        }
    }
    let listener = listener.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrInUse, "Port in use")
    })?;

    info!("Wavery Server running at http://{}", addr);
    println!("\n╔════════════════════════════════════════════════════════════╗");
    println!("║                                                            ║");
    println!("║   Wavery Music Server & Tray are Live!                     ║");
    println!("║   Open in browser: http://{:<32} ║", addr);
    println!("║   Display Options: Web Player | Tauri Desktop App          ║");
    println!("║                                                            ║");
    println!("╚════════════════════════════════════════════════════════════╝\n");

    // Spawn the HTTP server on an asynchronous task
    let server_handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("[wavery-server] Server error: {e}");
        }
    });

    // Initialize Native System Tray (supports Web/Desktop client switching)
    let _tray = ServerTrayManager::try_new(app_state.clone());

    let _ = server_handle.await;

    Ok(())
}

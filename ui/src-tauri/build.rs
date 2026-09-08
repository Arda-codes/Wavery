fn main() {
    // Ensure frontend dist directory exists so cargo check/test/clippy succeed even before UI is built
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let dist_dir = std::path::Path::new(&manifest_dir).join("../dist");
    if !dist_dir.exists() {
        let _ = std::fs::create_dir_all(&dist_dir);
    }
    let index_html = dist_dir.join("index.html");
    if !index_html.exists() {
        let _ = std::fs::write(
            index_html,
            "<!DOCTYPE html><html><head><title>Wavery</title></head><body></body></html>",
        );
    }
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}

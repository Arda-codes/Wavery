#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Wavery Linux Builder (.AppImage & .deb)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
UI_DIR="${ROOT_DIR}/ui"

echo "======================================================="
echo "  Building Wavery for Linux (x86_64)"
echo "======================================================="

# Check tool prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required." >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Error: Cargo/Rust is required." >&2; exit 1; }

echo "[1/4] Installing UI dependencies..."
cd "${UI_DIR}"
npm install

echo "[2/4] Building React/TypeScript frontend..."
npm run build

echo "[3/4] Checking Rust workspace..."
cd "${ROOT_DIR}"
cargo check --workspace --all-targets

echo "[4/4] Building Tauri desktop bundle (.AppImage, .deb)..."
cd "${UI_DIR}"
npx @tauri-apps/cli build

echo "======================================================="
echo "  Linux Build Successful!"
echo "  Output artifacts located in: ${ROOT_DIR}/target/release/bundle/"
echo "======================================================="

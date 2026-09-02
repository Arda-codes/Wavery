#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Wavery macOS Builder (.dmg & .app)
# Supports Universal Binary (Apple Silicon + Intel) or Native architecture
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
UI_DIR="${ROOT_DIR}/ui"
MODE="${1:-universal}" # 'universal', 'arm64', or 'x86_64'

echo "======================================================="
echo "  Building Wavery for macOS (Mode: ${MODE})"
echo "======================================================="

command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required." >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Error: Cargo/Rust is required." >&2; exit 1; }

echo "[1/4] Installing UI dependencies..."
cd "${UI_DIR}"
npm install

echo "[2/4] Building React/TypeScript frontend..."
npm run build

echo "[3/4] Configuring Rust target architectures..."
case "${MODE}" in
  universal)
    rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true
    BUILD_ARGS="--target universal-apple-darwin"
    ;;
  arm64)
    rustup target add aarch64-apple-darwin 2>/dev/null || true
    BUILD_ARGS="--target aarch64-apple-darwin"
    ;;
  x86_64)
    rustup target add x86_64-apple-darwin 2>/dev/null || true
    BUILD_ARGS="--target x86_64-apple-darwin"
    ;;
  *)
    BUILD_ARGS=""
    ;;
esac

echo "[4/4] Building Tauri macOS application (.dmg, .app)..."
cd "${UI_DIR}"
# shellcheck disable=SC2086
npx @tauri-apps/cli build ${BUILD_ARGS}

echo "======================================================="
echo "  macOS Build Successful!"
echo "  Output artifacts located in: ${ROOT_DIR}/target/release/bundle/dmg/"
echo "======================================================="

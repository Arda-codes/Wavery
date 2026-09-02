#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Wavery Universal Desktop Builder
# Dispatches build for Linux, macOS, or Windows based on environment or argument
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGET="${1:-auto}"

echo "======================================================="
echo "  Wavery Universal Builder"
echo "  Root: ${ROOT_DIR}"
echo "  Target: ${TARGET}"
echo "======================================================="

case "${TARGET}" in
  auto)
    UNAME="$(uname -s)"
    case "${UNAME}" in
      Linux*)   exec "${SCRIPT_DIR}/build-linux.sh" ;;
      Darwin*)  exec "${SCRIPT_DIR}/build-macos.sh" ;;
      CYGWIN*|MINGW*|MSYS*)
        powershell.exe -ExecutionPolicy Bypass -File "${SCRIPT_DIR}/build-windows.ps1"
        ;;
      *)
        echo "Error: Unknown or unsupported operating system '${UNAME}'" >&2
        exit 1
        ;;
    esac
    ;;
  linux)
    exec "${SCRIPT_DIR}/build-linux.sh"
    ;;
  macos|darwin)
    exec "${SCRIPT_DIR}/build-macos.sh"
    ;;
  windows|win)
    if command -v powershell.exe >/dev/null 2>&1; then
      powershell.exe -ExecutionPolicy Bypass -File "${SCRIPT_DIR}/build-windows.ps1"
    elif command -v pwsh >/dev/null 2>&1; then
      pwsh -ExecutionPolicy Bypass -File "${SCRIPT_DIR}/build-windows.ps1"
    else
      echo "Error: PowerShell is required to run the Windows build script." >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 [auto | linux | macos | windows]" >&2
    exit 1
    ;;
esac

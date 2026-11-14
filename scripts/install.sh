#!/usr/bin/env sh
set -eu

REPO="Arda-codes/Wavery"
VERSION="${WAVERY_VERSION:-${1:-latest}}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is required to install Wavery." >&2
    exit 1
  fi
}

need_cmd curl
need_cmd grep
need_cmd head

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ;;
  *)
    echo "Error: unsupported architecture '$ARCH' (only x86_64 packages are currently published)." >&2
    exit 1
    ;;
esac

if command -v pacman >/dev/null 2>&1; then
  EXT="pkg.tar.zst"
  PKG_MGR="pacman"
elif command -v apt-get >/dev/null 2>&1; then
  EXT="deb"
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  EXT="rpm"
  PKG_MGR="dnf"
else
  echo "Error: no supported package manager found (apt-get, dnf, pacman)." >&2
  echo "Download a package manually from: https://github.com/$REPO/releases" >&2
  exit 1
fi

if [ "$VERSION" = "latest" ]; then
  API_URL="https://api.github.com/repos/$REPO/releases/latest"
else
  API_URL="https://api.github.com/repos/$REPO/releases/tags/$VERSION"
fi

ASSET_URL="$(curl -fsSL "$API_URL" \
  | grep -Eo "https://[^\"]+\.$EXT" \
  | head -n 1 || true)"

if [ -z "$ASSET_URL" ]; then
  echo "Error: could not find a .$EXT asset in release '$VERSION'." >&2
  echo "Check available releases at: https://github.com/$REPO/releases" >&2
  exit 1
fi

PKG_FILE="$TMP_DIR/wavery.$EXT"
echo "Downloading Wavery ($EXT) from $ASSET_URL..."
curl -fL --progress-bar "$ASSET_URL" -o "$PKG_FILE"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  need_cmd sudo
  SUDO="sudo"
fi

echo "Installing Wavery using $PKG_MGR..."
case "$PKG_MGR" in
  pacman) $SUDO pacman -U --noconfirm "$PKG_FILE" ;;
  apt)    $SUDO apt-get install -y "$PKG_FILE" ;;
  dnf)    $SUDO dnf install -y "$PKG_FILE" ;;
esac

echo "Wavery installed successfully."

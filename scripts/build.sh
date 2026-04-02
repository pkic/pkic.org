#!/usr/bin/env bash
set -euo pipefail

REQUIRED_HUGO_VERSION="${HUGO_VERSION:-0.158.0}"

detect_hugo_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)
      echo "darwin-universal"
      ;;
    Linux)
      case "$arch" in
        x86_64|amd64)
          echo "linux-amd64"
          ;;
        arm64|aarch64)
          echo "linux-arm64"
          ;;
        *)
          echo "Unsupported Linux architecture: $arch" >&2
          return 1
          ;;
      esac
      ;;
    *)
      echo "Unsupported operating system: $os" >&2
      return 1
      ;;
  esac
}

# ── Ensure correct Hugo version is available ──────────────────────────────────
if command -v hugo &>/dev/null && hugo version 2>/dev/null | grep -qF "v${REQUIRED_HUGO_VERSION}"; then
  echo "Hugo ${REQUIRED_HUGO_VERSION} already installed."
  HUGO_BIN="hugo"
elif [[ "$(uname -s)" == "Darwin" ]] && command -v hugo &>/dev/null; then
  echo "Hugo ${REQUIRED_HUGO_VERSION} not found; using installed macOS Hugo: $(hugo version | head -n 1)"
  HUGO_BIN="hugo"
else
  echo "Installing Hugo ${REQUIRED_HUGO_VERSION}..."
  HUGO_PLATFORM="$(detect_hugo_platform)"
  HUGO_TAR="/tmp/hugo_${REQUIRED_HUGO_VERSION}.tar.gz"
  HUGO_BIN="/tmp/hugo_${REQUIRED_HUGO_VERSION}"
  curl -fsSL \
    "https://github.com/gohugoio/hugo/releases/download/v${REQUIRED_HUGO_VERSION}/hugo_extended_${REQUIRED_HUGO_VERSION}_${HUGO_PLATFORM}.tar.gz" \
    -o "${HUGO_TAR}"
  tar xzf "${HUGO_TAR}" -C /tmp hugo
  mv /tmp/hugo "${HUGO_BIN}"
  echo "Hugo ${REQUIRED_HUGO_VERSION} installed."
fi

# ── Build ─────────────────────────────────────────────────────────────────────
git submodule update --init --remote
"${HUGO_BIN}" --minify --cacheDir "$(pwd)/.cache"
npx -y pagefind --site "public"

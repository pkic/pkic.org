#!/usr/bin/env bash
set -euo pipefail

REQUIRED_HUGO_VERSION="${HUGO_VERSION:-0.157.0}"

# ── Ensure correct Hugo version is available ──────────────────────────────────
if command -v hugo &>/dev/null && hugo version 2>/dev/null | grep -qF "v${REQUIRED_HUGO_VERSION}"; then
  echo "Hugo ${REQUIRED_HUGO_VERSION} already installed."
  HUGO_BIN="hugo"
else
  echo "Installing Hugo ${REQUIRED_HUGO_VERSION}..."
  HUGO_TAR="/tmp/hugo_${REQUIRED_HUGO_VERSION}.tar.gz"
  HUGO_BIN="/tmp/hugo_${REQUIRED_HUGO_VERSION}"
  curl -fsSL \
    "https://github.com/gohugoio/hugo/releases/download/v${REQUIRED_HUGO_VERSION}/hugo_extended_${REQUIRED_HUGO_VERSION}_linux-amd64.tar.gz" \
    -o "${HUGO_TAR}"
  tar xzf "${HUGO_TAR}" -C /tmp hugo
  mv /tmp/hugo "${HUGO_BIN}"
  echo "Hugo ${REQUIRED_HUGO_VERSION} installed."
fi

# ── Build ─────────────────────────────────────────────────────────────────────
git submodule update --remote
"${HUGO_BIN}" --minify --cacheDir "$(pwd)/.cache"
npx -y pagefind --site "public"

#!/usr/bin/env bash
set -euo pipefail

REQUIRED_HUGO_VERSION="${HUGO_VERSION:-0.160.0}"

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

download_hugo() {
  local version platform archive_url archive_path extract_dir

  version="$1"
  platform="$2"
  archive_path="/tmp/hugo_${version}_${platform}"
  extract_dir="/tmp/hugo_${version}_${platform}_extract"

  case "$platform" in
    darwin-universal)
      archive_url="https://github.com/gohugoio/hugo/releases/download/v${version}/hugo_extended_${version}_${platform}.pkg"
      archive_path="${archive_path}.pkg"
      curl -fsSL "$archive_url" -o "$archive_path"
      rm -rf "$extract_dir"
      pkgutil --expand-full "$archive_path" "$extract_dir"
      cp "$extract_dir/Payload/hugo" "/tmp/hugo_${version}"
      chmod +x "/tmp/hugo_${version}"
      ;;
    *)
      archive_url="https://github.com/gohugoio/hugo/releases/download/v${version}/hugo_extended_${version}_${platform}.tar.gz"
      archive_path="${archive_path}.tar.gz"
      curl -fsSL "$archive_url" -o "$archive_path"
      tar xzf "$archive_path" -C /tmp hugo
      mv /tmp/hugo "/tmp/hugo_${version}"
      chmod +x "/tmp/hugo_${version}"
      ;;
  esac
}

# ── Ensure correct Hugo version is available ──────────────────────────────────
if command -v hugo &>/dev/null && hugo version 2>/dev/null | grep -qF "v${REQUIRED_HUGO_VERSION}"; then
  echo "Hugo ${REQUIRED_HUGO_VERSION} already installed."
  HUGO_BIN="hugo"
else
  echo "Installing Hugo ${REQUIRED_HUGO_VERSION}..."
  HUGO_PLATFORM="$(detect_hugo_platform)"
  HUGO_BIN="/tmp/hugo_${REQUIRED_HUGO_VERSION}"
  download_hugo "${REQUIRED_HUGO_VERSION}" "${HUGO_PLATFORM}"
  echo "Hugo ${REQUIRED_HUGO_VERSION} installed."
fi

# ── Build ─────────────────────────────────────────────────────────────────────
# Clone any missing submodules at the SHAs recorded in the parent commit.
git submodule update --init --recursive

# Refresh submodules that track a moving branch (have `branch = ...` in
# .gitmodules) to the latest tip of that branch. Submodules pinned to a
# specific commit — typically frozen version snapshots like
# content/wg/pkimm/1.0.0 — have no `branch` field and stay at the recorded
# SHA so they don't drift.
while IFS= read -r entry; do
  name="${entry#submodule.}"
  name="${name%.branch}"
  path="$(git config -f .gitmodules --get "submodule.${name}.path")"
  [ -n "$path" ] && git submodule update --remote -- "$path"
done < <(git config -f .gitmodules --name-only --get-regexp '^submodule\..*\.branch$')

"${HUGO_BIN}" -e development --minify --cacheDir "$(pwd)/.cache"
npx -y pagefind --site "public"

#!/usr/bin/env bash
set -euo pipefail

# Keep repository Markdown submodules available to the Worker bundle at the
# exact commits recorded by the parent repository. Content changes are made by
# updating those gitlinks deliberately, never by a non-reproducible build.
git submodule update --init --recursive

node --experimental-strip-types scripts/build-site.mjs

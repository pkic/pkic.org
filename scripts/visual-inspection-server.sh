#!/bin/sh
# Wrapper for the Browser pane preview: seeded portal on an isolated port for
# design/UX inspection sessions (keeps the developer's own 8788 untouched).
export E2E_PORT=8797
export E2E_SENDGRID_URL_FILE=test-results/visual-sendgrid-url
exec sh scripts/e2e-start.sh

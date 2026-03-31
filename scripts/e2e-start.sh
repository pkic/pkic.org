#!/bin/sh
# E2E test startup: builds Hugo, seeds a fresh database, then launches
# the SendGrid interceptor + wrangler.
# Playwright calls this as webServer and waits for port 8788 to be reachable.
set -e

STATE_DIR=$(mktemp -d)
INTERCEPT_PORT=48765

# Some environments inject npm_config_* keys that newer npm versions warn
# about as unknown config. Clear them for this script so Playwright webServer
# logs stay clean and future npm majors do not fail startup.
unset npm_config_npm_globalconfig NPM_CONFIG_NPM_GLOBALCONFIG
unset npm_config_verify_deps_before_run NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN
unset npm_config__jsr_registry NPM_CONFIG__JSR_REGISTRY

# ── 1. Build static site ────────────────────────────────────────────────────
hugo -e development

# ── 2. Seed a fresh database ────────────────────────────────────────────────
npx wrangler d1 migrations apply pkic-db --local --persist-to="$STATE_DIR"
node scripts/seed-initial-admin.mjs  --local --db pkic-db --persist-to "$STATE_DIR"
node scripts/seed-event.mjs          --local --db pkic-db --persist-to "$STATE_DIR" --skip-email-templates
node scripts/seed-email-templates.mjs --local --db pkic-db --persist-to "$STATE_DIR"

# ── 3. Start servers ────────────────────────────────────────────────────────
node scripts/e2e-interceptor.mjs "$INTERCEPT_PORT" &
INTERCEPTOR_PID=$!

trap 'kill "$INTERCEPTOR_PID" 2>/dev/null; rm -rf "$STATE_DIR"' EXIT INT TERM

npx wrangler dev \
  --port=8788 \
  --persist-to="$STATE_DIR" \
  --env-file=.dev.vars \
  -b "SENDGRID_API_BASE=http://127.0.0.1:${INTERCEPT_PORT}" \
  -b SENDGRID_API_KEY=e2e-test-dummy-key \
  -b APP_BASE_URL=http://127.0.0.1:8788

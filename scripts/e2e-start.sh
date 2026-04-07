#!/bin/sh
# E2E test startup: builds Hugo, seeds a fresh database, then launches
# the SendGrid interceptor + wrangler.
# Playwright calls this as webServer and waits for port 8788 to be reachable.
set -e

STATE_DIR=$(mktemp -d)
INTERCEPT_PORT=48765
E2E_ENV_FILE="$STATE_DIR/.e2e.vars"

# Some environments inject npm_config_* keys that newer npm versions warn
# about as unknown config. Clear them for this script so Playwright webServer
# logs stay clean and future npm majors do not fail startup.
unset npm_config_npm_globalconfig NPM_CONFIG_NPM_GLOBALCONFIG
unset npm_config_verify_deps_before_run NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN
unset npm_config__jsr_registry NPM_CONFIG__JSR_REGISTRY

cat .dev.vars > "$E2E_ENV_FILE"
cat >> "$E2E_ENV_FILE" <<EOF
SENDGRID_API_BASE=http://127.0.0.1:${INTERCEPT_PORT}
SENDGRID_API_KEY=e2e-test-dummy-key
APP_BASE_URL=http://127.0.0.1:8788
EMAIL_BADGE_DELAY_SECONDS=0
EOF

# ── 1. Build static site ────────────────────────────────────────────────────
hugo -e development

# ── 2. Seed a fresh database ────────────────────────────────────────────────
printf 'y\n' | npx wrangler d1 migrations apply pkic-db-local --env local --local --persist-to="$STATE_DIR"
node scripts/seed-initial-admin.mjs  --env local --local --db pkic-db-local --persist-to "$STATE_DIR"
node scripts/seed-event.mjs          --env local --local --db pkic-db-local --persist-to "$STATE_DIR" --skip-email-templates
node scripts/seed-email-templates.mjs --env local --local --db pkic-db-local --persist-to "$STATE_DIR"

# ── 3. Start servers ────────────────────────────────────────────────────────
node scripts/e2e-interceptor.mjs "$INTERCEPT_PORT" &
INTERCEPTOR_PID=$!

trap 'kill "$INTERCEPTOR_PID" 2>/dev/null; rm -rf "$STATE_DIR"' EXIT INT TERM

INTERCEPTOR_READY=0
INTERCEPTOR_ATTEMPTS=0
while [ "$INTERCEPTOR_ATTEMPTS" -lt 50 ]; do
  if ! kill -0 "$INTERCEPTOR_PID" 2>/dev/null; then
    echo "[e2e-start] SendGrid interceptor exited before becoming ready" >&2
    exit 1
  fi
  if curl -sf "http://127.0.0.1:${INTERCEPT_PORT}/outbox" >/dev/null 2>&1; then
    INTERCEPTOR_READY=1
    break
  fi
  INTERCEPTOR_ATTEMPTS=$((INTERCEPTOR_ATTEMPTS + 1))
  sleep 0.2
done

if [ "$INTERCEPTOR_READY" -ne 1 ]; then
  echo "[e2e-start] Timed out waiting for SendGrid interceptor on port ${INTERCEPT_PORT}" >&2
  exit 1
fi

npx wrangler dev \
  --env=local \
  --port=8788 \
  --persist-to="$STATE_DIR" \
  --env-file="$E2E_ENV_FILE" \
  < /dev/null

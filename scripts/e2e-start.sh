#!/bin/sh
# E2E test startup: builds Hugo, seeds a fresh database, then launches
# the SendGrid interceptor + wrangler.
# Playwright calls this as webServer and waits for port 8788 to be reachable.
set -e

STATE_ROOT="${E2E_STATE_ROOT:-${TMPDIR:-/tmp}}"
mkdir -p "$STATE_ROOT"
STATE_DIR=$(mktemp -d "${STATE_ROOT%/}/pkic-e2e.XXXXXX")
INTERCEPT_URL_FILE="${E2E_SENDGRID_URL_FILE:-test-results/e2e-sendgrid-url}"
E2E_ENV_FILE="$STATE_DIR/.e2e.vars"
E2E_PORT="${E2E_PORT:-8788}"

# Some environments inject npm_config_* keys that newer npm versions warn
# about as unknown config. Clear them for this script so Playwright webServer
# logs stay clean and future npm majors do not fail startup.
unset npm_config_npm_globalconfig NPM_CONFIG_NPM_GLOBALCONFIG
unset npm_config_verify_deps_before_run NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN
unset npm_config__jsr_registry NPM_CONFIG__JSR_REGISTRY

mkdir -p "$(dirname "$INTERCEPT_URL_FILE")"
rm -f "$INTERCEPT_URL_FILE"
rm -f test-results/portal-management-verification-auth.json
rm -f test-results/portal-mobile-navigation-auth.json

# ── 0. Clean stale build artifacts ───────────────────────────────────────────
# A previous `pnpm build` or `deploy:preview` may have left dist/ and
# .wrangler/deploy/config.json targeting a different environment (e.g.
# "production" or "preview"). Remove them so wrangler dev --env=local
# can start cleanly without an environment mismatch error.
rm -rf dist/ .wrangler/deploy/config.json

# ── 1. Build static site ────────────────────────────────────────────────────
node scripts/build-frontend.mjs --dev
HUGO_PARAMS_SKIPREMOTEFEEDS=true hugo --configDir='' --baseURL=/ -e development

# ── 2. Seed a fresh database ────────────────────────────────────────────────
printf 'y\n' | pnpm exec wrangler d1 migrations apply pkic-db-local --env local --local --persist-to="$STATE_DIR"
node scripts/seed-initial-admin.mjs  --env local --local --db pkic-db-local --persist-to "$STATE_DIR" --e2e-worker-pool
node scripts/seed-event.mjs          --env local --local --db pkic-db-local --persist-to "$STATE_DIR" --skip-email-templates
node scripts/seed-email-templates.mjs --env local --local --db pkic-db-local --persist-to "$STATE_DIR"
# The member-profile demo record, so portal specs and manual review both have a
# contact page with skills, participation and standing on it.
node scripts/seed-member-profiles.mjs --local --persist-to "$STATE_DIR"
pnpm exec wrangler d1 execute pkic-db-local --env local --local --persist-to="$STATE_DIR" --file tests/fixtures/e2e-donations.sql

# ── 3. Start servers ────────────────────────────────────────────────────────
node scripts/e2e-interceptor.mjs 0 "$INTERCEPT_URL_FILE" &
INTERCEPTOR_PID=$!

trap 'kill "$INTERCEPTOR_PID" 2>/dev/null; rm -rf "$STATE_DIR"; rm -f "$INTERCEPT_URL_FILE"' EXIT INT TERM

INTERCEPTOR_READY=0
INTERCEPTOR_ATTEMPTS=0
while [ "$INTERCEPTOR_ATTEMPTS" -lt 50 ]; do
  if ! kill -0 "$INTERCEPTOR_PID" 2>/dev/null; then
    echo "[e2e-start] SendGrid interceptor exited before becoming ready" >&2
    exit 1
  fi
  if [ -s "$INTERCEPT_URL_FILE" ] && curl -sf "$(cat "$INTERCEPT_URL_FILE")/outbox" >/dev/null 2>&1; then
    INTERCEPTOR_READY=1
    break
  fi
  INTERCEPTOR_ATTEMPTS=$((INTERCEPTOR_ATTEMPTS + 1))
  sleep 0.2
done

if [ "$INTERCEPTOR_READY" -ne 1 ]; then
  echo "[e2e-start] Timed out waiting for SendGrid interceptor" >&2
  exit 1
fi

INTERCEPT_URL=$(cat "$INTERCEPT_URL_FILE")
cat > "$E2E_ENV_FILE" <<EOF
INTERNAL_SIGNING_SECRET=e2e-test-signing-secret
MEETING_PROVIDER_ENCRYPTION_KEY=e2e-meeting-provider-encryption-secret-000000000000000
SENDGRID_API_BASE=${INTERCEPT_URL}
SENDGRID_API_KEY=e2e-test-dummy-key
APP_BASE_URL=http://127.0.0.1:${E2E_PORT}
EMAIL_BADGE_DELAY_SECONDS=0
DEFAULT_MIN_PROPOSAL_REVIEWS=0
EOF

# ── Serve a snapshot, not the live build directory ──────────────────────────
# `public/` is rewritten by every `hugo` run. When anything rebuilds the site
# while the suite is running — another worktree task, a developer checking a
# page — the directory disappears for a moment, Wrangler's asset walk fails
# with ENOENT, and the worker dies. Every test after that point fails with
# ERR_CONNECTION_REFUSED, which looks like sixty broken tests rather than one
# broken server. Copying the built site into this run's own state directory
# costs a second and makes the run immune to what else is happening on disk.
SITE_DIR="$STATE_DIR/site"
cp -R public "$SITE_DIR"

pnpm exec wrangler dev \
  --env=local \
  --assets="$SITE_DIR" \
  --port="$E2E_PORT" \
  --persist-to="$STATE_DIR" \
  --env-file="$E2E_ENV_FILE" \
  < /dev/null

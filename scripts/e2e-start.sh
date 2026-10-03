#!/bin/sh
# E2E test startup: bundles the Vite public shell and Worker, seeds a fresh
# database, then launches the SendGrid interceptor + bundled Worker.
# Playwright calls this as webServer and waits for port 8788 to be reachable.
set -e

STATE_ROOT="${E2E_STATE_ROOT:-${TMPDIR:-/tmp}}"
mkdir -p "$STATE_ROOT"
if [ -n "${E2E_PREPARED_STATE_DIR:-}" ]; then
  case "$E2E_PREPARED_STATE_DIR" in
    "${STATE_ROOT%/}"/pkic-e2e.*) ;;
    *) echo "[e2e-start] Prepared state must belong to the E2E state root" >&2; exit 1 ;;
  esac
  STATE_DIR="$E2E_PREPARED_STATE_DIR"
  if [ ! -f "$STATE_DIR/.prepared" ] || [ ! -d "$STATE_DIR/site" ]; then
    echo "[e2e-start] Prepared static release is missing" >&2
    exit 1
  fi
else
  STATE_DIR=$(mktemp -d "${STATE_ROOT%/}/pkic-e2e.XXXXXX")
fi
INTERCEPT_URL_FILE="${E2E_SENDGRID_URL_FILE:-test-results/e2e-sendgrid-url}"
PAYMENT_URL_FILE="${E2E_STRIPE_URL_FILE:-test-results/e2e-stripe-url}"
STATE_PATH_FILE="test-results/e2e-state-dir"
E2E_ENV_FILE="$STATE_DIR/.e2e.vars"
E2E_PORT="${E2E_PORT:-8788}"

# Some environments inject npm_config_* keys that newer npm versions warn
# about as unknown config. Clear them for this script so Playwright webServer
# logs stay clean and future npm majors do not fail startup.
unset npm_config_npm_globalconfig NPM_CONFIG_NPM_GLOBALCONFIG
unset npm_config_verify_deps_before_run NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN
unset npm_config__jsr_registry NPM_CONFIG__JSR_REGISTRY

mkdir -p "$(dirname "$INTERCEPT_URL_FILE")"
rm -f "$INTERCEPT_URL_FILE" "$PAYMENT_URL_FILE"
rm -f test-results/portal-management-verification-auth.json
rm -f test-results/portal-mobile-navigation-auth.json
rm -f test-results/portal-groups-auth.json
rm -f test-results/portal-vote-management-auth.json

cleanup() {
  if [ -n "${WORKER_PID:-}" ]; then
    kill "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
  fi
  if [ -n "${INTERCEPTOR_PID:-}" ]; then
    kill "$INTERCEPTOR_PID" 2>/dev/null || true
  fi
  if [ -n "${PAYMENT_INTERCEPTOR_PID:-}" ]; then
    kill "$PAYMENT_INTERCEPTOR_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_DIR"
  rm -f "$INTERCEPT_URL_FILE" "$PAYMENT_URL_FILE"
  rm -f "$STATE_PATH_FILE"
}
trap cleanup EXIT INT TERM

# CI prepares the release in its own build step. Local runs prepare here.
if [ -z "${E2E_PREPARED_STATE_DIR:-}" ]; then
  sh scripts/e2e-prepare.sh "$STATE_DIR"
fi
printf '%s\n' "$STATE_DIR" > "$STATE_PATH_FILE"

# ── 3. Start servers ────────────────────────────────────────────────────────
node scripts/e2e-interceptor.mjs 0 "$INTERCEPT_URL_FILE" &
INTERCEPTOR_PID=$!
node scripts/e2e-payment-interceptor.mjs "$PAYMENT_URL_FILE" &
PAYMENT_INTERCEPTOR_PID=$!

INTERCEPTOR_READY=0
INTERCEPTOR_ATTEMPTS=0
while [ "$INTERCEPTOR_ATTEMPTS" -lt 50 ]; do
  if ! kill -0 "$INTERCEPTOR_PID" 2>/dev/null; then
    echo "[e2e-start] SendGrid interceptor exited before becoming ready" >&2
    exit 1
  fi
  if [ -s "$PAYMENT_URL_FILE" ] && [ -s "$INTERCEPT_URL_FILE" ] && curl -sf "$(cat "$INTERCEPT_URL_FILE")/outbox" >/dev/null 2>&1; then
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
PAYMENT_INTERCEPT_URL=$(cat "$PAYMENT_URL_FILE")
cat > "$E2E_ENV_FILE" <<EOF
INTERNAL_SIGNING_SECRET=e2e-test-signing-secret
MEETING_PROVIDER_ENCRYPTION_KEY=e2e-meeting-provider-encryption-secret-000000000000000
SENDGRID_API_BASE=${INTERCEPT_URL}
SENDGRID_API_KEY=e2e-test-dummy-key
STRIPE_API_BASE=${PAYMENT_INTERCEPT_URL}
STRIPE_SECRET_KEY=sk_test_e2e_membership
STRIPE_WEBHOOK_SECRET=whsec_e2e_membership
APP_BASE_URL=http://localhost:${E2E_PORT}
WEBAUTHN_ORIGIN=http://localhost:${E2E_PORT}
EMAIL_BADGE_DELAY_SECONDS=0
DEFAULT_MIN_PROPOSAL_REVIEWS=0
EOF

# ── Why localhost rather than 127.0.0.1 ────────────────────────────────────
# WebAuthn requires the relying-party id to be a registrable domain suffix of
# the page's origin, and an IP address is neither registrable nor a domain: a
# ceremony run from 127.0.0.1 against the `localhost` RP id is refused outright
# with "127.0.0.1 is an invalid domain". The origin also has to match the port
# this run actually uses, which the static local value cannot know.
#
# ── Serve a snapshot, not the live build directory ──────────────────────────
# `public/` is rewritten by every public-shell build. When anything rebuilds the site
# while the suite is running — another worktree task, a developer checking a
# page — the directory disappears for a moment, Wrangler's asset walk fails
# with ENOENT, and the worker dies. Every test after that point fails with
# ERR_CONNECTION_REFUSED, which looks like sixty broken tests rather than one
# broken server. Copying the built site into this run's own state directory
# costs a second and makes the run immune to what else is happening on disk.
node --experimental-strip-types scripts/e2e-publication-server.mjs \
  "$STATE_DIR" "$E2E_ENV_FILE" "$E2E_PORT" \
  < /dev/null &
WORKER_PID=$!
wait "$WORKER_PID"

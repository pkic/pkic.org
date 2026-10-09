#!/bin/sh
# Prepare one synthetic database and immutable static release before starting
# the browser server. The caller owns the fresh state directory and its cleanup.
set -eu
STATE_DIR="${1:?Pass a fresh E2E state directory}"
if [ ! -d "$STATE_DIR" ] || [ -e "$STATE_DIR/site" ]; then
  echo "[e2e-prepare] Expected a fresh state directory" >&2
  exit 1
fi

# ── 0. Clean stale build artifacts ───────────────────────────────────────────
# A previous `pnpm build` or `deploy:preview` may have left dist/ and
# .wrangler/deploy/config.json targeting a different environment (e.g.
# "production" or "preview"). Remove them so wrangler dev --env=local
# can start cleanly without an environment mismatch error.
rm -rf dist/ .wrangler/deploy/config.json

# ── 1. Build static site ────────────────────────────────────────────────────
node --experimental-strip-types scripts/prepare-public.mjs --dev
CLOUDFLARE_ENV=local pnpm exec vite build

# ── 2. Seed a fresh database ────────────────────────────────────────────────
printf 'y\n' | pnpm exec wrangler d1 migrations apply pkic-db-local --env local --local --persist-to="$STATE_DIR"
node scripts/seed-initial-admin.mjs  --env local --local --db pkic-db-local --persist-to "$STATE_DIR" --e2e-worker-pool
node scripts/seed-event.mjs          --env local --local --db pkic-db-local --persist-to "$STATE_DIR" --skip-email-templates
node scripts/seed-email-templates.mjs --env local --local --db pkic-db-local --persist-to "$STATE_DIR"
# The member-profile demo record, so portal specs and manual review both have a
# contact page with skills, participation and standing on it.
node --experimental-strip-types scripts/seed-member-profiles.mjs --local --persist-to "$STATE_DIR"
pnpm exec wrangler d1 execute pkic-db-local --env local --local --persist-to="$STATE_DIR" --file tests/fixtures/e2e-settings.sql

# Publish the synthetic local D1 snapshot into the complete Worker asset build.
PKIC_PUBLICATION_LOCAL_STATE="$STATE_DIR/v3" node --experimental-strip-types scripts/publication/build-local-publication.mjs dist/client

# The server consumes this immutable release, independent of later builds.
cp -R dist/client "$STATE_DIR/site"
touch "$STATE_DIR/.prepared"

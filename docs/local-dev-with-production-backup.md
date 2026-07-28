# Running pkic.org locally with a production D1 backup

This walks through standing up the site locally and loading a real snapshot
of the production database from `backups/d1/`, instead of the synthetic
data that `npm run seed:local` creates.

## 1. Prerequisites

- Node.js + [pnpm](https://pnpm.io/) (this repo pins `pnpm@11.5.1` via
  `packageManager` in `package.json`)
- `wrangler` — no separate install needed, it's already a devDependency and
  is invoked through `npx wrangler` / the `npm run` scripts below

## 2. Install dependencies

```bash
pnpm install
```

## 3. Set up local secrets

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and set at least `INTERNAL_SIGNING_SECRET` to any random
string. The other values in the example file are optional and only needed
if you're testing email sending or the membership/sponsor-interest forms
(which call out to GitHub).

## 4. Make sure you're starting from clean local Miniflare state

The local D1 database is a SQLite file managed by Wrangler under
`.wrangler/state/v3/d1`. The backup file doesn't contain `DROP TABLE`
statements, so importing it into a database that already has tables (e.g.
one already seeded via `npm run seed:local`) will fail with
"table ... already exists".

If you've previously run `npm run migrate:local` or `npm run seed:local`,
wipe the local D1 state first:

```bash
rm -rf .wrangler/state/v3/d1
```

**Wipe all of `.wrangler/state/v3`, not just `d1`, if `npm run dev` fails
to start.** KV, cache, and other local storage under `.wrangler/state/v3`
are implemented the same way D1 is — as SQLite-backed Durable Objects —
and old copies left over from before a `miniflare`/`workerd` dependency
bump are not forward-compatible. A stale copy will crash the *entire* dev
server at startup with an error like:

```
*** Fatal uncaught kj::Exception: workerd/util/sqlite.c++:842: failed:
SENTRY_DO SQLite failed; dbErrorMessage(prepareResult, db) = table
_cf_ALARM has 3 columns but 2 values were supplied: SQLITE_ERROR
```

This is unrelated to the backup import or any migration — it reproduces
on a completely empty database too, and is fixed by removing the whole
local state directory rather than just `d1`:

```bash
rm -rf .wrangler/state/v3
```

(This only removes local Miniflare emulation state — KV, D1, cache, etc.
It does not touch anything remote. You'll need to redo step 5 below since
this also clears D1.)

## 5. Import the backup

Pick the backup you want from `backups/d1/` — e.g.
`backups/d1/production-20260722-114200.sql` — and import it directly into
the `local` environment's D1 binding:

```bash
npx wrangler d1 execute DB --env local --local \
  --file=backups/d1/production-20260722-114200.sql --yes
```

The dump already contains the full schema (including the `d1_migrations`
tracking table) and all rows, so you do **not** need to run
`npm run migrate:local` first — running migrations against an empty DB and
then importing the dump would just collide on `CREATE TABLE`.

If new migrations have landed since the backup was taken, apply them on
top after importing:

```bash
npm run migrate:local
```

As of Phase 0 (PRD §0.1), this step is currently required even for a
same-day backup: `migrations/0033_rebuild_members_multi_representative.sql`
rebuilds the `members` table and hasn't been applied to production yet, so
every existing backup in `backups/d1/` predates it.

**If import fails with `no such table: main.users`:** the dump was taken
before `npm run backup:local`/`backup:preview`/`backup:production` started
reordering exports (schema before data — see `scripts/reorder-d1-dump.mjs`
for why this matters: `d1 export` interleaves each table's `CREATE TABLE`
with its own rows in creation order, and a table created early, like
`organizations`, can have FK columns pointing at a table created later,
like `users`; `PRAGMA defer_foreign_keys` only defers the row-existence
check, not the table's existence). Fix the file in place and re-run the
import:

```bash
node scripts/reorder-d1-dump.mjs backups/d1/production-20260722-114200.sql
```

## 6. Start the dev server

```bash
npm run dev
```

This runs Vite with `CLOUDFLARE_ENV=local`, which builds the Hugo site and
runs the Worker (with the D1 binding pointed at `pkic-db-local`) via
`@cloudflare/vite-plugin`. Open http://localhost:8788/ once it's up.

## 7. Log in to the admin console

Locally there's no real email provider configured (`.dev.vars.example` ships
with `SENDGRID_API_KEY` commented out) and passkeys aren't implemented, so
the normal magic-link email never actually gets delivered. You don't need
either: `queueEmail()` (`functions/_lib/email/outbox.ts`) writes the
rendered email — including the plaintext magic-link URL — into the
`email_outbox` table *before* attempting to send it, so the token is always
recoverable from local D1 even when sending fails.

**Request the link from the same browser you'll open it in, not `curl`.**
`request-link` hashes the requester's `User-Agent` header and stores it
alongside the token; `verify-link` re-hashes the `User-Agent` on the
follow-up request and rejects the token on a mismatch
(`functions/_lib/auth/admin.ts`, `MAGIC_LINK_CONTEXT_MISMATCH`). A plain
`curl` request sends `curl/8.x` as its `User-Agent`, which will never match
the browser you paste the link into, and verification will fail with
"Magic link is not valid from this browser".

1. Open http://localhost:8788/admin/ in the browser you intend to sign in
   with, open its DevTools console, and request a link for an existing
   active admin user (see `users` table, `role = 'admin'`) from there so the
   `User-Agent` matches:

   ```js
   fetch("/api/v1/admin/auth/request-link", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ email: "you@pkic.org" }),
   });
   ```

2. Pull the magic-link URL back out of the local outbox:

   ```bash
   npx wrangler d1 execute DB --env local --local --command \
     "SELECT payload_json FROM email_outbox WHERE template_key='admin_magic_link' ORDER BY created_at DESC LIMIT 1;"
   ```

   The `payload_json` column contains a `magicLinkUrl` field like
   `http://localhost:8788/admin/?token=<token>`.

3. Open that URL in the same browser you used in step 1. The admin SPA
   (`assets/ts/admin/shell/Login.tsx`) detects the `?token=` param on load
   and calls `verify-link` automatically, which sets the `pkic_admin_session`
   cookie and drops you into `/admin/`.

Tokens are single-use and expire after `MAGIC_LINK_TTL_MINUTES` (15 minutes
by default) — just repeat the steps above to get a fresh one.

## 8. (Optional) Verify the data loaded

```bash
npx wrangler d1 execute DB --env local --local \
  --command "SELECT COUNT(*) FROM events;"
```

## 9. Stop the dev server

`npm run dev` runs in the foreground, so press `Ctrl+C` in the terminal
where you started it. That kills the Vite/Wrangler process and frees up
port 8788.

This does **not** touch the local D1 state — `.wrangler/state/v3/d1` (and
the production data you imported into it) is left on disk, so running
`npm run dev` again later picks up right where you left off. If you want
to get rid of the imported production data instead of just stopping the
server, remove the local state as in step 4:

```bash
rm -rf .wrangler/state/v3/d1
```

## Notes

- Production data may contain real member/donor PII — treat your local
  copy with the same care as production and don't commit it or push it
  anywhere.
- To take a fresh backup yourself instead of using an existing file in
  `backups/d1/`, run `npm run backup:production` (requires production
  Cloudflare credentials).

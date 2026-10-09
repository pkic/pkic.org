# Contributing to pkic.org

The [README](README.md) covers content authoring and local content previews. This
guide covers backend development, validation, builds, and deployment.

## Validation

Run the complete validation gate before handing off a code or configuration
change:

```bash
pnpm run check
```

Routine browser CI (`pnpm run test:e2e`) covers ongoing user flows. The static
publication audit (`pnpm run test:e2e:astro`) is opt-in: it builds synthetic public
data and checks populated layouts, light and dark artwork, and historical
conference display exports. Run it for public-site migrations or relevant
publication changes, rather than adding those temporary-page and detailed
geometry checks to every CI run. The catalog-wide contrast audit
(`pnpm run test:e2e:contrast`) is also opt-in. Wait for the rendered state or
resource being tested; do not add fixed sleeps.

Use focused tests while iterating. For repeatable timing profiles, set
`PKIC_TEST_PROFILE_PATH` to a path outside the repository. The report records
test, import, environment, and setup durations without disabling test isolation:

```bash
PKIC_TEST_PROFILE_PATH=/path/outside/repository/worker.json pnpm run test:worker
pnpm exec vitest run --config vitest.config.ts --configLoader runner tests/d1-public-flow-profile.test.ts
```

The public-flow test emits `D1_FLOW_PROFILE` JSON containing SQL templates,
session constraints, round-trip counts, and `EXPLAIN QUERY PLAN` results against
synthetic fixtures. It checks directory/search batching, a single-round-trip
member profile/roster batch, and single-query image resolution, including
missing images and entity precedence. Durations are advisory; query-count and
plan regressions fail the test. Compare repeated runs under similar machine
load and keep profiles outside the repository.

ESLint and Prettier run as separate gates so formatting is checked once. The
Worker suite has two projects that share bindings and migrations. `d1` tests
explicitly import their real service or router without eagerly loading the
entire application during setup. Tests using `SELF.fetch` belong in the
`workerFetchFiles` list in `vitest.config.ts`; the `worker-fetch` project runs
them against the real Worker entry point. An accidental `SELF.fetch` in `d1`
fails explicitly rather than returning a mock response.

Large WebAuthn and MCP dependency graphs are prebundled for tests using Vitest's
dependency optimizer. Node and Cloudflare built-ins remain external so workerd
provides their real implementations; application modules and storage remain
isolated per test file.

## D1 sessions and read replicas

The Worker opens one D1 session per invocation. Public `GET` and `HEAD` requests
use `first-unconstrained`; authenticated, capability-bearing, and state-changing
requests start with `first-primary`. Scheduled and email invocations also start
with `first-primary`.

That constraint applies only to the first query. Subsequent reads can use a
replica that satisfies the session bookmark, while writes still go to the
primary. Keeping authentication in the same session establishes a fresh
consistency boundary before authorization and data reads. Explicitly public
member and sponsor directory, wall, display, and logo reads ignore incidental
login cookies when choosing a replica; staff projections do not.

Enabling replicas in the dashboard is not sufficient: application reads must
use the [D1 Sessions API](https://developers.cloudflare.com/d1/best-practices/read-replication/).
Replica eligibility does not guarantee a particular serving region. Verify
remote query metadata (`served_by_region` and `served_by_primary`) after
deployment; local D1 tests cannot establish European placement or network
latency.

## Local backend data

Run the local seed flow to create admin and event data, forms, terms, and default
email templates in D1 and R2:

```bash
pnpm run seed:local
```

For ordinary interactive development, use `pnpm run dev`. It reuses persistent
local D1 state and configured local email delivery.

For an isolated disposable database with SendGrid delivery captured by a local
interceptor, use:

```bash
pnpm run dev:intercepted
```

The intercepted server prints its capture URL and never sends messages to an
external mailbox. Playwright starts this same isolated server automatically; do
not start it manually before `pnpm run test:e2e` unless the test run sets
`REUSE_SERVER`.

If templates are missing or you want to reseed template versions only, run:

```bash
pnpm run seed:templates:local
```

## Build and deployment

The Cloudflare Worker uses Vite with `@cloudflare/vite-plugin`. The Vite build
runs Hugo, indexes the generated site with Pagefind, bundles the native
TypeScript Worker, and writes the deployable Wrangler output config to `dist`.

```bash
pnpm run build
pnpm run build:preview
pnpm run build:production
```

Merges to `main` are automatically deployed to production. Branches and pull
requests are deployed as [Workers Previews](https://developers.cloudflare.com/workers/previews/)
of the production Worker (`wrangler preview`), at
`https://<branch>-pkic-org.pkic.workers.dev`. They replace the former separate
`pkic-org-preview` Worker. Previews inherit no production bindings: every
binding they use is declared in `env.production.previews` in
[wrangler.jsonc](wrangler.jsonc) and points at preview resources
(`pkic-db-preview`, `pkic-assets-preview`, `pkic-speaker-uploads-preview`).
`tests/tools/workers-previews-config.test.ts` fails if a production resource
appears there.

- Each Preview's `APP_BASE_URL` and `WEBAUTHN_ORIGIN` are its own branch URL,
  injected by `vite.config.ts` from `WORKERS_CI_BRANCH` or the current git
  branch. A preview build without a non-`main` branch fails.
- All Previews share the `pkic-db-preview` D1 database, which is also the
  production `DB` binding's `preview_database_id`. Deployments never apply
  migrations; apply them separately with `pnpm migrate:preview`, which runs
  Wrangler with `--env production --preview`. `pnpm seed:preview` uses the same
  arguments, and `pnpm backup:preview` exports `pkic-db-preview` by name
  because `d1 export` has no `--preview` option. Wrangler takes the account
  from `wrangler.jsonc`.
- Cron Triggers, routes, and inbound email do not run in Previews, so the
  email outbox and other scheduled jobs stay idle there. Run a job manually
  from the portal scheduler when a Preview test needs it.
- Preview URLs are public unless Cloudflare Access protects them. Cloudflare
  adds `X-Robots-Tag: noindex` to `workers.dev` Previews.
- MCP OAuth in Previews uses its own `OAUTH_KV` namespace, never the
  production one.

Never copy production personal data, credentials, secrets, or private uploads
into preview; use synthetic or purpose-created preview data. Preview secrets
belong to the Previews base configuration:
`pnpm exec wrangler preview base-config secret put <NAME> --env production`.

One-time Cloudflare dashboard steps for the switch:

1. Set each secret the old `pkic-org-preview` Worker used
   (`pnpm exec wrangler secret list --name pkic-org-preview` lists the names)
   in the Previews base configuration with its preview value, never a
   production value.
2. In Workers Builds for `pkic-org`, complete the one-time Previews setup and
   set the non-production branch deploy command to `pnpm exec wrangler preview`.
   Keep the build command unchanged.
3. Optionally protect `*-pkic-org.pkic.workers.dev` with Cloudflare Access.
4. Repoint or remove any Stripe test-mode or SendGrid webhook that targets
   `pkic-org-preview.pkic.workers.dev`.
5. After a Preview builds and works, disconnect and delete the
   `pkic-org-preview` Worker.

Manual deployment is exceptional. If an explicitly approved recovery or
operational task requires it, build and deploy together, because the Vite
plugin applies `env.production` (with its `previews` block) during build time:

```bash
pnpm run deploy:preview
pnpm run deploy:production
```

The MCP OAuth binding uses Wrangler automatic provisioning for `OAUTH_KV`. On
the first deployment for an environment, Wrangler creates the namespace and
writes the generated IDs back into [wrangler.jsonc](wrangler.jsonc).

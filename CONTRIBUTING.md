# Contributing to pkic.org

The [README](README.md) covers content authoring and local content previews. This
guide covers backend development, validation, builds, and deployment.

## Validation

Run the complete validation gate before handing off a code or configuration
change:

```bash
pnpm run check
```

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

Branches and pull requests are automatically deployed as preview sites. All
preview sites share the preview D1 database. Merges to `main` are automatically
deployed to production.

Database migrations are not applied by deployments and must be applied
separately to the intended environment. Never copy production personal data,
credentials, secrets, or private uploads into preview; use synthetic or
purpose-created preview data.

Manual deployment is exceptional. If an explicitly approved recovery or
operational task requires it, build and deploy the selected Cloudflare
environment together because the Vite plugin applies `env.preview` or
`env.production` during build time:

```bash
pnpm run deploy:preview
pnpm run deploy:production
```

The MCP OAuth binding uses Wrangler automatic provisioning for `OAUTH_KV`. On
the first deployment for an environment, Wrangler creates the namespace and
writes the generated IDs back into [wrangler.jsonc](wrangler.jsonc).

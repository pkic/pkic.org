# Contributing to pkic.org

The [README](README.md) covers content authoring and local content previews. This
guide covers backend development, validation, builds, and deployment.

## Validation

Run focused tests, typechecks, and targeted lint/format checks locally. The
complete validation gate runs in CI for code and configuration changes:

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

Worker integration tests use two disjoint projects. `d1` imports real services
and mounted routers, applies real migrations per file, and uses an empty asset
directory. It never builds or serves a static publication. Run it independently
with `pnpm run test:worker --project d1` (optionally `--shard=1/4`).
`worker-fetch` retains the real Worker entry point and synthetic publication;
its pool builds that publication only when matching tests are selected. The
scanner benchmark also uses the D1 setup. Runtime and database isolation remain
per file; shards never share mutable storage.

The publication fixture uses its own temporary directory under
`PKIC_BUILD_TMPDIR` (else `TMPDIR`), with a copy-on-write clone of the shared
Astro derivative cache. Only completed publications with identical fixture
inputs are reused by the existing local cache. Browser and Worker-fetch runners restore the same content-addressed compiler
derivatives, including the integrity seal required to retain native image
transforms; D1 runners restore none. Browser fixtures have different
inputs and are prepared separately; neither their database nor their HTML is
substituted for the Worker fixture.

Application CI runs static and Node checks first. Once they pass, frontend/tooling
checks, critical browser journeys, four D1 shards, and the real-publication
Worker project run on independent runners. The existing required application
check aggregates all results and fails on failed, canceled, or skipped required
jobs. Each Worker runner uploads `worker-profile-*` timing diagnostics. Compare
successful runs at the same revision, runner size, inventory, and cold/warm
cache conditions before claiming a speedup; include runner minutes and shard
imbalance, not just elapsed time. The four-shard trial preserves every
test and uses Vitest's built-in sharding; profile evidence should guide any
subsequent duration balancing.

| Behavior                          | Owning validation layer  | Unique protection retained                           |
| --------------------------------- | ------------------------ | ---------------------------------------------------- |
| Pure schemas and policy           | Node                     | Contract and policy permutations                     |
| UI state and request/error wiring | Frontend components      | Rendered states and transport contracts              |
| Tooling and publication lifecycle | Node tooling             | Build failure, cleanup, cache and compiler behavior  |
| SQL, authorization and atomicity  | D1 integration           | Real migrations, mounted routes and isolated storage |
| Public assets and Worker fetch    | Worker-fetch integration | Real publication and Worker routing                  |
| Critical user journeys            | Browser                  | Authentication, navigation and browser behavior      |

No assertions are removed or moved between layers by this CI split. Complete
validation remains required; changed-test selection is advisory. Cloudflare
Workers Builds commands are account configuration, not established by these
scripts. Inspect actual build/deploy logs before removing duplicated validation.
A passing PR merge check does not validate a different production SHA; preserve
existing deployment gates until the exact deployed candidate is verified.

Use focused tests while iterating. `pnpm test:changed` runs the tests related
to uncommitted changes in every suite (`--since <ref>` compares with a branch
instead). The selection follows imports, so it is advisory: Worker routes and
migrations are not always visible through them, and a change to `package.json`
or a Vite or Vitest config runs every test.

The optional pre-commit hook checks formatting and lint on staged files in a few
seconds and runs no tests. Enable it once per clone with
`git config core.hooksPath .githooks`.

The component gallery renders the design-system primitives and every pattern
catalog entry (`.agents/skills/pkic-ui/patterns.md`) with fixture data, served
by Vite alone in a second. `pnpm gallery` serves it on port 8796 (`?only=<id>`
shows one entry); `pnpm gallery:shot <id> [--phone] [--dark]` writes a
screenshot of one entry, with its popup open, to `.gallery-shots/`. The same
page is also served by the site at `/design/`.

For repeatable timing profiles, set
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

Mounted Worker tests can enforce a complete-request D1 budget with
`callApi(env, path, init, { maxRoundTrips: 1 })`. The budget includes
middleware, authentication, resource reads, writes, and request-owned
`waitUntil` work through the instrumented D1 binding. A multi-statement batch
counts once; separate calls count individually, including parallel calls and
failures. Calls inside Durable Objects need their own instrumentation.
Failures identify the request and SQL templates without bound parameter values.

To audit existing tests without making every unfinished workflow fail, run
`PKIC_D1_BUDGET_MODE=warn pnpm run test:worker <test-file>`. Use `fail` instead
of `warn` to enforce a one-trip maximum for every `callApi` request in that run.
Explicit per-request budgets take precedence. Converted workflows should keep
a strict budget in their tests; avoid raising it to hide a regression.

Oxlint (`pnpm run lint`) and Oxfmt (`pnpm run format:check`) run as separate
gates so formatting is checked once. Oxlint's type-aware rules read the nearest
`tsconfig.json` of each file. The `tsconfig.json` in `assets/ts`, `assets/design`,
`tests/frontend`, `tests/tools`, `scripts`, and `site` only extends the project
that owns the directory, so every group is typed against its own compiler options.
The architecture rules live in `scripts/oxlint/pkic-rules.mjs` and are scoped in
`.oxlintrc.json`. The Worker suite has two projects that share bindings and migrations. `d1` tests
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

The Worker opens one D1 session per invocation. Ordinary `GET` and `HEAD`
requests, including protected reads, use the signed caller's bookmark or
`first-unconstrained`. Authentication endpoints, capability-bearing requests,
state-changing requests, and opaque credentials without bookmark transport
start with `first-primary`. Scheduled and email invocations also start with
`first-primary`.

That constraint applies only to the first query. Subsequent reads can use a
replica that satisfies the session bookmark, while writes still go to the
primary. Read authorization uses a read-only check in the same batch as the
protected queries; mutations retain an atomic write guard. The owner explicitly
accepts replica lag in permission and session revocations for reads; see the
policy comments in `functions/_lib/db/session.ts` and
`functions/_lib/db/authorization-guard.ts`. Seconds of lag are expected, without
a fixed D1 guarantee. Bookmarks preserve sequential consistency, including
after login and saves, rather than immediate visibility of another actor's
revocation. Existing cookie credentials receive bookmark updates after writes,
not ordinary `GET`/`HEAD` responses, so a late read cannot overwrite a save's
bookmark. Newly issued credentials still receive their request's bookmark;
token response headers continue to carry read bookmarks. Explicitly public
member and sponsor directory, wall, display, and logo reads ignore incidental
login cookies and do not replace private bookmarks.

Enabling replicas in the dashboard is not sufficient: application reads must
use the [D1 Sessions API](https://developers.cloudflare.com/d1/best-practices/read-replication/).
Replica eligibility does not guarantee a particular serving region. Verify
remote query metadata (`served_by_region` and `served_by_primary`) after
deployment; local D1 tests cannot establish European placement or network
latency.

## Local backend data

`pnpm dev` migrates and seeds its own synthetic database. To seed a remote
target (admin and event data, forms, terms, and default email templates in D1
and R2), run `pnpm seed --preview` or `pnpm seed --production`; add
`--only <step>` to run one seeder.

For interactive development, use `pnpm dev` or its alias `pnpm dev:test` (see
the [README](README.md#test-the-portal-locally)). This is the default local
environment for everyone. It keeps a migrated and seeded synthetic database in
`.local-test/`, generates its own local secrets, and captures all email in a
local inbox; no local command delivers email. It shares its serving code with
`pnpm dev:rehearsal` below.

Both hot-reload by default: the Vite dev server runs the Worker from source
against the state directory, and a watching client build rewrites the portal
bundle under stable development names. Pass `--build` to serve the bundled
Worker and built site instead. Development and built behavior differ in these
ways:

- Public pages are prerendered once at startup in both modes; only `--build`
  uses optimized images and social images (unless `--fast`). Diagrams render in
  every mode, including hot reload and `--fast`, and reuse cached output. An
  uncached diagram starts the build-time browser renderer.
- The portal bundle is unminified with inline source maps and no bundle budget
  or subresource integrity; `--build` produces the hashed, budgeted release.
- The Worker runs through Vite's module runner instead of the bundled output, so
  bundling problems show only with `--build` or `pnpm run build`.

Run `--build` before a push or release, not for UI iteration.

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

## Rehearse against a database backup

`pnpm dev:rehearsal` is opt-in and only for operators who are authorized to hold
a production database backup. Everyone else uses `pnpm dev:test`. The rehearsal
imports the backup into a new local directory, applies this branch's migrations
to it locally, and serves it with the same hot reload and captured inbox as
`pnpm dev:test`, so you can check a migration and the portal against real data
before anything reaches preview or production. Nothing it runs touches a remote
database, and no email leaves the computer.

The backup is a D1 SQL export, such as the file `pnpm backup production`
writes to `backups/d1/`. It holds the database only: R2 uploads such as logos
and portraits are not copied, and the published pages show those images as
missing. Keep the state directory outside the repository (`backups/` is ignored
by Git), and delete the backup and the state directory when the rehearsal is
finished.

One command prepares and serves a fresh rehearsal. It exports the latest
production backup (read-only), imports it into a new state directory, applies
this branch's migrations, and serves it. With `--plans`, it then applies each
reviewed agenda migration plan (`<event>/plan.json`, kept outside the
repository) in directory-name order, authenticated by `PKIC_AGENDA_IMPORT_TOKEN`.
Public pages are published before the plans run, so restart with `start` to see
migrated agendas on them.

```bash
PKIC_AGENDA_IMPORT_TOKEN=… pnpm dev:rehearsal refresh --state ../rehearsal-<date> [--plans ../agenda-migration-plans]
```

The individual steps are available on their own:

```bash
# Import the backup once into a new directory; no migrations or seeders run.
pnpm dev:rehearsal init --state ../rehearsal --dump backups/d1/production-<timestamp>.sql
# Apply this branch's pending migrations to the imported database.
pnpm dev:rehearsal migrate --state ../rehearsal
# Optionally run one SQL file against it, such as a data repair under review.
pnpm dev:rehearsal apply --state ../rehearsal --sql repair.sql
# Serve with hot reload; add --build [--fast] to serve the built release instead.
pnpm dev:rehearsal start --state ../rehearsal [--build [--fast]] [--port 8788] [--inbox-port 8799] [--host 127.0.0.1]
```

To access the site and captured email inbox from another device, bind both to
an IP address assigned to the host (the default is `127.0.0.1`):

```bash
pnpm dev:rehearsal start --state ../pkic-rehearsal --port 8788 --host 192.168.1.10
```

Open `http://192.168.1.10:8788/portal/` and `http://192.168.1.10:8799/`.
`--inbox-port` changes the inbox port. Generated sign-in links use the selected
host; `--base-url <origin>` overrides the application's public origin when needed.
Pass IPv6 addresses without brackets; printed URLs include the required brackets.
Wildcard hosts (`0.0.0.0` or `::`) bind all interfaces and need `--base-url` set to
a reachable address for remote sign-in links. Only expose a rehearsal containing
private data on a trusted network. Passkeys require a secure browser context;
use the email sign-in link when accessing a LAN IP over HTTP.

`start` prints the portal and captured inbox URLs; sign in with a link from the
inbox. It never migrates the database, so run `migrate` first when the branch
adds migrations. `init` refuses an existing directory: import every backup into
a new one.

## Email-domain lists

Free and ISP mail, disposable mail, and the Public Suffix List are vendored in
`functions/_lib/email-domains/generated/` from open-source lists (free mail:
`Kikobeats/free-email-domains`, MIT; disposable mail:
`disposable-email-domains/disposable-email-domains`, CC0-1.0; Public Suffix
List: `publicsuffix/list`, MPL-2.0). `provenance.json` records each source's
commit, counts and license. The Worker never fetches them and the browser never
bundles them; it asks `GET /api/v1/email/domains/:domain`.

To move them forward, run the refresh and review the diff like code:

```bash
pnpm run refresh:email-domains
```

Correct a provider the lists miss, or an organization they list by mistake, in
`functions/_lib/email-domains/overrides.ts`. Migration 0038 embeds the free and
disposable set; until it is applied, regenerate its `affiliation_free_email_domains`
inserts when the lists change (the organization-domain migration test shows the
expected text). An applied migration stays as it is.

## Build and deployment

The Cloudflare Worker uses Vite with `@cloudflare/vite-plugin`. The build
(`scripts/build-site.mjs`) prepares the public shell, bundles the native
TypeScript Worker and interactive application with Vite, renders the Astro
publication and its Pagefind index, generates the OpenAPI document, and
assembles one static release with the deployable Wrangler output config in
`dist`.

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
  migrations; apply them separately with `pnpm migrate preview`, which runs
  Wrangler with `--env production --preview`. `pnpm seed --preview` uses the same
  arguments, and `pnpm backup preview` exports `pkic-db-preview` by name
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

### Client updates after deployment

The shared client loader compares each page's existing module fingerprints
(and offline inventory link) on return, hash navigation, import failure, and
every five minutes while visible. Checks omit credentials, query strings, and
hashes. Cacheable HTML reuses native ETag/304 revalidation. There is no additional
release manifest, build pass, package, or server-side release archive.

A changed release refreshes an idle tab in place, preserving its location.
Editing or submitting a form disables automatic refresh for that document's
lifetime, including after a save: draft ownership is not universally tracked.
Pending API writes and uncertain save outcomes also block refresh. Scanning,
live-session, studio, verification, open-dialog, and fullscreen surfaces are
excluded. A missing portal view keeps navigation available and offers **Reload
page**; save unfinished work before using it.

The browser records one bounded reload guard per tab. Unavailable storage,
offline checks, and unsuccessful responses leave the current application
running. This recovery starts with clients that have loaded this implementation;
already-open clients from earlier releases need their first ordinary refresh.
HTML uses the existing Cloudflare revalidation headers (private pages retain
no-store); hashed assets keep their long-lived immutable policy. Vite's
`vite:preloadError` event triggers recovery across public interactive pages and
the portal. No custom version cookie, version endpoint, cache-busting parameter,
cache purge, migration, secret, or build step is required. Embedded frames and
playing media also block automatic refresh.

This follows [Vite's production load-error handling](https://vite.dev/guide/build#load-error-handling)
and [Cloudflare's standard static-asset validators](https://developers.cloudflare.com/workers/static-assets/headers/).
Production recovery does not use Vite's development-only HMR hooks.

### System role permission defaults

System role IDs and names identify product responsibilities and remain immutable;
permission bundles are editable by authorized operators. An assignment keeps its
scope and responsibilities (such as group leadership) when the bundle changes.
Effective access remains the union of current role assignments and direct grants.

Future migrations must preserve operator-managed bundles. Seed a complete default
bundle only when creating a new role. Adding a default permission to an existing
system role requires an explicit rollout decision: add it only where the current
bundle still matches the documented prior default, or require an audited operator
change. Do not regenerate existing bundles, restore removed permissions with
unconditional inserts, or treat a new permission as automatically granted. Document
the prior/default comparison and the affected roles in that migration's review.
Advance the role's timestamp revision whenever a migration changes its bundle so
concurrent operator edits retain their compare-and-set protection.
Applied migrations remain immutable; these rules govern future schema/reference
data work rather than rewriting existing migration history.

# Repository guidance

## Workflow

- Use `pnpm` for repository scripts and local binaries. Do not mix in `npm` or `npx`.
- Use US English for site content, prose, comments, UI copy, and documentation. Preserve exact quoted names and source text where required.
- Read the nearest scoped `AGENTS.md` before changing files below a directory.
- Inspect existing schemas, parsers, list controls, services, SQL helpers, shortcodes, and UI components before adding another abstraction.
- Existing debt is not precedent. Do not copy a known weak pattern; improve touched code and track larger remediation explicitly instead of hiding it in a baseline.
- Keep changes focused. Use descriptive domain and use-case names; do not introduce vague buckets such as `commands`, `management`, or `repository` without a real interface boundary.
- Keep authored files cohesive and reasonably small. A line-count check is only a warning signal; separate responsibilities instead of moving unrelated code into another large file.
- Do not add lint suppressions, architecture baselines, duplication allowances, or generated ignore files to make a new gate pass. Fix the violations before enabling the gate.

## Architecture and contracts

- Keep one dependency direction: shared contracts and domain policy, then backend persistence and focused use cases, then thin HTTP routes; the frontend consumes shared transport contracts and never imports backend implementation.
- API request and response schemas are canonical shared Zod schemas. Infer TypeScript types from them and extend or compose shared bases instead of copying shapes.
- DRY is required across schemas and behavior: keep one canonical contract, codec, query parser, list controller, or policy implementation for each responsibility.
- Every listing/search endpoint must compose the shared filter, search, sort, pagination, and page-response contracts. Improve the shared abstraction when it is incomplete; do not introduce another query dialect.
- Filtering, searching, sorting, aggregation, and pagination belong in bounded backend D1 queries. The frontend renders server results and must not process a fetched full dataset as a substitute for a query.
- One basis for validation: a form validates through the shared Zod request schema its route parses, via `useContractForm(schema, body)` in Preact, and never through a local boolean, regex, or hand-written check. A field's state and message come from that contract or from the server's refusal read through the shared validation map. A form on the hook sets `noValidate`, so the browser's own bubble never speaks ahead of the contract. `check:form-contracts` enforces it, together with the shared primitives: `Field` with `TextInput`/`Textarea`/`Select`, `Checkbox`/`Radio`, `ButtonLink`, and no `pk-` class that no stylesheet defines.
- Flexible profile links use the shared link schema and JSON codec. Keep identity, authorization, uniqueness, joins, state transitions, and indexed filter fields normalized.
- Keep routes thin: validate the shared contract, resolve auth context, call one focused use case, and serialize the shared response. Business transitions and SQL do not belong in routes.
- Model API paths around stable business and resource domains. Do not create top-level route families named after UI shells, navigation groupings, actor types, authorization levels, or vague technical buckets such as `admin`, `portal`, `system`, `me`, or `operations` unless the term is the actual product domain and the user explicitly approves it. Authentication is the `/api/v1/auth` domain; identity-specific resources belong under the relevant resource, such as `/api/v1/users/current`.
- Model related resources as natural nested collections instead of compound `/domain-something` segments. For example, use `/events/:eventSlug/forms/placements/:purpose`, `/events/:eventSlug/speakers/invitations`, and `/events/:eventSlug/sponsors/tiers`, not `/form-placements`, `/speaker-invites`, or `/sponsor-tiers`. Treat a compound route segment as an architecture exception requiring explicit user approval, not as a naming shortcut.
- Keep route naming independent from permissions and UI placement. The same canonical domain endpoint serves every authorized user; backend permission guards control each action and the UI exposes only the actions granted to the current user.
- Remove superseded route handlers, mounts, callers, contracts, tests, and documentation in the same cutover. Do not retain compatibility aliases in this unreleased application unless the user explicitly approves a compatibility requirement.
- Keep configurable product policy in shared domain modules or reference data. Do not scatter status, role, category, URL, email-template, or feature-policy literals through routes and components.
- A state-changing use case owns one atomic D1 command boundary. External effects use the durable outbox and one explicit retry owner.

## Time and time zones

- The system operates in UTC. Persist, compute with, and transport every instant as ISO-8601 UTC with an explicit `Z` and millisecond precision.
- Localize only at a presentation boundary. Backend services, shared contracts, stored values, and API payloads never carry a viewer's local time.
- When a value's meaning is a local wall clock rather than an instant, store the IANA time zone identifier alongside the UTC instant. Recurrence expansion, event scheduling, and generated calendars resolve the wall clock through that identifier.
- Never persist a fixed UTC offset or an abbreviation such as `CET` in place of an IANA identifier. Offsets do not survive daylight-saving transitions.
- Use the shared codec in `assets/shared/timezone.ts` for every wall-clock conversion. Do not hand-roll offset arithmetic, and reject local times that do not exist in the configured zone.
- Keep date-only values as `YYYY-MM-DD` calendar dates interpreted in the owning entity's zone. Do not widen them into instants.

## D1 migrations

- Never edit a migration that has been applied to preview or production. Verify both migration ledgers before changing migration history.
- Squash branch migrations that reached neither preview nor production into the final branch migration instead of appending corrective migrations.
- Deployments do not apply D1 migrations. Treat preview and production migration application as a separate, manual operation that requires explicit approval.
- All branch and pull-request previews share the preview database. Keep preview-compatible migrations and code changes coordinated across concurrently active branches.
- Never copy, import, backfill, or otherwise move production personal data, credentials, secrets, or private uploads into preview. Use synthetic or purpose-created preview fixtures.
- Prefer additive schema evolution. Avoid table rebuilds and changeable product vocabularies in table-level `CHECK` constraints.
- Reserve database constraints for durable structural invariants. Enforce evolvable workflow and product policy through shared Zod/domain modules with Vitest coverage, or through reference tables that can evolve additively.
- If an existing-table rebuild is genuinely unavoidable, document rejected additive designs and require explicit approval, a production-shaped rehearsal, and a tested recovery plan.

## Validation and deployment

- Match validation cost to the files and behavior changed. Do not run broad suites without a relevant reason.
- For simple Hugo content or data-only changes under `content/` or `data/` that do not touch templates, executable code, schemas, or configuration, do not run `pnpm run check`, `pnpm run test`, or `pnpm run test:e2e`. Review the diff and validate the affected front matter or YAML; preview the affected page only when rendering may have changed.
- For shortcode, layout, SCSS, client-side behavior, or navigation changes, run the narrow lint/build checks that cover the changed files and inspect the affected page. Add a focused browser test when interaction or rendering behavior changed.
- For JavaScript, TypeScript, Worker, schema, migration, build, or lint-configuration changes, run focused checks while iterating and `pnpm run check` before handoff.
- A local commit is not a handoff. During a multi-commit task, run the smallest relevant Vitest files and targeted lint/format checks after each coherent change. Use `pnpm run check:static` when a change crosses several TypeScript or architecture boundaries. Run the complete `pnpm run check` once after the final local batch is assembled and before handing the work to a reviewer; do not repeat the complete gate after every local commit.
- Treat migrations, shared contracts, authentication and authorization, central routers, Worker/build configuration, package changes, and test-runner configuration as broad-impact changes. Run the relevant wider suites while iterating and retain the complete handoff gate. Dependency-based changed-test selection is advisory for this repository because Worker routes and migrations are not always visible through a static import graph.
- Run `pnpm run test:e2e` only as an additional gate when browser-visible behavior, routing, or an end-to-end user flow changes. Prefer the smallest relevant Playwright project or test file during iteration.
- Prefix every commit subject with its Conventional Commit type: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, or `style`. Merge commits use the type of the work they bring in, not a bare `Merge ...` subject. Write the subject in the imperative mood, lower case after the prefix, with no trailing period.
- Commit messages and trailers describe the change only. They carry no agent names, model names, tool names, or workstream mechanics.
- Keep descriptive local commits, but batch normal pushes at coherent vertical-slice or review checkpoints so CI validates an accumulated, focused unit of work. Push sooner only when a preview, remote review, or external integration is required. Before a batch push, run the focused checks for every included commit; before final handoff, run the complete required gates against the exact accumulated state.
- Profile representative unit, build, Worker, and browser workloads periodically at phase boundaries instead of on every commit or CI batch. Start with advisory CPU, heap, duration, and trace evidence; fix repeatable hot spots, retain comparable baselines outside the repository under `/Volumes/ScanDisk` on this development machine, and introduce a blocking threshold only after the metric is stable across repeated runs and identifies an actionable regression. Use the profiler for the runtime that executes the work: Node CPU/heap profiles for Node processes, Cloudflare Worker DevTools for `workerd`, and Playwright/Chromium tracing for browser behavior. Do not add a native profiling dependency to required installs until it supports the repository's active Node versions and demonstrates value beyond the built-in tools.
- Branches and pull requests are deployed automatically to preview; `main` is deployed automatically to production. Treat `pnpm run deploy:preview` and `pnpm run deploy:production` as exceptional manual operations and never run them without an explicit request and confirmed target.
- Automatic application deployment does not apply migrations. Report required manual preview or production migration steps separately.
- Treat a passing check as necessary but not sufficient: verify the final diff against the requested architecture, data, and security invariants.

## Relevant skills

Load these skills when they are available and the work enters their scope:

- `$cloudflare` for Cloudflare architecture and platform decisions.
- `$workers-best-practices` for Cloudflare Worker implementation and review.
- `$wrangler` before Wrangler, D1, R2, environment, or deployment commands.
- `$hono` for Hono middleware, routing, validation, and route tests.
- `$database-schema-designer` for D1 schemas, constraints, indexes, and migrations.
- `$write-endpoints` for Chanfana and OpenAPI endpoints.
- `$codex-security:security-diff-scan` when a security diff review is explicitly requested.

If a required skill is unavailable, use the relevant current official documentation and state the limitation.

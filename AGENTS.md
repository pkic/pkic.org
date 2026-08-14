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
- Flexible profile links use the shared link schema and JSON codec. Keep identity, authorization, uniqueness, joins, state transitions, and indexed filter fields normalized.
- Keep routes thin: validate the shared contract, resolve auth context, call one focused use case, and serialize the shared response. Business transitions and SQL do not belong in routes.
- Keep configurable product policy in shared domain modules or reference data. Do not scatter status, role, category, URL, email-template, or feature-policy literals through routes and components.
- A state-changing use case owns one atomic D1 command boundary. External effects use the durable outbox and one explicit retry owner.

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
- Run `pnpm run test:e2e` only as an additional gate when browser-visible behavior, routing, or an end-to-end user flow changes. Prefer the smallest relevant Playwright project or test file during iteration.
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

# Repository guidance

## Workflow

- Use `pnpm` for repository scripts and local binaries. Do not mix in `npm` or `npx`.
- Use US English for site content, prose, comments, UI copy, and documentation. Preserve exact quoted names and source text where required.
- Read the nearest scoped `AGENTS.md` before changing files below a directory.
- Inspect existing schemas, parsers, list controls, services, SQL helpers, shortcodes, and UI components before adding another abstraction.
- Existing debt is not precedent. Do not copy a known weak pattern; improve touched code and track larger remediation explicitly instead of hiding it in a baseline.
- Keep changes focused. Use descriptive domain and use-case names; do not introduce vague buckets such as `commands`, `management`, or `repository` without a real interface boundary.
- Member onboarding and profile changes use the portal. Treat `data/members/*.yaml` as legacy import material, not an ongoing member edit path.
- Before proposing a public `pkic/pkic.org` PR, compare with its current `main` and review every new commit and tracked file for internal plans, personal data, and one-time tooling.
- Use the product terms in `GLOSSARY.md` in code, copy, and documentation. One thing has one name across flows.
- For a new screen or a large redesign, show the owner one desktop and one phone screenshot of the bare layout first. Build every state and the polish only after the layout is approved.
- Keep authored files cohesive and reasonably small. A line-count check is only a warning signal; separate responsibilities instead of moving unrelated code into another large file.
- Do not add lint suppressions, architecture baselines, duplication allowances, or generated ignore files to make a new gate pass. Fix the violations before enabling the gate.

## Agent communication with people

- These rules apply only to agent-to-human communication, including chat, issue comments, and handoffs. They do not apply to website or product copy.
- Keep owner updates, issue comments, and handoffs very brief and easy to scan.
- Use concise bullets and short sections; lead with the outcome, remaining work, and checks.
- Label questions explicitly as **Question**. Ask only when an answer is needed to proceed.

## Architecture and contracts

- Keep one dependency direction: shared contracts and domain policy, then backend persistence and focused use cases, then thin HTTP routes; the frontend consumes shared transport contracts and never imports backend implementation.
- API request and response schemas are canonical shared Zod schemas. Infer TypeScript types from them and extend or compose shared bases instead of copying shapes.
- DRY is required across schemas and behavior: keep one canonical contract, codec, query parser, list controller, or policy implementation for each responsibility.
- Every listing/search endpoint must compose the shared filter, search, sort, pagination, and page-response contracts. Improve the shared abstraction when it is incomplete; do not introduce another query dialect.
- Filtering, searching, sorting, aggregation, and pagination belong in bounded backend D1 queries. The frontend renders server results and must not process a fetched full dataset as a substitute for a query.
- One basis for validation: a form validates through the shared Zod request schema its route parses, via `useContractForm(schema, body)` in Preact, and never through a local boolean, regex, or hand-written check. A field's state and message come from that contract or from the server's refusal read through the shared validation map. A form on the hook sets `noValidate`, so the browser's own bubble never speaks ahead of the contract. `check:form-contracts` enforces it, together with the shared primitives: `Field` with `TextInput`/`Textarea`/`Select`, `Checkbox`/`Radio`, `ButtonLink`, and no `pk-` class that no stylesheet defines.
- Profile data (name, title, organization, bio, links, headshot) lives only in users and the identities they act as. Proposals, registrations, sessions, snapshots, and overrides reference an identity and never store or show a copy; a new per-record profile field is a defect. Reuse `assets/ts/components/identities/` and the shared identity read model.
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
- Use `pnpm migrate preview` or `pnpm migrate production` for remote migrations; migration 0035 needs the repository's atomic file-import workaround for D1's trigger parsing error. Do not bypass it with raw `wrangler d1 migrations apply` until 0035 is recorded.
- All branch and pull-request previews share the preview database. Keep preview-compatible migrations and code changes coordinated across concurrently active branches.
- Never copy, import, backfill, or otherwise move production personal data, credentials, secrets, or private uploads into preview. Use synthetic or purpose-created preview fixtures.
- Prefer additive schema evolution. Avoid table rebuilds and changeable product vocabularies in table-level `CHECK` constraints.
- Reserve database constraints for durable structural invariants. Enforce evolvable workflow and product policy through shared Zod/domain modules with Vitest coverage, or through reference tables that can evolve additively.
- If an existing-table rebuild is genuinely unavoidable, document rejected additive designs and require explicit approval, a production-shaped rehearsal, and a tested recovery plan.

## Validation and deployment

- Match validation cost to the files and behavior changed. Do not run broad suites without a relevant reason.
- For simple Markdown content or data-only changes under `content/` or `data/` that do not touch templates, executable code, schemas, or configuration, do not run `pnpm run check`, `pnpm run test`, or `pnpm run test:e2e`. Review the diff and validate the affected front matter or YAML; preview the affected page only when rendering may have changed.
- For shortcode, layout, SCSS, client-side behavior, or navigation changes, run the narrow lint/build checks that cover the changed files and inspect the affected page. Cover interaction and rendering with component tests; change Playwright only when a critical workflow changes.
- Test policy: run only the focused tests for the files you change (the smallest relevant Vitest files, or `pnpm test:changed`), plus typecheck and targeted lint/format. Use `pnpm run check:static` when a change crosses several TypeScript or architecture boundaries. The complete `pnpm run check` runs once, before a push to production, and in CI; never run it per commit, per agent, or in parallel with another full run.
- Treat migrations, shared contracts, authentication and authorization, central routers, Worker/build configuration, package changes, and test-runner configuration as broad-impact changes. Run the relevant wider suites while iterating. Dependency-based changed-test selection is advisory for this repository because Worker routes and migrations are not always visible through a static import graph.
- E2E (Playwright with the local Worker) is slow: reserve it for critical end-to-end workflows, extend an existing flow spec rather than adding one, and run it as an additional gate only when such a workflow, routing, or browser-visible behavior changes. Prefer the smallest relevant spec during iteration.
- Keep E2E fixtures synthetic and self-contained: a fresh database may have no members, sponsors, or group roster. Drive labeled controls through visible labels, and match assertions to the current UI copy.
- Prefix every commit subject with its Conventional Commit type: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, or `style`. Merge commits use the type of the work they bring in, not a bare `Merge ...` subject. Write the subject in the imperative mood, lower case after the prefix, with no trailing period.
- Commit messages and trailers describe the change only. They carry no agent names, model names, tool names, or workstream mechanics.
- Keep descriptive local commits, but batch normal pushes at coherent vertical-slice or review checkpoints so CI validates an accumulated, focused unit of work. Push sooner only when a preview, remote review, or external integration is required. Before a batch push, run the focused checks for every included commit; CI runs the complete gates on the pushed state.
- Profile representative unit, build, Worker, and browser workloads periodically at phase boundaries instead of on every commit or CI batch. Start with advisory CPU, heap, duration, and trace evidence; fix repeatable hot spots, retain comparable baselines outside the repository under `/Volumes/ScanDisk` on this development machine, and introduce a blocking threshold only after the metric is stable across repeated runs and identifies an actionable regression. Use the profiler for the runtime that executes the work: Node CPU/heap profiles for Node processes, Cloudflare Worker DevTools for `workerd`, and Playwright/Chromium tracing for browser behavior. Do not add a native profiling dependency to required installs until it supports the repository's active Node versions and demonstrates value beyond the built-in tools.
- Branches and pull requests are deployed automatically as Workers Previews of the production Worker, bound only to the preview resources in `env.production.previews` (see `CONTRIBUTING.md`); `main` is deployed automatically to production. Treat `pnpm run deploy:preview` and `pnpm run deploy:production` as exceptional manual operations and never run them without an explicit request and confirmed target.
- Automatic application deployment does not apply migrations. Report required manual preview or production migration steps separately.
- Treat a passing check as necessary but not sufficient: verify the final diff against the requested architecture, data, and security invariants.
- For a reported portal issue, reproduce the complete user journey and inspect the rendered screen; a narrow test or `ready-for-verification` label alone does not establish that the workflow works.

## Definition of done

A change is done when all of these hold:

- It meets the request and the invariants above; the diff holds no unrelated edits, debug code, or one-time tooling.
- The focused tests, typecheck, and lint for the touched files pass (see the test policy).
- UI changes follow `$pkic-ui`. The agent rendered the changed control or screen, inspected the screenshot itself, and checked it against the pattern catalog entry: a gallery screenshot for a component change, a hot-reload screenshot for a screen change, and a built-server check only before a push. Desktop and 375px phone width for screens. A reviewer rejects UI work without a screenshot.
- Copy is US English, uses the glossary terms, and passed a `$ux-copy` review.
- Required manual steps (migrations, secrets, owner decisions) are reported, not implied.

## Relevant skills

Load these skills when they are available and the work enters their scope:

- `$pkic-ui` for every portal, site, or studio UI change: shared components, the pattern catalog, copy, and the component gallery.
- `$cloudflare`, `$workers-best-practices`, and `$wrangler` for Worker code and before Wrangler, D1, R2, or deployment commands; `$durable-objects` for live session rooms.
- `$hono` for routes and middleware; `$vitest` for unit, frontend, and Worker tests; `$playwright-best-practices` for e2e specs.
- `$preact-forms-events` for portal components and forms.
- `$frontend-design` when building or reshaping UI. The design system (tokens in `assets/design`, shared components, the session details dialog as the reference) is the brief; the skill sharpens quality within it and never sets a new visual direction.
- `$ux-copy`, `$design-critique`, and `$accessibility` / `$accessibility-review` to review a screen before handoff.
- `$security-review` for changes to authentication, authorization, or untrusted input.

The other skills in `skills-lock.json` are optional; load one when the task needs it.

Project skills are pinned in `skills-lock.json` and installed on demand into the shared, tool-neutral `.agents/skills/` directory with `pnpm run skills:install`; installed copies are not committed. The repository's own skills (`.agents/skills/pkic-ui/`) are committed and edited in place. Add or update a skill with `pnpm dlx skills@1.7.1 add <source> --skill <name> --agent universal --yes`, review its `SKILL.md`, and commit only the lock file. Agents that read skills from another location point their own configuration at `.agents/skills/`; the repository does not maintain per-agent copies. Where a skill shows `npx` commands, run the `pnpm dlx` or `pnpm exec` equivalent.

If a required skill is unavailable, use the relevant current official documentation and state the limitation.

# Reproducing the YAML → D1 Member Migration Locally

Manual steps to run Step 2/3/3b (`scripts/migrate-members-yaml-to-d1.mjs`)
against local D1 (`pkic-db-local`). Safe to run repeatedly — the script is
idempotent, and this whole procedure targets a local SQLite file, not
production.

## Prerequisites

```bash
pnpm install                 # ensures `yaml` package etc. are present
```

Run the importer through `pnpm run migrate:members`. The command enables
Node's TypeScript type stripping so the importer can consume the canonical
shared schemas; pass importer options after `--` as shown below. Do not use
the production or preview options without an explicit migration plan and
approval.

This importer requires Node 22.6 or newer because that is the first Node 22
release with the `--experimental-strip-types` runtime used by the package
command. The repository's `engines.node` declaration reflects this minimum.

Confirm the source data is in place:

- `data/members/*.yaml` — 418 member YAML files (plus a non-YAML `AGENTS.md`)
- `csv/pkic.csv` + `csv/{ca,cbom,cm,pkimm,pqc,tcwg}.csv` — Google Groups roster
  exports (`csv/ec.csv` also exists but is intentionally not consumed — EC
  membership) — untracked, never commit these; they carry real people's
  email addresses.

## Step 1 — Apply schema migrations

The script writes to the final organization, Member-capacity, acting-identity,
domain, category-assignment, and group-membership schema consolidated in the
unreleased `migrations/0035_membership_portal_governance.sql`. Apply the
complete local migration set before running it:

```bash
pnpm run migrate:local
# equivalent to: pnpm exec wrangler d1 migrations apply DB --env local --local
```

Applies every not-yet-applied migration in `migrations/` to the local D1
instance. Safe to re-run — wrangler tracks which migrations already ran.

## Step 2 — (optional) Back up local D1 first

```bash
pnpm run backup:local
# writes backups/d1/local-<timestamp>.sql
```

Not strictly necessary since the import is idempotent, but cheap insurance if
your local DB already has other data you care about.

## Step 3 — Dry run the migration script

```bash
pnpm run migrate:members -- --local --dry-run
```

Parses the YAML + CSVs, does the domain-matching/pairing, and writes the
generated SQL + a report to `ignore/` (gitignored) — does **not** touch the
database. Review `ignore/` for:

- the generated `.sql` file (what would be executed)
- the migration report (unmatched orgs, ambiguous pairings, WG-only roster
  users)

Expect 380 matched orgs/individuals, 16 org-less individuals created with a
placeholder email, and 22 unmatched org-tied representatives (2026-08-17
run — these numbers drift slightly release to release as `data/members/
*.yaml` and the roster CSVs change; re-run `--dry-run` for the current
count instead of trusting this snapshot).

## Step 4 — Run it for real

```bash
pnpm run migrate:members -- --local
```

Executes the generated SQL against local D1 via `wrangler d1 execute --file`.
Idempotent — re-running (e.g. after fixing data or re-exporting CSVs) upserts
rather than duplicates. Also uploads logos/photos to R2 by default — see
Step 5.

**Fixed 2026-08-17 (was a known issue in this doc briefly):** against the
full real dataset (419 YAML files, ~4,300 statements), `wrangler d1 execute
--local --file` used to fail with `✘ [ERROR] statement too long:
SQLITE_TOOBIG`. Root cause: `buildUpsertUserStatement`'s `ON CONFLICT DO
UPDATE SET` ended with a `headshot_r2_key = CASE ... END,` clause followed
by one more clause — wrangler's local-execute SQL splitter
(`unstable_splitSqlQuery`) only recognizes a `CASE` block as closed when
`END` is immediately followed by `;` or whitespace; `END,` (comma, no
space) never satisfies that, so the splitter's compound-statement tracking
never popped and it silently merged every later statement in the file into
that one, eventually exceeding D1's 100KB per-statement limit. Fixed by
reordering that `SET` clause list so `CASE ... END` is last, ending the
statement in `END;` directly — confirmed against wrangler's own splitter
with a minimal repro, and re-verified end to end against the full real
dataset (`EXEC_EXIT:0`, all statements executed successfully). Only ever
affected local `d1 execute --file`/`--command` — `--remote` (the actual
`--preview`/`--production` import path) uploads the raw file for
server-side ingestion instead and was never affected.

## Step 5 — Logos/photos to R2 (on by default)

```bash
pnpm run migrate:members -- --local            # uploads by default
pnpm run migrate:members -- --local --skip-logos  # opt out (faster)
```

Uploading is now the default (it was opt-in via `--upload-logos` through
2026-07-27) — pass `--skip-logos` if you want a faster dry pass over just the
SQL. `--upload-logos` is still accepted as a no-op for old muscle memory.

Sources images from `assets/images/members/<slug>/`; sets
`organizations.logo_r2_key` for the org's own logo file (`<slug>.*`),
`users.headshot_r2_key` for H5/H6/H7 individual identities (same
`<slug>/<slug>.*` file), **and** `users.headshot_r2_key` for each matched
organization identity's own photo — every other image file in that same directory,
keyed by the source representative's urlized name (or their YAML `representatives[].id`
when one is set, for names the urlizer can't reproduce exactly, e.g. explicit
nicknames). Identity photos surface via `GET /api/v1/members/:id` →
`identities[].photoUrl`, served by the same `GET /api/v1/members/:id/logo`
endpoint — keyed on that identity's own `identities.id`
(`functions/_lib/services/membership/directory.ts`'s `getMemberLogoR2Key`),
not a `members.id`. There is one `members` aggregate per organization and N
identity rows derive that shared capacity through `identity_member_capacities`.

## Step 6 — Verify

```bash
pnpm exec wrangler d1 execute DB --env local --local --command "SELECT COUNT(*) FROM organizations"
pnpm exec wrangler d1 execute DB --env local --local --command "SELECT COUNT(*) FROM members"
pnpm exec wrangler d1 execute DB --env local --local --command "SELECT COUNT(*) FROM identities"
pnpm exec wrangler d1 execute DB --env local --local --command "SELECT COUNT(*) FROM group_memberships"
```

`members` is one aggregate row per organization plus one per approved H5/H6/H7
individual, not one row per person acting for an organization. Those exact
capacities live in `identities`. All counts drift as
`data/members/*.yaml` and the roster CSVs change — don't trust this
snapshot for a different run; cross-check against the generated `.sql`
file's own statement tallies (`grep -oE "INSERT( OR IGNORE)? INTO [a-z_]+"
ignore/member-migration-*.sql | sort | uniq -c`) and `ignore/member-migration-
report-*.json`'s `totals`/`workingGroupCounts` instead, which are always
accurate for that specific run. Actual row counts can land at or slightly
below the `.sql` file's statement counts for `organizations`/`members`/
`identities`/`users` (never above) — `INSERT OR
IGNORE`/`ON CONFLICT` collapse a duplicate `normalized_name`,
`organization_id`, active `(member_id, user_id)` pair, or
`normalized_email` into one row (e.g. the 2026-08-17 run's 418
`member`-insert statements collapsed to 417 rows, and 847 `users`-insert
statements collapsed to 844 — expected, not a bug).

## What changed 2026-08-16/17 (Phase 2 schema retarget)

The importer previously targeted an intermediate, now-deleted schema shape
(`organizations.membership_category`, `organizations.social_*` columns,
`organizations.primary_contact_user_id`/`secondary_contact_user_id`, one
`members` row per representative). All of `scripts/migrate-members-yaml-to-d1.mjs`'s
org/individual write paths were rewritten to target the final Phase-1 schema
instead:

- `organizations` no longer gets a `membership_category` column or
  `social_*` columns — social links fold into the canonical `links_json`
  array (same shape `users.links_json` already used).
- `organization_domains` is populated directly from YAML
  `organizationDomains`, instead of a later normalization pass.
- Exactly one `members` aggregate row is created per organization
  (`member_type='organization'`) or per org-less individual
  (`member_type='individual'`), each with a `member_category_assignments`
  row for its category — never one `members` row per representative.
- Organization participants become `identities` rows (not `members` rows),
  H5/H6/H7 records receive one organization-less identity, and the org's primary/secondary contact become
  `role-primary_contact`/`role-secondary_contact` grants in `user_roles`
  (context-scoped to the org's aggregate `members.id`) instead of
  `organizations.primary_contact_user_id`/`secondary_contact_user_id`
  columns.

Also split into `scripts/migrate-members/{cli,parsers,reconciliation,
sql-renderer,report,r2-adapter}.mjs` (`scripts/AGENTS.md`'s "entrypoints
orchestrate focused modules" shape — `migrate-members-yaml-to-d1.mjs` was
1,332 lines and failed `pnpm run check:max-lines`), and gained a fresh-D1
execution smoke test (`tests/tools/migrate-members-importer.test.ts`,
`pnpm run test:tools`) that applies the full migration set to an empty D1
and executes a small synthetic fixture's generated SQL against it — this is
the safety net that would have caught the intermediate-schema drift this
pass fixed, and now runs in CI via `pnpm run test`.

Also fixed a real `SQLITE_TOOBIG` failure discovered while verifying this
pass end to end against the full real dataset: see Step 4's "Fixed
2026-08-17" note and Step 6's now-verified row counts above — a `CASE ...
END,` clause in the `users` upsert (not itself changed by the schema
rewrite, but only exercised at real scale for the first time by this pass's
verification) desynced wrangler's local SQL statement splitter and merged
the rest of the file into one oversized statement. Fixed by reordering the
`SET` clause list so the `CASE` block ends the statement.

## What changed 2026-07-28

Four gaps closed in this pass, all in `scripts/migrate-members-yaml-to-d1.mjs`
unless noted:

1. **Org-less individuals (H5/H6/H7) with no domain-matched roster email are
   no longer skipped entirely.** Previously the script created _nothing_ for
   these 16 people — no `users` row, no `members` row, nothing to attach a
   photo to. They now get a real row keyed on a deterministic, non-deliverable
   placeholder email (`unmatched-<slug>@members.invalid`, using the
   non-resolvable `.invalid` domain reserved by RFC 2606), flagged
   `needsEmail: true` in the report.
   Staff attach a real email later via **Users → [user] → Edit**. Org-tied
   representatives with no matched email are **not** affected by this — they
   still go through the Interim Admin Tool as before, since an org-tied
   representative's record is meaningless without knowing which real person
   at the organization it is.
2. **`members.member_since`** (now consolidated in migration `0035`) — the YAML
   `memberSince` key (org-tied) and each individual's own `memberSince` now
   land in D1 and are read back by the public directory (`GET /api/v1/members[/:id]`),
   the member self-service profile (`GET /api/v1/users/current`), and the staff
   Organizations detail view, instead of those endpoints silently
   substituting the row's D1 `created_at` (a migration-run timestamp, not a
   real join date). The Interim Admin Tool's "Add organization" form was
   **also** already collecting a `memberSince` date from staff and silently
   dropping it — a pre-existing bug unrelated to this migration script, fixed
   alongside since it's the same underlying gap
   (`functions/_lib/services/membership-management-list.ts`).
3. **Hugo shortcodes in YAML `content` are rewritten to plain URLs** before
   landing in `organizations.content_markdown` — `{{< youtube ID >}}` →
   `https://www.youtube.com/watch?v=ID`, `{{< vimeo ID >}}` →
   `https://vimeo.com/ID`, `{{< video link="URL" ... >}}` → `URL`. Previously
   these rendered as literal, unresolved shortcode text on an organization's
   profile page (25 occurrences across `data/members/*.yaml`, checked
   2026-07-28).
4. **Logo/photo upload to R2 is now the default**, not opt-in — see Step 5.

## What changed 2026-07-29

Five more gaps closed, all in `scripts/migrate-members-yaml-to-d1.mjs` unless
noted:

1. **Membership category** was never set by the migration for org-tied
   members — only the per-member mirror was. Every migrated org ended up
   uncategorized, blocking `addActingIdentity`'s
   `422 ORG_CATEGORY_NOT_SET` guard until staff manually set it. Now sourced
   from the YAML `memberType` key on every org upsert (never overwrites a
   category staff already set by hand — since the 2026-08-16/17 rewrite this
   lands in `member_category_assignments` via `INSERT OR IGNORE`, not an
   `organizations` column).
2. **Domain matching now also draws candidates from the six working-group
   roster CSVs** (`csv/{ca,cbom,cm,pkimm,pqc,tcwg}.csv`), not just
   `csv/pkic.csv`. A subscriber present only on a WG list (e.g.
   `chris@ssl.com`, `ca.csv`-only) whose email domain matches an org's
   `organizationDomains` is now attributed to that org instead of becoming an
   orphaned "WG-only roster user."
3. **`organizations.slug`** (now consolidated in migration `0035`) is populated from
   each org-tied YAML file's `id:` key, backing a clean public profile URL
   (`/members/<slug>`) instead of the UUID-keyed `/members/profile/?id=<uuid>`.
4. **Sponsorship data** (`sponsor.level`/`sponsor.since` and
   `sponsor.sponsoring.<Event Name>`) is now migrated into `sponsorships` +
   `organizations.sponsor_tier`/`sponsor_start_date`, closing the gap
   and flagged as follow-up when the D1-native sponsorship pipeline
   shipped. Per-event sponsorships are matched against a small hardcoded
   `EVENT_NAME_ALIASES` table (only 3 distinct event names exist across all
   YAML) rather than fuzzy name matching; unrecognized event names are
   reported, not silently dropped.
   Legacy blank or case-insensitive `none` levels mean “not a sponsor,”
   matching the former Hugo behavior; they do not create an active D1
   sponsorship or populate `organizations.sponsor_tier`.
5. **`--logo-bucket` now defaults per environment** (`pkic-assets-preview`
   for `--preview`, `pkic-assets` for `--local`/`--production`) instead of
   always `pkic-assets` — running `--preview` without an explicit
   `--logo-bucket` previously uploaded photos into the _production_ bucket.

Re-run `--dry-run` and check the fresh report for updated matched/unmatched
counts — the domain-matching change (item 2) in particular will shift how
many "bare"/"WG-only" roster users remain after this pass.

## Notes

- `--local` targets `pkic-db-local` (`--env local --local` under the hood).
  Don't substitute `--preview`/`--production` unless you actually mean to
  touch those databases — no confirmation prompt gates that choice.
- The unmatched org-tied representatives are **expected** to be left out.
  The canonical `POST /api/v1/members` path is the membership provisioning
  adapter for staff reconciliation, not the canonical long-term workflow.
- Only a minority of active representatives have a photo file on disk under
  `assets/images/members/<orgSlug>/` — the rest simply never had a photo
  uploaded to the Hugo site, unrelated to migration matching. Their
  detail-page card falls back to the initials avatar, same as an org/individual
  with no logo file.
- Report files land in `ignore/` (gitignored) — read the Markdown one for a
  human-readable summary of what happened. It also lists, for every
  bare-roster and WG-only-roster email that couldn't be attributed to a YAML
  representative, which working-group CSV(s) that email appears in — the
  signal staff need to reconcile identity by hand.

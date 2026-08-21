/**
 * Step 2/3/3b — Import member organizations & representatives to D1.
 *
 * Reads `data/members/*.yaml` (the Hugo-era member directory) and the
 * Google Groups roster exports under `csv/` (`pkic.csv` plus the six
 * per-working-group rosters), reconciles them by email domain, and
 * generates idempotent SQL that:
 *
 *   - upserts one `organizations` row per org-tied YAML file (categories
 *     A-G, H1-H4, H8), populating the content columns and a canonical
 *     `links_json` array (social links) directly — no `social_*` columns
 *   - upserts one `organization_domain_claims` row per YAML `organizationDomains`
 *     entry for org-tied organizations
 *   - creates exactly one `members` aggregate row per organization (the
 *     org's `member_type='organization'` row, migration 0000) plus a
 *     `member_category_assignments` row for its category (consolidated migration 0035) —
 *     never one `members` row per representative
 *   - upserts one `users` row + one `organization_representatives` row per
 *     representative whose email could be matched against the `pkic.csv`
 *     roster by organization domain (Step 2); the org's primary/secondary
 *     contact are granted as `role-primary_contact`/`role-secondary_contact`
 *     `user_roles` grants (consolidated migration 0035), context-scoped to the org's
 *     aggregate `members.id`
 *   - upserts one `users` + `members` (individual aggregate) row for
 *     **every** org-less individual (H5/H6/H7) YAML file, even when no
 *     roster email matches its domain — an individual with no reconcilable
 *     email still gets a real row, keyed on a deterministic, non-deliverable
 *     `.invalid`-TLD placeholder email (`unmatched-<slug>@members.invalid`,
 *     same "sentinel email" pattern `user-merge.ts` already uses for
 *     anonymized accounts) so the person, their bio/role, and their photo
 *     show up immediately; flagged `needsEmail: true` in the report so staff
 *     can attach a real email via Users → Edit later. Org-tied
 *     representatives with no matched email are unaffected by this — they
 *     still go through the Interim Admin Tool, per the "no reliable email to
 *     key a users row on" reasoning below.
 *   - upserts a bare `users` row (no organization) for any roster email
 *     that can't be attributed to any YAML organization at all (Step 3)
 *   - upserts `working_group_members` rows for every user created above,
 *     from the six per-WG roster CSVs, not the YAML `workingGroups:` field
 *     (Step 3b)
 *   - by default, also uploads every logo/photo found under
 *     `assets/images/members/<slug>/` to R2 (pass `--skip-logos` to opt out)
 *   - rewrites Hugo shortcodes (`{{< youtube ID >}}`, `{{< vimeo ID >}}`,
 *     `{{< video link="URL" ... >}}`) found in YAML `content` into plain
 *     URLs before writing `organizations.content_markdown`, so they render
 *     as links instead of literal, unresolved shortcode text
 *   - rejects the entire import up front (no SQL generated) if any record
 *     has a missing, unknown, or kind-incompatible membership category —
 *     see scripts/migrate-members/categories.mjs
 *
 * What this script deliberately does NOT do:
 *   - create `organizations`/`users`/`organization_representatives` rows for
 *     org-tied representatives with no domain-matched email at all — see the
 *     "unmatched" report section; these are finished one at a time via the
 *     Interim Admin Tool (`POST /api/v1/admin/members`). (Org-less
 *     individuals in the same situation *do* get a row now, via the
 *     sentinel-email path described above — the distinction is that an
 *     individual's own YAML file **is** their whole record, where an
 *     org-tied representative's record is meaningless without knowing which
 *     real person at the organization it belongs to.)
 *
 * This is the thin orchestration entry point (scripts/AGENTS.md): CLI
 * parsing lives in scripts/migrate-members/cli.mjs; the actual
 * YAML-record-to-SQL pipeline (loading, category preflight, per-record
 * dispatch, report assembly) lives in scripts/migrate-members/
 * build-migration.mjs and the focused modules it calls
 * (categories/individuals/organizations/roster-users/non-member-sponsors/
 * sql-renderer.mjs); report formatting is in report.mjs; wrangler/R2 side
 * effects are in r2-adapter.mjs. This file only wires the CLI to
 * `buildMigration` and writes its output.
 *
 * Usage:
 *   node scripts/migrate-members-yaml-to-d1.mjs --local
 *   node scripts/migrate-members-yaml-to-d1.mjs --preview
 *   node scripts/migrate-members-yaml-to-d1.mjs --production
 *   node scripts/migrate-members-yaml-to-d1.mjs --local --dry-run   (writes SQL + report only)
 *
 * Environment flags mirror scripts/seed.mjs's ENVS table (binding is always
 * "DB"; --env/--local|--remote select which wrangler.jsonc environment
 * block resolves it):
 *   --local        --env local --local     (database pkic-db-local)
 *   --preview      --env preview --remote  (database pkic-db-preview)
 *   --production   --env production --remote (database pkic-db)
 *
 * Other flags:
 *   --persist-to <path>          forwarded to `wrangler d1 execute`
 *   --dry-run                    skip execution; only write the .sql + report
 *   --skip-logos                  don't upload logos/photos to R2 (on by default)
 *   --logo-bucket <name>          R2 bucket for logo uploads (default: pkic-assets)
 *   --out <dir>                    report output directory (default: ignore/)
 */
import fs from "node:fs";
import path from "node:path";

import { parseArgs, ENVS } from "./migrate-members/cli.mjs";
import { buildMigration } from "./migrate-members/build-migration.mjs";
import { renderMarkdownReport } from "./migrate-members/report.mjs";
import { runWranglerD1, uploadLogosToR2 } from "./migrate-members/r2-adapter.mjs";

export { buildMigration };

const ROOT = process.cwd();

function main() {
  const cli = parseArgs(process.argv.slice(2), ROOT);
  const { sql, report, logoUploads } = buildMigration({
    uploadLogos: cli.uploadLogos,
  });

  fs.mkdirSync(cli.outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sqlOutPath = path.join(cli.outDir, `member-migration-${timestamp}.sql`);
  const jsonOutPath = path.join(cli.outDir, `member-migration-report-${timestamp}.json`);
  const mdOutPath = path.join(cli.outDir, `member-migration-report-${timestamp}.md`);

  fs.writeFileSync(sqlOutPath, sql, "utf8");
  fs.writeFileSync(jsonOutPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(mdOutPath, renderMarkdownReport(report), "utf8");

  console.log(`Wrote SQL to ${sqlOutPath}`);
  console.log(`Wrote report to ${mdOutPath} (${jsonOutPath})`);
  console.log(
    `${report.totals.matchedOrgs} matched, ${report.totals.sentinelIndividuals} individuals created with a placeholder email, ${report.totals.unmatched.length} unmatched, ${report.bareRosterUsers.length} bare roster users`,
  );

  if (cli.dryRun) {
    console.log("--dry-run: skipping wrangler execution and logo upload.");
    return;
  }

  runWranglerD1(ROOT, ENVS[cli.env], cli, sql);

  if (cli.uploadLogos && logoUploads.length > 0) {
    console.log(`Uploading ${logoUploads.length} organization logos to R2 bucket ${cli.logoBucket}...`);
    uploadLogosToR2(ROOT, ENVS[cli.env], cli, logoUploads);
  }
}

// Guarded so this module can be imported (e.g. by the fresh-D1 smoke test
// in tests/tools/migrate-members-importer.test.ts) without executing the CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

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
 *   - upserts one `organization_domains` row per YAML `organizationDomains`
 *     entry for org-tied organizations
 *   - creates exactly one `members` aggregate row per organization (the
 *     org's `member_type='organization'` row, migration 0000) plus a
 *     `member_category_assignments` row for its category (migration 0037) —
 *     never one `members` row per representative
 *   - upserts one `users` row + one `organization_representatives` row per
 *     representative whose email could be matched against the `pkic.csv`
 *     roster by organization domain (Step 2); the org's primary/secondary
 *     contact are granted as `role-primary_contact`/`role-secondary_contact`
 *     `user_roles` grants (migration 0038), context-scoped to the org's
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
 * parsing lives in scripts/migrate-members/cli.mjs, YAML/CSV ingestion in
 * parsers.mjs, representative/email matching in reconciliation.mjs, SQL
 * rendering in sql-renderer.mjs, report formatting in report.mjs, and the
 * wrangler/R2 side effects in r2-adapter.mjs. `buildMigration` below is the
 * one place that stitches those together in file-processing order.
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
import YAML from "yaml";

import { parseArgs, ENVS } from "./migrate-members/cli.mjs";
import {
  loadRosterCsv,
  loadMemberYamlFiles,
  activeRepresentatives,
  splitName,
  urlizeName,
} from "./migrate-members/parsers.mjs";
import {
  buildEmailsByDomain,
  candidateEmailsForDomains,
  matchRepsToCandidates,
  sentinelEmailForSlug,
} from "./migrate-members/reconciliation.mjs";
import {
  buildUpsertOrganizationStatement,
  buildOrganizationDomainStatements,
  buildOrganizationMemberAggregateStatements,
  buildOrganizationRepresentativeStatement,
  buildRepresentativeRoleGrantStatement,
  buildUpsertUserStatement,
  buildIndividualMemberAggregateStatements,
  buildConsortiumSponsorshipStatements,
  buildEventSponsorshipStatements,
  buildNonMemberConsortiumSponsorshipStatement,
  buildNonMemberEventSponsorshipStatements,
  buildWorkingGroupMemberStatement,
} from "./migrate-members/sql-renderer.mjs";
import { repSummary, renderMarkdownReport } from "./migrate-members/report.mjs";
import { findLogoFile, findRepPhotoFile, runWranglerD1, uploadLogosToR2 } from "./migrate-members/r2-adapter.mjs";

const ROOT = process.cwd();
const MEMBERS_DIR = path.join(ROOT, "data", "members");
const CSV_DIR = path.join(ROOT, "csv");
const LOGO_DIR = path.join(ROOT, "assets", "images", "members");
const SPONSORS_YAML_PATH = path.join(ROOT, "data", "sponsors.yaml");
const SPONSOR_LOGO_DIR = path.join(ROOT, "assets", "images", "sponsors");

const WORKING_GROUP_CSVS = {
  ca: "ca.csv",
  cbom: "cbom.csv",
  cm: "cm.csv",
  pkimm: "pkimm.csv",
  pqc: "pqc.csv",
  tcwg: "tcwg.csv",
};
// csv/ec.csv (Executive Council roster) is intentionally excluded — EC
// membership is scope (users.is_ec_member), not this migration.

const INDIVIDUAL_CATEGORIES = new Set(["H5", "H6", "H7"]);

// (sponsorship reconciliation): maps a YAML `sponsor.sponsoring.<key>`
// event name to the `events` row it should attribute to. Only 3 distinct
// event names exist across all of data/members/*.yaml (checked 2026-07-29),
// small enough to hand-map from content/events/*/index.md front matter
// rather than fuzzy-match against event names — the single generic
// "Post-Quantum Cryptography Conference" row already seeded in D1 doesn't
// distinguish by city/year, so each of these becomes (or reuses, if already
// present by slug) its own `events` row.
const EVENT_NAME_ALIASES = {
  "Post-Quantum Cryptography Conference Amsterdam 2023": {
    slug: "pqc-conference-amsterdam-nl-2023",
    name: "Post-Quantum Cryptography Conference - Amsterdam 2023",
    timezone: "Europe/Amsterdam",
    startsAt: "2023-11-07",
    endsAt: "2023-11-08",
  },
  "Post-Quantum Cryptography Conference Austin 2025": {
    slug: "pqc-conference-austin-us-2025",
    name: "Post-Quantum Cryptography Conference - Austin 2025",
    timezone: "America/Chicago",
    startsAt: "2025-01-15",
    endsAt: "2025-01-16",
  },
  "Post-Quantum Cryptography Conference Kuala Lumpur 2025": {
    slug: "pqc-conference-kuala-lumpur-my-2025",
    name: "Post-Quantum Cryptography Conference - Kuala Lumpur 2025",
    timezone: "Asia/Kuala_Lumpur",
    startsAt: "2025-10-28",
    endsAt: "2025-10-30",
  },
};

/**
 * Builds the full set of SQL statements plus a structured report, per the
 * reconciliation algorithm.
 */
function buildMigration({
  uploadLogos,
  membersDir = MEMBERS_DIR,
  csvDir = CSV_DIR,
  sponsorsYamlPath = SPONSORS_YAML_PATH,
}) {
  const yamlRecords = loadMemberYamlFiles(membersDir);
  const pkicRoster = loadRosterCsv(path.join(csvDir, "pkic.csv"));

  const wgRosters = {};
  for (const [slug, filename] of Object.entries(WORKING_GROUP_CSVS)) {
    wgRosters[slug] = loadRosterCsv(path.join(csvDir, filename));
  }

  // Domain-based org matching (Step 2 representative pairing, and the
  // "leftover matched candidates become anonymous org members" fallback
  // just below it) draws candidates from every roster we have, not just
  // pkic.csv — a representative or subscriber can appear only on a
  // working-group list (e.g. csv/ca.csv) and never on the main pkic@ list,
  // but their email still domain-matches their organization's
  // `organizationDomains` and should be attributed to it instead of
  // silently ending up an org-less bare/WG-only user.
  const combinedRoster = new Map(pkicRoster);
  for (const roster of Object.values(wgRosters)) {
    for (const [email, meta] of roster.entries()) {
      if (!combinedRoster.has(email)) combinedRoster.set(email, meta);
    }
  }
  const emailsByDomain = buildEmailsByDomain(combinedRoster);

  const statements = ["PRAGMA foreign_keys = ON;"];
  const logoUploads = []; // { slug, filePath, r2Key }
  const claimedEmails = new Set();
  const createdUserEmails = new Set(); // every email we insert a `users` row for
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      yamlFiles: yamlRecords.length,
      matchedOrgs: 0,
      sentinelIndividuals: 0,
      unmatched: [],
      missingCategory: [],
      ambiguousPairing: [],
    },
    needsEmailIndividuals: [],
    bareRosterUsers: [],
    wgOnlyRosterUsers: [],
    unmatchedEventSponsorships: [],
    nonMemberSponsorships: { created: 0, unmatchedEvents: [] },
    workingGroupCounts: Object.fromEntries(Object.keys(WORKING_GROUP_CSVS).map((k) => [k, 0])),
  };

  function upsertUser(input) {
    const { statement, normalizedEmail } = buildUpsertUserStatement(input);
    statements.push(statement);
    createdUserEmails.add(normalizedEmail);
    return normalizedEmail;
  }

  // ── Step 3e: sponsorship reconciliation (data/members/*.yaml `sponsor:`) ──
  // Migrates both the org's consortium-wide tier and any per-event
  // sponsorships. See buildConsortiumSponsorshipStatements/
  // buildEventSponsorshipStatements for the idempotency guards.
  function upsertSponsorshipsForOrg({ normalizedOrgName, doc, filename, name }) {
    const sponsor = doc.sponsor;
    if (!sponsor) return;

    const level = String(sponsor.level ?? "").trim();
    if (level) {
      const startDate = sponsor.since ?? doc.memberSince ?? null;
      statements.push(...buildConsortiumSponsorshipStatements(normalizedOrgName, level, startDate));
    }

    const sponsoring = sponsor.sponsoring;
    if (sponsoring && typeof sponsoring === "object") {
      for (const [eventName, eventSponsor] of Object.entries(sponsoring)) {
        const tier = String(eventSponsor?.level ?? "").trim();
        if (!tier) continue;
        const alias = EVENT_NAME_ALIASES[eventName];
        if (!alias) {
          report.unmatchedEventSponsorships.push({ file: filename, name, eventName, tier });
          continue;
        }
        statements.push(...buildEventSponsorshipStatements(normalizedOrgName, alias, tier));
      }
    }
  }

  // ── Step 2: organizations + representatives ─────────────────────────────

  for (const { filename, slug, doc } of yamlRecords) {
    const name = String(doc.name ?? slug).trim();
    const memberType = String(doc.memberType ?? "").trim();
    const isIndividual = INDIVIDUAL_CATEGORIES.has(memberType);
    const domains = Array.isArray(doc.organizationDomains) ? doc.organizationDomains.filter(Boolean) : [];
    const reps = activeRepresentatives(doc);
    const candidates = candidateEmailsForDomains(domains, emailsByDomain);

    if (!memberType) {
      report.totals.missingCategory.push({ file: filename, name });
    }

    if (isIndividual) {
      // Individuals have no organization row at all.
      //
      // Unlike org-tied representatives (where an unmatched email means "we
      // don't know which real person this is" and the row is left for the
      // Interim Admin Tool), an org-less individual's YAML file *is* their
      // whole record — every field needed to create them is already known
      // except a deliverable email. So an individual with no domain-matched
      // roster email still gets a real row, keyed on a deterministic
      // sentinel `.invalid` placeholder email (see sentinelEmailForSlug),
      // flagged `needsEmail: true` for staff to attach a real address later.
      const needsEmail = candidates.length === 0;
      const email = needsEmail ? sentinelEmailForSlug(slug) : candidates[0].email;

      if (needsEmail) {
        report.needsEmailIndividuals.push({
          file: filename,
          name,
          memberType,
          sentinelEmail: email,
          reason: domains.length ? "no roster subscriber at this domain" : "no domain to match against",
          workingGroupsHint: doc.workingGroups ?? [],
        });
      }

      // Individuals use the same per-slug image directory as org logos
      // (`/images/members/<slug>/<slug>.*`, per the old Hugo member-card/
      // single-page partials) — there's no separate `organizations` row to
      // hold a key for it, so it's stored on the user's own `headshot_r2_key`
      // (the same column self-service headshot uploads use).
      let headshotR2Key = null;
      if (uploadLogos) {
        const photoFile = findLogoFile(LOGO_DIR, slug);
        if (photoFile) {
          headshotR2Key = `member-photos/${slug}/${path.basename(photoFile)}`;
          logoUploads.push({ slug, filePath: photoFile, r2Key: headshotR2Key });
        }
      }

      const rep = reps[0] ?? { name, role: null, social: {}, description: null };
      const { firstName, lastName } = splitName(rep.name ?? name);
      // Canonical persisted shape is a plain URL array (matches
      // assets/shared/schemas/api.ts's linksSchema and everything
      // users.links_json is written/read as elsewhere) — not the legacy
      // {linkedin, x} object this script used to write.
      const links = [rep.social?.linkedin, rep.social?.x].filter(Boolean);
      const normalizedEmail = upsertUser({
        email,
        firstName,
        lastName,
        jobTitle: rep.role ?? null,
        biography: rep.description ?? null,
        linksJson: links.length > 0 ? JSON.stringify(links) : null,
        headshotR2Key,
      });
      claimedEmails.add(normalizedEmail);
      statements.push(
        ...buildIndividualMemberAggregateStatements(normalizedEmail, memberType || null, doc.memberSince),
      );
      if (needsEmail) report.totals.sentinelIndividuals += 1;
      else report.totals.matchedOrgs += 1;
      continue;
    }

    // Org-tied (A-G, H1-H4, H8): organization row is always created,
    // matched or not.
    let logoR2Key = null;
    if (uploadLogos) {
      const logoFile = findLogoFile(LOGO_DIR, slug);
      if (logoFile) {
        logoR2Key = `org-logos/${slug}/${path.basename(logoFile)}`;
        logoUploads.push({ slug, filePath: logoFile, r2Key: logoR2Key });
      }
    }
    const { statement: organizationStatement, normalizedOrgName } = buildUpsertOrganizationStatement({
      slug,
      name,
      doc,
      logoR2Key,
    });
    statements.push(organizationStatement);
    statements.push(...buildOrganizationDomainStatements(normalizedOrgName, domains));
    statements.push(
      ...buildOrganizationMemberAggregateStatements(normalizedOrgName, memberType || null, doc.memberSince),
    );
    upsertSponsorshipsForOrg({ normalizedOrgName, doc, filename, name });

    if (candidates.length === 0) {
      report.totals.unmatched.push({
        file: filename,
        name,
        memberType,
        representatives: reps.map(repSummary),
        reason: domains.length ? "no roster subscriber at this domain" : "no domain to match against",
        workingGroupsHint: doc.workingGroups ?? [],
      });
      continue;
    }

    const assignment = matchRepsToCandidates(reps, candidates); // parallel to reps: candidate index or null
    const unpairedReps = reps.filter((_, i) => assignment[i] === null);

    if (reps.length > 1 && candidates.length > 1) {
      report.totals.ambiguousPairing.push({
        file: filename,
        name,
        representatives: reps.map((r) => r.name),
        candidateEmails: candidates.map((c) => c.email),
      });
    }
    if (unpairedReps.length > 0) {
      report.totals.ambiguousPairing.push({
        file: filename,
        name,
        note: "more named representatives than matched emails — some representatives got no portal account",
        // Full detail (not just names), so staff finishing these via the
        // Interim Admin Tool have LinkedIn/role/bio in hand without going
        // back to the YAML — this data was previously dropped silently.
        unpaired: unpairedReps.map(repSummary),
      });
    }

    const contactEmails = [];
    const matchedCandidateIndices = new Set();

    for (let i = 0; i < reps.length; i += 1) {
      if (assignment[i] === null) continue;
      const rep = reps[i];
      const { email } = candidates[assignment[i]];
      matchedCandidateIndices.add(assignment[i]);
      const { firstName, lastName } = splitName(rep.name);
      // Canonical persisted shape is a plain URL array (matches
      // assets/shared/schemas/api.ts's linksSchema and everything
      // users.links_json is written/read as elsewhere) — not the legacy
      // {linkedin, x} object this script used to write.
      const links = [rep.social?.linkedin, rep.social?.x].filter(Boolean);

      // Representative photos live in the same `assets/images/members/<orgSlug>/`
      // directory as the org logo, one file per person (see findRepPhotoFile) —
      // distinct from the org's own `<orgSlug>.*` logo file.
      let repHeadshotR2Key = null;
      if (uploadLogos) {
        const photoFile = findRepPhotoFile(LOGO_DIR, slug, rep, urlizeName);
        if (photoFile) {
          repHeadshotR2Key = `member-photos/${slug}/${path.basename(photoFile)}`;
          logoUploads.push({ slug, filePath: photoFile, r2Key: repHeadshotR2Key });
        }
      }

      const normalizedEmail = upsertUser({
        email,
        firstName,
        lastName,
        jobTitle: rep.role ?? null,
        biography: rep.description ?? null,
        linksJson: links.length > 0 ? JSON.stringify(links) : null,
        headshotR2Key: repHeadshotR2Key,
      });
      claimedEmails.add(normalizedEmail);
      statements.push(buildOrganizationRepresentativeStatement(normalizedOrgName, normalizedEmail, true));
      contactEmails.push(normalizedEmail);
    }

    // Domain-matched emails not paired to any named representative (or,
    // for orgs with no `representatives` field at all, every matched
    // email) become anonymous, opted-out representative rows.
    for (let i = 0; i < candidates.length; i += 1) {
      if (matchedCandidateIndices.has(i)) continue;
      const { email } = candidates[i];
      const normalizedEmail = upsertUser({
        email,
        firstName: null,
        lastName: null,
        jobTitle: null,
        biography: null,
        linksJson: null,
      });
      claimedEmails.add(normalizedEmail);
      statements.push(buildOrganizationRepresentativeStatement(normalizedOrgName, normalizedEmail, false));
      contactEmails.push(normalizedEmail);
    }

    if (contactEmails[0])
      statements.push(
        buildRepresentativeRoleGrantStatement(normalizedOrgName, contactEmails[0], "role-primary_contact"),
      );
    if (contactEmails[1])
      statements.push(
        buildRepresentativeRoleGrantStatement(normalizedOrgName, contactEmails[1], "role-secondary_contact"),
      );

    report.totals.matchedOrgs += 1;
  }

  // ── Step 3: bare users for roster emails not attributable to any org ────

  // For every email that couldn't be reconciled to a YAML representative,
  // record which working-group roster CSV(s) it appears in — this is exactly
  // the manual-reconciliation signal staff need (an email with no name/org
  // attached, but a known set of WGs it belongs to) and previously wasn't
  // captured anywhere.
  function wgSlugsForEmail(email) {
    return Object.entries(wgRosters)
      .filter(([, roster]) => roster.has(email))
      .map(([slug]) => slug);
  }

  for (const [email] of pkicRoster.entries()) {
    if (claimedEmails.has(email)) continue;
    upsertUser({ email, firstName: null, lastName: null, jobTitle: null, biography: null, linksJson: null });
    report.bareRosterUsers.push({ email, workingGroups: wgSlugsForEmail(email) });
  }

  // Finding (this migration, not in the original): a meaningful
  // number of WG-roster subscribers never appear in csv/pkic.csv at all
  // (288 across the six WG CSVs in a 2026-07-26 dry run) — e.g. someone
  // unsubscribed from the main pkic@ list but stayed on a WG list, or the
  // exports were taken at slightly different times. This
  // only covers "CSV roster emails not attributable to any YAML
  // organization" sourced from pkic.csv, which would silently drop these
  // people's WG membership entirely (can only attach
  // working_group_members to a user row that already exists). We create a
  // bare user for them too, flagged separately in the report,
  // below has a user row to attach their WG membership to.
  for (const roster of Object.values(wgRosters)) {
    for (const [email] of roster.entries()) {
      if (claimedEmails.has(email) || createdUserEmails.has(email)) continue;
      upsertUser({ email, firstName: null, lastName: null, jobTitle: null, biography: null, linksJson: null });
      report.wgOnlyRosterUsers.push({ email, workingGroups: wgSlugsForEmail(email) });
    }
  }

  // ── Step 3b: working_group_members from the per-WG roster CSVs ─────────

  for (const [wgSlug, roster] of Object.entries(wgRosters)) {
    for (const [email] of roster.entries()) {
      if (!createdUserEmails.has(email)) continue; // not a user we created (shouldn't happen, defensive)
      report.workingGroupCounts[wgSlug] += 1;
      statements.push(buildWorkingGroupMemberStatement(wgSlug, email));
    }
  }

  // ── non-member sponsors (data/sponsors.yaml) ───────────────────
  // The one-time 2026-07-29 backfill only covered data/members/*.yaml's
  // `sponsor:` block (Step 3e above) — data/sponsors.yaml (companies that
  // sponsor without being a PKIC member, e.g. an event venue partner) was
  // never migrated, meaning those sponsors silently vanished the moment the
  // public sponsor display cut over to reading D1 (
  // "re-run/diff the backfill immediately before cutover").
  // Same NOT EXISTS-guarded, re-run-safe shape, just without an
  // organization_id (non_member_name identifies the sponsor instead).
  if (fs.existsSync(sponsorsYamlPath)) {
    const nonMemberSponsors = YAML.parse(fs.readFileSync(sponsorsYamlPath, "utf8")) ?? [];
    for (const entry of nonMemberSponsors) {
      const sponsorName = String(entry.name ?? "").trim();
      if (!sponsorName) continue;
      const website = entry.website ?? null;
      const sponsorSlug = urlizeName(sponsorName);

      let logoR2Key = null;
      if (uploadLogos && entry.logo) {
        const logoFile = path.join(SPONSOR_LOGO_DIR, entry.logo);
        if (fs.existsSync(logoFile)) {
          logoR2Key = `sponsor-logos/${sponsorSlug}/${path.basename(logoFile)}`;
          logoUploads.push({ slug: sponsorSlug, filePath: logoFile, r2Key: logoR2Key });
        }
      }

      const sponsor = entry.sponsor ?? {};
      const level = String(sponsor.level ?? "").trim();
      if (level) {
        statements.push(buildNonMemberConsortiumSponsorshipStatement(sponsorName, website, logoR2Key, level));
        report.nonMemberSponsorships.created += 1;
      }

      const sponsoring = sponsor.sponsoring;
      if (sponsoring && typeof sponsoring === "object") {
        for (const [eventName, eventSponsor] of Object.entries(sponsoring)) {
          const tier = String(eventSponsor?.level ?? "").trim();
          if (!tier) continue;
          const alias = EVENT_NAME_ALIASES[eventName];
          if (!alias) {
            report.nonMemberSponsorships.unmatchedEvents.push({ name: sponsorName, eventName, tier });
            continue;
          }
          statements.push(...buildNonMemberEventSponsorshipStatements(sponsorName, website, logoR2Key, alias, tier));
          report.nonMemberSponsorships.created += 1;
        }
      }
    }
  }

  return { sql: statements.join("\n"), report, logoUploads };
}

// ── Execution ────────────────────────────────────────────────────────────

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

export { buildMigration };

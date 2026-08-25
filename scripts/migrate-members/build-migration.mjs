/**
 * Orchestrator: loads YAML/CSV input, runs the category preflight, then
 * dispatches each record to the focused processing module that knows how
 * to turn it into statements (individuals.mjs / organizations.mjs /
 * roster-users.mjs / non-member-sponsors.mjs). This file owns file I/O,
 * iteration order, and the shared mutable `ctx` those modules write into
 * — it deliberately contains no business/mapping logic of its own beyond
 * wiring, so it stays a thin orchestration layer per scripts/AGENTS.md.
 */
import path from "node:path";
import { loadRosterCsv, loadMemberYamlFiles, activeRepresentatives } from "./parsers.mjs";
import { buildEmailsByDomain, candidateEmailsForDomains } from "./reconciliation.mjs";
import { buildUpsertUserStatement } from "./sql-renderer.mjs";
import { assertCategoriesValid, isIndividualMembershipCategory } from "./categories.mjs";
import { processIndividualRecord } from "./individuals.mjs";
import { processOrganizationRecord } from "./organizations.mjs";
import { processBareRosterUsers, processWorkingGroupMemberships } from "./roster-users.mjs";
import { processNonMemberSponsors } from "./non-member-sponsors.mjs";
import { WORKING_GROUP_CSVS } from "./constants.mjs";

const ROOT = process.cwd();
const MEMBERS_DIR = path.join(ROOT, "data", "members");
const CSV_DIR = path.join(ROOT, "csv");
const LOGO_DIR = path.join(ROOT, "assets", "images", "members");
const SPONSORS_YAML_PATH = path.join(ROOT, "data", "sponsors.yaml");
const SPONSOR_LOGO_DIR = path.join(ROOT, "assets", "images", "sponsors");

function emptyReport(yamlRecordCount) {
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      yamlFiles: yamlRecordCount,
      matchedOrgs: 0,
      sentinelIndividuals: 0,
      unmatched: [],
      missingCategory: [],
      ambiguousPairing: [],
    },
    needsEmailIndividuals: [],
    bareRosterUsers: [],
    wgOnlyRosterUsers: [],
    invalidLinks: [],
    unmatchedEventSponsorships: [],
    nonMemberSponsorships: { created: 0, unmatchedEvents: [] },
    workingGroupCounts: Object.fromEntries(Object.keys(WORKING_GROUP_CSVS).map((k) => [k, 0])),
  };
}

/**
 * Builds the full set of SQL statements plus a structured report, per the
 * reconciliation algorithm described in this script's header comment.
 */
export function buildMigration({
  uploadLogos,
  membersDir = MEMBERS_DIR,
  csvDir = CSV_DIR,
  logoDir = LOGO_DIR,
  sponsorsYamlPath = SPONSORS_YAML_PATH,
  sponsorLogoDir = SPONSOR_LOGO_DIR,
}) {
  const yamlRecords = loadMemberYamlFiles(membersDir);

  // Fail loudly, before generating any SQL, on a missing/unknown/
  // kind-incompatible category — see categories.mjs.
  assertCategoriesValid(yamlRecords);

  const pkicRoster = loadRosterCsv(path.join(csvDir, "pkic.csv"));
  const wgRosters = {};
  for (const [slug, filename] of Object.entries(WORKING_GROUP_CSVS)) {
    wgRosters[slug] = loadRosterCsv(path.join(csvDir, filename));
  }

  // Domain-based org matching (Step 2 representative pairing, and the
  // "leftover matched candidates become anonymous org members" fallback)
  // draws candidates from every roster we have, not just pkic.csv — a
  // representative or subscriber can appear only on a working-group list
  // (e.g. csv/ca.csv) and never on the main pkic@ list, but their email
  // still domain-matches their organization's `organizationDomains` and
  // should be attributed to it instead of silently ending up an org-less
  // bare/WG-only user.
  const combinedRoster = new Map(pkicRoster);
  for (const roster of Object.values(wgRosters)) {
    for (const [email, meta] of roster.entries()) {
      if (!combinedRoster.has(email)) combinedRoster.set(email, meta);
    }
  }
  const emailsByDomain = buildEmailsByDomain(combinedRoster);

  const ctx = {
    uploadLogos,
    logoDir,
    statements: ["PRAGMA foreign_keys = ON;"],
    logoUploads: [], // { slug, filePath, r2Key }
    claimedEmails: new Set(),
    createdUserEmails: new Set(), // every email we insert a `users` row for
    report: emptyReport(yamlRecords.length),
    upsertUser(input) {
      const { statement, normalizedEmail } = buildUpsertUserStatement(input);
      this.statements.push(statement);
      this.createdUserEmails.add(normalizedEmail);
      return normalizedEmail;
    },
  };

  // ── Step 2: organizations + representatives, or org-less individuals ───
  for (const { filename, slug, doc } of yamlRecords) {
    const name = String(doc.name ?? slug).trim();
    const memberType = String(doc.memberType ?? "").trim();
    const domains = Array.isArray(doc.organizationDomains) ? doc.organizationDomains.filter(Boolean) : [];
    const reps = activeRepresentatives(doc);
    const candidates = candidateEmailsForDomains(domains, emailsByDomain);

    if (isIndividualMembershipCategory(memberType)) {
      processIndividualRecord(ctx, { filename, slug, doc, name, memberType, domains, candidates });
    } else {
      processOrganizationRecord(ctx, { filename, slug, doc, name, memberType, domains, reps, candidates });
    }
  }

  // ── Step 3 / 3b: bare roster users + canonical group memberships ──────
  processBareRosterUsers(ctx, { pkicRoster, wgRosters });
  processWorkingGroupMemberships(ctx, { wgRosters });

  // ── non-member sponsors (data/sponsors.yaml) ────────────────────────────
  processNonMemberSponsors(ctx, { sponsorsYamlPath, sponsorLogoDir });

  return { sql: ctx.statements.join("\n"), report: ctx.report, logoUploads: ctx.logoUploads };
}

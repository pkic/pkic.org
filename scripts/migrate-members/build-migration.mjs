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
import fs from "node:fs";
import { loadRosterCsv, loadMemberYamlFiles, activeRepresentatives } from "./parsers.mjs";
import { buildEmailsByDomain, candidateEmailsForDomains } from "./reconciliation.mjs";
import { buildAutomaticEnrollmentStatement, buildUpsertUserStatements } from "./sql-renderer.mjs";
import { assertCategoriesValid, isIndividualMembershipCategory } from "./categories.mjs";
import { processIndividualRecord } from "./individuals.mjs";
import { processOrganizationRecord } from "./organizations.mjs";
import { processBareRosterUsers, processGroupMemberships } from "./roster-users.mjs";
import { processNonMemberSponsors } from "./non-member-sponsors.mjs";
import { legacyEventFormPlacementSql, legacyEventOwnershipSql } from "./event-ownership.mjs";
import { loadManualMappings, reconcileManualRecord } from "./manual-mapping.mjs";
import { buildPlaceholderEmailStatement } from "./placeholder-email.mjs";
import { GROUP_ROSTER_CSVS } from "./constants.mjs";

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
      organizations: 0,
      sentinelIndividuals: 0,
      unmatched: [],
      missingCategory: [],
      ambiguousPairing: [],
    },
    manualMappings: [],
    needsEmailIndividuals: [],
    bareRosterUsers: [],
    groupOnlyRosterUsers: [],
    invalidLinks: [],
    unmatchedEventSponsorships: [],
    // Filled in after the SQL is applied, by the entry point's reservation
    // check; stays null when nothing was applied (--dry-run) so the report
    // never presents "not checked" as "nothing found".
    emailReservationConflicts: null,
    nonMemberSponsorships: { created: 0, unmatchedEvents: [] },
    groupRosterCounts: Object.fromEntries(Object.keys(GROUP_ROSTER_CSVS).map((k) => [k, 0])),
    missingOptionalRosters: [],
  };
}

/**
 * Builds the full set of SQL statements plus a structured report, per the
 * reconciliation algorithm described in this script's header comment.
 */
export function buildMigration({
  uploadLogos,
  rosterTimeZone,
  manualMappingPath = "",
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
  const manualMappings = loadManualMappings(manualMappingPath, yamlRecords);

  const pkicRoster = loadRosterCsv(path.join(csvDir, "pkic.csv"));
  const groupRosters = {};
  const missingOptionalRosters = [];
  for (const [slug, source] of Object.entries(GROUP_ROSTER_CSVS)) {
    const filePath = path.join(csvDir, source.filename);
    if (source.optional && !fs.existsSync(filePath)) {
      missingOptionalRosters.push(source.filename);
      continue;
    }
    groupRosters[slug] = loadRosterCsv(filePath, { allowEmpty: true });
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
  for (const roster of Object.values(groupRosters)) {
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
    importedEmails: new Set(), // every address this import expects an account behind
    report: { ...emptyReport(yamlRecords.length), rosterUsers: combinedRoster.size, missingOptionalRosters },
    upsertUser(input) {
      const { statements, normalizedEmail } = buildUpsertUserStatements(input);
      this.statements.push(...statements);
      this.importedEmails.add(normalizedEmail);
      return normalizedEmail;
    },
  };

  ctx.report.manualMappings = [...manualMappings.values()].flat().map((row) => ({
    file: row.source_file,
    name: row.representative_name,
    decision: row.decision,
    email: row.decision === "confirmed" ? row.confirmed_email : null,
    previousEmail: row.current_or_placeholder_email,
    notes: row.notes,
  }));
  const placeholderMappings = ctx.report.manualMappings.filter(
    (row) => row.decision === "confirmed" && row.previousEmail.endsWith("@members.invalid"),
  );
  ctx.statements.push(...placeholderMappings.map(buildPlaceholderEmailStatement));

  // ── Step 2: organizations + identities, or org-less individuals ────────
  for (const { filename, slug, doc } of yamlRecords) {
    const name = String(doc.name ?? slug).trim();
    const memberType = String(doc.memberType ?? "").trim();
    const mappings = manualMappings.get(filename) ?? [];
    const domains =
      mappings.find((row) => row.domains.length)?.domains ??
      (Array.isArray(doc.organizationDomains) ? doc.organizationDomains.filter(Boolean) : []);
    const { reps, candidates } = reconcileManualRecord({
      reps: activeRepresentatives(doc),
      candidates: candidateEmailsForDomains(domains, emailsByDomain),
      mappings,
    });

    if (isIndividualMembershipCategory(memberType)) {
      const confirmed = mappings.find((row) => row.decision === "confirmed");
      processIndividualRecord(ctx, {
        filename,
        slug,
        doc,
        name,
        memberType,
        domains,
        confirmedEmail: confirmed?.confirmed_email,
        candidates: mappings.length ? (confirmed ? [{ email: confirmed.confirmed_email }] : []) : candidates,
      });
    } else {
      processOrganizationRecord(ctx, { filename, slug, doc, name, memberType, domains, reps, candidates, mappings });
    }
  }

  // ── Step 3 / 3b: bare roster users + canonical group memberships ──────
  processBareRosterUsers(ctx, { pkicRoster, groupRosters });
  processGroupMemberships(ctx, { groupRosters, rosterTimeZone });

  // ── non-member sponsors (data/sponsors.yaml) ────────────────────────────
  processNonMemberSponsors(ctx, { sponsorsYamlPath, sponsorLogoDir });

  ctx.statements.push(legacyEventOwnershipSql());
  ctx.statements.push(legacyEventFormPlacementSql());
  // Last, once every capacity above exists: the memberships the portal's
  // automatic enrollment would have written as those capacities were created.
  ctx.statements.push(buildAutomaticEnrollmentStatement());
  return {
    placeholderMappings,
    sql: ctx.statements.join("\n"),
    report: ctx.report,
    logoUploads: ctx.logoUploads,
    // Every address this import expects a live account behind, so the
    // caller can check them against the reservations the target database
    // actually holds — see migrate-members/email-reservations.mjs.
    importedEmails: [...ctx.importedEmails],
  };
}

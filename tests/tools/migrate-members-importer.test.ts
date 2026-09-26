/**
 * P2-01 fresh-D1 execution smoke test (scripts/AGENTS.md: "Generated SQL
 * requires a fresh-D1 execution smoke test"). Runs under vitest.config.tools.ts
 * (plain Node, not the Workers sandbox) because it shells out to the real
 * `wrangler` CLI — the same code path scripts/migrate-members-yaml-to-d1.mjs
 * itself uses (runWranglerD1) — against a disposable local D1 instance:
 *
 *   1. Build a tiny synthetic member-directory fixture (org-tied + org-less
 *      individual + a roster CSV) — never the real `csv/`/`data/members`
 *      trees, which carry real people's emails and are intentionally
 *      untracked (AGENTS.md: never move production personal data into a
 *      shared/preview environment, and CI has no `csv/` at all).
 *   2. Call `buildMigration` directly (pure, in-process) to generate SQL.
 *   3. Apply the complete migration set to an empty local D1.
 *   4. Execute the generated SQL against it via `wrangler d1 execute --file`.
 *   5. Assert no missing-column/table errors, and spot-check the rows that
 *      landed match the final schema (organization_domain_claims,
 *      member_category_assignments, identities,
 *      role-primary_contact, groups, group_memberships) — the exact shapes 0033-era intermediate
 *      columns (social_*, organizations.membership_category,
 *      primary_contact_user_id) no longer exist to write to.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMigration } from "../../scripts/migrate-members-yaml-to-d1.mjs";
import {
  EMAIL_RESERVATION_QUERY,
  findEmailReservationConflicts,
} from "../../scripts/migrate-members/email-reservations.mjs";

import { placeholderPreflightQuery } from "../../scripts/migrate-members/placeholder-email.mjs";

const ROOT = path.resolve(__dirname, "..", "..");

function writeFixtureRosterCsv(filePath: string, rows: string[][]): void {
  const lines = [
    "Members for group fixture",
    "Email,Nickname,Col3,Col4,Col5,Col6,Year,Month,Day,Hour,Minute,Second",
    ...rows.map((fields) => fields.join(",")),
  ];
  fs.writeFileSync(filePath, `\uFEFF${lines.join("\r\n").replaceAll(",", "\t")}\r\n`, "utf16le");
}

function createImporterFixture(tmpDirs: string[]) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-importer-fixture-"));
  tmpDirs.push(fixtureRoot);
  const membersDir = path.join(fixtureRoot, "members");
  const csvDir = path.join(fixtureRoot, "csv");
  fs.mkdirSync(membersDir);
  fs.mkdirSync(csvDir);
  return {
    fixtureRoot,
    membersDir,
    csvDir,
    sponsorsYamlPath: path.join(fixtureRoot, "sponsors-does-not-exist.yaml"),
  };
}

function writeFixtureRosters(
  csvDir: string,
  primaryRows: string[][],
  workingGroupRows = new Map<string, string[][]>(),
) {
  writeFixtureRosterCsv(path.join(csvDir, "pkic.csv"), primaryRows);
  for (const slug of ["ca", "cbom", "cm", "pkimm", "pqc", "tcwg"]) {
    writeFixtureRosterCsv(path.join(csvDir, `${slug}.csv`), workingGroupRows.get(slug) ?? []);
  }
}

function runWrangler(args: string[]): string {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

interface D1QueryResult {
  results: Record<string, unknown>[];
}

function queryD1(persistTo: string, sql: string): Record<string, unknown>[] {
  return queryD1Batch(persistTo, [sql])[0]!;
}

// Each CLI invocation starts workerd. Collect independent assertions in one
// invocation while keeping execution on real D1 and preserving every result.
function queryD1Batch(persistTo: string, queries: string[]): Record<string, unknown>[][] {
  const raw = runWrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    "local",
    "--local",
    "--persist-to",
    persistTo,
    "--json",
    "--command",
    queries.join(";\n"),
  ]);
  const parsed = JSON.parse(raw) as D1QueryResult[];
  expect(parsed).toHaveLength(queries.length);
  return parsed.map((result) => result.results);
}

describe("migrate-members-yaml-to-d1 importer — fresh-D1 execution smoke test", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies the full migration set, then executes the generated import SQL with no missing-column/table errors", () => {
    const { fixtureRoot, membersDir, csvDir, sponsorsYamlPath } = createImporterFixture(tmpDirs);

    // Org-tied member: exercises organizations, organization_domain_claims, the
    // members aggregate + member_category_assignments, users,
    // identities, and the role-primary_contact grant.
    fs.writeFileSync(
      path.join(membersDir, "acme.yaml"),
      `id: acme
name: Acme Corp
memberType: A
organizationDomains:
  - acme.example
memberSince: "2020-01-01"
description: "A test organization; with a semicolon in its description."
website: https://acme.example
social:
  linkedin: https://linkedin.com/company/acme
representatives:
  - name: Alice Anderson
    role: CEO
    social:
      linkedin: https://linkedin.com/in/alice-anderson
`,
      "utf8",
    );

    // Org-less individual with no domain-matched roster email: exercises
    // the sentinel-email path (members.member_type='individual').
    fs.writeFileSync(
      path.join(membersDir, "bob.yaml"),
      `id: bob
name: Bob Individual
memberType: H5
`,
      "utf8",
    );

    writeFixtureRosters(csvDir, [
      ["alice@acme.example", "Alice", "x", "x", "x", "x", "2023", "01", "15", "10", "00", "00"],
    ]);

    const { sql, report } = buildMigration({
      uploadLogos: false,
      rosterTimeZone: "Europe/Tallinn",
      membersDir,
      csvDir,
      sponsorsYamlPath,
    });

    expect(report.totals.matchedOrgs).toBe(1);
    expect(report.totals.sentinelIndividuals).toBe(1);

    const sqlFile = path.join(fixtureRoot, "import.sql");
    fs.writeFileSync(sqlFile, sql, "utf8");

    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-importer-d1-"));
    tmpDirs.push(persistTo);

    runWrangler(["d1", "migrations", "apply", "DB", "--env", "local", "--local", "--persist-to", persistTo]);

    queryD1(
      persistTo,
      `INSERT INTO events (id, slug, name, timezone, created_at, updated_at)
      VALUES ('10000000-0000-4000-8000-000000000081', 'pqc-conference-amsterdam-nl', 'PQC conference', 'Europe/Amsterdam',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );

    // The assertion that matters: this must not throw. A schema mismatch
    // (e.g. a dropped social_* column or organizations.membership_category
    // reintroduced by a regression) surfaces here as a non-zero exit from
    // wrangler ("no such column"/"no such table"), which execFileSync
    // turns into a thrown error and fails the test.
    expect(() =>
      runWrangler(["d1", "execute", "DB", "--env", "local", "--local", "--persist-to", persistTo, "--file", sqlFile]),
    ).not.toThrow();

    const [
      events,
      orgs,
      domains,
      memberAggregates,
      categoryAssignments,
      identities,
      importedUserProfile,
      primaryContactGrants,
      sentinelUser,
      foreignKeyViolations,
    ] = queryD1Batch(persistTo, [
      `SELECT g.slug, e.profile_key FROM events e JOIN groups g ON g.id = e.owner_group_id
        WHERE e.slug = 'pqc-conference-amsterdam-nl'`,
      "SELECT id, normalized_name, links_json FROM organizations",
      "SELECT domain FROM organization_domain_claims",
      "SELECT member_type, member_since FROM members ORDER BY member_type",
      "SELECT category_code FROM member_category_assignments ORDER BY category_code",
      `SELECT show_on_organization_profile, job_title, biography, links_json FROM identities
        WHERE organization_id IS NOT NULL`,
      "SELECT job_title, biography, links_json FROM users WHERE email = 'alice@acme.example'",
      "SELECT role_id, single_holder_per_context FROM user_roles WHERE role_id = 'role-primary_contact'",
      "SELECT email FROM users WHERE email = 'unmatched-bob@members.invalid'",
      "PRAGMA foreign_key_check",
    ]);
    expect(events).toEqual([{ slug: "pqc", profile_key: "conference" }]);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.links_json).toBe(JSON.stringify(["https://linkedin.com/company/acme"]));

    expect(domains.map((r) => r.domain)).toEqual(["acme.example"]);

    expect(memberAggregates).toHaveLength(2);
    expect(memberAggregates[0]).toMatchObject({ member_type: "individual" });
    expect(memberAggregates[1]).toMatchObject({ member_type: "organization", member_since: "2020-01-01" });

    expect(categoryAssignments.map((r) => r.category_code)).toEqual(["A", "H5"]);

    expect(identities).toHaveLength(1);
    expect(identities[0]).toMatchObject({
      show_on_organization_profile: 1,
      job_title: "CEO",
      biography: null,
      links_json: JSON.stringify(["https://linkedin.com/in/alice-anderson"]),
    });
    expect(importedUserProfile).toEqual([{ job_title: null, biography: null, links_json: null }]);

    expect(primaryContactGrants).toHaveLength(1);
    expect(primaryContactGrants[0]).toMatchObject({ single_holder_per_context: 1 });

    // No `unmatched-bob@members.invalid`-style row lacks its sentinel user.
    expect(sentinelUser).toHaveLength(1);

    expect(foreignKeyViolations).toEqual([]);

    // Approved reconciliation upgrades the existing placeholder in place and
    // adds an organization user whose email cannot be discovered by domain.
    const manualMappingPath = path.join(csvDir, "manual-mapping.csv");
    fs.writeFileSync(
      manualMappingPath,
      [
        "source_file,organization,representative_name,current_or_placeholder_email,confirmed_email,corrected_domains,decision,notes",
        "acme.yaml,Acme Corp,Alice Anderson,,alice@acme.example,,confirmed,",
        "acme.yaml,Acme Corp,Charlie User,,charlie@users.example,,confirmed,",
        "bob.yaml,N/A (individual member),Bob Individual,unmatched-bob@members.invalid,bob@users.example,,confirmed,",
      ].join("\n"),
    );
    const before = queryD1(
      persistTo,
      "SELECT id FROM users WHERE normalized_email = 'unmatched-bob@members.invalid'",
    )[0]!.id;
    const mapped = buildMigration({
      uploadLogos: false,
      rosterTimeZone: "Europe/Tallinn",
      membersDir,
      csvDir,
      sponsorsYamlPath,
      manualMappingPath,
    });
    expect(mapped.report.totals.sentinelIndividuals).toBe(0);
    expect(mapped.report.manualMappings).toHaveLength(3);
    expect(queryD1(persistTo, placeholderPreflightQuery(mapped.placeholderMappings)!)).toEqual([]);
    fs.writeFileSync(sqlFile, mapped.sql);
    const applyMapped = () =>
      runWrangler(["d1", "execute", "DB", "--env", "local", "--local", "--persist-to", persistTo, "--file", sqlFile]);
    applyMapped();
    const snapshot = () =>
      queryD1(
        persistTo,
        `SELECT u.id, u.normalized_email, i.id AS identity_id, m.id AS member_id
      FROM users u JOIN identities i ON i.user_id = u.id
      LEFT JOIN members m ON m.user_id = u.id
      ORDER BY u.normalized_email`,
      );
    const first = snapshot();
    expect(first.find((row) => row.normalized_email === "bob@users.example")!.id).toBe(before);
    expect(first.some((row) => row.normalized_email === "charlie@users.example")).toBe(true);
    expect(first.some((row) => String(row.normalized_email).endsWith("@members.invalid"))).toBe(false);
    applyMapped();
    expect(snapshot()).toEqual(first);
    expect(queryD1(persistTo, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("rejects the entire import — no SQL generated at all — when any record has a missing or unknown category", () => {
    const { membersDir, csvDir, sponsorsYamlPath } = createImporterFixture(tmpDirs);

    // One perfectly valid org, one with no memberType at all — the whole
    // batch must be rejected, not just the bad record silently dropped or
    // silently imported with a null category (PR #1 review blocker 1).
    fs.writeFileSync(
      path.join(membersDir, "acme.yaml"),
      `id: acme\nname: Acme Corp\nmemberType: A\norganizationDomains:\n  - acme.example\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(membersDir, "no-category.yaml"), `id: no-category\nname: No Category Inc\n`, "utf8");

    writeFixtureRosters(csvDir, []);

    expect(() =>
      buildMigration({
        uploadLogos: false,
        rosterTimeZone: "Europe/Tallinn",
        membersDir,
        csvDir,
        sponsorsYamlPath,
      }),
    ).toThrowError(/Category preflight failed: 1 record\(s\) rejected\. No SQL was generated\./);
  });

  it("imports the rest of the directory when an address is reserved elsewhere, and attaches an alternate address to its owner", () => {
    // A production database reserves addresses the member directory also
    // lists: an unconfirmed pending email change claims one without owning
    // it, and an alternate address owns one on an account whose login is a
    // different address. `trg_users_primary_email_reservation_insert` aborts
    // an upsert across either claim, which failed the whole import file with
    // EMAIL_TAKEN (SQLITE_CONSTRAINT_TRIGGER) — one reserved address must
    // cost one reported record, never the migration.
    const { fixtureRoot, membersDir, csvDir, sponsorsYamlPath } = createImporterFixture(tmpDirs);

    fs.writeFileSync(
      path.join(membersDir, "acme.yaml"),
      `id: acme
name: Acme Corp
memberType: A
organizationDomains:
  - acme.example
representatives:
  - name: Alice Anderson
    role: CEO
  - name: Carol Contact
    role: COO
`,
      "utf8",
    );

    const alice = ["alice@acme.example", "Alice", "x", "x", "x", "x", "2023", "01", "15", "10", "00", "00"];
    const carol = ["carol@acme.example", "Carol", "x", "x", "x", "x", "2023", "01", "16", "10", "00", "00"];
    writeFixtureRosters(csvDir, [alice, carol]);

    const { sql, importedEmails } = buildMigration({
      uploadLogos: false,
      rosterTimeZone: "Europe/Tallinn",
      membersDir,
      csvDir,
      sponsorsYamlPath,
    });
    const sqlFile = path.join(fixtureRoot, "import.sql");
    fs.writeFileSync(sqlFile, sql, "utf8");

    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-importer-d1-reservations-"));
    tmpDirs.push(persistTo);
    runWrangler(["d1", "migrations", "apply", "DB", "--env", "local", "--local", "--persist-to", persistTo]);

    // alice@acme.example: claimed by another account's in-flight email change.
    // carol@acme.example: already an alternate address of a live account
    // whose login address is a different one.
    queryD1Batch(persistTo, [
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at, pending_email)
       VALUES ('20000000-0000-4000-8000-000000000001', 'old@example.org', 'old@example.org', 'user', 1,
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'alice@acme.example')`,
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES ('20000000-0000-4000-8000-000000000002', 'carol@other.example', 'carol@other.example', 'user', 1,
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at)
       VALUES ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002',
               'carol@acme.example', 'carol@acme.example', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ]);

    expect(() =>
      runWrangler(["d1", "execute", "DB", "--env", "local", "--local", "--persist-to", persistTo, "--file", sqlFile]),
    ).not.toThrow();

    // The reserved address stays reserved: no second account claims it, and
    // the account holding it keeps its own login address.
    const [
      aliceAccounts,
      pendingEmail,
      carolAccounts,
      organizationIdentities,
      roles,
      organizations,
      reservations,
      foreignKeyViolations,
    ] = queryD1Batch(persistTo, [
      "SELECT id FROM users WHERE normalized_email = 'alice@acme.example'",
      "SELECT pending_email FROM users WHERE id = '20000000-0000-4000-8000-000000000001'",
      "SELECT id FROM users WHERE normalized_email = 'carol@acme.example'",
      `SELECT i.user_id AS user_id, i.job_title FROM identities i
         JOIN users u ON u.id = i.user_id WHERE i.organization_id IS NOT NULL`,
      "SELECT role_id, user_id FROM user_roles WHERE context_type = 'organization'",
      "SELECT normalized_name FROM organizations",
      EMAIL_RESERVATION_QUERY,
      "PRAGMA foreign_key_check",
    ]);
    expect(aliceAccounts).toEqual([]);
    expect(pendingEmail).toEqual([{ pending_email: "alice@acme.example" }]);

    // The alternate address belongs to a person who already has an account,
    // so the organization identity and role attach to that account instead
    // of to a duplicate one.
    expect(carolAccounts).toEqual([]);
    expect(organizationIdentities).toEqual([{ user_id: "20000000-0000-4000-8000-000000000002", job_title: "COO" }]);
    // Carol is the second representative, so she holds the secondary
    // contact role; the primary contact grant belongs to Alice and stays
    // ungranted along with her account.
    expect(roles).toEqual([{ role_id: "role-secondary_contact", user_id: "20000000-0000-4000-8000-000000000002" }]);

    // The organization itself imported, so one reserved address cost one
    // representative, not the batch.
    expect(organizations).toEqual([{ normalized_name: "acme corp" }]);

    // And the address that got no account is reported, by address and holder.
    expect(findEmailReservationConflicts(importedEmails, reservations)).toEqual([
      { email: "alice@acme.example", reservedBy: "old@example.org", reason: "pending_email_change" },
    ]);
    expect(foreignKeyViolations).toEqual([]);
  });

  it("is idempotent: running the generated SQL twice against the same D1 produces identical row counts and identities", () => {
    const { fixtureRoot, membersDir, csvDir, sponsorsYamlPath } = createImporterFixture(tmpDirs);

    // Org-tied member with two representatives (primary + secondary
    // contact roles), a consortium sponsorship, and an event sponsorship
    // against a known EVENT_NAME_ALIASES entry — exercises every table
    // this migration writes to, so a rerun exercising the same rows is a
    // meaningful idempotency check, not just "no duplicate orgs".
    fs.writeFileSync(
      path.join(membersDir, "acme.yaml"),
      `id: acme
name: Acme Corp
memberType: A
organizationDomains:
  - acme.example
memberSince: "2020-01-01"
description: "A test organization."
website: https://acme.example
representatives:
  - name: Alice Anderson
    role: CEO
  - name: Carol Contact
    role: COO
sponsor:
  level: gold
  since: "2021-01-01"
  sponsoring:
    Post-Quantum Cryptography Conference Amsterdam 2023:
      level: silver
`,
      "utf8",
    );
    fs.writeFileSync(path.join(membersDir, "bob.yaml"), `id: bob\nname: Bob Individual\nmemberType: H5\n`, "utf8");
    fs.writeFileSync(
      sponsorsYamlPath,
      `- name: Venue Partner
  website: https://venue.example
  sponsor:
    sponsoring:
      Post-Quantum Cryptography Conference Amsterdam 2023:
        level: Ambassador
- name: Legacy Non-Sponsor
  website: https://not-a-sponsor.example
  sponsor:
    level: none
`,
      "utf8",
    );

    const alice = ["alice@acme.example", "Alice", "x", "x", "x", "x", "2023", "01", "15", "10", "00", "00"];
    const carol = ["carol@acme.example", "Carol", "x", "x", "x", "x", "2023", "01", "16", "10", "00", "00"];
    const unresolved = [
      "unresolved@example.test",
      "Unresolved",
      "x",
      "x",
      "x",
      "x",
      "2023",
      "01",
      "17",
      "10",
      "00",
      "00",
    ];
    writeFixtureRosters(csvDir, [alice, carol], new Map([["ca", [alice, unresolved]]]));
    writeFixtureRosterCsv(path.join(csvDir, "board.csv"), [carol]);
    writeFixtureRosterCsv(path.join(csvDir, "ec.csv"), [alice, unresolved]);

    const { sql, report } = buildMigration({
      uploadLogos: false,
      rosterTimeZone: "Europe/Tallinn",
      membersDir,
      csvDir,
      sponsorsYamlPath,
    });
    expect(report.groupOnlyRosterUsers).toContainEqual({
      email: "unresolved@example.test",
      groups: ["ca", "executive-council"],
    });
    expect(report.missingOptionalRosters).toEqual([]);
    expect(report.nonMemberSponsorships).toEqual({ created: 1, unmatchedEvents: [] });
    expect(sql).toContain("INSERT OR IGNORE INTO group_memberships");
    expect(sql).not.toMatch(/\bworking_group_members\b/);
    expect(sql).not.toMatch(/\bworking_groups\b/);
    const sqlFile = path.join(fixtureRoot, "import.sql");
    fs.writeFileSync(sqlFile, sql, "utf8");

    const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-importer-d1-idempotency-"));
    tmpDirs.push(persistTo);
    runWrangler(["d1", "migrations", "apply", "DB", "--env", "local", "--local", "--persist-to", persistTo]);

    function runImport(): void {
      runWrangler(["d1", "execute", "DB", "--env", "local", "--local", "--persist-to", persistTo, "--file", sqlFile]);
    }

    function snapshot(): Record<string, Record<string, unknown>[]> {
      const queries = {
        organizations: "SELECT id, normalized_name FROM organizations ORDER BY normalized_name",
        members: "SELECT id, member_type, organization_id, user_id FROM members ORDER BY id",
        categoryAssignments: "SELECT member_id, category_code FROM member_category_assignments ORDER BY member_id",
        identities: "SELECT id, organization_id, user_id FROM identities ORDER BY id",
        roles:
          "SELECT id, user_id, role_id, context_id FROM user_roles WHERE context_type = 'organization' ORDER BY id",
        sponsorships: "SELECT id, sponsor_type, organization_id, event_id, tier FROM sponsorships ORDER BY id",
        groupMemberships:
          "SELECT id, group_id, user_id, member_id, source, joined_at FROM group_memberships ORDER BY id",
      };
      const results = queryD1Batch(persistTo, Object.values(queries));
      return Object.fromEntries(Object.keys(queries).map((name, index) => [name, results[index]!]));
    }

    runImport();
    const first = snapshot();

    // Sanity: the fixture actually exercised every table being compared —
    // an idempotency check over all-empty tables would be vacuous.
    expect(first.organizations).toHaveLength(1);
    expect(first.members).toHaveLength(2);
    expect(first.categoryAssignments).toHaveLength(2);
    expect(first.identities).toHaveLength(3); // two organization identities + one individual identity
    expect(first.roles.length).toBeGreaterThanOrEqual(2); // primary + secondary contact
    expect(first.sponsorships).toHaveLength(3); // member consortium + member event + non-member event
    expect(first.sponsorships.some((row) => String(row.tier).toLowerCase() === "none")).toBe(false);
    // One membership from the working-group roster; the rest are the
    // automatic enrollments the portal would have written as each capacity
    // was created — the community group's category rules seat every member.
    const rosterMemberships = first.groupMemberships.filter((row) => row.source === "migration");
    expect(
      rosterMemberships.every(
        (row) => String(row.joined_at).startsWith("2023-01-") && String(row.joined_at).endsWith("T08:00:00.000Z"),
      ),
    ).toBe(true);
    expect(rosterMemberships).toHaveLength(3);
    expect(
      queryD1(
        persistTo,
        "SELECT g.slug FROM group_memberships gm JOIN groups g ON g.id = gm.group_id WHERE gm.source = 'migration' ORDER BY g.slug",
      ),
    ).toEqual([{ slug: "board" }, { slug: "ca" }, { slug: "executive-council" }]);
    expect(first.groupMemberships.filter((row) => row.source === "automatic_policy").length).toBeGreaterThan(0);
    const enrolledIdentity = first.identities.find((identity) => identity.user_id === rosterMemberships[0]!.user_id);
    expect(enrolledIdentity).toBeDefined();
    expect(
      queryD1(
        persistTo,
        `SELECT member_id FROM identity_member_capacities WHERE identity_id = '${String(enrolledIdentity!.id)}'`,
      )[0]!.member_id,
    ).toBe(rosterMemberships[0]!.member_id);
    expect(queryD1(persistTo, "SELECT id FROM users WHERE normalized_email = 'unresolved@example.test'")).toHaveLength(
      1,
    );
    expect(
      queryD1(
        persistTo,
        `SELECT gm.id FROM group_memberships gm
          JOIN users u ON u.id = gm.user_id
         WHERE u.normalized_email = 'unresolved@example.test'`,
      ),
    ).toEqual([]);

    runImport();
    const second = snapshot();

    expect(second).toEqual(first);
    expect(queryD1(persistTo, "PRAGMA foreign_key_check")).toEqual([]);
  });
});

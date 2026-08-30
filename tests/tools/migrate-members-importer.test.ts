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
 *      member_category_assignments, organization_representatives,
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

const ROOT = path.resolve(__dirname, "..", "..");

function writeFixtureRosterCsv(filePath: string, rows: string[][]): void {
  const lines = [
    "Members for group fixture",
    "Email,Nickname,Col3,Col4,Col5,Col6,Year,Month,Day,Hour,Minute,Second",
    ...rows.map((fields) => fields.join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
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
    sql,
  ]);
  const parsed = JSON.parse(raw) as D1QueryResult[];
  return parsed[0]?.results ?? [];
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
    // organization_representatives, and the role-primary_contact grant.
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

    // The assertion that matters: this must not throw. A schema mismatch
    // (e.g. a dropped social_* column or organizations.membership_category
    // reintroduced by a regression) surfaces here as a non-zero exit from
    // wrangler ("no such column"/"no such table"), which execFileSync
    // turns into a thrown error and fails the test.
    expect(() =>
      runWrangler(["d1", "execute", "DB", "--env", "local", "--local", "--persist-to", persistTo, "--file", sqlFile]),
    ).not.toThrow();

    const orgs = queryD1(persistTo, "SELECT id, normalized_name, links_json FROM organizations");
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.links_json).toBe(JSON.stringify(["https://linkedin.com/company/acme"]));

    const domains = queryD1(persistTo, "SELECT domain FROM organization_domain_claims");
    expect(domains.map((r) => r.domain)).toEqual(["acme.example"]);

    const memberAggregates = queryD1(persistTo, "SELECT member_type, member_since FROM members ORDER BY member_type");
    expect(memberAggregates).toHaveLength(2);
    expect(memberAggregates[0]).toMatchObject({ member_type: "individual" });
    expect(memberAggregates[1]).toMatchObject({ member_type: "organization", member_since: "2020-01-01" });

    const categoryAssignments = queryD1(
      persistTo,
      "SELECT category_code FROM member_category_assignments ORDER BY category_code",
    );
    expect(categoryAssignments.map((r) => r.category_code)).toEqual(["A", "H5"]);

    const representatives = queryD1(persistTo, `SELECT show_on_org_profile FROM organization_representatives`);
    expect(representatives).toHaveLength(1);
    expect(representatives[0]).toMatchObject({ show_on_org_profile: 1 });

    const primaryContactGrants = queryD1(
      persistTo,
      `SELECT role_id, single_holder_per_context FROM user_roles WHERE role_id = 'role-primary_contact'`,
    );
    expect(primaryContactGrants).toHaveLength(1);
    expect(primaryContactGrants[0]).toMatchObject({ single_holder_per_context: 1 });

    // No `unmatched-bob@members.invalid`-style row lacks its sentinel user.
    const sentinelUser = queryD1(persistTo, "SELECT email FROM users WHERE email = 'unmatched-bob@members.invalid'");
    expect(sentinelUser).toHaveLength(1);

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
        membersDir,
        csvDir,
        sponsorsYamlPath,
      }),
    ).toThrowError(/Category preflight failed: 1 record\(s\) rejected\. No SQL was generated\./);
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

    const { sql, report } = buildMigration({
      uploadLogos: false,
      membersDir,
      csvDir,
      sponsorsYamlPath,
    });
    expect(report.wgOnlyRosterUsers).toContainEqual({ email: "unresolved@example.test", workingGroups: ["ca"] });
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
      return {
        organizations: queryD1(persistTo, "SELECT id, normalized_name FROM organizations ORDER BY normalized_name"),
        members: queryD1(persistTo, "SELECT id, member_type, organization_id, user_id FROM members ORDER BY id"),
        categoryAssignments: queryD1(
          persistTo,
          "SELECT member_id, category_code FROM member_category_assignments ORDER BY member_id",
        ),
        representatives: queryD1(
          persistTo,
          "SELECT id, member_id, user_id FROM organization_representatives ORDER BY id",
        ),
        roles: queryD1(
          persistTo,
          "SELECT id, user_id, role_id, context_id FROM user_roles WHERE context_type = 'organization' ORDER BY id",
        ),
        sponsorships: queryD1(
          persistTo,
          "SELECT id, sponsor_type, organization_id, event_id, tier FROM sponsorships ORDER BY id",
        ),
        groupMemberships: queryD1(
          persistTo,
          "SELECT id, group_id, user_id, member_id, source FROM group_memberships ORDER BY id",
        ),
      };
    }

    runImport();
    const first = snapshot();

    // Sanity: the fixture actually exercised every table being compared —
    // an idempotency check over all-empty tables would be vacuous.
    expect(first.organizations).toHaveLength(1);
    expect(first.members).toHaveLength(2);
    expect(first.categoryAssignments).toHaveLength(2);
    expect(first.representatives).toHaveLength(2);
    expect(first.roles.length).toBeGreaterThanOrEqual(2); // primary + secondary contact
    expect(first.sponsorships).toHaveLength(3); // member consortium + member event + non-member event
    expect(first.sponsorships.some((row) => String(row.tier).toLowerCase() === "none")).toBe(false);
    expect(first.groupMemberships).toHaveLength(1);
    expect(first.groupMemberships[0]).toMatchObject({ source: "migration" });
    expect(first.groupMemberships[0]!.member_id).toBe(first.representatives[0]!.member_id);
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

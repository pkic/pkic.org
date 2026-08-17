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
 *      landed match the final schema (organization_domains,
 *      member_category_assignments, organization_representatives,
 *      role-primary_contact) — the exact shapes 0033-era intermediate
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
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkic-importer-fixture-"));
    tmpDirs.push(fixtureRoot);
    const membersDir = path.join(fixtureRoot, "members");
    const csvDir = path.join(fixtureRoot, "csv");
    fs.mkdirSync(membersDir);
    fs.mkdirSync(csvDir);

    // Org-tied member: exercises organizations, organization_domains, the
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

    writeFixtureRosterCsv(path.join(csvDir, "pkic.csv"), [
      ["alice@acme.example", "Alice", "x", "x", "x", "x", "2023", "01", "15", "10", "00", "00"],
    ]);
    for (const wg of ["ca", "cbom", "cm", "pkimm", "pqc", "tcwg"]) {
      writeFixtureRosterCsv(path.join(csvDir, `${wg}.csv`), []);
    }

    const { sql, report } = buildMigration({
      uploadLogos: false,
      membersDir,
      csvDir,
      sponsorsYamlPath: path.join(fixtureRoot, "sponsors-does-not-exist.yaml"),
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

    const domains = queryD1(persistTo, "SELECT domain FROM organization_domains");
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
  });
});

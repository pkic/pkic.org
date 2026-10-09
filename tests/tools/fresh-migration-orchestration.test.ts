import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { apply } from "../../scripts/apply-d1-migrations.mjs";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: execute }));
afterEach(() => execute.mockReset());

const migrationDirectory = resolve("migrations");
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => /^\d.*\.sql$/.test(name))
  .sort();
const lastImportMigration = "0037_retire_legacy_account_role.sql";
const ledgerSql =
  "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)";

describe("remote migration orchestration", () => {
  it.each([
    ["a fresh database", null],
    ["the governance cutover", "0035_membership_portal_governance.sql"],
    ["the retirement cutover", lastImportMigration],
  ])("applies every pending migration after %s through the appropriate execution path", (_scenario, appliedThrough) => {
    const db = new DatabaseSync(":memory:");
    const imported: string[] = [];
    const appliedByWrangler: string[] = [];
    const pendingNames = migrationNames.filter((name) => appliedThrough === null || name > appliedThrough);

    function applyRegularMigration(name: string): void {
      db.exec("BEGIN");
      db.exec(readFileSync(resolve(migrationDirectory, name), "utf8"));
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      db.exec("COMMIT");
    }

    execute.mockImplementation((_command: string, args: string[]) => {
      let rows: unknown[] = [];
      if (args.includes("list")) {
        db.exec(ledgerSql);
      } else if (args.includes("--file")) {
        const sql = readFileSync(args[args.indexOf("--file") + 1], "utf8");
        db.exec(sql);
        imported.push(sql.match(/INSERT INTO d1_migrations \(name\) VALUES \('([^']+)'\)/)![1]);
      } else if (args.includes("--command")) {
        rows = db.prepare(args[args.indexOf("--command") + 1]).all();
      } else if (args.includes("apply")) {
        const recorded = db.prepare("SELECT 1 FROM d1_migrations WHERE name = ?");
        for (const name of migrationNames) {
          if (recorded.get(name)) continue;
          applyRegularMigration(name);
          appliedByWrangler.push(name);
        }
      }
      return { status: 0, stdout: JSON.stringify([{ success: true, results: rows }]), stderr: "" };
    });
    try {
      if (appliedThrough !== null) {
        db.exec(ledgerSql);
        for (const name of migrationNames.filter((name) => name <= appliedThrough)) {
          applyRegularMigration(name);
        }
      }

      apply("production");
      expect(execute.mock.calls[0][1]).toContain("list");
      expect(imported).toEqual(pendingNames.filter((name) => name <= lastImportMigration));
      expect(appliedByWrangler).toEqual(pendingNames.filter((name) => name > lastImportMigration));
      expect([...imported, ...appliedByWrangler]).toEqual(pendingNames);
      expect(db.prepare("SELECT name FROM d1_migrations ORDER BY name").all()).toEqual(
        migrationNames.map((name) => ({ name })),
      );
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'oauth_authorization%' ORDER BY name").all(),
      ).toEqual([]);
      expect(
        db.prepare("SELECT job_key FROM scheduled_jobs WHERE job_key = 'oauth_authorization_cleanup'").all(),
      ).toEqual([]);
      expect(execute.mock.calls.at(-1)?.[1]).toEqual([
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        "DB",
        "--env",
        "production",
        "--remote",
      ]);

      apply("production");
      expect([...imported, ...appliedByWrangler]).toEqual(pendingNames);
    } finally {
      db.close();
    }
  });
});

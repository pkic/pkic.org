import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { apply } from "../../scripts/apply-d1-migrations.mjs";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: execute }));
afterEach(() => execute.mockReset());

describe("fresh remote migration orchestration", () => {
  it("initializes the ledger and imports every prerequisite before the guarded cutovers", () => {
    const db = new DatabaseSync(":memory:");
    const imported: string[] = [];
    execute.mockImplementation((_command: string, args: string[]) => {
      let rows: unknown[] = [];
      if (args.includes("list")) {
        db.exec(
          "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
        );
      } else if (args.includes("--file")) {
        const sql = readFileSync(args[args.indexOf("--file") + 1], "utf8");
        db.exec(sql);
        imported.push(sql.match(/INSERT INTO d1_migrations \(name\) VALUES \('([^']+)'\)/)![1]);
      } else if (args.includes("--command")) {
        rows = db.prepare(args[args.indexOf("--command") + 1]).all();
      }
      return { status: 0, stdout: JSON.stringify([{ success: true, results: rows }]), stderr: "" };
    });
    try {
      apply("production");
      expect(execute.mock.calls[0][1]).toContain("list");
      const migrationNames = readdirSync(resolve("migrations"))
        .filter((name) => /^\d.*\.sql$/.test(name))
        .sort();
      expect(imported).toEqual(migrationNames);
      expect(db.prepare("SELECT name FROM d1_migrations ORDER BY name").all()).toEqual(
        migrationNames.map((name) => ({ name })),
      );
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
    } finally {
      db.close();
    }
  });
});

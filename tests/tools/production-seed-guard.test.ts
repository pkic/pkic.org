import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { requireEmptyProductionSeedDatabase } from "../../scripts/lib/production-seed-guard.mjs";
import { insertStatements, runSeed } from "../../scripts/seed-initial-admin.mjs";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: execute }));
const options = { database: "test-db", wranglerEnv: "production", mode: "remote", persistTo: null };
afterEach(() => {
  vi.resetModules();
  execute.mockReset();
  vi.unstubAllGlobals();
});

function finalDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dir = resolve("migrations");
  for (const name of readdirSync(dir)
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort()) {
    db.exec(readFileSync(resolve(dir, name), "utf8"));
  }
  return db;
}

function sqliteExecute(db: DatabaseSync) {
  return (_command: string, args: string[]) =>
    JSON.stringify([{ success: true, results: db.prepare(args.at(-1)!).all() }]);
}

describe("production seed preflight", () => {
  it("allows a fresh database, but refuses application or migration records", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const read = sqliteExecute(db);
      expect(() => requireEmptyProductionSeedDatabase(options, read)).not.toThrow();
      db.exec('CREATE TABLE "quoted""table" (id TEXT)');
      expect(() => requireEmptyProductionSeedDatabase(options, read)).not.toThrow();
      db.exec('INSERT INTO "quoted""table" VALUES (\'synthetic\')');
      expect(() => requireEmptyProductionSeedDatabase(options, read)).toThrow("requires an empty database");
      db.exec(
        'DELETE FROM "quoted""table"; CREATE TABLE d1_migrations (name TEXT); INSERT INTO d1_migrations VALUES (\'0000\')',
      );
      expect(() => requireEmptyProductionSeedDatabase(options, read)).toThrow("requires an empty database");
    } finally {
      db.close();
    }
  });

  it.each(["{}", '[{"success":false,"results":[]}]', "not JSON"])(
    "fails closed on unsuccessful preflight: %s",
    (output) => {
      expect(() => requireEmptyProductionSeedDatabase(options, () => output)).toThrow();
    },
  );

  it.each([{ flags: [] }, { flags: ["--only", "admin"] }, { flags: ["--skip-migrations"] }])(
    "refuses before migrations, seeds, or R2 calls: %j",
    async ({ flags }) => {
      execute
        .mockReturnValueOnce(JSON.stringify([{ success: true, results: [{ name: "users" }] }]))
        .mockReturnValueOnce(JSON.stringify([{ success: true, results: [{ populated: 1 }] }]));
      vi.stubGlobal("process", { ...process, argv: ["node", "scripts/seed.mjs", "--production", ...flags] });
      await expect(import("../../scripts/seed.mjs")).rejects.toThrow("requires an empty database");
      expect(execute).toHaveBeenCalledTimes(2);
      for (const call of execute.mock.calls) expect(call[1]).toContain("--command");
    },
  );

  it("requires explicit production recovery and an existing administrator before writes", () => {
    expect(() => runSeed("remote", "test-db", null, null, false, false)).toThrow("explicit");
    expect(execute).not.toHaveBeenCalled();
    execute.mockReturnValue(JSON.stringify([{ success: true, results: [{ has_users: 1, administrator_exists: 1 }] }]));
    expect(() => runSeed("remote", "test-db", "production", null, false, false)).toThrow("requires no users");
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockClear();
    execute.mockReturnValue(JSON.stringify([{ success: true, results: [{ has_users: 1, administrator_exists: 0 }] }]));
    expect(() => runSeed("remote", "test-db", "production", null, false, true)).toThrow("requires the existing");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("administrator recovery against the final schema", () => {
  it("is idempotent and replaces expired assignments while preserving their history", () => {
    const db = finalDatabase();
    try {
      const seed = () => insertStatements(["admin@pkic.org"]).forEach((sql) => db.exec(sql));
      seed();
      seed();
      const activeCount = () =>
        db.prepare("SELECT COUNT(*) AS count FROM user_roles WHERE role_id = 'role-admin' AND revoked_at IS NULL").get()
          ?.count;
      expect(activeCount()).toBe(1);
      db.exec(
        "UPDATE user_roles SET expires_at = '2000-01-01T00:00:00.000Z' WHERE role_id = 'role-admin'; UPDATE users SET active = 0 WHERE normalized_email = 'admin@pkic.org'",
      );
      const statements = insertStatements(["admin@pkic.org"], { recover: true });
      expect(statements.some((sql) => sql.startsWith("INSERT INTO users"))).toBe(false);
      for (const sql of statements) db.exec(sql);
      expect(activeCount()).toBe(1);
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM user_roles WHERE role_id = 'role-admin' AND revoked_at IS NOT NULL")
          .get()?.count,
      ).toBe(1);
      expect(db.prepare("SELECT active FROM users WHERE normalized_email = 'admin@pkic.org'").get()?.active).toBe(1);
      seed();
      expect(activeCount()).toBe(1);
    } finally {
      db.close();
    }
  });
});

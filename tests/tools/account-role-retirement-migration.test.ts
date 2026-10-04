import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../migrations");
const retirementMigration = "0037_retire_legacy_account_role.sql";

function databaseBeforeRetirement(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort()) {
    if (file === retirementMigration) break;
    db.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
  return db;
}

function retire(db: DatabaseSync): void {
  db.exec(readFileSync(resolve(migrationsDirectory, retirementMigration), "utf8"));
}

describe("legacy account role retirement", () => {
  it("applies to a fresh schema and leaves no executable schema reference to the column", () => {
    const db = databaseBeforeRetirement();
    try {
      retire(db);
      expect(db.prepare("PRAGMA table_info(users)").all()).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "role" })]),
      );
      expect(
        db.prepare("SELECT sql FROM sqlite_master WHERE name = 'trg_event_resource_management_guard_validate'").get(),
      ).not.toEqual(expect.objectContaining({ sql: expect.stringContaining("actor_user.role") }));
      expect(() => db.exec("UPDATE users SET role = 'admin'")).toThrow("no such column: role");
    } finally {
      db.close();
    }
  });

  it("preserves populated user relationships and requires live grants at the atomic event guard", () => {
    const db = databaseBeforeRetirement();
    try {
      db.exec(`
        INSERT INTO users (id, email, normalized_email, role, created_at, updated_at)
        VALUES ('retirement-user', 'retirement@example.test', 'retirement@example.test', 'admin',
                '2026-10-04T00:00:00.000Z', '2026-10-04T00:00:00.000Z');
        INSERT INTO user_roles (id, user_id, role_id, created_at)
        VALUES ('retirement-assignment', 'retirement-user', 'role-admin', '2026-10-04T00:00:00.000Z');
        INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
        VALUES ('retirement-session', 'retirement-user', 'synthetic-hash', '2099-01-01T00:00:00.000Z', '2026-10-04T00:00:00.000Z');
      `);
      const user = db.prepare("SELECT id, email, active FROM users WHERE id = 'retirement-user'").get();
      const event = db.prepare("SELECT id, owner_group_id FROM events WHERE owner_group_id IS NOT NULL LIMIT 1").get()!;
      const guard = () =>
        db
          .prepare(
            `
        INSERT INTO event_resource_management_guards
          (id, event_id, group_id, required_capability, actor_user_id, trusted_service, created_at)
        VALUES ('retirement-guard', ?, ?, 'manage', 'retirement-user', 0, '2026-10-04T00:00:00.000Z')
      `,
          )
          .run(event.id, event.owner_group_id);
      // The old trigger authorizes the stale label even after the assignment is revoked.
      db.exec("UPDATE user_roles SET revoked_at = '2026-10-04T00:00:00.000Z' WHERE id = 'retirement-assignment'");
      expect(guard).not.toThrow();
      retire(db);
      expect(db.prepare("SELECT id, email, active FROM users WHERE id = 'retirement-user'").get()).toEqual(user);
      expect(db.prepare("SELECT user_id FROM sessions WHERE id = 'retirement-session'").get()).toEqual({
        user_id: "retirement-user",
      });
      expect(guard).toThrow("EVENT_RESOURCE_MANAGEMENT_CONTEXT_CHANGED");
      db.exec("UPDATE user_roles SET revoked_at = NULL WHERE id = 'retirement-assignment'");
      expect(guard).not.toThrow();
      db.exec("UPDATE user_roles SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 'retirement-assignment'");
      expect(guard).toThrow("EVENT_RESOURCE_MANAGEMENT_CONTEXT_CHANGED");
      db.exec(`INSERT INTO permission_grants (id, user_id, permission, created_at)
               VALUES ('retirement-grant', 'retirement-user', 'groups:write', '2026-10-04T00:00:00.000Z')`);
      expect(guard).not.toThrow();
      db.exec("UPDATE permission_grants SET revoked_at = '2026-10-04T00:00:00.000Z' WHERE id = 'retirement-grant'");
      expect(guard).toThrow("EVENT_RESOURCE_MANAGEMENT_CONTEXT_CHANGED");
    } finally {
      db.close();
    }
  });
});

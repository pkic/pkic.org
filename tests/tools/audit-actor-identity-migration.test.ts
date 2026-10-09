import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../migrations");
const agendaPlatformMigration = "0038_event_agenda_platform.sql";

function databaseBeforeAgendaPlatform(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort()) {
    if (file === agendaPlatformMigration) break;
    db.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
  return db;
}

/**
 * Two organizations and three people: one with a single affiliation, one who
 * gained a second affiliation midway, and one whose only affiliation ended.
 * Audit rows mix the application's ISO instants with the space-separated form
 * older rows carry.
 */
function seedIdentityHistory(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES
      ('org-a', 'Alpha', 'alpha', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
      ('org-b', 'Beta', 'beta', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at) VALUES
      ('member-a', 'organization', 'org-a', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
      ('member-b', 'organization', 'org-b', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    INSERT INTO users (id, email, normalized_email, created_at, updated_at) VALUES
      ('solo', 'solo@example.test', 'solo@example.test', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
      ('dual', 'dual@example.test', 'dual@example.test', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
      ('former', 'former@example.test', 'former@example.test', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    INSERT INTO identities
      (id, user_id, organization_id, source, invited_at, started_at, ended_at, created_at, updated_at) VALUES
      ('solo-a', 'solo', 'org-a', 'staff', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', NULL,
       '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
      ('dual-a', 'dual', 'org-a', 'staff', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', NULL,
       '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
      ('dual-b', 'dual', 'org-b', 'staff', '2025-03-01T00:00:00.000Z', '2025-03-01T00:00:00.000Z', NULL,
       '2025-03-01T00:00:00.000Z', '2025-03-01T00:00:00.000Z'),
      ('former-a', 'former', 'org-a', 'staff', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z',
       '2025-05-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2025-05-01T00:00:00.000Z');
    INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at) VALUES
      ('solo-active', 'user', 'solo', 'profile_updated', 'user', 'solo', NULL, '2025-06-01 10:00:00'),
      ('solo-before-start', 'user', 'solo', 'profile_updated', 'user', 'solo', NULL, '2024-12-01T00:00:00.000Z'),
      ('solo-as-admin', 'admin', 'solo', 'profile_updated', 'user', 'solo', NULL, '2025-06-01T00:00:00.000Z'),
      ('dual-one-active', 'user', 'dual', 'profile_updated', 'user', 'dual', NULL, '2025-02-01T00:00:00.000Z'),
      ('dual-two-active', 'user', 'dual', 'profile_updated', 'user', 'dual', NULL, '2025-04-01T00:00:00.000Z'),
      ('former-active', 'user', 'former', 'profile_updated', 'user', 'former', NULL, '2025-04-30T23:59:59.999Z'),
      ('former-at-end', 'user', 'former', 'profile_updated', 'user', 'former', NULL, '2025-05-01T00:00:00.000Z'),
      ('system-row', 'system', NULL, 'job_ran', 'job', NULL, NULL, '2025-06-01T00:00:00.000Z');
  `);
}

describe("audit acting identity", () => {
  it("names an identity only for user rows whose actor held exactly one identity at that instant", () => {
    const db = databaseBeforeAgendaPlatform();
    try {
      seedIdentityHistory(db);
      db.exec(readFileSync(resolve(migrationsDirectory, agendaPlatformMigration), "utf8"));
      const rows = db.prepare("SELECT id, actor_identity_id FROM audit_log ORDER BY id").all() as Array<{
        id: string;
        actor_identity_id: string | null;
      }>;
      expect(Object.fromEntries(rows.map((row) => [row.id, row.actor_identity_id]))).toEqual({
        "dual-one-active": "dual-a",
        "dual-two-active": null,
        "former-active": "former-a",
        "former-at-end": null,
        "solo-active": "solo-a",
        "solo-as-admin": null,
        "solo-before-start": null,
        "system-row": null,
      });
    } finally {
      db.close();
    }
  });

  it("adds the column to an empty database", () => {
    const db = databaseBeforeAgendaPlatform();
    try {
      db.exec(readFileSync(resolve(migrationsDirectory, agendaPlatformMigration), "utf8"));
      expect(db.prepare("PRAGMA table_info(audit_log)").all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "actor_identity_id", notnull: 0 })]),
      );
    } finally {
      db.close();
    }
  });
});

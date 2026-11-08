import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const directory = resolve(import.meta.dirname, "../../migrations");
const migration = "0043_shared_organization_domains.sql";

describe("shared organization domain migration", () => {
  it("preserves existing organizations, people and claims while allowing another organization to claim a domain", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      for (const file of readdirSync(directory)
        .filter((name) => /^\d.*\.sql$/.test(name))
        .sort()) {
        if (file === migration) break;
        db.exec(readFileSync(resolve(directory, file), "utf8"));
      }
      db.exec(`
        INSERT INTO organizations (id,name,normalized_name,created_at,updated_at) VALUES
          ('first','First','first','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),
          ('second','Second','second','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
        INSERT INTO users (id,email,normalized_email,created_at,updated_at)
          VALUES ('person','person@work.example','person@work.example','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
        INSERT INTO organization_domain_claims (id,domain,organization_id,created_at,updated_at)
          VALUES ('root','work.example','first','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
      `);
      const before = db.prepare("SELECT id,email FROM users WHERE id='person'").get();
      const migrationSql = readFileSync(resolve(directory, migration), "utf8");
      const originalClaims = db.prepare("SELECT * FROM organization_domain_claims").all();
      db.exec("BEGIN");
      expect(() => db.exec(`${migrationSql}\nINSERT INTO nonexistent_recovery_test VALUES (1);`)).toThrow();
      db.exec("ROLLBACK");
      expect(db.prepare("SELECT * FROM organization_domain_claims").all()).toEqual(originalClaims);
      expect(() =>
        db.exec(`INSERT INTO organization_domain_claims
        (id,domain,organization_id,created_at,updated_at) VALUES
        ('rollback','work.example','second','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`),
      ).toThrow();
      db.exec(migrationSql);
      expect(db.prepare("PRAGMA foreign_key_list(member_applications)").all()).toContainEqual(
        expect.objectContaining({ from: "organization_id", table: "organizations", to: "id" }),
      );
      expect(db.prepare("SELECT id,email FROM users WHERE id='person'").get()).toEqual(before);
      expect(
        db.prepare("SELECT organization_id FROM organization_domain_claims WHERE domain='work.example'").all(),
      ).toEqual([{ organization_id: "first" }]);
      db.exec(`INSERT INTO organization_domain_claims
        (id,domain,organization_id,created_at,updated_at)
        VALUES ('additional','work.example','second','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`);
      expect(
        db
          .prepare(
            "SELECT organization_id FROM organization_domain_claims WHERE domain='work.example' ORDER BY organization_id",
          )
          .all(),
      ).toEqual([{ organization_id: "first" }, { organization_id: "second" }]);
      expect(() =>
        db.exec(
          "INSERT INTO organization_domain_claims (id,domain,organization_id,created_at,updated_at) VALUES ('duplicate','work.example','second','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')",
        ),
      ).toThrow();
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

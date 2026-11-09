import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { productionShapedFixture, ORGANIZATION_DOMAIN_FIXTURE } from "../fixtures/organization-domain-people";
import { seedPopulation } from "./helpers/organization-domain-population";

const migrations = resolve(import.meta.dirname, "../../migrations");
const migration = "0043_shared_organization_domains.sql";
const claimsSql =
  "SELECT id,domain,application_id,organization_id,created_at,updated_at FROM organization_domain_claims ORDER BY id";

function snapshot(db: DatabaseSync) {
  return {
    claims: db.prepare(claimsSql).all(),
    users: db.prepare("SELECT * FROM users ORDER BY id").all(),
    organizations: db.prepare("SELECT * FROM organizations ORDER BY id").all(),
    identities: db.prepare("SELECT * FROM identities ORDER BY id").all(),
  };
}

describe("shared-domain cutover recovery rehearsal", () => {
  it("preserves a synthetic production-shaped population and restores its quiesced pre-cutover snapshot", () => {
    const directory = mkdtempSync(join(tmpdir(), "pkic-shared-domains-recovery-"));
    const path = join(directory, "rehearsal.sqlite");
    const backup = join(directory, "before-cutover.sqlite");
    let db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      for (const name of readdirSync(migrations)
        .filter((name) => /^\d.*\.sql$/.test(name))
        .sort()) {
        if (name === migration) break;
        if (name === "0038_event_agenda_platform.sql") {
          const fixture = productionShapedFixture();
          fixture.organizations.push(...ORGANIZATION_DOMAIN_FIXTURE.organizations);
          fixture.people.push(...ORGANIZATION_DOMAIN_FIXTURE.people);
          seedPopulation(db, fixture);
        }
        db.exec(readFileSync(join(migrations, name), "utf8"));
      }
      const before = snapshot(db);
      expect(before.users.length).toBeGreaterThan(1500);
      expect(before.claims.some((claim) => claim.application_id !== null)).toBe(true);
      expect(before.identities.length).toBeGreaterThan(0);
      db.exec(`VACUUM INTO '${backup}'`);
      const sql = readFileSync(join(migrations, migration), "utf8");
      db.exec("BEGIN");
      expect(() => db.exec(`${sql}\nINSERT INTO synthetic_missing_table VALUES (1);`)).toThrow();
      db.exec("ROLLBACK");
      expect(snapshot(db)).toEqual(before);
      db.exec("BEGIN");
      db.exec(sql);
      db.exec("COMMIT");
      expect(snapshot(db)).toEqual(before);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      // Writes remain paused: restoring the snapshot is safe only before reopening traffic.
      db.close();
      copyFileSync(backup, path);
      db = new DatabaseSync(path);
      db.exec("PRAGMA foreign_keys=ON");
      expect(snapshot(db)).toEqual(before);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(
        db
          .prepare("PRAGMA table_info(member_applications)")
          .all()
          .some((column) => column.name === "organization_id"),
      ).toBe(false);
      // Recover forward by retrying the migration, then accept new shared claims.
      db.exec(sql);
      const claim = before.claims.find((entry) => entry.organization_id !== null)!;
      const other = before.organizations.find((organization) => organization.id !== claim.organization_id)!;
      db.prepare(
        "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES ('post-recovery',?,?,?,?)",
      ).run(claim.domain, other.id, claim.created_at, claim.updated_at);
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM organization_domain_claims WHERE domain=?").get(claim.domain),
      ).toEqual({ count: 2 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

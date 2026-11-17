import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("preserves legacy visible and hidden decisions and leaves new defaults undecided", () => {
  const db = new DatabaseSync(":memory:");
  const directory = resolve(import.meta.dirname, "../../migrations");
  const migration = "0047_organization_profile_listing_approval.sql";
  try {
    db.exec("PRAGMA foreign_keys=ON");
    for (const file of readdirSync(directory)
      .filter((name) => /^\d.*\.sql$/.test(name))
      .sort()) {
      if (file === migration) break;
      db.exec(readFileSync(resolve(directory, file), "utf8"));
    }
    db.exec(`INSERT INTO organizations (id,name,normalized_name,created_at,updated_at)
      VALUES ('org','Organization','organization','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
      INSERT INTO users(id,email,normalized_email) VALUES ('person','person@example.test','person@example.test');
      INSERT INTO identities(id,user_id,organization_id,source,show_on_organization_profile,invited_at,created_at,updated_at)
        VALUES ('shown','person','org','staff',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
      INSERT INTO users(id,email,normalized_email) VALUES ('hidden-person','hidden@example.test','hidden@example.test');
      INSERT INTO identities(id,user_id,organization_id,source,show_on_organization_profile,invited_at,created_at,updated_at)
        VALUES ('hidden','hidden-person','org','verified_email',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
    db.exec(readFileSync(resolve(directory, migration), "utf8"));
    expect(
      db
        .prepare(
          "SELECT id,show_on_organization_profile,organization_profile_listing_approved FROM identities ORDER BY id",
        )
        .all(),
    ).toEqual([
      { id: "hidden", show_on_organization_profile: 0, organization_profile_listing_approved: 0 },
      { id: "shown", show_on_organization_profile: 1, organization_profile_listing_approved: 1 },
    ]);
    db.exec(`INSERT INTO users(id,email,normalized_email) VALUES ('new-person','new@example.test','new@example.test');
      INSERT INTO identities(id,user_id,organization_id,source,show_on_organization_profile,invited_at,created_at,updated_at)
        VALUES ('new','new-person','org','verified_email',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
    expect(db.prepare("SELECT organization_profile_listing_approved FROM identities WHERE id='new'").get()).toEqual({
      organization_profile_listing_approved: null,
    });
  } finally {
    db.close();
  }
});

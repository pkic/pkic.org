import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_GROUPS, demoGroupSql, meetingsSql } from "../../scripts/lib/seed-demo-groups.mjs";
import { memberProfileId } from "../../scripts/lib/seed-ids.mjs";

describe("demo meeting seed", () => {
  it("creates valid policies and repairs obsolete demo rows without overwriting edited policies", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const migrations = new URL("../../migrations/", import.meta.url);
      for (const name of readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        db.exec(readFileSync(new URL(name, migrations), "utf8"));
      }
      for (const group of DEMO_GROUPS) {
        db.exec(demoGroupSql(group));
        const statements = meetingsSql(group.slug, 0, 0, 0, "nobody@example.test");
        const seed = () => statements.forEach((statement) => db.exec(statement));
        seed();
        const id = memberProfileId(`event-${group.slug}`);
        const row = () => db.prepare("SELECT profile_key, registration_mode FROM events WHERE id = ?").get(id);
        expect(row()).toMatchObject({
          profile_key: group.type === "board" ? "board_meeting" : "meeting",
          registration_mode: "no_registration",
        });
        db.prepare("UPDATE events SET profile_key = NULL, registration_mode = 'invite_or_open' WHERE id = ?").run(id);
        seed();
        expect(row()).toMatchObject({
          profile_key: group.type === "board" ? "board_meeting" : "meeting",
          registration_mode: "no_registration",
        });
        db.prepare("UPDATE events SET registration_mode = 'optional' WHERE id = ?").run(id);
        seed();
        expect(row()).toMatchObject({ registration_mode: "optional" });
      }
      expect(db.prepare("SELECT COUNT(*) AS count FROM event_series").get()).toMatchObject({
        count: DEMO_GROUPS.length,
      });
    } finally {
      db.close();
    }
  });
});

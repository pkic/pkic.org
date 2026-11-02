import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { expect, it } from "vitest";

it("repairs reminder delivery after registration-wide attendance is retired", async () => {
  const migrations = await readD1Migrations(path.resolve(import.meta.dirname, "../../migrations"));
  const repairIndex = migrations.findIndex((migration) => migration.name === "0040_email_reminder_day_access.sql");
  if (repairIndex < 0) throw new Error("Missing reminder delivery migration");

  const db = new DatabaseSync(":memory:");
  try {
    for (const migration of migrations.slice(0, repairIndex)) {
      for (const query of migration.queries) db.exec(query);
    }
    db.exec(`INSERT INTO events (id, slug, name, timezone, created_at, updated_at)
      VALUES ('reminder-upgrade', 'reminder-upgrade', 'Reminder upgrade', 'UTC',
        '2026-01-01T12:00:00.000Z', '2026-01-01T12:00:00.000Z')`);
    const readGuard = () => db.prepare("SELECT id, version, deliverable FROM email_delivery_guard_states").all();
    expect(readGuard).toThrow(/attendance_type/);

    for (const query of migrations[repairIndex]!.queries) db.exec(query);

    expect(readGuard()).toEqual([]);
    expect(db.prepare("SELECT name FROM events WHERE id='reminder-upgrade'").get()).toEqual({
      name: "Reminder upgrade",
    });
  } finally {
    db.close();
  }
});

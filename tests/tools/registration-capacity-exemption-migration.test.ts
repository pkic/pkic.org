import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("removes cached admission fields from an existing registration and keeps capacity revisions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync("migrations")
      .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0036_remove_registration_capacity_exemption.sql")
      .sort()) {
      db.exec(readFileSync(`migrations/${name}`, "utf8"));
    }
    const now = "2026-09-30T10:00:00.000Z";
    db.prepare("INSERT INTO events (id, slug, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "event-1",
      "event-1",
      "Event",
      "UTC",
      now,
      now,
    );
    db.prepare("INSERT INTO users (id, email, normalized_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "user-1",
      "speaker@example.test",
      "speaker@example.test",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO event_days (id, event_id, day_date, in_person_capacity, created_at, updated_at)
       VALUES ('day-1', 'event-1', '2026-12-01', 1, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO registrations
       (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret,
        capacity_exempt_in_person, capacity_exempt_reason, created_at, updated_at)
       VALUES ('registration-1', 'event-1', 'user-1', 'registered', 'in_person', 'direct',
               'manage-secret', 1, 'role:speaker', ?, ?)`,
    ).run(now, now);

    db.exec(readFileSync("migrations/0036_remove_registration_capacity_exemption.sql", "utf8"));

    const columns = db.prepare("PRAGMA table_info(registrations)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain("capacity_exempt_in_person");
    expect(columns.map((column) => column.name)).not.toContain("capacity_exempt_reason");
    expect(db.prepare("SELECT id, status FROM registrations WHERE id = 'registration-1'").get()).toEqual({
      id: "registration-1",
      status: "registered",
    });
    const before = db.prepare("SELECT capacity_revision FROM event_days WHERE id = 'day-1'").get() as {
      capacity_revision: number;
    };
    db.exec("UPDATE registrations SET status = 'cancelled' WHERE id = 'registration-1'");
    expect(db.prepare("SELECT capacity_revision FROM event_days WHERE id = 'day-1'").get()).toEqual({
      capacity_revision: before.capacity_revision + 1,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

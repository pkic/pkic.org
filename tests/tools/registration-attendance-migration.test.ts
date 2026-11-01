import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const migration = "0039_event_promotion_kits.sql";
const marker = "-- Flexible event registration attendance types.";
const at = "2026-01-01T00:00:00.000Z";

function existingDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations")
    .filter((file) => /^\d{4}_.+\.sql$/.test(file) && file < migration)
    .sort())
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  db.exec("PRAGMA foreign_keys = ON");
  db.prepare(
    "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES('event','event','Event','UTC',?,?)",
  ).run(at, at);
  db.prepare(
    "INSERT INTO users(id,email,normalized_email,created_at,updated_at) VALUES('user','user@example.test','user@example.test',?,?)",
  ).run(at, at);
  db.prepare(
    "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES('day','event','2026-12-01',?,?)",
  ).run(at, at);
  db.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES('registration','event','user','registered','virtual','direct','secret',?,?)",
  ).run(at, at);
  db.prepare(
    "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) VALUES('attendance','registration','day','virtual',?,?)",
  ).run(at, at);
  db.prepare(
    "INSERT INTO registration_attendance_history(id,registration_id,to_type,changed_by,changed_at,event_day_id) VALUES('history','registration','virtual','test',?,'day')",
  ).run(at);
  db.prepare(
    "INSERT INTO registration_badge_role_overrides(registration_id,role,set_by_user_id,created_at,updated_at) VALUES('registration','speaker','user',?,?)",
  ).run(at, at);
  return db;
}

function delta(): string {
  const sql = readFileSync(`migrations/${migration}`, "utf8");
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error("Missing registration attendance migration");
  return sql.slice(start);
}

function snapshot(db: DatabaseSync) {
  return {
    registration: db.prepare("SELECT * FROM registrations").all(),
    days: db.prepare("SELECT * FROM registration_day_attendance").all(),
    history: db.prepare("SELECT * FROM registration_attendance_history").all(),
    badge: db.prepare("SELECT * FROM registration_badge_role_overrides").all(),
    eventDays: db.prepare("SELECT * FROM event_days").all(),
    objects: db
      .prepare(
        "SELECT type,name,sql FROM sqlite_schema WHERE type IN ('index','trigger','view') AND sql IS NOT NULL ORDER BY type,name",
      )
      .all(),
  };
}

it("preserves existing records and database objects while allowing configured attendance types", () => {
  const db = existingDatabase();
  try {
    const before = snapshot(db);
    db.exec(`BEGIN;\n${delta()}\nCOMMIT;`);
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    db.exec("UPDATE registrations SET attendance_type='livestream_lounge' WHERE id='registration'");
    expect(db.prepare("SELECT attendance_type FROM registrations WHERE id='registration'").get()).toEqual({
      attendance_type: "livestream_lounge",
    });
  } finally {
    db.close();
  }
});

it("rolls the rebuild back if a statement fails after the original table is dropped", () => {
  const db = existingDatabase();
  try {
    const before = snapshot(db);
    const broken = delta().replace(
      "DROP TABLE registrations;",
      "DROP TABLE registrations; SELECT * FROM intentional_migration_failure;",
    );
    expect(() => db.exec(`BEGIN;\n${broken}\nCOMMIT;`)).toThrow();
    db.exec("ROLLBACK");
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='registrations'").get()).toMatchObject({
      sql: expect.stringContaining("CHECK (attendance_type IN"),
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

it("removes the registration-wide field while preserving day attendance and related records", () => {
  const db = existingDatabase();
  try {
    db.exec(`BEGIN;\n${delta()}\nCOMMIT;`);
    const before = snapshot(db);
    const cutover = readFileSync("migrations/0040_registration_day_attendance.sql", "utf8");
    db.exec(`BEGIN;\n${cutover}\nCOMMIT;`);
    const after = snapshot(db);
    expect(after.days).toEqual(before.days);
    expect(after.history).toEqual(before.history);
    expect(after.badge).toEqual(before.badge);
    expect(after.eventDays).toEqual(before.eventDays);
    expect(db.prepare("PRAGMA table_info(registrations)").all()).not.toContainEqual(
      expect.objectContaining({ name: "attendance_type" }),
    );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});

it("refuses to discard registration-only attendance and rolls the cutover back", () => {
  const db = existingDatabase();
  try {
    db.exec(`BEGIN;\n${delta()}\nCOMMIT;`);
    db.exec("DELETE FROM registration_day_attendance");
    const before = snapshot(db);
    const cutover = readFileSync("migrations/0040_registration_day_attendance.sql", "utf8");
    expect(() => db.exec(`BEGIN;\n${cutover}\nCOMMIT;`)).toThrow();
    db.exec("ROLLBACK");
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

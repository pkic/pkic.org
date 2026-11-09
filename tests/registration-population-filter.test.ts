import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventAttendanceRegistrationsQuerySchema } from "../assets/shared/schemas/event-registrations";
import { eventBadgePrintPopulationQuerySchema } from "../assets/shared/schemas/event-badge-printing";
import { groupEventRegistrationExportQuerySchema } from "../assets/shared/schemas/group-event-registration-operations";
import { registrationPopulationFilter } from "../functions/_lib/services/registrations/registration-population-filter";

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE registrations(id TEXT PRIMARY KEY,user_id TEXT,event_id TEXT,status TEXT,created_at TEXT);
    CREATE TABLE event_days(id TEXT PRIMARY KEY,event_id TEXT,day_date TEXT);
    CREATE TABLE registration_day_attendance(registration_id TEXT,event_day_id TEXT,attendance_type TEXT);
    CREATE TABLE event_day_waitlist_entries(registration_id TEXT,event_day_id TEXT,status TEXT,offer_expires_at TEXT);
    INSERT INTO event_days VALUES ('one','event','2026-12-01'),('two','event','2026-12-02'),('three','event','2026-12-03'),('foreign','other','2026-12-01');`);
  const attendee = (id: string, days: Array<[string, string]>, event = "event") => {
    db.prepare("INSERT INTO users VALUES (?)").run(id);
    db.prepare("INSERT INTO registrations VALUES (?,?,?,'registered','2026-11-01T00:00:00.000Z')").run(id, id, event);
    for (const [day, type] of days)
      db.prepare("INSERT INTO registration_day_attendance VALUES (?,?,?)").run(id, day, type);
  };
  attendee("mixed", [
    ["one", "in_person"],
    ["two", "virtual"],
    ["three", "in_person"],
  ]);
  attendee("both", [
    ["one", "in_person"],
    ["two", "in_person"],
  ]);
  attendee("other-day", [["two", "in_person"]]);
  attendee("offered", [
    ["one", "in_person"],
    ["two", "virtual"],
  ]);
  attendee("expired", [["one", "in_person"]]);
  attendee("declined", [["one", "in_person"]]);
  attendee("not-attending", [["one", "not_attending"]]);
  attendee("foreign", [["foreign", "in_person"]], "other");
  db.exec(`INSERT INTO event_day_waitlist_entries VALUES
    ('mixed','three','waiting',NULL),('offered','one','offered','2999-01-01T00:00:00.000Z'),
    ('expired','one','offered','2000-01-01T00:00:00.000Z'),('declined','one','declined',NULL);`);
});
afterEach(() => db.close());
function matches(query: Record<string, string>, waitlistStatus?: Parameters<typeof registrationPopulationFilter>[2]) {
  const filters = eventAttendanceRegistrationsQuerySchema.parse(query);
  const built = registrationPopulationFilter("event", filters, waitlistStatus);
  return db
    .prepare(`SELECT r.id ${built.fromSql} ORDER BY r.id`)
    .all(...(built.bindings as string[]))
    .map((row) => row.id);
}

describe("attendee day, attendance and waitlist filters", () => {
  it("matches the chosen day and type, excluding other dates, events and not-attending choices", () => {
    expect(matches({ day_dates: "2026-12-01", attendance_type: "in_person" })).toEqual([
      "both",
      "declined",
      "expired",
      "mixed",
      "offered",
    ]);
    expect(matches({ day_dates: "2026-12-01" })).not.toContain("not-attending");
    expect(matches({ day_dates: "2026-12-04" })).toEqual([]);
  });
  it("matches any selected day by default, and every selected day when requested", () => {
    const query = { day_dates: "2026-12-01,2026-12-02", attendance_type: "in_person" };
    expect(matches(query)).toContain("other-day");
    expect(matches({ ...query, day_match: "all" })).toEqual(["both"]);
    expect(matches({ day_dates: "2026-12-01,2026-12-02", day_match: "all" })).toEqual(["both", "mixed", "offered"]);
  });
  it("scopes positive and negative waitlist filters to the selected day", () => {
    expect(matches({ day_dates: "2026-12-01", attendance_type: "in_person", waitlisted: "true" })).toEqual(["offered"]);
    expect(matches({ day_dates: "2026-12-01", attendance_type: "in_person", waitlisted: "false" })).toEqual([
      "both",
      "declined",
      "expired",
      "mixed",
    ]);
    expect(matches({ day_dates: "2026-12-03", waitlisted: "true" })).toEqual(["mixed"]);
    expect(matches({ day_dates: "2026-12-03", waitlisted: "false" })).toEqual([]);
  });
  it("does not combine a type on one day with a waitlist on another", () => {
    expect(matches({ attendance_type: "virtual", waitlisted: "true" })).toEqual([]);
    expect(matches({ day_dates: "2026-12-02", attendance_type: "virtual", waitlisted: "true" })).toEqual([]);
  });
  it("matches nonwaitlisted days of the selected type without excluding other days", () => {
    const result = matches({ attendance_type: "in_person", waitlisted: "false" });
    expect(result).toEqual(["both", "declined", "expired", "mixed", "other-day"]);
  });
  it("does not exclude an accepted type because another type is waitlisted", () => {
    db.exec(`INSERT INTO users VALUES ('cross-type');
      INSERT INTO registrations VALUES ('cross-type','cross-type','event','registered','2026-11-01T00:00:00.000Z');
      INSERT INTO registration_day_attendance VALUES ('cross-type','one','in_person'),('cross-type','two','virtual');
      INSERT INTO event_day_waitlist_entries VALUES ('cross-type','two','waiting',NULL);`);
    expect(matches({ attendance_type: "in_person", waitlisted: "false" })).toContain("cross-type");
    expect(matches({ attendance_type: "virtual", waitlisted: "false" })).not.toContain("cross-type");
    expect(matches({ attendance_type: "virtual", waitlisted: "true" })).toContain("cross-type");
    expect(matches({ attendance_type: "in_person", waitlisted: "true" })).not.toContain("cross-type");
    expect(matches({ waitlisted: "false" })).not.toContain("cross-type");
    expect(matches({ waitlisted: "false" })).not.toContain("mixed");
  });
  it("combines exact waitlist status and active-waitlist filters with matching bindings", () => {
    db.exec("UPDATE event_day_waitlist_entries SET status='accepted' WHERE registration_id='declined'");
    const scopes: Array<Record<string, string>> = [{ attendance_type: "in_person" }, { day_dates: "2026-12-01" }];
    for (const scope of scopes) {
      expect(matches({ ...scope, waitlisted: "false" }, "accepted")).toEqual(["declined"]);
      expect(matches({ ...scope, waitlisted: "true" }, "accepted")).toEqual([]);
      expect(matches({ ...scope, waitlisted: "true" }, "offered")).toEqual(["offered"]);
    }
  });
  it("uses the identical validated scope for the table, CSV export and badge population", () => {
    const scope = {
      day_dates: "2026-12-01,2026-12-02",
      day_match: "all",
      attendance_type: "in_person",
      waitlisted: "false",
    };
    for (const schema of [
      eventAttendanceRegistrationsQuerySchema,
      groupEventRegistrationExportQuerySchema,
      eventBadgePrintPopulationQuerySchema,
    ]) {
      const query = schema.parse(scope);
      const built = registrationPopulationFilter("event", query);
      expect(
        db
          .prepare(`SELECT r.id ${built.fromSql}`)
          .all(...(built.bindings as string[]))
          .map((row) => row.id),
      ).toEqual(["both"]);
    }
  });
  it.each(["", "2026-02-30", "2026-12-01,2026-12-01", "2026-12-01,anything", "2026-12-01 OR 1=1"])(
    "rejects invalid day selection %j across all consumers",
    (day_dates) => {
      for (const schema of [
        eventAttendanceRegistrationsQuerySchema,
        groupEventRegistrationExportQuerySchema,
        eventBadgePrintPopulationQuerySchema,
      ])
        expect(schema.safeParse({ day_dates }).success).toBe(false);
    },
  );
  it("rejects unsupported matching modes", () => {
    expect(eventAttendanceRegistrationsQuerySchema.safeParse({ day_match: "some" }).success).toBe(false);
  });
});

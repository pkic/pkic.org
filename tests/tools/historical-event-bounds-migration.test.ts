import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { utcInstantSchema } from "../../assets/shared/schemas/api-common";

const migrationsDirectory = resolve(import.meta.dirname, "../../migrations");
const agendaMigration = "0038_event_agenda_platform.sql";
const originalRevision = "2026-01-01T00:00:00.000Z";
const historicalEvents = [
  {
    slug: "pqc-conference-amsterdam-nl-2023",
    timezone: "Europe/Amsterdam",
    startsAt: "2023-11-07",
    endsAt: "2023-11-08",
    expectedStart: "2023-11-07T07:30:00.000Z",
    expectedEnd: null,
  },
  {
    slug: "pqc-conference-austin-us-2025",
    timezone: "America/Chicago",
    startsAt: "2025-01-15",
    endsAt: "2025-01-16",
    expectedStart: "2025-01-15T14:30:00.000Z",
    expectedEnd: "2025-01-17T00:00:00.000Z",
  },
  {
    slug: "pqc-conference-kuala-lumpur-my-2025",
    timezone: "Asia/Kuala_Lumpur",
    startsAt: "2025-10-28",
    endsAt: "2025-10-30",
    expectedStart: "2025-10-28T00:30:00.000Z",
    expectedEnd: "2025-10-30T09:00:00.000Z",
  },
];

function databaseBeforeAgenda(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort()) {
    if (file === agendaMigration) break;
    db.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
  return db;
}

function applyAgenda(db: DatabaseSync): void {
  db.exec(readFileSync(resolve(migrationsDirectory, agendaMigration), "utf8"));
}

function seedEvent(
  db: DatabaseSync,
  event: Pick<(typeof historicalEvents)[number], "slug" | "timezone"> & {
    startsAt: string | null;
    endsAt: string | null;
  },
  sourceMode = "hugo",
): void {
  db.prepare(
    `INSERT INTO events
    (id, slug, name, timezone, starts_at, ends_at, source_mode, profile_key, owner_group_id,
     settings_json, created_at, updated_at)
    VALUES (?, ?, 'Authored historical conference', ?, ?, ?, ?, 'conference',
      (SELECT id FROM groups WHERE slug = 'pqc'), '{"preserved":"event settings"}', ?, ?)`,
  ).run(
    event.slug,
    event.slug,
    event.timezone,
    event.startsAt,
    event.endsAt,
    sourceMode,
    originalRevision,
    originalRevision,
  );
  db.prepare("INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES (?,90,?)").run(
    event.slug,
    originalRevision,
  );
}

function readEvent(db: DatabaseSync, slug: string) {
  return db
    .prepare(
      `SELECT id,slug,name,timezone,starts_at,ends_at,source_mode,profile_key,
    owner_group_id,settings_json,source_path,base_path,created_at,updated_at
    FROM events WHERE slug = ?`,
    )
    .get(slug)!;
}

function expectIntegrity(db: DatabaseSync): void {
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

describe("historical event bounds in the actual agenda migration", () => {
  it("repairs only known authored bounds and preserves expired contact closure and all other event fields", () => {
    const db = databaseBeforeAgenda();
    try {
      for (const event of historicalEvents) seedEvent(db, event);
      const unrelated = { ...historicalEvents[0], slug: "unrelated-calendar-event" };
      seedEvent(db, unrelated);
      const original = historicalEvents.map((event) => readEvent(db, event.slug));
      const unrelatedBefore = readEvent(db, unrelated.slug);
      const deadlines = historicalEvents.map(
        (event) =>
          db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ',?,'+90 days') AS deadline").get(event.endsAt)!.deadline,
      );

      applyAgenda(db);

      for (const [index, event] of historicalEvents.entries()) {
        const { starts_at, ends_at, updated_at, ...unchanged } = readEvent(db, event.slug);
        const { starts_at: oldStart, ends_at: oldEnd, updated_at: oldRevision, ...originalFields } = original[index]!;
        expect(unchanged).toEqual(originalFields);
        expect(oldStart).toBe(event.startsAt);
        expect(oldEnd).toBe(event.endsAt);
        expect(oldRevision).toBe(originalRevision);
        expect(utcInstantSchema.parse(starts_at)).toBe(event.expectedStart);
        expect(utcInstantSchema.nullable().parse(ends_at)).toBe(event.expectedEnd);
        expect(utcInstantSchema.parse(updated_at)).not.toBe(originalRevision);
        expect(
          db
            .prepare("SELECT closed_at,deadline_at FROM event_contact_retention_state WHERE event_id=?")
            .get(event.slug),
        ).toEqual({ closed_at: deadlines[index], deadline_at: deadlines[index] });
      }
      expect(readEvent(db, unrelated.slug)).toEqual(unrelatedBefore);
      expect(
        db.prepare("SELECT event_id FROM event_contact_retention_state WHERE event_id=?").get(unrelated.slug),
      ).toBeUndefined();
      expectIntegrity(db);
    } finally {
      db.close();
    }
  });

  it.each([
    { label: "wrong timezone", timezone: "UTC" },
    { label: "another import source", sourceMode: "integration" },
    { label: "staff-modified start", startsAt: "2023-11-07T08:00:00.000Z" },
    { label: "staff-modified end", endsAt: "2023-11-08T18:00:00.000Z" },
    { label: "already repaired", startsAt: "2023-11-07T07:30:00.000Z", endsAt: null },
  ])("preserves $label without updating revision or contact closure", (variant) => {
    const db = databaseBeforeAgenda();
    try {
      const event = { ...historicalEvents[0], ...variant };
      seedEvent(db, event, "sourceMode" in variant ? variant.sourceMode : "hugo");
      const before = readEvent(db, event.slug);
      applyAgenda(db);
      expect(readEvent(db, event.slug)).toEqual(before);
      expect(
        db.prepare("SELECT event_id FROM event_contact_retention_state WHERE event_id=?").get(event.slug),
      ).toBeUndefined();
      expectIntegrity(db);
    } finally {
      db.close();
    }
  });

  it("applies cleanly to a fresh database with no historical rows", () => {
    const db = databaseBeforeAgenda();
    try {
      applyAgenda(db);
      expect(db.prepare("SELECT COUNT(*) AS count FROM event_contact_retention_state").get()).toEqual({ count: 0 });
      expectIntegrity(db);
    } finally {
      db.close();
    }
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(import.meta.dirname, "../../migrations");
const agendaMigration = "0038_event_agenda_platform.sql";
const revision = "2026-01-01T00:00:00.000Z";

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

function seed(db: DatabaseSync, slug: string, settings: unknown, extra: { timezone?: string; source?: string } = {}) {
  db.prepare(
    `INSERT INTO events (id, slug, name, timezone, source_mode, owner_group_id, profile_key, settings_json,
                         created_at, updated_at)
     VALUES (?1, ?2, 'Synthetic event', ?3, ?4,
             CASE WHEN ?4 = 'portal' THEN (SELECT id FROM groups WHERE slug = 'pqc') END,
             CASE WHEN ?4 = 'portal' THEN 'conference' END, ?5, ?6, ?7)`,
  ).run(slug, slug, extra.timezone ?? "UTC", extra.source ?? null, JSON.stringify(settings), revision, revision);
}

function migrated(settingsByLabel: Record<string, unknown>) {
  const db = databaseBeforeAgenda();
  for (const [slug, settings] of Object.entries(settingsByLabel)) seed(db, slug, settings);
  db.exec(readFileSync(resolve(migrationsDirectory, agendaMigration), "utf8"));
  return {
    db,
    row: (slug: string) =>
      db.prepare("SELECT city, country, settings_json, updated_at FROM events WHERE slug = ?").get(slug) as {
        city: string | null;
        country: string | null;
        settings_json: string;
        updated_at: string;
      },
  };
}

describe("0038 event city and country", () => {
  it("backfills a city and an ISO code from labels that name a known country", () => {
    const { row } = migrated({
      amsterdam: { location: "Amsterdam, The Netherlands", venue: "Meervaart" },
      austin: { location: "Austin, Texas, US" },
      "kuala-lumpur": { location: "Kuala Lumpur, Malaysia" },
      ottawa: { location: " Ottawa ,  Canada " },
    });
    expect(row("amsterdam")).toMatchObject({ city: "Amsterdam", country: "NL" });
    expect(row("austin")).toMatchObject({ city: "Austin", country: "US" });
    expect(row("kuala-lumpur")).toMatchObject({ city: "Kuala Lumpur", country: "MY" });
    expect(row("ottawa")).toMatchObject({ city: "Ottawa", country: "CA" });
    // The venue stays; the retired label leaves the settings document.
    expect(JSON.parse(row("amsterdam").settings_json)).toEqual({ venue: "Meervaart" });
    expect(row("amsterdam").updated_at).toBe(revision);
  });

  it("leaves labels that do not parse reliably for organizers to fill in", () => {
    const { row } = migrated({
      attendance: { location: "Rotterdam and online" },
      "attendance-with-country": { location: "Amsterdam and online, Netherlands" },
      online: { location: "Online" },
      unmapped: { location: "Paris, France" },
      blank: { location: "" },
      none: { venue: "Somewhere" },
    });
    for (const slug of ["attendance", "attendance-with-country", "online", "unmapped", "blank", "none"]) {
      expect(row(slug)).toMatchObject({ city: null, country: null });
      expect(JSON.parse(row(slug).settings_json)).not.toHaveProperty("location");
    }
  });

  it("places the past conferences by their imported slugs and zones", () => {
    const db = databaseBeforeAgenda();
    seed(db, "pqc-conference-amsterdam-nl-2023", {}, { timezone: "Europe/Amsterdam", source: "hugo" });
    seed(db, "pqc-conference-austin-us-2025", {}, { timezone: "America/Chicago", source: "hugo" });
    seed(db, "pqc-conference-kuala-lumpur-my-2025", {}, { timezone: "Asia/Kuala_Lumpur", source: "hugo" });
    seed(db, "post-quantum-cryptography-conference", {}, { timezone: "America/Toronto", source: "portal" });
    // A slug on another zone is not the authored event.
    seed(db, "conference-elsewhere", {}, { timezone: "UTC", source: "hugo" });
    db.exec(readFileSync(resolve(migrationsDirectory, agendaMigration), "utf8"));
    const places = db
      .prepare("SELECT slug, city, country FROM events WHERE slug LIKE '%conference%' ORDER BY slug")
      .all();
    expect(places).toEqual([
      { slug: "conference-elsewhere", city: null, country: null },
      { slug: "post-quantum-cryptography-conference", city: "Ottawa", country: "CA" },
      { slug: "pqc-conference-amsterdam-nl-2023", city: "Amsterdam", country: "NL" },
      { slug: "pqc-conference-austin-us-2025", city: "Austin", country: "US" },
      { slug: "pqc-conference-kuala-lumpur-my-2025", city: "Kuala Lumpur", country: "MY" },
    ]);
  });

  it("rejects a country that is not a two-letter upper-case code", () => {
    const { db } = migrated({});
    seed(db, "valid", {});
    expect(() => db.prepare("UPDATE events SET country = 'nl' WHERE slug = 'valid'").run()).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE events SET country = 'NLD' WHERE slug = 'valid'").run()).toThrow(/CHECK/);
    db.prepare("UPDATE events SET country = 'NL', city = 'Amsterdam' WHERE slug = 'valid'").run();
  });
});

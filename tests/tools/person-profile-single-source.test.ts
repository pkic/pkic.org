/**
 * A person's name and photo live on `users`, and the biography, links,
 * organization and title on the identity they speak as. The copies the
 * proposal roster and the account once kept are gone from the final schema,
 * and no source file may name them again: a reintroduced copy fails here
 * before it can be read or written.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migrationsDirectory = join(root, "migrations");

/** Retired copies, by table, with a name no other table uses. */
const RETIRED_PROPOSAL_SPEAKER_COLUMNS = [
  "profile_overrides_json",
  "headshot_override_set",
  "acting_identity_snapshot_json",
] as const;
const RETIRED_COLUMNS: Record<string, readonly string[]> = {
  users: ["biography", "links_json", "organization_name", "job_title"],
  proposal_speakers: [...RETIRED_PROPOSAL_SPEAKER_COLUMNS, "headshot_r2_key", "headshot_updated_at"],
  registrations: ["registration_organization_name", "registration_job_title"],
};
/** Names of the retired code paths that read or wrote those copies. */
const RETIRED_IDENTIFIERS = [
  ...RETIRED_PROPOSAL_SPEAKER_COLUMNS,
  "profileOverrides",
  "ProfileOverride",
  "proposalSpeakerEffective",
  "proposalActingIdentitySnapshotSchema",
  "proposal-speaker-profile-overrides",
  "proposal-speaker-headshot-read-model",
  "replaceProposalSpeakerHeadshot",
];

function finalSchema(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(readFileSync(join(migrationsDirectory, file), "utf8"));
  }
  return db;
}

/** Migration rehearsals build the schema as it was before the copies went, so they name the old columns. */
const MIGRATION_REHEARSALS = new Set(["tests/tools/audit-actor-identity-migration.test.ts"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|mjs|js|astro)$/.test(name) ? [path] : [];
  });
}

describe("one source for a person's profile", () => {
  it("leaves no copy of a person's profile in the final schema", () => {
    const db = finalSchema();
    try {
      for (const [table, retired] of Object.entries(RETIRED_COLUMNS)) {
        const columns = (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map(
          (row) => row.name,
        );
        expect(columns.length, table).toBeGreaterThan(0);
        expect(
          columns.filter((column) => retired.includes(column)),
          table,
        ).toEqual([]);
      }
    } finally {
      db.close();
    }
  });

  it("names none of the retired copies in application, script or test code", () => {
    const self = relative(root, import.meta.filename);
    const offenders = ["functions", "assets", "scripts", "tests"]
      .flatMap((directory) => sourceFiles(join(root, directory)))
      .filter((path) => relative(root, path) !== self && !MIGRATION_REHEARSALS.has(relative(root, path)))
      .flatMap((path) => {
        const text = readFileSync(path, "utf8");
        return RETIRED_IDENTIFIERS.filter((identifier) => text.includes(identifier)).map(
          (identifier) => `${relative(root, path)}: ${identifier}`,
        );
      });
    expect(offenders).toEqual([]);
  });
});

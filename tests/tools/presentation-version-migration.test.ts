import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { expect, it } from "vitest";

it("backfills a legacy presentation with no uploader against the pre-versioning schema", async () => {
  const migrations = await readD1Migrations(path.resolve(import.meta.dirname, "../../migrations"));
  const versioningIndex = migrations.findIndex((migration) => migration.name === "0033_presentation_versions.sql");
  const invariants = migrations.find((migration) => migration.name === "0034_presentation_version_invariants.sql");
  if (versioningIndex < 0 || !invariants) throw new Error("Missing presentation version migrations");

  const db = new DatabaseSync(":memory:");
  try {
    // Replay the real historical schema rather than reversing today's tables and views.
    for (const migration of migrations.slice(0, versioningIndex)) {
      for (const query of migration.queries) db.exec(query);
    }
    db.exec(`
      INSERT INTO events (id, slug, name, timezone, created_at, updated_at)
      VALUES ('legacy-event', 'legacy-event', 'Legacy event', 'UTC',
        '2026-01-01T12:00:00.000Z', '2026-01-01T12:00:00.000Z');
      INSERT INTO users (id, email, normalized_email)
      VALUES ('legacy-proposer', 'legacy-proposer@example.test', 'legacy-proposer@example.test');
      INSERT INTO session_proposals
        (id, event_id, proposer_user_id, status, proposal_type, title, abstract, manage_token_hash,
         presentation_r2_key, presentation_uploaded_at, presentation_uploaded_by_user_id, submitted_at, updated_at)
      VALUES ('legacy-proposal', 'legacy-event', 'legacy-proposer', 'accepted', 'talk', 'Legacy talk',
        'Synthetic legacy presentation.', 'legacy-manage-token', 'presentations/legacy.pdf', NULL, NULL,
        '2026-01-01T12:00:00.000Z', '2026-01-02T12:00:00.000Z');
    `);

    for (const migration of [migrations[versioningIndex]!, invariants]) {
      for (const query of migration.queries) db.exec(query);
    }

    const versions = db
      .prepare(`SELECT version_number, r2_key, uploaded_by_user_id, uploaded_at, is_current
        FROM presentation_versions WHERE proposal_id = 'legacy-proposal'`)
      .all();
    expect(versions).toEqual([
      {
        version_number: 1,
        r2_key: "presentations/legacy.pdf",
        uploaded_by_user_id: null,
        uploaded_at: "2026-01-02T12:00:00.000Z",
        is_current: 1,
      },
    ]);

    const columns = db
      .prepare("PRAGMA table_info(session_proposals)")
      .all()
      .map((column) => column.name);
    expect(columns).not.toContain("presentation_r2_key");
    expect(columns).not.toContain("presentation_uploaded_at");
    expect(columns).not.toContain("presentation_uploaded_by_user_id");
  } finally {
    db.close();
  }
});

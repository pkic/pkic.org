import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";
import { buildTemplateSqlStatements } from "../../scripts/lib/email-template-seed-sql.mjs";

const migrationDirectory = resolve(import.meta.dirname, "../../migrations");
const agendaMigration = "0038_event_agenda_platform.sql";
const templateKeys = [
  "agenda_changed",
  "event_proposal_verify",
  "registration_email_verify",
  "proposal_representation_review",
  "user_email_verification",
  "agenda_session_reminder",
  "agenda_session_invitation",
  "agenda_session_booking",
  "proposal_organizational_representation_request",
  "co_speaker_invite",
  "agenda_speaker_declined",
];

function beforeAgenda(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync(migrationDirectory)
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort()) {
    if (name === agendaMigration) break;
    db.exec(readFileSync(resolve(migrationDirectory, name), "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function templateRows(db: DatabaseSync) {
  return db.prepare("SELECT * FROM email_template_versions ORDER BY template_key, version").all();
}

describe("agenda migration and separate email template seeding", () => {
  it.each([false, true])("preserves templates with preexisting agenda templates: %s", (existing) => {
    const db = beforeAgenda();
    try {
      if (existing) {
        const insert = db.prepare(`INSERT INTO email_template_versions
          (id, template_key, version, subject_template, body, content_type, checksum_sha256, status, created_at)
          VALUES (?, ?, 1, 'Authored subject', 'Authored body', 'markdown', 'authored-checksum', 'active',
            '2026-01-01T00:00:00.000Z')`);
        for (const key of templateKeys) {
          db.prepare("DELETE FROM email_template_versions WHERE template_key = ?").run(key);
          insert.run(`authored-${key}`, key);
        }
      }
      const before = templateRows(db);
      db.exec(readFileSync(resolve(migrationDirectory, agendaMigration), "utf8"));
      expect(templateRows(db)).toEqual(before);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      db.close();
    }
  });

  it("seeds missing templates separately, preserves authored versions, and replaces only explicitly", () => {
    const db = beforeAgenda();
    try {
      db.exec(readFileSync(resolve(migrationDirectory, agendaMigration), "utf8"));
      db.exec(`INSERT INTO users (id, email, normalized_email, created_at, updated_at)
        VALUES ('seed-admin', 'admin@example.test', 'admin@example.test',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
      const templates = templateKeys.map((key) => {
        const template = DEFAULT_TEMPLATES.find((candidate) => candidate.key === key);
        expect(template, key).toBeDefined();
        return template!;
      });
      db.exec(`UPDATE email_template_versions SET body = 'Authored invitation', checksum_sha256 = 'authored-checksum',
        created_by_user_id = 'seed-admin' WHERE template_key = 'co_speaker_invite' AND status = 'active'`);
      const authored = db
        .prepare("SELECT * FROM email_template_versions WHERE template_key = 'co_speaker_invite'")
        .all();
      expect(authored).toHaveLength(1);

      const cli = { adminEmail: "admin@example.test", ifMissing: true };
      db.exec(buildTemplateSqlStatements(cli, templates));
      const seeded = templateRows(db);
      db.exec(buildTemplateSqlStatements(cli, templates));
      expect(templateRows(db)).toEqual(seeded);
      expect(
        db.prepare("SELECT * FROM email_template_versions WHERE template_key = 'co_speaker_invite'").all(),
      ).toEqual(authored);
      for (const template of templates) {
        const active = db
          .prepare("SELECT body FROM email_template_versions WHERE template_key = ? AND status = 'active'")
          .all(template.key);
        expect(active).toEqual([
          { body: template.key === "co_speaker_invite" ? "Authored invitation" : template.content },
        ]);
      }

      const invitation = templates.find((template) => template.key === "co_speaker_invite")!;
      db.exec(buildTemplateSqlStatements({ ...cli, ifMissing: false }, [invitation]));
      expect(
        db
          .prepare(
            "SELECT version, body, status FROM email_template_versions WHERE template_key = 'co_speaker_invite' ORDER BY version",
          )
          .all(),
      ).toEqual([
        { version: 1, body: "Authored invitation", status: "archived" },
        { version: 2, body: invitation.content, status: "active" },
      ]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

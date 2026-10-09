import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";

const directory = resolve(import.meta.dirname, "../../migrations");
const migrationName = "0038_membership_review_digest_templates.sql";
const migration = readFileSync(resolve(directory, migrationName), "utf8");
const templates = DEFAULT_TEMPLATES.filter(
  (item) => item.key === "membership-workflow-review-digest" || item.key.startsWith("partial_membership_review_"),
);

function beforeUpgrade() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory)
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort()) {
    if (name === migrationName) break;
    db.exec(readFileSync(resolve(directory, name), "utf8"));
  }
  return db;
}

const columns = "id, template_key, version, body, subject_template, content_type, checksum_sha256, status, created_at";

describe("membership review digest template upgrade", () => {
  it("makes all digest templates available without running a seed script", () => {
    const db = beforeUpgrade();
    try {
      db.exec(migration);
      for (const template of templates) {
        const row = db
          .prepare(
            `SELECT ${columns}, message_type, created_by_user_id FROM email_template_versions WHERE template_key = ?`,
          )
          .get(template.key);
        expect(row).toMatchObject({
          template_key: template.key,
          version: 1,
          body: template.content,
          subject_template: template.subjectTemplate,
          content_type: template.contentType,
          checksum_sha256: createHash("sha256").update(template.content).digest("hex"),
          status: "active",
          message_type: "transactional",
          created_by_user_id: null,
          created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        });
      }
      const before = db.prepare(`SELECT ${columns} FROM email_template_versions ORDER BY id`).all();
      db.exec(migration);
      expect(db.prepare(`SELECT ${columns} FROM email_template_versions ORDER BY id`).all()).toEqual(before);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("preserves active portal edits and unrelated templates when only some digest templates are missing", () => {
    const db = beforeUpgrade();
    try {
      db.prepare(
        `INSERT INTO email_template_versions
        (id, template_key, version, body, content_type, checksum_sha256, status, created_at)
        VALUES ('edited-summary', 'partial_membership_review_summary', 4, 'Custom organization summary', 'markdown', 'custom-checksum', 'active', '2026-10-09T00:00:00.000Z')`,
      ).run();
      const before = db.prepare(`SELECT ${columns} FROM email_template_versions ORDER BY id`).all();
      db.exec(migration);
      const after = db.prepare(`SELECT ${columns} FROM email_template_versions ORDER BY id`).all();
      expect(after).toEqual(expect.arrayContaining(before));
      expect(after).toHaveLength(before.length + 2);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM email_template_versions WHERE template_key = 'partial_membership_review_summary'",
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("adds the next active version without altering draft or archived history", () => {
    const db = beforeUpgrade();
    try {
      db.exec(`INSERT INTO email_template_versions
        (id, template_key, version, body, content_type, checksum_sha256, status, created_at)
        VALUES ('archived-details', 'partial_membership_review_details', 2, 'Previous details', 'markdown', 'old', 'archived', '2026-10-09T00:00:00.000Z'),
               ('draft-details', 'partial_membership_review_details', 5, 'Draft form details', 'markdown', 'draft', 'draft', '2026-10-09T00:00:00.000Z')`);
      const history = db
        .prepare(
          `SELECT ${columns} FROM email_template_versions WHERE template_key = 'partial_membership_review_details' ORDER BY version`,
        )
        .all();
      db.exec(migration);
      const after = db
        .prepare(
          `SELECT ${columns} FROM email_template_versions WHERE template_key = 'partial_membership_review_details' ORDER BY version`,
        )
        .all();
      expect(after.slice(0, 2)).toEqual(history);
      expect(after[2]).toMatchObject({
        version: 6,
        status: "active",
        body: templates.find((item) => item.key === "partial_membership_review_details")!.content,
      });
    } finally {
      db.close();
    }
  });
});

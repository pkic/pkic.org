import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  buildPlaceholderEmailStatement,
  placeholderPreflightQuery,
} from "../../scripts/migrate-members/placeholder-email.mjs";
import {
  buildIndividualMemberAggregateStatements,
  buildUpsertUserStatements,
} from "../../scripts/migrate-members/sql-renderer.mjs";

let db: DatabaseSync | undefined;
afterEach(() => db?.close());
const mapping = { previousEmail: "unmatched-ada@members.invalid", email: "ada@users.example" };
function setup() {
  db = new DatabaseSync(":memory:");
  const directory = path.resolve("migrations");
  for (const file of fs
    .readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(directory, file), "utf8"));
  }
  db.exec(
    buildUpsertUserStatements({
      email: mapping.previousEmail,
      firstName: "Ada",
      lastName: "User",
      jobTitle: null,
      biography: null,
      linksJson: null,
      headshotR2Key: null,
    }).statements.join("\n"),
  );
  db.exec(buildIndividualMemberAggregateStatements(mapping.previousEmail, "H6", "2020-01-01").join("\n"));
  return db;
}

function reservePending(database: DatabaseSync, userId: string) {
  database.exec(
    "INSERT INTO events (id, slug, name, timezone, created_at, updated_at) VALUES ('forms-event', 'forms-event', 'Forms Workshop', 'UTC', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  );
  database
    .prepare(
      `INSERT INTO registrations (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
    VALUES ('registration', 'forms-event', ?, 'pending_email_confirmation', 'virtual', 'public', 'test-token', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(userId);
  database
    .prepare(
      "UPDATE users SET pending_email = 'ada@users.example', pending_email_change_registration_id = 'registration' WHERE id = ?",
    )
    .run(userId);
}

describe("approved placeholder email replacement", () => {
  it("preserves user and membership IDs and is idempotent", () => {
    const database = setup();
    const original = database.prepare("SELECT id FROM users").get();
    const member = database.prepare("SELECT id, user_id FROM members").get();
    expect(database.prepare(placeholderPreflightQuery([mapping])!).all()).toEqual([]);
    database.exec(buildPlaceholderEmailStatement(mapping));
    database.exec(buildPlaceholderEmailStatement(mapping));
    expect(database.prepare("SELECT id FROM users").get()).toEqual(original);
    expect(database.prepare("SELECT id, user_id FROM members").get()).toEqual(member);
    expect(database.prepare("SELECT email, normalized_email FROM users").get()).toEqual({
      email: mapping.email,
      normalized_email: mapping.email,
    });
  });

  it.each(["primary", "pending", "alternate"])(
    "refuses to merge a placeholder into an existing %s reservation",
    (kind) => {
      const database = setup();
      database.exec(
        "INSERT INTO users (id, email, normalized_email) VALUES ('other', 'other@users.example', 'other@users.example')",
      );
      if (kind === "primary")
        database.exec(
          "UPDATE users SET email = 'ada@users.example', normalized_email = 'ada@users.example' WHERE id = 'other'",
        );
      if (kind === "pending") reservePending(database, "other");
      if (kind === "alternate")
        database.exec(
          "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES ('alternate', 'other', 'ada@users.example', 'ada@users.example', '2026-01-01T00:00:00.000Z')",
        );
      expect(database.prepare(placeholderPreflightQuery([mapping])!).all()).toHaveLength(1);
      expect(() => database.exec(buildPlaceholderEmailStatement(mapping))).toThrow();
      expect(
        database.prepare("SELECT id FROM users WHERE normalized_email = ?").get(mapping.previousEmail),
      ).toBeTruthy();
    },
  );

  it("refuses to replace a placeholder during its pending email-change workflow", () => {
    const database = setup();
    const user = database.prepare("SELECT id FROM users").get()!;
    reservePending(database, String(user.id));
    expect(database.prepare(placeholderPreflightQuery([mapping])!).all()).toHaveLength(1);
    database.exec(buildPlaceholderEmailStatement(mapping));
    expect(database.prepare("SELECT normalized_email FROM users").get()).toEqual({
      normalized_email: mapping.previousEmail,
    });
  });

  it.each(["pii_redacted_at = '2026-01-01T00:00:00.000Z'", "active = 0"])(
    "refuses a changed placeholder: %s",
    (assignment) => {
      const database = setup();
      database.exec(`UPDATE users SET ${assignment}`);
      expect(database.prepare(placeholderPreflightQuery([mapping])!).all()).toHaveLength(1);
      database.exec(buildPlaceholderEmailStatement(mapping));
      expect(database.prepare("SELECT normalized_email FROM users").get()).toEqual({
        normalized_email: mapping.previousEmail,
      });
    },
  );
});

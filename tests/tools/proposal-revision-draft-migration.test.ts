import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

const directory = resolve(import.meta.dirname, "../../migrations");
const migration = "0040_proposal_revision_drafts.sql";

it("adds a nullable revision draft without changing existing proposals", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(directory)
      .filter((name) => /^\d.*\.sql$/.test(name))
      .sort()) {
      if (name === migration) break;
      db.exec(readFileSync(resolve(directory, name), "utf8"));
    }
    db.exec("PRAGMA foreign_keys = ON");
    const at = "2026-10-20T10:00:00.000Z";
    db.prepare(
      "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES ('migration-proposer','migration@example.test','migration@example.test',1,?,?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES ('migration-event','migration-event','Synthetic migration event','UTC','invite_or_open','{}',?,?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO session_proposals(id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at) VALUES ('migration-proposal','migration-event','migration-proposer','needs-work','talk','Previously reviewed title','Previously reviewed abstract','synthetic-unused-secret',?,?)",
    ).run(at, at);
    const before = db
      .prepare("SELECT title,abstract,status,review_round FROM session_proposals WHERE id='migration-proposal'")
      .get();
    db.exec(readFileSync(resolve(directory, migration), "utf8"));
    expect(
      db
        .prepare("SELECT title,abstract,status,review_round FROM session_proposals WHERE id='migration-proposal'")
        .get(),
    ).toEqual(before);
    expect(db.prepare("SELECT revision_draft_json FROM session_proposals WHERE id='migration-proposal'").get()).toEqual(
      { revision_draft_json: null },
    );
    const draft = JSON.stringify({ title: "Unsubmitted draft" });
    db.prepare("UPDATE session_proposals SET revision_draft_json=? WHERE id='migration-proposal'").run(draft);
    expect(() =>
      db
        .prepare("UPDATE session_proposals SET revision_draft_json=? WHERE id='migration-proposal'")
        .run("malformed JSON"),
    ).toThrow();
    expect(db.prepare("SELECT revision_draft_json FROM session_proposals WHERE id='migration-proposal'").get()).toEqual(
      { revision_draft_json: draft },
    );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

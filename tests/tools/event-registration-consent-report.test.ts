import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const query = readFileSync(join(process.cwd(), "scripts/reports/event-registration-consent.sql"), "utf8");

describe("historical event-confirmation identity review", () => {
  it("reports temporal candidates with history, paginates, and leaves every row unchanged", () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (const file of readdirSync("migrations")
        .filter((file) => file.endsWith(".sql"))
        .sort())
        db.exec(readFileSync(join("migrations", file), "utf8"));
      const at = "2026-09-09T12:00:00.000Z";
      db.prepare(
        "INSERT INTO users(id,email,normalized_email,first_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ).run("review-user", "review@example.test", "review@example.test", "Review", at, at);
      db.prepare("INSERT INTO organizations(id,name,normalized_name,created_at,updated_at) VALUES(?,?,?,?,?)").run(
        "review-org",
        "Review",
        "review",
        at,
        at,
      );
      db.prepare("INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(
        "review-event",
        "review-event",
        "Review",
        "UTC",
        at,
        at,
      );
      db.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "review-registration",
        "review-event",
        "review-user",
        "registered",
        "virtual",
        "public",
        "synthetic-review-secret",
        at,
        at,
        at,
      );
      db.prepare(
        "INSERT INTO members(id,member_type,organization_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ).run("review-member", "organization", "review-org", "active", at, at);
      const identity = db.prepare(
        "INSERT INTO identities(id,user_id,organization_id,source,invited_at,started_at,ended_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      );
      for (const [id, source, created] of [
        ["candidate-a", "verified_domain", at],
        ["candidate-b", "verified_domain", at],
        ["explicit", "staff", at],
        ["unrelated", "verified_domain", "2026-09-08T12:00:00.000Z"],
      ])
        identity.run(id, "review-user", "review-org", source, created, created, created, created, created);
      db.prepare(
        "INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        "review-audit",
        "member",
        "review-user",
        "identity_updated",
        "identity",
        "candidate-b",
        "2026-09-10T12:00:00.000Z",
      );
      const before = db.prepare("SELECT total_changes() AS total").get();
      const statement = db.prepare(query);
      const first = statement.get("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", "", "", 1)!;
      expect(first.identity_id).toBe("candidate-a");
      expect(JSON.parse(String(first.nearby_registration_ids))).toEqual(["review-registration"]);
      const second = statement.get("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", at, "candidate-a", 1)!;
      expect(second.identity_id).toBe("candidate-b");
      expect(second.has_later_identity_audit).toBe(1);
      expect(statement.all("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z", at, "candidate-b", 100)).toEqual([]);
      expect(db.prepare("SELECT total_changes() AS total").get()).toEqual(before);
    } finally {
      db.close();
    }
  });
});

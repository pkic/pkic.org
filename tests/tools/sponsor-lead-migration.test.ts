import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = "0054_sponsor_lead_scan_removal.sql";
const at = "2026-10-04T10:00:00.000Z";

describe("sponsor lead removal migration", () => {
  it("carries earlier withdrawals into scan rows and removes the interim table", () => {
    const db = new DatabaseSync(":memory:");
    const directory = resolve("migrations");
    db.exec("PRAGMA foreign_keys=ON");
    try {
      for (const name of readdirSync(directory)
        .filter((name) => name.endsWith(".sql") && name < migration)
        .sort()) {
        db.exec(readFileSync(resolve(directory, name), "utf8"));
      }
      const eventId = crypto.randomUUID();
      const sponsorId = crypto.randomUUID();
      const operatorId = crypto.randomUUID();
      db.prepare("INSERT INTO users(id,email,normalized_email) VALUES(?,?,?)").run(
        operatorId,
        "operator@synthetic.test",
        "operator@synthetic.test",
      );
      db.prepare(
        "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,?,'Synthetic event','UTC',?,?)",
      ).run(eventId, "synthetic-event", at, at);
      db.prepare(
        "INSERT INTO sponsorships(id,sponsor_type,event_id,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'active',?,?)",
      ).run(sponsorId, eventId, at, at);
      const leads = [crypto.randomUUID(), crypto.randomUUID()].map((userId) => ({
        userId,
        leadId: crypto.randomUUID(),
      }));
      for (const [index, lead] of leads.entries()) {
        const email = `attendee${index}@synthetic.test`;
        db.prepare("INSERT INTO users(id,email,normalized_email) VALUES(?,?,?)").run(lead.userId, email, email);
        db.prepare(
          "INSERT INTO event_sponsor_leads(id,event_id,sponsor_id,user_id,operator_user_id,observed_at) VALUES(?,?,?,?,?,?)",
        ).run(lead.leadId, eventId, sponsorId, lead.userId, operatorId, at);
      }
      const scan = (userId: string, operationId: string) => {
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO event_scan_attempts
          (id,event_id,sponsor_id,user_id,operator_user_id,device_id,operation_id,request_hash,
            outcome,reason,action,observed_at,created_at,scanned_value)
          VALUES(?,?,?,?,?,?,?,?,'eligible','captured','lead',?,?,?)`).run(
          id,
          eventId,
          sponsorId,
          userId,
          operatorId,
          crypto.randomUUID(),
          operationId,
          "original_hash",
          at,
          at,
          "SYNTHETIC_BADGE",
        );
        return id;
      };
      const survivingScan = scan(leads[0].userId, crypto.randomUUID());
      const removedScans = [scan(leads[0].userId, crypto.randomUUID()), scan(leads[1].userId, crypto.randomUUID())];
      db.prepare("UPDATE event_evidence_retention_state SET capture_closed_at=? WHERE event_id=?").run(at, eventId);
      for (const [index, attemptId] of removedScans.entries()) {
        const removalId = crypto.randomUUID();
        db.prepare(
          "INSERT INTO event_sponsor_lead_removed_attempts(attempt_id,lead_id,removal_id,removed_by_user_id,removed_at) VALUES(?,?,?,?,?)",
        ).run(attemptId, leads[index].leadId, removalId, operatorId, at);
        db.prepare(
          "INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,created_at) VALUES(?,'user',?,'sponsor_lead_captures_removed','event_sponsor_lead',?,?)",
        ).run(removalId, operatorId, leads[index].leadId, at);
      }

      db.exec(readFileSync(resolve(directory, migration), "utf8"));
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='event_sponsor_lead_removed_attempts'")
          .get(),
      ).toBeUndefined();
      expect(db.prepare("SELECT id FROM event_sponsor_leads ORDER BY id").all()).toEqual([{ id: leads[0].leadId }]);
      expect(db.prepare("SELECT user_id FROM event_scan_attempts WHERE id=?").get(survivingScan)).toEqual({
        user_id: leads[0].userId,
      });
      for (const attemptId of removedScans) {
        const row = db
          .prepare(
            "SELECT user_id,badge_id,scanned_value,request_hash,sponsor_lead_removed_at,sponsor_lead_removal_id FROM event_scan_attempts WHERE id=?",
          )
          .get(attemptId);
        expect(row).toMatchObject({ user_id: null, badge_id: null, scanned_value: null, sponsor_lead_removed_at: at });
        expect(row?.request_hash).not.toBe("original_hash");
        expect(row?.sponsor_lead_removal_id).toBeTruthy();
      }
    } finally {
      db.close();
    }
  });
});

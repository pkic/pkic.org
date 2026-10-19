import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";

function databaseBeforeLogoPeriods() {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0038_")
    .sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  return db;
}
function seed(db: DatabaseSync, id: string, stage: string, start: string | null, renewal = "2026-10-01") {
  db.prepare(`INSERT INTO sponsorships(id,sponsor_type,non_member_name,tier,pipeline_stage,start_date,renewal_date,created_at,updated_at)
    VALUES(?,'consortium',?,'Gold',?,?,?,'2026-01-01T00:00:00.000Z','2026-10-17T12:00:00.000Z')`).run(
    id,
    id,
    stage,
    start,
    renewal,
  );
}
const migration = () => readFileSync("migrations/0038_event_agenda_platform.sql", "utf8");
describe("sponsorship period backfill", () => {
  it("imports only the last evidenced period, normalizes dates, and grants recently lapsed logos their original deadline", () => {
    const db = databaseBeforeLogoPeriods();
    try {
      seed(db, "active", "active", "2025-01-01");
      seed(db, "lapsed", "lapsed", "2026-01-01");
      seed(db, "unproven", "lapsed", null);
      seed(db, "early", "lapsed", "2026-01-01", "2027-01-01");
      db.prepare(`INSERT INTO sponsorship_events(id,sponsorship_id,from_stage,to_stage,created_at)
        VALUES('activation','active','lapsed','active','2026-04-01T09:30:00.000Z')`).run();
      db.exec(migration());
      expect(
        db
          .prepare(
            `SELECT sponsorship_id,started_at,scheduled_end_at,end_reason FROM sponsorship_periods ORDER BY sponsorship_id`,
          )
          .all(),
      ).toEqual([
        {
          sponsorship_id: "active",
          started_at: "2026-04-01T09:30:00.000Z",
          scheduled_end_at: "2026-10-01T00:00:00.000Z",
          end_reason: null,
        },
        {
          sponsorship_id: "early",
          started_at: "2026-01-01T00:00:00.000Z",
          scheduled_end_at: "2027-01-01T00:00:00.000Z",
          end_reason: "termination",
        },
        {
          sponsorship_id: "lapsed",
          started_at: "2026-01-01T00:00:00.000Z",
          scheduled_end_at: "2026-10-01T00:00:00.000Z",
          end_reason: "ordinary_expiry",
        },
      ]);
      expect(db.prepare("SELECT logo_action_due_at FROM sponsorships WHERE id='lapsed'").get()).toEqual({
        logo_action_due_at: "2026-12-30T00:00:00.000Z",
      });
      expect(db.prepare("SELECT logo_action_due_at FROM sponsorships WHERE id='unproven'").get()).toEqual({
        logo_action_due_at: null,
      });
    } finally {
      db.close();
    }
  });
  it.each(["refunded", "disputed"])("does not resurrect a previously %s sponsor", (status) => {
    const db = databaseBeforeLogoPeriods();
    try {
      seed(db, "withdrawn", "lapsed", "2026-01-01");
      db.prepare(`INSERT INTO payment_ledger_entries(id,purpose,resource_type,resource_id,status,created_at,updated_at)
        VALUES('payment','sponsorship','sponsorship','withdrawn',?,'2026-10-16T00:00:00.000Z','2026-10-16T00:00:00.000Z')`).run(
        status,
      );
      db.exec(migration());
      expect(db.prepare("SELECT ended_reason,logo_action_due_at FROM sponsorships WHERE id='withdrawn'").get()).toEqual(
        { ended_reason: status === "refunded" ? "refund" : "dispute", logo_action_due_at: null },
      );
    } finally {
      db.close();
    }
  });
});

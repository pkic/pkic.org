import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { exportSponsorLeads } from "../../functions/_lib/services/event-participation/lead-export";
import { csvResponse } from "../../functions/_lib/csv";
import type { DatabaseLike, StatementLike } from "../../functions/_lib/db/types";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  const db: DatabaseLike = {
    prepare(sql) {
      let values: SQLInputValue[] = [];
      const statement: StatementLike = {
        bind(...v) {
          values = v as SQLInputValue[];
          return statement;
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...values) ?? null) as T | null;
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...values) as T[] };
        },
        async run() {
          throw new Error("Export must not mutate");
        },
      };
      return statement;
    },
    async batch() {
      throw new Error("Export must not mutate");
    },
  };
  sqlite.exec(`INSERT INTO users(id,email,normalized_email,first_name,last_name,organization_name,active) VALUES('operator','operator@example.test','operator@example.test','Operator','','',1),('attendee','attendee@example.test','attendee@example.test','=HYPERLINK("bad")','Example','Synthetic org',1);
 INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES('event','export-test','Export test','UTC','{}','2026-10-03','2026-10-03'),('other-event','other-event','Other event','UTC','{}','2026-10-03','2026-10-03');
 INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES('sponsor','event','event','Synthetic sponsor','active','2026-10-03','2026-10-03'),('other-sponsor','event','event','Other sponsor','active','2026-10-03','2026-10-03');
 INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES('registration','event','attendee','registered','in_person','test','synthetic','2026-10-03','2026-10-03');
 INSERT INTO event_sponsor_leads(id,event_id,sponsor_id,user_id,operator_user_id,observed_at) VALUES('lead','event','sponsor','attendee','operator','2026-10-03T10:00:00Z');
 INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES('grant','operator','agenda:leads_export','event_sponsor','sponsor','2026-10-03');
 INSERT INTO event_terms(id,event_id,audience_type,term_key,version,active,created_at) VALUES('term','event','attendee','sponsor-data-sharing','1',1,'2026-10-03');
 INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at) VALUES('consent','registration','event','attendee','attendee','sponsor-data-sharing','1','2026-10-03T10:00:00Z');`);
  return { sqlite, db };
}
describe("sponsor lead export", () => {
  it("exports live contacts only for the selected sponsor with safe CSV fields and no-store", async () => {
    const { sqlite, db } = fixture();
    try {
      const csv = await exportSponsorLeads(db, "event", "sponsor", "operator");
      expect(csv).toContain("attendee@example.test");
      expect(csv).toContain(`"'=HYPERLINK(""bad"") Example"`);
      expect(csvResponse(csv, "leads.csv").headers.get("cache-control")).toBe("no-store");
      sqlite.exec("UPDATE users SET email='updated@example.test' WHERE id='attendee'");
      expect(await exportSponsorLeads(db, "event", "sponsor", "operator")).toContain("updated@example.test");
    } finally {
      sqlite.close();
    }
  });
  it("rejects another sponsor, another event, expired scope and capture-only scope", async () => {
    const { sqlite, db } = fixture();
    try {
      await expect(exportSponsorLeads(db, "event", "other-sponsor", "operator")).rejects.toMatchObject({ status: 403 });
      await expect(exportSponsorLeads(db, "other-event", "sponsor", "operator")).rejects.toMatchObject({ status: 404 });
      sqlite.exec("UPDATE permission_grants SET expires_at='2000-01-01T00:00:00Z'");
      await expect(exportSponsorLeads(db, "event", "sponsor", "operator")).rejects.toMatchObject({ status: 403 });
      sqlite.exec("UPDATE permission_grants SET expires_at=NULL,permission='agenda:leads_capture'");
      await expect(exportSponsorLeads(db, "event", "sponsor", "operator")).rejects.toMatchObject({ status: 403 });
    } finally {
      sqlite.close();
    }
  });
  it("excludes withdrawn consent, other audiences and cancelled registrations", async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.exec("UPDATE consent_acceptances SET audience_type='speaker'");
      expect(await exportSponsorLeads(db, "event", "sponsor", "operator")).not.toContain("attendee@example.test");
      sqlite.exec(
        "UPDATE consent_acceptances SET audience_type='attendee';UPDATE registrations SET status='cancelled'",
      );
      expect(await exportSponsorLeads(db, "event", "sponsor", "operator")).not.toContain("attendee@example.test");
      sqlite.exec("UPDATE registrations SET status='registered';DELETE FROM consent_acceptances");
      expect(await exportSponsorLeads(db, "event", "sponsor", "operator")).not.toContain("attendee@example.test");
    } finally {
      sqlite.close();
    }
  });
  it("requires acceptance of the current active attendee consent version", async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.exec("UPDATE event_terms SET version='2'");
      expect(await exportSponsorLeads(db, "event", "sponsor", "operator")).not.toContain("attendee@example.test");
      sqlite.exec("UPDATE consent_acceptances SET term_version='2'");
      expect(await exportSponsorLeads(db, "event", "sponsor", "operator")).toContain("attendee@example.test");
      sqlite.exec("UPDATE event_terms SET active=0");
      expect(await exportSponsorLeads(db, "event", "sponsor", "operator")).not.toContain("attendee@example.test");
    } finally {
      sqlite.close();
    }
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";

const fixture = createEventScannerFixture();
const timestamp = "2026-10-04T10:00:00.000Z";

/** A real FK-connected graph includes imports, corrections and scanners with no grant. */
async function evidenceGraph() {
  const id = () => crypto.randomUUID();
  const attempt = id(),
    observation = id(),
    review = id(),
    imported = id(),
    grant = id(),
    epoch = id();
  const badge = await env.DB.prepare("SELECT id FROM event_badge_credentials WHERE event_id=? AND user_id=?")
    .bind(fixture.eventId, fixture.userId)
    .first<{ id: string }>();
  const definitions = [
    [
      "event_scan_attempts",
      "event_id",
      "INSERT INTO event_scan_attempts(id,event_id,occurrence_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,'eligible','eligible','attendance',?,?)",
      [
        attempt,
        fixture.eventId,
        fixture.occurrenceId,
        badge!.id,
        fixture.userId,
        fixture.operatorId,
        id(),
        id(),
        "synthetic-hash",
        timestamp,
        timestamp,
      ],
    ],
    [
      "event_attendance_observations",
      "event_id",
      "INSERT INTO event_attendance_observations(id,attempt_id,event_id,occurrence_id,user_id,attendance_mode,observed_at) VALUES(?,?,?,?,?,'physical',?)",
      [observation, attempt, fixture.eventId, fixture.occurrenceId, fixture.userId, timestamp],
    ],
    [
      "event_attendance_corrections",
      "event_id",
      "INSERT INTO event_attendance_corrections(id,observation_id,event_id,actor_user_id,operation_id,revision,kind,reason_code,created_at) VALUES(?,?,?,?,?,1,'restore','verified_evidence_review',?)",
      [id(), observation, fixture.eventId, fixture.operatorId, id(), timestamp],
    ],
    [
      "event_attendance_correction_state",
      "observation_id",
      "INSERT INTO event_attendance_correction_state(observation_id,revision,voided) VALUES(?,1,0)",
      [observation],
    ],
    [
      "event_attendance_import_reviews",
      "event_id",
      "INSERT INTO event_attendance_import_reviews(id,event_id,operation_id,actor_user_id,payload_hash,payload_json,reviewed_at,expires_at) VALUES(?,?,?,?,?,'{}',?,?)",
      [review, fixture.eventId, id(), fixture.operatorId, "synthetic-hash", timestamp, "2026-10-04T11:00:00.000Z"],
    ],
    [
      "event_attendance_imports",
      "event_id",
      "INSERT INTO event_attendance_imports(id,event_id,operation_id,review_id,reviewer_user_id,actor_user_id,source,source_reference,row_count,received_at) VALUES(?,?,?,?,?,?,'manual_evidence','synthetic',1,?)",
      [imported, fixture.eventId, id(), review, fixture.operatorId, fixture.operatorId, timestamp],
    ],
    [
      "event_attendance_import_provenance",
      "event_id",
      "INSERT INTO event_attendance_import_provenance(observation_id,import_id,event_id,source,source_reference,source_record_id,verification) VALUES(?,?,?,'manual_evidence','synthetic','record-one','unverified')",
      [observation, imported, fixture.eventId],
    ],
    [
      "event_sponsor_leads",
      "event_id",
      "INSERT INTO event_sponsor_leads(id,event_id,sponsor_id,user_id,operator_user_id,observed_at) VALUES(?,?,'synthetic-sponsor',?,?,?)",
      [id(), fixture.eventId, fixture.userId, fixture.operatorId, timestamp],
    ],
    [
      "event_offline_admission_grants",
      "event_id",
      "INSERT INTO event_offline_admission_grants(id,event_id,occurrence_id,day_date,operator_user_id,device_id,quantity,issued_at,expires_at,created_by) VALUES(?,?,?,'2026-10-04',?,?,0,?,?,?)",
      [
        grant,
        fixture.eventId,
        fixture.occurrenceId,
        fixture.operatorId,
        id(),
        timestamp,
        "2026-10-04T11:00:00.000Z",
        fixture.operatorId,
      ],
    ],
    [
      "event_offline_admission_entitlements",
      "grant_id",
      "INSERT INTO event_offline_admission_entitlements(grant_id,user_id) VALUES(?,?)",
      [grant, fixture.userId],
    ],
    [
      "event_offline_admission_access",
      "grant_id",
      "INSERT INTO event_offline_admission_access(grant_id,user_id) VALUES(?,?)",
      [grant, fixture.userId],
    ],
    [
      "event_offline_admission_spends",
      "grant_id",
      "INSERT INTO event_offline_admission_spends(operation_id,grant_id,user_id,observed_at,accepted_at) VALUES(?,?,?,?,?)",
      [id(), grant, fixture.userId, timestamp, timestamp],
    ],
    [
      "event_entry_admissions",
      "event_id",
      "INSERT INTO event_entry_admissions(id,event_id,day_date,user_id,operation_id,admitted_at) VALUES(?,?,'2026-10-04',?,?,?)",
      [id(), fixture.eventId, fixture.userId, id(), timestamp],
    ],
    [
      "event_session_admissions",
      "event_id",
      "INSERT INTO event_session_admissions(id,event_id,occurrence_id,user_id,operation_id,admitted_at) VALUES(?,?,?,?,?,?)",
      [id(), fixture.eventId, fixture.occurrenceId, fixture.userId, id(), timestamp],
    ],
    [
      "event_badge_credentials",
      "event_id",
      "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at) VALUES(?,?,?,?,?)",
      [id(), fixture.eventId, fixture.userId, id(), timestamp],
    ],
    [
      "event_scanner_device_sessions",
      "event_id",
      "INSERT INTO event_scanner_device_sessions(id,event_id,operator_user_id,device_id,enrollment_operation_id,opened_at) VALUES(?,?,?,?,?,?)",
      [epoch, fixture.eventId, fixture.operatorId, id(), id(), timestamp],
    ],
    [
      "event_scanner_upload_receipts",
      "epoch_id",
      "INSERT INTO event_scanner_upload_receipts(epoch_id,sequence,operation_id,request_hash,response_json,received_at) VALUES(?,1,?,?,'{}',?)",
      [epoch, id(), "synthetic-hash", timestamp],
    ],
  ] as const;
  await env.DB.batch(definitions.map(([, , sql, values]) => env.DB.prepare(sql).bind(...values)));
  return definitions;
}

async function generation() {
  return (await env.DB.prepare("SELECT generation FROM event_evidence_retention_state WHERE event_id=?")
    .bind(fixture.eventId)
    .first<{ generation: number }>())!.generation;
}

describe("Raw evidence source generation and terminal capture fencing", () => {
  beforeEach(fixture.setup);
  it("tracks every identifying chain and rejects all writes when a reviewed run owns the fence", async () => {
    const before = await generation();
    const definitions = await evidenceGraph();
    expect(await generation()).toBe(before + definitions.length);
    await env.DB.prepare("UPDATE event_evidence_retention_state SET active_run_id=? WHERE event_id=?")
      .bind(crypto.randomUUID(), fixture.eventId)
      .run();
    for (const [table, column, sql, values] of definitions) {
      await expect(
        env.DB.prepare(sql)
          .bind(...values)
          .run(),
      ).rejects.toThrow("EVENT_EVIDENCE_CAPTURE_CLOSED");
      await expect(env.DB.prepare(`UPDATE ${table} SET ${column}=${column}`).run()).rejects.toThrow(
        "EVENT_EVIDENCE_CAPTURE_CLOSED",
      );
      await expect(env.DB.prepare(`DELETE FROM ${table}`).run()).rejects.toThrow("EVENT_EVIDENCE_CAPTURE_CLOSED");
    }
    expect(await generation()).toBe(before + definitions.length);
  });
  it("prevents reopening retired capture and rolls back a batch with a late write", async () => {
    await evidenceGraph();
    await env.DB.prepare("UPDATE event_evidence_retention_state SET capture_closed_at=? WHERE event_id=?")
      .bind(timestamp, fixture.eventId)
      .run();
    await expect(
      env.DB.prepare("UPDATE event_evidence_retention_state SET capture_closed_at=NULL WHERE event_id=?")
        .bind(fixture.eventId)
        .run(),
    ).rejects.toThrow("EVENT_EVIDENCE_CAPTURE_CLOSED");
    await expect(
      env.DB.batch([
        env.DB.prepare(
          "INSERT INTO event_evidence_retention_policies(event_id,revision,evidence_until,purpose_code,legal_hold,updated_by,updated_at) VALUES(?,1,?,'attendance_reporting',0,?,?)",
        ).bind(fixture.eventId, timestamp, fixture.operatorId, timestamp),
        env.DB.prepare("DELETE FROM event_sponsor_leads WHERE event_id=?").bind(fixture.eventId),
      ]),
    ).rejects.toThrow("EVENT_EVIDENCE_CAPTURE_CLOSED");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM event_evidence_retention_policies WHERE event_id=?")
        .bind(fixture.eventId)
        .first(),
    ).toEqual({ total: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM event_sponsor_leads WHERE event_id=?")
        .bind(fixture.eventId)
        .first(),
    ).toEqual({ total: 1 });
  });
  it("advances source generation for mutation/removal and cannot move it backwards", async () => {
    await evidenceGraph();
    const before = await generation();
    await env.DB.prepare("UPDATE event_sponsor_leads SET observed_at=? WHERE event_id=?")
      .bind("2026-10-04T10:01:00.000Z", fixture.eventId)
      .run();
    await env.DB.prepare("DELETE FROM event_sponsor_leads WHERE event_id=?").bind(fixture.eventId).run();
    expect(await generation()).toBe(before + 2);
    await expect(
      env.DB.prepare("UPDATE event_evidence_retention_state SET generation=? WHERE event_id=?")
        .bind(before, fixture.eventId)
        .run(),
    ).rejects.toThrow("EVENT_EVIDENCE_GENERATION_CHANGED");
    expect(await generation()).toBe(before + 2);
  });
});

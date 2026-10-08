import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import { attendanceSummarySchema } from "../assets/shared/schemas/event-attendance-reporting";
import { enrolledOfflineEligibilityResponseSchema } from "../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanResponseSchema,
  offlineScanRecordSchema,
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
  type OfflineScanRecord,
} from "../assets/shared/schemas/event-participation-scanning";
import {
  scannerDeviceSessionEnrollmentSchema,
  scannerDeviceSessionEnrollmentResponseSchema,
} from "../assets/shared/schemas/event-scanner-devices";
import { sponsorLeadCapturesSchema, sponsorLeadListSchema } from "../assets/shared/schemas/event-sponsor-lead-list";
import {
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
} from "../assets/shared/schemas/registration";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import {
  physicalOccupiedSql,
  remoteOccupiedSql,
} from "../functions/_lib/services/event-participation/capacity-accounting";
import { publishedSessionsSql } from "../functions/_lib/services/event-participation/published-schedule";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { insertUser } from "./helpers/membership";

const fixture = createEventScannerFixture();
const base = "/api/v1/events/scan-test";
const headers = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

async function allocation() {
  const queries = [
    "SELECT id,user_id,status,attendance_type FROM registrations WHERE event_id=? ORDER BY id",
    "SELECT id,user_id,occurrence_id,status,attendance_mode,room_id,saved,approval_state,allocation_revision FROM agenda_session_participations WHERE event_id=? ORDER BY id",
    "SELECT id,occurrence_id,user_id,attendance_mode,room_id,expires_at,revoked_at FROM agenda_session_holds WHERE event_id=? ORDER BY id",
    `SELECT session.id,session.room_id,session.capacity,session.remote_capacity,${physicalOccupiedSql("session.id")} AS occupied,${remoteOccupiedSql("session.id")} AS remote_occupied FROM (${publishedSessionsSql}) session WHERE session.event_id=? ORDER BY session.id`,
    "SELECT id,capacity FROM event_agenda_rooms WHERE event_id=? ORDER BY id",
    "SELECT revision,published_revision FROM event_agenda_state WHERE event_id=?",
    "SELECT id FROM event_entry_admissions WHERE event_id=? ORDER BY id",
    "SELECT id FROM event_session_admissions WHERE event_id=? ORDER BY id",
  ];
  return Promise.all(queries.map((sql) => queryAll(env.DB, sql, fixture.eventId)));
}

async function ledger() {
  const queries = [
    "SELECT id,user_id,operator_user_id,device_id,operation_id,action,sponsor_id,outcome,reason,observed_at,capture_publication_revision,capture_time_zone FROM event_scan_attempts WHERE event_id=? ORDER BY operation_id",
    "SELECT id,attempt_id,user_id,occurrence_id,observed_at,attendance_mode FROM event_attendance_observations WHERE event_id=? ORDER BY id",
    "SELECT id,sponsor_id,user_id,operator_user_id,observed_at FROM event_sponsor_leads WHERE event_id=? ORDER BY id",
    "SELECT receipt.epoch_id,receipt.sequence,receipt.operation_id,receipt.request_hash,receipt.response_json FROM event_scanner_upload_receipts receipt JOIN event_scanner_device_sessions epoch ON epoch.id=receipt.epoch_id WHERE epoch.event_id=? ORDER BY receipt.operation_id",
  ];
  return Promise.all(queries.map((sql) => queryAll(env.DB, sql, fixture.eventId)));
}

async function upload(record: OfflineScanRecord, token: string) {
  const response = await callApi(env, `${base}/scans`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(record.scan),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const raw = await response.json();
  const receipt = enrolledEventScanResponseSchema.parse(raw);
  expect(receipt.operationId).toBe(record.scan.operationId);
  expect(receipt.scannerReceipt).toMatchObject({
    epochId: record.scan.scannerSession?.epochId,
    sequence: record.scan.scannerSession?.sequence,
    operationId: record.scan.operationId,
  });
  expect(JSON.stringify(raw)).not.toContain(`${fixture.userId}@example.test`);
  expect(JSON.stringify(raw)).not.toContain(fixture.badgeId);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("The mounted scanner response must be an object");
  expect(Object.keys(raw).sort()).toEqual(Object.keys(receipt).sort());
  return receipt;
}

describe("Combined enrolled attendance and sponsor lead reconciliation", () => {
  beforeEach(fixture.setup);

  it("reconciles two operators' original captures and repeated receipts without spending the last reserved place or bypassing consent and sponsor scope", async () => {
    const now = new Date().toISOString();
    const roomId = crypto.randomUUID(),
      sponsorId = crypto.randomUUID(),
      otherSponsorId = crypto.randomUUID();
    const secondOperator = await insertUser(env.DB);
    const rival = await insertUser(env.DB);
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Single place',1)")
      .bind(roomId, fixture.eventId)
      .run();
    await env.DB.prepare("UPDATE event_agenda_occurrences SET room_id=?,start_at=?,end_at=? WHERE id=?")
      .bind(
        roomId,
        new Date(Date.now() + 86400000).toISOString(),
        new Date(Date.now() + 90000000).toISOString(),
        fixture.occurrenceId,
      )
      .run();
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=0")
      .bind(JSON.stringify(await getAgenda(env.DB, fixture.eventId, "scan-test")), fixture.eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), fixture.eventId, rival, crypto.randomUUID(), now, now)
      .run();
    for (const id of [sponsorId, otherSponsorId])
      await env.DB.prepare(
        "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Synthetic sponsor','active',?,?)",
      )
        .bind(id, fixture.eventId, now, now)
        .run();
    for (const operator of [fixture.operatorId, secondOperator])
      for (const permission of ["agenda:leads_capture", "agenda:leads_view"])
        await env.DB.prepare(
          "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,'event_sponsor',?,?)",
        )
          .bind(crypto.randomUUID(), operator, permission, sponsorId, now)
          .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:attendance_record','event',?,?)",
    )
      .bind(crypto.randomUUID(), secondOperator, fixture.eventId, now)
      .run();
    const registrationId = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
      .bind(fixture.eventId, fixture.userId)
      .first<string>("id");
    expect(registrationId).toBeTruthy();
    await env.DB.prepare(
      "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,active,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','1',1,?)",
    )
      .bind(crypto.randomUUID(), fixture.eventId, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at) VALUES(?,?,?,?,'attendee','sponsor-data-sharing','1',?)",
    )
      .bind(crypto.randomUUID(), registrationId, fixture.eventId, fixture.userId, now)
      .run();

    // Allocation is the attendee policy's command, never a scanner side effect.
    const attendeeToken = await createAdminSession(env.DB, fixture.userId, crypto.randomUUID());
    const rivalToken = await createAdminSession(env.DB, rival, crypto.randomUUID());
    const book = (token: string) =>
      callApi(env, `${base}/agenda/${fixture.occurrenceId}/participation`, {
        method: "PUT",
        headers: headers(token),
        body: JSON.stringify(
          sessionParticipationRequestSchema.parse({
            action: "reserve",
            attendanceMode: "physical",
            expectedPublishedRevision: 0,
            roomId,
          }),
        ),
      });
    const reserved = await book(attendeeToken);
    expect(reserved.status, await reserved.clone().text()).toBe(200);
    expect(sessionParticipationResponseSchema.parse(await reserved.json()).status).toBe("reserved");
    const full = await book(rivalToken);
    expect(full.status, await full.clone().text()).toBe(200);
    expect(sessionParticipationResponseSchema.parse(await full.json()).status).toBe("waitlisted");
    const originalAllocation = await allocation();
    expect(originalAllocation[3]).toEqual([expect.objectContaining({ capacity: 1, occupied: 1, remote_occupied: 0 })]);
    expect(originalAllocation.slice(6)).toEqual([[], []]);

    const secondToken = await createAdminSession(env.DB, secondOperator, crypto.randomUUID());
    const secondDevice = crypto.randomUUID();
    const enrolled = await callApi(env, `${base}/scanner/devices/sessions`, {
      method: "POST",
      headers: headers(secondToken),
      body: JSON.stringify(
        scannerDeviceSessionEnrollmentSchema.parse({ operationId: crypto.randomUUID(), deviceId: secondDevice }),
      ),
    });
    expect(enrolled.status, await enrolled.clone().text()).toBe(200);
    const secondEpoch = scannerDeviceSessionEnrollmentResponseSchema.parse(await enrolled.json());
    expect(secondEpoch).toMatchObject({
      eventId: fixture.eventId,
      operatorUserId: secondOperator,
      deviceId: secondDevice,
    });
    expect(secondEpoch.epochId).not.toBe(fixture.epochId);
    const prepared = await callApi(
      env,
      `${base}/offline-eligibility?${new URLSearchParams({ epochId: secondEpoch.epochId, deviceId: secondDevice, occurrenceId: fixture.occurrenceId, roomId })}`,
      { headers: headers(secondToken) },
    );
    expect(prepared.status, await prepared.clone().text()).toBe(200);
    const manifest = enrolledOfflineEligibilityResponseSchema.parse(await prepared.json());
    expect(manifest.entries.find((entry) => entry.userId === fixture.userId)).toMatchObject({
      eventRegistered: true,
      sessionEligible: true,
      sessionStatus: "reserved",
    });
    const record = (sequence: number, action: "attendance" | "lead") =>
      offlineScanRecordSchema.parse({
        eventId: fixture.eventId,
        scan: {
          operatorUserId: secondOperator,
          operationId: crypto.randomUUID(),
          deviceId: secondDevice,
          scannerSession: { epochId: secondEpoch.epochId, sequence },
          badgeId: fixture.badgeId,
          action,
          observedAt: manifest.serverNow,
          capturePublicationRevision: manifest.publishedRevision,
          occurrenceId: action === "attendance" ? fixture.occurrenceId : null,
          ...(action === "attendance" ? { roomId } : { sponsorId, consentConfirmed: true }),
        },
      });
    // Captured once from a real enrolled manifest; requests are delayed, without claiming a browser network outage.
    const delayedAttendance = record(1, "attendance"),
      delayedLead = record(2, "lead");
    const consentChanged = record(3, "lead"),
      badgeChanged = record(4, "attendance");
    const retained = [delayedAttendance, delayedLead, consentChanged, badgeChanged].map((entry) =>
      JSON.stringify(entry),
    );
    for (const entry of [delayedAttendance, delayedLead]) {
      expect(JSON.stringify(entry)).not.toContain(`${fixture.userId}@example.test`);
      expect(offlineScanRecordSchema.safeParse({ ...entry, displayName: "Private name" }).success).toBe(false);
      expect(
        offlineScanRecordSchema.safeParse({ ...entry, scan: { ...entry.scan, email: "private@example.test" } }).success,
      ).toBe(false);
    }
    expect(await ledger()).toEqual([[], [], [], []]);
    const onlineAttendance = offlineScanRecordSchema.parse({
      eventId: fixture.eventId,
      scan: fixture.scanBody({
        roomId,
        observedAt: manifest.serverNow,
        capturePublicationRevision: manifest.publishedRevision,
      }),
    });
    const onlineLead = offlineScanRecordSchema.parse({
      eventId: fixture.eventId,
      scan: fixture.scanBody({
        action: "lead",
        occurrenceId: null,
        sponsorId,
        consentConfirmed: true,
        observedAt: manifest.serverNow,
        capturePublicationRevision: manifest.publishedRevision,
      }),
    });
    const originals = [onlineAttendance, onlineLead, delayedAttendance, delayedLead];
    const tokens = [fixture.token, fixture.token, secondToken, secondToken];
    const receipts = [];
    for (const [index, entry] of originals.slice(0, 2).entries()) {
      receipts.push(await upload(entry, tokens[index]!));
      expect(await allocation()).toEqual(originalAllocation);
    }
    // The two delayed operations have independent sequence identities and reconcile concurrently.
    receipts.push(...(await Promise.all([delayedAttendance, delayedLead].map((entry) => upload(entry, secondToken)))));
    for (const [index, entry] of originals.entries()) {
      expect(receipts[index]).toMatchObject({
        recorded: true,
        outcome: "eligible",
        reason: "eligible",
        attendanceRecorded: entry.scan.action === "attendance",
        admissionRecorded: false,
        admissionDecision: null,
      });
      expect(await allocation()).toEqual(originalAllocation);
    }
    const leadPath = `${base}/sponsors/${sponsorId}/leads`;
    const contacts = await callApi(env, leadPath, { headers: headers(secondToken) });
    expect(contacts.status).toBe(200);
    expect(contacts.headers.get("cache-control")).toContain("no-store");
    const lead = sponsorLeadListSchema.parse(await contacts.json());
    expect(lead.page.total).toBe(1);
    expect(lead.leads).toHaveLength(1);
    expect(lead.leads[0]).toMatchObject({ userId: fixture.userId, email: `${fixture.userId}@example.test` });
    const captures = await callApi(env, `${leadPath}/${lead.leads[0]!.id}/captures`, { headers: headers(secondToken) });
    expect(captures.status).toBe(200);
    const history = sponsorLeadCapturesSchema.parse(await captures.json());
    expect(history.page.total).toBe(2);
    expect(history.captures.map((entry) => entry.operatorUserId).sort()).toEqual(
      [fixture.operatorId, secondOperator].sort(),
    );
    const scopeBaseline = await ledger();
    const excessPersonalData = await callApi(env, `${base}/scans`, {
      method: "POST",
      headers: headers(secondToken),
      body: JSON.stringify({ ...delayedLead.scan, email: "private@example.test" }),
    });
    expect(excessPersonalData.status).toBe(400);
    expect(JSON.stringify(await excessPersonalData.json())).not.toContain("private@example.test");
    const foreign = await callApi(env, `${base}/scans`, {
      method: "POST",
      headers: headers(secondToken),
      body: JSON.stringify({ ...delayedLead.scan, sponsorId: otherSponsorId }),
    });
    expect(foreign.status).toBe(403);
    expect(apiErrorPayloadSchema.parse(await foreign.json()).error.code).toBe("PERMISSION_REQUIRED");
    const anonymous = await callApi(env, leadPath);
    expect(anonymous.status).toBe(401);
    expect(JSON.stringify(await anonymous.json())).not.toContain(`${fixture.userId}@example.test`);
    expect(await ledger()).toEqual(scopeBaseline);

    const manageToken = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "registration_manage",
      resourceId: registrationId!,
    });
    const withdrawn = await callApi(env, `/api/v1/registrations/access/${encodeURIComponent(manageToken)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registrationManageSchema.parse({ action: "withdraw_sponsor_sharing" })),
    });
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
    expect(registrationManageUpdateResponseSchema.parse(await withdrawn.json()).sponsorSharing.allowed).toBe(false);
    const refusedLead = await upload(consentChanged, secondToken);
    expect(refusedLead).toMatchObject({
      recorded: true,
      outcome: "warning",
      reason: "consent_required",
      attendanceRecorded: false,
    });
    await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=? AND user_id=?")
      .bind(new Date().toISOString(), fixture.eventId, fixture.userId)
      .run();
    const refusedAttendance = await upload(badgeChanged, secondToken);
    expect(refusedAttendance).toMatchObject({
      recorded: true,
      outcome: "denied",
      reason: "revoked_badge",
      attendanceRecorded: false,
    });
    expect(await allocation()).toEqual(originalAllocation);
    const finalLedger = await ledger();
    expect(finalLedger.map((rows) => rows.length)).toEqual([6, 2, 1, 6]);
    expect(finalLedger[0]?.map((row) => row.operation_id).sort()).toEqual(
      [...originals, consentChanged, badgeChanged].map((entry) => entry.scan.operationId).sort(),
    );
    expect(finalLedger[0]?.every((row) => row.user_id === fixture.userId)).toBe(true);
    for (let replay = 0; replay < 2; replay++) {
      for (const [index, entry] of originals.entries())
        expect(await upload(entry, tokens[index]!)).toEqual(receipts[index]);
      expect(await upload(consentChanged, secondToken)).toEqual(refusedLead);
      expect(await upload(badgeChanged, secondToken)).toEqual(refusedAttendance);
      expect(await ledger()).toEqual(finalLedger);
      expect(await allocation()).toEqual(originalAllocation);
    }
    expect(
      [delayedAttendance, delayedLead, consentChanged, badgeChanged].map((entry) => JSON.stringify(entry)),
    ).toEqual(retained);
    const hidden = await callApi(env, leadPath, { headers: headers(secondToken) });
    expect(hidden.status).toBe(200);
    expect(sponsorLeadListSchema.parse(await hidden.json())).toMatchObject({ leads: [], page: { total: 0 } });
    const hiddenHistory = await callApi(env, `${leadPath}/${lead.leads[0]!.id}/captures`, {
      headers: headers(secondToken),
    });
    expect(hiddenHistory.status).toBe(404);
    const summary = await callApi(env, `${base}/attendance/summary`, { headers: headers(fixture.token) });
    expect(summary.status).toBe(200);
    expect(attendanceSummarySchema.parse(await summary.json())).toMatchObject({
      observed: {
        uniquePeople: 1,
        originalObservations: 2,
        physicalPeople: 1,
        virtualPeople: 0,
        entryObservations: 1,
        reentryObservations: 1,
      },
      attempts: { recognized: 3, attendance: 3, successful: 2, unsuccessful: 1, admissions: 0 },
      sync: { completeness: "not_established" },
    });
  });
});

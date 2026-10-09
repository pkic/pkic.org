import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
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
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { physicalOccupiedSql } from "../functions/_lib/services/event-participation/capacity-accounting";
import type { DatabaseLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { insertUser } from "./helpers/membership";

const fixture = createEventScannerFixture();
const base = "/api/v1/events/scan-test";
const headers = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
beforeEach(fixture.setup);

/** Gate the real allocation transaction only after its command has been prepared. */
function bookingGate() {
  const gate = gateNextBatch(env.DB);
  let prepared = false;
  const db: DatabaseLike = {
    prepare(sql) {
      if (sql.startsWith("WITH actor AS (SELECT ? AS user_id")) prepared = true;
      return env.DB.prepare(sql);
    },
    batch: (statements) => (prepared ? gate.db : env.DB).batch(statements),
  };
  return { ...gate, db };
}
async function reached(gate: ReturnType<typeof bookingGate>, request: Promise<Response>) {
  await Promise.race([
    gate.reached,
    request.then((response) => {
      throw new Error(`Booking ended before its allocation transaction: ${response.status}`);
    }),
  ]);
}
async function protectedState() {
  return Promise.all([
    ...[
      "registrations",
      "agenda_session_participations",
      "agenda_session_holds",
      "event_agenda_state",
      "event_agenda_rooms",
      "event_agenda_occurrences",
      "event_entry_admissions",
      "event_session_admissions",
      "event_offline_admission_spends",
    ].map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`)),
    queryAll(env.DB, "SELECT * FROM email_outbox ORDER BY rowid"),
    queryAll(env.DB, "SELECT * FROM agenda_push_outbox ORDER BY rowid"),
  ]);
}
async function scannerState() {
  return Promise.all(
    [
      "event_scan_attempts",
      "event_attendance_observations",
      "event_sponsor_leads",
      "event_scanner_upload_receipts",
    ].map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`)),
  );
}
async function receive(record: OfflineScanRecord, token: string) {
  const response = await callApi(env, `${base}/scans`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(record.scan),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const raw = await response.json();
  const receipt = enrolledEventScanResponseSchema.parse(raw);
  expect(JSON.stringify(raw)).not.toContain(`${fixture.userId}@example.test`);
  expect(JSON.stringify(raw)).not.toContain(fixture.badgeId);
  expect(receipt.operationId).toBe(record.scan.operationId);
  expect(receipt.scannerReceipt).toMatchObject({
    epochId: record.scan.scannerSession?.epochId,
    sequence: record.scan.scannerSession?.sequence,
    operationId: record.scan.operationId,
  });
  expect(receipt.admissionRecorded).toBe(false);
  expect(receipt.admissionDecision).toBeNull();
  return receipt;
}

it("interleaves two prepared last-seat claims with online and delayed attendance/lead receipts without scanner allocation", async () => {
  const now = new Date().toISOString();
  const roomId = crypto.randomUUID(),
    sponsorId = crypto.randomUUID(),
    secondDevice = crypto.randomUUID();
  const rival = await insertUser(env.DB),
    secondOperator = await insertUser(env.DB);
  await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'One place',1)")
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
  await env.DB.prepare(
    "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Concurrent sponsor','active',?,?)",
  )
    .bind(sponsorId, fixture.eventId, now, now)
    .run();
  for (const operator of [fixture.operatorId, secondOperator]) {
    for (const permission of ["agenda:leads_capture", "agenda:leads_view"])
      await env.DB.prepare(
        "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,'event_sponsor',?,?)",
      )
        .bind(crypto.randomUUID(), operator, permission, sponsorId, now)
        .run();
  }
  await env.DB.prepare(
    "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:attendance_record','event',?,?)",
  )
    .bind(crypto.randomUUID(), secondOperator, fixture.eventId, now)
    .run();
  const registrationId = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
    .bind(fixture.eventId, fixture.userId)
    .first<string>("id");
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
  const attendeeToken = await createAdminSession(env.DB, fixture.userId, crypto.randomUUID());
  const rivalToken = await createAdminSession(env.DB, rival, crypto.randomUUID());
  const secondToken = await createAdminSession(env.DB, secondOperator, crypto.randomUUID());
  const enrolled = await callApi(env, `${base}/scanner/devices/sessions`, {
    method: "POST",
    headers: headers(secondToken),
    body: JSON.stringify(
      scannerDeviceSessionEnrollmentSchema.parse({ operationId: crypto.randomUUID(), deviceId: secondDevice }),
    ),
  });
  expect(enrolled.status).toBe(200);
  const epoch = scannerDeviceSessionEnrollmentResponseSchema.parse(await enrolled.json());
  expect(epoch.epochId).not.toBe(fixture.epochId);
  const response = await callApi(
    env,
    `${base}/offline-eligibility?${new URLSearchParams({ epochId: epoch.epochId, deviceId: secondDevice, occurrenceId: fixture.occurrenceId, roomId })}`,
    { headers: headers(secondToken) },
  );
  expect(response.status).toBe(200);
  const manifest = enrolledOfflineEligibilityResponseSchema.parse(await response.json());
  expect(manifest.entries.find((entry) => entry.userId === fixture.userId)).toMatchObject({
    eventRegistered: true,
    sessionEligible: false,
    sessionStatus: null,
  });
  const online = (action: "attendance" | "lead") =>
    offlineScanRecordSchema.parse({
      eventId: fixture.eventId,
      scan: fixture.scanBody({
        action,
        occurrenceId: action === "attendance" ? fixture.occurrenceId : null,
        ...(action === "attendance" ? { roomId } : { sponsorId, consentConfirmed: true }),
        observedAt: manifest.serverNow,
        capturePublicationRevision: manifest.publishedRevision,
      }),
    });
  const delayed = (sequence: number, action: "attendance" | "lead") =>
    offlineScanRecordSchema.parse({
      eventId: fixture.eventId,
      scan: {
        operatorUserId: secondOperator,
        operationId: crypto.randomUUID(),
        deviceId: secondDevice,
        scannerSession: { epochId: epoch.epochId, sequence },
        badgeId: fixture.badgeId,
        action,
        occurrenceId: action === "attendance" ? fixture.occurrenceId : null,
        ...(action === "attendance" ? { roomId } : { sponsorId, consentConfirmed: true }),
        observedAt: manifest.serverNow,
        capturePublicationRevision: manifest.publishedRevision,
      },
    });
  // These are retained native request bodies, not a claim of browser/physical network emulation.
  const aAttendance = online("attendance"),
    aLead = online("lead"),
    bAttendance = delayed(1, "attendance"),
    bLead = delayed(2, "lead");
  const originals = [aAttendance, aLead, bAttendance, bLead];
  const bodies = originals.map((entry) => JSON.stringify(entry));
  const gates = [bookingGate(), bookingGate()];
  const pending = [attendeeToken, rivalToken].map((token, index) =>
    callApi({ ...env, DB: gates[index]!.db }, `${base}/agenda/${fixture.occurrenceId}/participation`, {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify(
        sessionParticipationRequestSchema.parse({
          action: "reserve",
          attendanceMode: "physical",
          roomId,
          expectedPublishedRevision: 0,
        }),
      ),
    }),
  );
  try {
    await Promise.all(gates.map((gate, index) => reached(gate, pending[index]!)));
    const beforeBookings = await protectedState();
    // Both real booking commands have read/prepared their claim. Scanning cannot claim their vacant seat.
    const first = await Promise.all([
      receive(aAttendance, fixture.token),
      receive(aAttendance, fixture.token),
      receive(bLead, secondToken),
      receive(bLead, secondToken),
    ]);
    expect(first[0]).toEqual(first[1]);
    expect(first[2]).toEqual(first[3]);
    expect(first[0]).toMatchObject({ outcome: "warning", reason: "missing_registration", attendanceRecorded: true });
    expect(first[2]).toMatchObject({ outcome: "eligible", reason: "eligible", attendanceRecorded: false });
    expect(await protectedState()).toEqual(beforeBookings);
    gates.forEach((gate) => gate.release());
    // Release both prepared transactions together; real D1 owns the final atomic capacity decision.
    const bookings = await Promise.all(pending);
    const results = [];
    for (const booking of bookings) {
      expect(booking.status, await booking.clone().text()).toBe(200);
      results.push(sessionParticipationResponseSchema.parse(await booking.json()));
    }
    expect(results.map((row) => row.status).sort()).toEqual(["reserved", "waitlisted"]);
    const allocations = await queryAll(
      env.DB,
      "SELECT * FROM agenda_session_participations WHERE event_id=? ORDER BY user_id",
      fixture.eventId,
    );
    expect(allocations).toHaveLength(2);
    expect(allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: fixture.userId,
          status: results[0]!.status,
          attendance_mode: "physical",
          room_id: roomId,
        }),
        expect.objectContaining({
          user_id: rival,
          status: results[1]!.status,
          attendance_mode: "physical",
          room_id: roomId,
        }),
      ]),
    );
    const occupied = await env.DB.prepare(
      `WITH target AS(SELECT ? AS id) SELECT ${physicalOccupiedSql("target.id")} AS total FROM target`,
    )
      .bind(fixture.occurrenceId)
      .first<{ total: number }>();
    expect(occupied?.total).toBe(1);
    const afterBookings = await protectedState();
    // A real committed response is deliberately not delivered to this caller; retry preserves its original body.
    const undelivered = await callApi(env, `${base}/scans`, {
      method: "POST",
      headers: headers(fixture.token),
      body: JSON.stringify(aLead.scan),
    });
    expect(undelivered.status).toBe(200);
    await undelivered.body?.cancel();
    const later = await Promise.all([
      receive(aLead, fixture.token),
      receive(aLead, fixture.token),
      receive(bAttendance, secondToken),
      receive(bAttendance, secondToken),
    ]);
    expect(later[0]).toEqual(later[1]);
    expect(later[2]).toEqual(later[3]);
    expect(later[0]).toMatchObject({ outcome: "eligible", reason: "eligible", attendanceRecorded: false });
    expect(later[2]).toMatchObject({
      outcome: results[0]!.status === "reserved" ? "eligible" : "warning",
      reason: results[0]!.status === "reserved" ? "eligible" : "missing_registration",
      attendanceRecorded: true,
    });
    expect(await protectedState()).toEqual(afterBookings);
    const ledger = await scannerState();
    expect(ledger.map((rows) => rows.length)).toEqual([4, 2, 1, 4]);
    expect(ledger[0]!.map((row) => row.operation_id).sort()).toEqual(
      originals.map((entry) => entry.scan.operationId).sort(),
    );
    const stored = await env.DB.prepare("SELECT response_json FROM event_scanner_upload_receipts WHERE operation_id=?")
      .bind(aLead.scan.operationId)
      .first<string>("response_json");
    expect(enrolledEventScanResponseSchema.parse(JSON.parse(stored!))).toEqual(later[0]);
    const leadsPath = `${base}/sponsors/${sponsorId}/leads`;
    const leadsResponse = await callApi(env, leadsPath, { headers: headers(secondToken) });
    expect(leadsResponse.status).toBe(200);
    const leads = sponsorLeadListSchema.parse(await leadsResponse.json());
    expect(leads).toMatchObject({ page: { total: 1 }, leads: [{ userId: fixture.userId }] });
    const capturesResponse = await callApi(env, `${leadsPath}/${leads.leads[0]!.id}/captures`, {
      headers: headers(secondToken),
    });
    expect(capturesResponse.status).toBe(200);
    const captures = sponsorLeadCapturesSchema.parse(await capturesResponse.json());
    expect(captures.page.total).toBe(2);
    expect(captures.captures.map((entry) => entry.operatorUserId).sort()).toEqual(
      [fixture.operatorId, secondOperator].sort(),
    );
    for (let replay = 0; replay < 2; replay++) {
      const receipts = await Promise.all(
        originals.map((entry, index) => receive(entry, index < 2 ? fixture.token : secondToken)),
      );
      expect(receipts).toEqual([first[0], later[0], later[2], first[2]]);
      expect(await scannerState()).toEqual(ledger);
      expect(await protectedState()).toEqual(afterBookings);
    }
    expect(originals.map((entry) => JSON.stringify(entry))).toEqual(bodies);
  } finally {
    gates.forEach((gate) => gate.release());
    await Promise.allSettled(pending);
  }
});

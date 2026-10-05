import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import {
  enrolledOfflineEligibilityQuerySchema,
  enrolledOfflineEligibilityResponseSchema,
} from "../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanResponseSchema,
  offlineScanRecordSchema,
  type EventScanRequest,
  type EventScanResponse,
} from "../assets/shared/schemas/event-participation-scanning";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { preparePublicAgendaSnapshot } from "../functions/_lib/services/event-agenda/public-snapshot";
import {
  physicalOccupiedSql,
  remoteOccupiedSql,
} from "../functions/_lib/services/event-participation/capacity-accounting";
import { publishedSessionsSql } from "../functions/_lib/services/event-participation/published-schedule";
import { callApi } from "./helpers/app";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";

const fixture = createEventScannerFixture();
const roomA = crypto.randomUUID();
const roomB = crypto.randomUUID();
const headers = () => ({ authorization: `Bearer ${fixture.token}` });

async function prepare(eventWide = false, roomId = roomA) {
  const query = enrolledOfflineEligibilityQuerySchema.parse({
    epochId: fixture.epochId,
    deviceId: fixture.deviceId,
    ...(eventWide ? {} : { occurrenceId: fixture.occurrenceId, roomId }),
  });
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return callApi(env, `/api/v1/events/scan-test/offline-eligibility?${search}`, {
    headers: headers(),
  });
}

async function capture(overrides: Partial<EventScanRequest> = {}) {
  const response = await prepare(overrides.occurrenceId === null);
  expect(response.status).toBe(200);
  const manifest = enrolledOfflineEligibilityResponseSchema.parse(await response.json());
  expect(manifest.entries.find((entry) => entry.userId === fixture.userId)).toMatchObject({
    revoked: false,
    eventRegistered: true,
    sessionEligible: true,
  });
  const record = offlineScanRecordSchema.parse({
    eventId: fixture.eventId,
    scan: fixture.scanBody({
      action: "check",
      roomId: roomA,
      observedAt: manifest.serverNow,
      capturePublicationRevision: manifest.publishedRevision,
      ...overrides,
    }),
  });
  return { record, manifest, serialized: JSON.stringify(record) };
}

type Capture = Awaited<ReturnType<typeof capture>>;

async function allocationSnapshot() {
  const results = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS total FROM event_entry_admissions WHERE event_id=?").bind(fixture.eventId),
    env.DB.prepare("SELECT COUNT(*) AS total FROM event_session_admissions WHERE event_id=?").bind(fixture.eventId),
    env.DB.prepare(
      "SELECT id,occurrence_id,user_id,attendance_mode,status,approval_state,room_id FROM agenda_session_participations WHERE event_id=? ORDER BY id",
    ).bind(fixture.eventId),
    env.DB.prepare(
      "SELECT id,occurrence_id,user_id,attendance_mode,room_id,expires_at,revoked_at FROM agenda_session_holds WHERE event_id=? ORDER BY id",
    ).bind(fixture.eventId),
    env.DB.prepare(
      `SELECT session.id,session.room_id,session.additional_room_ids_json,session.capacity,session.remote_capacity,${physicalOccupiedSql("session.id")} AS physical_occupied,${remoteOccupiedSql("session.id")} AS remote_occupied FROM (${publishedSessionsSql}) session WHERE session.event_id=? ORDER BY session.id`,
    ).bind(fixture.eventId),
    env.DB.prepare("SELECT id,capacity FROM event_agenda_rooms WHERE event_id=? ORDER BY id").bind(fixture.eventId),
  ]);
  const [entryAdmissions, sessionAdmissions, participations, holds, sessions, rooms] = results.map(
    (result) => result.results,
  );
  expect(entryAdmissions).toEqual([{ total: 0 }]);
  expect(sessionAdmissions).toEqual([{ total: 0 }]);
  return { entryAdmissions, sessionAdmissions, participations, holds, sessions, rooms };
}

async function reconcile(
  captured: Capture,
  expected: Pick<EventScanResponse, "outcome" | "reason" | "attendanceRecorded">,
) {
  expect(JSON.stringify(captured.record)).toBe(captured.serialized);
  const allocation = await allocationSnapshot();
  const response = await fixture.scan(captured.record.scan);
  expect(response.status).toBe(200);
  const receipt = enrolledEventScanResponseSchema.parse(await response.json());
  expect(receipt).toMatchObject({
    ...expected,
    operationId: captured.record.scan.operationId,
    recorded: true,
    admissionRecorded: false,
    scannerReceipt: {
      epochId: fixture.epochId,
      sequence: captured.record.scan.scannerSession?.sequence,
    },
  });
  expect(await allocationSnapshot()).toEqual(allocation);
  const replay = await fixture.scan(captured.record.scan);
  expect(replay.status).toBe(200);
  expect(enrolledEventScanResponseSchema.parse(await replay.json())).toEqual(receipt);
  expect(await allocationSnapshot()).toEqual(allocation);
  expect(
    await env.DB.prepare(
      "SELECT observed_at,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE operation_id=?",
    )
      .bind(captured.record.scan.operationId)
      .first(),
  ).toEqual({
    observed_at: captured.record.scan.observedAt,
    capture_publication_revision: captured.manifest.publishedRevision,
    capture_context_source: "published_manifest",
  });
  expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first()).toEqual({ total: 1 });
  expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scanner_upload_receipts").first()).toEqual({
    total: 1,
  });
  expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
    total: expected.attendanceRecorded ? 1 : 0,
  });
  return receipt;
}

/** Seed a new approved revision; the previous captured publication remains untouched. */
async function publishTransition(change: "move" | "remove" | "reservation") {
  const original = await env.DB.prepare(
    "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=0",
  )
    .bind(fixture.eventId)
    .first<string>("snapshot_json");
  await env.DB.prepare("UPDATE event_agenda_state SET revision=1 WHERE event_id=?").bind(fixture.eventId).run();
  if (change === "move")
    await env.DB.prepare("UPDATE event_agenda_occurrences SET room_id=? WHERE id=?")
      .bind(roomB, fixture.occurrenceId)
      .run();
  if (change === "reservation")
    await env.DB.prepare("UPDATE event_agenda_occurrences SET admission_policy='reservation' WHERE id=?")
      .bind(fixture.occurrenceId)
      .run();
  if (change === "remove")
    await env.DB.prepare("UPDATE event_agenda_occurrences SET start_at=NULL,end_at=NULL WHERE id=?")
      .bind(fixture.occurrenceId)
      .run();
  const snapshot = preparePublicAgendaSnapshot(await getAgenda(env.DB, fixture.eventId, "scan-test"), 1);
  await env.DB.prepare(
    "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      fixture.eventId,
      JSON.stringify(agendaSnapshotSchema.parse(snapshot)),
      fixture.operatorId,
      new Date().toISOString(),
    )
    .run();
  await env.DB.prepare("UPDATE event_agenda_state SET published_revision=1 WHERE event_id=?")
    .bind(fixture.eventId)
    .run();
  expect(
    await env.DB.prepare("SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=0")
      .bind(fixture.eventId)
      .first<string>("snapshot_json"),
  ).toBe(original);
}

async function sponsorWithConsent() {
  const sponsorId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Synthetic sponsor','active',?,?)",
  )
    .bind(sponsorId, fixture.eventId, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:leads_capture','event_sponsor',?,?)",
  )
    .bind(crypto.randomUUID(), fixture.operatorId, sponsorId, now)
    .run();
  const termId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','1',?)",
  )
    .bind(termId, fixture.eventId, now)
    .run();
  const registrationId = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
    .bind(fixture.eventId, fixture.userId)
    .first<string>("id");
  expect(registrationId).toBeTruthy();
  const consentId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at) VALUES(?,?,?,?,'attendee','sponsor-data-sharing','1',?)",
  )
    .bind(consentId, registrationId, fixture.eventId, fixture.userId, now)
    .run();
  return { sponsorId, termId, consentId };
}

describe("Known offline scans reconciled after server state changes", () => {
  beforeEach(async () => {
    await fixture.setup();
    for (const [id, name] of [
      [roomA, "Room A"],
      [roomB, "Room B"],
    ])
      await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name) VALUES(?,?,?)")
        .bind(id, fixture.eventId, name)
        .run();
    await env.DB.prepare(
      "UPDATE event_agenda_occurrences SET room_id=?,admission_policy='preference',start_at=?,end_at=? WHERE id=?",
    )
      .bind(roomA, fixture.observedAt, "2026-10-03T11:00:00.000Z", fixture.occurrenceId)
      .run();
    const snapshot = preparePublicAgendaSnapshot(await getAgenda(env.DB, fixture.eventId, "scan-test"), 0);
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=0")
      .bind(JSON.stringify(snapshot), fixture.eventId)
      .run();
  });
  afterEach(() => vi.useRealTimers());

  it("refuses a previously known badge revoked before its first queued upload", async () => {
    const captured = await capture({ action: "attendance" });
    await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
      .bind(new Date().toISOString(), fixture.eventId)
      .run();
    await reconcile(captured, { outcome: "denied", reason: "revoked_badge", attendanceRecorded: false });
    const current = enrolledOfflineEligibilityResponseSchema.parse(await (await prepare()).json());
    expect(current.entries[0]).toMatchObject({ revoked: true, sessionEligible: false });
  });

  it("keeps the captured room A evidence separate from an approved move to room B", async () => {
    const captured = await capture({ action: "attendance" });
    await publishTransition("move");
    await reconcile(captured, { outcome: "warning", reason: "wrong_location", attendanceRecorded: true });
    expect(await env.DB.prepare("SELECT room_id FROM event_attendance_observations").first()).toEqual({
      room_id: null,
    });
    expect(captured.record.scan.roomId).toBe(roomA);
    expect((await prepare()).status).toBe(400);
    const current = enrolledOfflineEligibilityResponseSchema.parse(await (await prepare(false, roomB)).json());
    expect(current).toMatchObject({ roomId: roomB, publishedRevision: 1 });
  });

  it("retains an unsuccessful attempt when the captured session is no longer published", async () => {
    const captured = await capture({ action: "attendance" });
    await publishTransition("remove");
    expect((await prepare()).status).toBe(404);
    await reconcile(captured, { outcome: "warning", reason: "verification_required", attendanceRecorded: false });
  });

  it("checks a registration canceled after capture without discarding physical observation evidence", async () => {
    const captured = await capture({ action: "attendance" });
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
      .bind(fixture.eventId, fixture.userId)
      .run();
    await reconcile(captured, { outcome: "warning", reason: "canceled_registration", attendanceRecorded: true });
    const current = enrolledOfflineEligibilityResponseSchema.parse(await (await prepare()).json());
    expect(current.entries[0]).toMatchObject({ eventRegistered: false, sessionEligible: false });
  });

  it("rechecks the approved reservation policy rather than the old preference manifest", async () => {
    const captured = await capture();
    await publishTransition("reservation");
    await reconcile(captured, { outcome: "warning", reason: "missing_registration", attendanceRecorded: false });
    const current = enrolledOfflineEligibilityResponseSchema.parse(await (await prepare()).json());
    expect(current).toMatchObject({ publishedRevision: 1, session: { admissionPolicy: "reservation" } });
    expect(current.entries[0]?.sessionEligible).toBe(false);
  });

  it("reconciles a pre-expiry capture after manifest expiry using its original observed time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const captured = await capture();
    vi.setSystemTime(new Date(Date.parse(captured.manifest.expiresAt) + 1000));
    expect(Date.now()).toBeGreaterThan(Date.parse(captured.manifest.expiresAt));
    await reconcile(captured, { outcome: "eligible", reason: "eligible", attendanceRecorded: false });
    const current = enrolledOfflineEligibilityResponseSchema.parse(await (await prepare()).json());
    expect(Date.parse(current.serverNow)).toBeGreaterThan(Date.parse(captured.manifest.expiresAt));
    expect(Date.parse(current.expiresAt)).toBeGreaterThan(Date.parse(current.serverNow));
  });

  it.each(["withdrawal", "replacement"] as const)(
    "rechecks sharing %s before the first queued sponsor upload",
    async (change) => {
      const { sponsorId, termId, consentId } = await sponsorWithConsent();
      const captured = await capture({
        action: "lead",
        sponsorId,
        consentConfirmed: true,
        occurrenceId: null,
        roomId: null,
      });
      if (change === "withdrawal")
        await env.DB.prepare("DELETE FROM consent_acceptances WHERE id=?").bind(consentId).run();
      else {
        await env.DB.prepare("UPDATE event_terms SET active=0 WHERE id=?").bind(termId).run();
        await env.DB.prepare(
          "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','2',?)",
        )
          .bind(crypto.randomUUID(), fixture.eventId, new Date().toISOString())
          .run();
      }
      const receipt = await reconcile(captured, {
        outcome: "warning",
        reason: "consent_required",
        attendanceRecorded: false,
      });
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_sponsor_leads").first()).toEqual({ total: 0 });
      expect(JSON.stringify(receipt)).not.toContain("example.test");
      expect(JSON.stringify(receipt)).not.toContain(fixture.userId);
      expect(JSON.stringify(receipt)).not.toContain(fixture.badgeId);
    },
  );

  it("leaves a revoked operator's original queued operation unacknowledged until authority is restored", async () => {
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      `UPDATE user_roles SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE user_id=? AND role_id='role-admin'
        AND context_type IS NULL AND context_id IS NULL AND revoked_at IS NULL`,
    )
      .bind(fixture.operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:check','event',?,?)",
    )
      .bind(grantId, fixture.operatorId, fixture.eventId, new Date().toISOString())
      .run();
    const captured = await capture();
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), grantId)
      .run();
    expect((await prepare()).status).toBe(401);
    const allocation = await allocationSnapshot();
    expect((await fixture.scan(captured.record.scan)).status).toBe(401);
    expect(await allocationSnapshot()).toEqual(allocation);
    expect(JSON.stringify(captured.record)).toBe(captured.serialized);
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first()).toEqual({ total: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scanner_upload_receipts").first()).toEqual({
      total: 0,
    });
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=NULL WHERE id=?").bind(grantId).run();
    await reconcile(captured, { outcome: "eligible", reason: "eligible", attendanceRecorded: false });
  });
});

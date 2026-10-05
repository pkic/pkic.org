import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { eventSeriesResponseSchema } from "../assets/shared/schemas/event-series";
import { nativeEventCaptureContextSchema } from "../assets/shared/schemas/event-attendance-capture";
import { enrolledOfflineEligibilityResponseSchema } from "../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanRequestSchema,
  enrolledEventScanResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";
import { badgeIssueResponseSchema } from "../assets/shared/schemas/route-contracts-event-badges";
import { scannerDeviceSessionEnrollmentResponseSchema } from "../assets/shared/schemas/event-scanner-devices";
import {
  attendanceSummarySchema,
  attendanceAttemptsResponseSchema,
} from "../assets/shared/schemas/event-attendance-reporting";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { nowIso } from "../functions/_lib/utils/time";
import type { Env } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { mutateBeforeNextBatch, mutateAfterNextStatement } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const groupId = "20000000-0000-4000-8000-000000000003";
const nativeEventContext = nativeEventCaptureContextSchema.parse({
  profileKey: "meeting",
  timeZone: "Europe/Amsterdam",
});
const observedAt = "2026-10-24T23:30:00.000Z";
let eventId: string;
let token: string;
let operatorId: string;
let userId: string;
let badgeId: string;
let epochId: string;
let sponsorId: string;
let registrationId: string;
let sequence: number;
let deviceId: string;

async function request(path: string, body?: unknown, environment: Env = env) {
  return callApi(environment, path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function scanBody(extra: Record<string, unknown> = {}) {
  return {
    operatorUserId: operatorId,
    operationId: crypto.randomUUID(),
    deviceId,
    badgeId,
    scannerSession: { epochId, sequence: ++sequence },
    occurrenceId: null,
    action: "attendance",
    observedAt,
    capturePublicationRevision: null,
    nativeEventContext,
    ...extra,
  };
}
async function scan(extra: Record<string, unknown> = {}, environment: Env = env) {
  const body = enrolledEventScanRequestSchema.parse(scanBody(extra));
  const response = await request("/api/v1/events/native-capture/scans", body, environment);
  expect(response.status, await response.clone().text()).toBe(200);
  return { body, receipt: enrolledEventScanResponseSchema.parse(await response.json()) };
}
async function invariants() {
  return {
    registration: await queryAll(env.DB, "SELECT id,status,attendance_type,updated_at FROM registrations WHERE id=?", [
      registrationId,
    ]),
    participation: await queryAll(env.DB, "SELECT id,status FROM agenda_session_participations WHERE user_id=?", [
      userId,
    ]),
    admissions: await queryAll(env.DB, "SELECT id FROM event_entry_admissions WHERE event_id=?", [eventId]),
    sessionAdmissions: await queryAll(env.DB, "SELECT id FROM event_session_admissions WHERE event_id=?", [eventId]),
    spends: await queryAll(env.DB, "SELECT operation_id FROM event_offline_admission_spends"),
  };
}
async function changeContext(kind: string) {
  if (kind === "zone") await env.DB.prepare("UPDATE events SET timezone='UTC' WHERE id=?").bind(eventId).run();
  if (kind === "profile")
    await env.DB.prepare("UPDATE events SET profile_key='board_meeting' WHERE id=?").bind(eventId).run();
  if (kind === "publication") {
    const snapshot = await getAgenda(env.DB, eventId, "native-capture");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
      ).bind(eventId, nowIso()),
      env.DB.prepare(
        "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
      ).bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operatorId, nowIso()),
    ]);
  }
}

/** Authorization-wrapped reads also batch; race only the actual capture aggregate. */
function mutateBeforeCaptureBatch(mutation: () => Promise<unknown>) {
  const raced = mutateBeforeNextBatch(env.DB, mutation);
  let capturePrepared = false;
  return {
    prepare(sql: string) {
      if (/INSERT INTO event_scan_attempts\b/.test(sql)) capturePrepared = true;
      return env.DB.prepare(sql);
    },
    batch: (statements: Parameters<typeof raced.batch>[0]) =>
      capturePrepared ? raced.batch(statements) : env.DB.batch(statements),
  };
}

async function originalCaptureAttempt(operationId: string) {
  expect(
    await queryAll(
      env.DB,
      "SELECT outcome,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE operation_id=?",
      [operationId],
    ),
  ).toEqual([
    {
      outcome: "unverified",
      capture_day_date: "2026-10-25",
      capture_time_zone: "Europe/Amsterdam",
      capture_publication_revision: null,
      capture_context_source: "native_event_manifest",
    },
  ]);
}

async function unverifiedAttendanceReport() {
  const response = await request("/api/v1/events/native-capture/attendance/summary?dayDate=2026-10-25");
  expect(response.status).toBe(200);
  const report = attendanceSummarySchema.parse(await response.json());
  expect(report.attempts).toMatchObject({ recognized: 1, successful: 0, unsuccessful: 1, unverified: 1 });
  expect(report.observed).toMatchObject({ originalObservations: 1, offlineAuthorizedObservations: 0 });
  expect(report.evidence.clockVerification).toBe("unverified");
  const attempts = await request("/api/v1/events/native-capture/attendance/attempts?dayDate=2026-10-25");
  expect(attempts.status).toBe(200);
  expect(attendanceAttemptsResponseSchema.parse(await attempts.json()).attempts[0]).toMatchObject({
    outcome: "unverified",
    reason: "verification_required",
    clockVerification: "unverified",
    captureContext: {
      state: "captured",
      dayDate: "2026-10-25",
      timeZone: "Europe/Amsterdam",
      publicationRevision: null,
      source: "native_event_manifest",
    },
  });
}

describe("Native meeting event-wide captured calendar context", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [operator] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    operatorId = operator.id;
    token = await createAdminSession(env.DB, operatorId, crypto.randomUUID());
    const created = await request(`/api/v1/groups/${groupId}/meetings/series`, {
      eventName: "Native capture meeting",
      eventSlug: "native-capture",
      profileKey: "meeting",
      policy: {
        registrationPolicy: "optional",
        memberEligibility: "owner_group",
        guestPolicy: "occurrence_invitation",
      },
      startsAt: observedAt,
      recurrenceRule: "FREQ=DAILY;COUNT=2",
      timezone: nativeEventContext.timeZone,
      durationMinutes: 45,
      providerType: null,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    eventId = eventSeriesResponseSchema.parse(await created.json()).series.eventId;
    userId = await insertUser(env.DB, "native-attendee@example.test");
    registrationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(registrationId, eventId, userId, crypto.randomUUID(), nowIso(), nowIso())
      .run();
    const issued = await request("/api/v1/events/native-capture/badges", { operationId: crypto.randomUUID(), userId });
    expect(issued.status, await issued.clone().text()).toBe(200);
    const badge = badgeIssueResponseSchema.parse(await issued.json());
    if (badge.result !== "issued") throw new Error("Expected a fresh badge");
    badgeId = badge.credential;
    deviceId = crypto.randomUUID();
    const enrolled = await request("/api/v1/events/native-capture/scanner/devices/sessions", {
      operationId: crypto.randomUUID(),
      deviceId,
    });
    expect(enrolled.status).toBe(200);
    epochId = scannerDeviceSessionEnrollmentResponseSchema.parse(await enrolled.json()).epochId;
    sequence = 0;
    sponsorId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Synthetic native sponsor','active',?,?)",
      ).bind(sponsorId, eventId, nowIso(), nowIso()),
      env.DB.prepare(
        "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:leads_capture','event_sponsor',?,?)",
      ).bind(crypto.randomUUID(), operatorId, sponsorId, nowIso()),
      env.DB.prepare(
        "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','1',?)",
      ).bind(crypto.randomUUID(), eventId, nowIso()),
      env.DB.prepare(
        "INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at) VALUES(?,?,?,?,'attendee','sponsor-data-sharing','1',?)",
      ).bind(crypto.randomUUID(), registrationId, eventId, userId, nowIso()),
    ]);
  });

  it("prepares the original native tuple from a real series event without conference sessions", async () => {
    const query = new URLSearchParams({ epochId, deviceId });
    const response = await request(`/api/v1/events/native-capture/offline-eligibility?${query}`);
    expect(response.status).toBe(200);
    const manifest = enrolledOfflineEligibilityResponseSchema.parse(await response.json());
    expect(manifest).toMatchObject({ eventId, occurrenceId: null, publishedRevision: null, nativeEventContext });
    expect(manifest.entries[0]).toMatchObject({ eventRegistered: true, physicalDayEligible: true });
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_occurrences WHERE event_id=?", [eventId])).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM event_occurrences WHERE series_id=(SELECT id FROM event_series WHERE event_id=?)",
        [eventId],
      ),
    ).toHaveLength(2);
  });

  it.each(["check", "attendance", "checkout"])(
    "captures native %s date without allocating admission",
    async (action) => {
      const before = await invariants();
      const { body, receipt } = await scan({ action });
      expect(receipt).toMatchObject({ outcome: "eligible", admissionRecorded: false });
      expect(
        await queryAll(
          env.DB,
          "SELECT capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE operation_id=?",
          [body.operationId],
        ),
      ).toEqual([
        {
          capture_day_date: "2026-10-25",
          capture_time_zone: "Europe/Amsterdam",
          capture_publication_revision: null,
          capture_context_source: "native_event_manifest",
        },
      ]);
      expect(await invariants()).toEqual(before);
    },
  );

  it("captures a consenting event-wide sponsor lead and retains event deduplication", async () => {
    const before = await invariants();
    for (let attempt = 0; attempt < 2; attempt++) {
      const { receipt } = await scan({ action: "lead", sponsorId, consentConfirmed: true });
      expect(receipt).toMatchObject({ outcome: "eligible", attendanceRecorded: false, admissionRecorded: false });
    }
    expect(
      await queryAll(env.DB, "SELECT event_id,sponsor_id,user_id FROM event_sponsor_leads WHERE event_id=?", [eventId]),
    ).toEqual([{ event_id: eventId, sponsor_id: sponsorId, user_id: userId }]);
    expect(await invariants()).toEqual(before);
  });

  it.each(["zone", "profile", "publication"])(
    "replays the original consenting lead receipt after %s changes",
    async (kind) => {
      const { body, receipt } = await scan({ action: "lead", sponsorId, consentConfirmed: true });
      const original = await queryAll(
        env.DB,
        "SELECT id,outcome,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE operation_id=?",
        [body.operationId],
      );
      await changeContext(kind);
      const replay = await request("/api/v1/events/native-capture/scans", body);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(receipt);
      expect(
        await queryAll(
          env.DB,
          "SELECT id,outcome,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE operation_id=?",
          [body.operationId],
        ),
      ).toEqual(original);
      expect(await queryAll(env.DB, "SELECT id FROM event_sponsor_leads WHERE event_id=?", [eventId])).toHaveLength(1);
    },
  );

  it("reports original captured dates after timezone changes and replays the immutable receipt", async () => {
    const { body, receipt } = await scan();
    await changeContext("zone");
    const replay = await request("/api/v1/events/native-capture/scans", body);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(receipt);
    const summaryResponse = await request("/api/v1/events/native-capture/attendance/summary?dayDate=2026-10-25");
    expect(summaryResponse.status).toBe(200);
    const report = attendanceSummarySchema.parse(await summaryResponse.json());
    expect(report.observed).toMatchObject({
      uniquePeople: 1,
      physicalPeople: 1,
      originalObservations: 1,
      offlineAuthorizedObservations: 0,
    });
    expect(report.classification).toMatchObject({ missingObservations: 0, missingAttempts: 0, capturedTimeZones: 1 });
    const attempts = await request("/api/v1/events/native-capture/attendance/attempts?dayDate=2026-10-25");
    expect(attempts.status).toBe(200);
    expect(attendanceAttemptsResponseSchema.parse(await attempts.json()).attempts[0].captureContext).toEqual({
      state: "captured",
      dayDate: "2026-10-25",
      timeZone: "Europe/Amsterdam",
      publicationRevision: null,
      source: "native_event_manifest",
    });
    const wrongDay = await request("/api/v1/events/native-capture/attendance/summary?dayDate=2026-10-24");
    expect(attendanceSummarySchema.parse(await wrongDay.json()).observed.uniquePeople).toBe(0);
    const changed = await request("/api/v1/events/native-capture/scans", {
      ...body,
      nativeEventContext: { ...nativeEventContext, timeZone: "UTC" },
    });
    expect(changed.status).toBe(409);
    expect(await queryAll(env.DB, "SELECT id FROM event_scan_attempts WHERE event_id=?", [eventId])).toHaveLength(1);
  });

  for (const action of ["attendance", "lead"] as const)
    it.each(["zone", "profile", "publication"])(`refuses the first ${action} upload after %s changes`, async (kind) => {
      const before = await invariants();
      await changeContext(kind);
      const { body, receipt } = await scan(action === "lead" ? { action, sponsorId, consentConfirmed: true } : {});
      expect(receipt).toMatchObject({
        outcome: "unverified",
        reason: "verification_required",
        attendanceRecorded: action === "attendance",
        admissionRecorded: false,
      });
      await originalCaptureAttempt(body.operationId);
      const replay = await request("/api/v1/events/native-capture/scans", body);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(receipt);
      await originalCaptureAttempt(body.operationId);
      if (action === "attendance") await unverifiedAttendanceReport();
      expect(await queryAll(env.DB, "SELECT id FROM event_sponsor_leads WHERE event_id=?", [eventId])).toEqual([]);
      expect(await invariants()).toEqual(before);
    });

  for (const action of ["attendance", "lead"] as const)
    it.each(["zone", "profile", "publication"])(
      `atomically refuses ${action} when %s changes before commit`,
      async (kind) => {
        const before = await invariants();
        const db = mutateBeforeCaptureBatch(() => changeContext(kind));
        const { body, receipt } = await scan(action === "lead" ? { action, sponsorId, consentConfirmed: true } : {}, {
          ...env,
          DB: db,
        });
        expect(receipt).toMatchObject({
          outcome: "unverified",
          reason: "verification_required",
          attendanceRecorded: action === "attendance",
          admissionRecorded: false,
        });
        await originalCaptureAttempt(body.operationId);
        const replay = await request("/api/v1/events/native-capture/scans", body);
        expect(replay.status).toBe(200);
        expect(await replay.json()).toEqual(receipt);
        await originalCaptureAttempt(body.operationId);
        if (action === "attendance") await unverifiedAttendanceReport();
        expect(await queryAll(env.DB, "SELECT id FROM event_sponsor_leads WHERE event_id=?", [eventId])).toEqual([]);
        expect(await invariants()).toEqual(before);
      },
    );

  it.each(["meeting", "conference"])(
    "does not infer native context from a bare null revision for %s",
    async (profileKey) => {
      await env.DB.prepare("UPDATE events SET profile_key=? WHERE id=?").bind(profileKey, eventId).run();
      const { receipt } = await scan({ nativeEventContext: undefined });
      expect(receipt).toMatchObject({
        outcome: "unverified",
        reason: "verification_required",
        admissionRecorded: false,
      });
      if (profileKey === "conference") {
        const query = new URLSearchParams({ epochId, deviceId });
        const response = await request(`/api/v1/events/native-capture/offline-eligibility?${query}`);
        expect(response.status).toBe(200);
        expect(enrolledOfflineEligibilityResponseSchema.parse(await response.json())).not.toHaveProperty(
          "nativeEventContext",
        );
      }
    },
  );

  it.each([
    { occurrenceId: "20000000-0000-4000-8000-000000000003" },
    { roomId: "20000000-0000-4000-8000-000000000003" },
    { capturePublicationRevision: 0 },
    {
      offlineRight: {
        grantId: "20000000-0000-4000-8000-000000000003",
        activationId: "20000000-0000-4000-8000-000000000003",
      },
    },
  ])("refuses native target or authority misuse %j without writing", async (extra) => {
    const response = await request("/api/v1/events/native-capture/scans", scanBody(extra));
    expect(response.status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM event_scan_attempts WHERE event_id=?", [eventId])).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT operation_id FROM event_scanner_upload_receipts WHERE epoch_id=?", [epochId]),
    ).toEqual([]);
  });

  it("does not publish a stale native manifest when the profile changes during preparation", async () => {
    // The first state read is the producer's read; standalone use keeps that race exact.
    const { offlineEligibility } = await import("../functions/_lib/services/event-participation/offline-eligibility");
    const db = mutateAfterNextStatement(env.DB, () => changeContext("profile"));
    await expect(offlineEligibility(db, eventId, operatorId, {})).rejects.toMatchObject({
      code: "OFFLINE_MANIFEST_CHANGED",
    });
  });
});

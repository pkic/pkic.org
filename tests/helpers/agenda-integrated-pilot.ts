import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { z } from "zod";
import { callApi } from "./app";
import { createAdminSession, createMemberSession } from "./auth";
import { queryAll, seedEventAndAdmin } from "./context";
import { insertIndividualMember } from "./membership";
import { badgeIssueResponseSchema } from "../../assets/shared/schemas/route-contracts-event-badges";
import { scannerDeviceSessionEnrollmentResponseSchema } from "../../assets/shared/schemas/event-scanner-devices";
import { enrolledOfflineEligibilityResponseSchema } from "../../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanRequestSchema,
  enrolledEventScanResponseSchema,
  offlineScanRecordSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { attendanceSummarySchema } from "../../assets/shared/schemas/event-attendance-reporting";

/** Mounted transport shared only by the two joined pilot scenarios. */
export async function integratedPilot() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const operator = await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>();
  if (!operator) throw new Error("Missing seeded administrator");
  const token = await createAdminSession(env.DB, operator.id, crypto.randomUUID());
  const person = await insertIndividualMember(env.DB, "H6", `pilot-${crypto.randomUUID()}@example.test`);
  const personToken = await createMemberSession(
    env.DB,
    person.userId,
    crypto.randomUUID(),
    env.INTERNAL_SIGNING_SECRET,
    person.identityId,
  );
  async function raw(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    identityToken = token,
  ) {
    return callApi(env, path, {
      method,
      headers: { authorization: `Bearer ${identityToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function api<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    method?: string,
    status = 200,
    identityToken = token,
  ): Promise<T> {
    const response = await raw(path, body, method, identityToken);
    expect(response.status, await response.clone().text()).toBe(status);
    return schema.parse(await response.json());
  }
  return { eventId, operatorId: operator.id, person, personToken, api, raw };
}
export type IntegratedPilot = Awaited<ReturnType<typeof integratedPilot>>;

/** Synthetic registration/consent fixture, never an alternate production registration path. */
export async function pilotEvidence(
  pilot: IntegratedPilot,
  eventId: string,
  slug: string,
  observedAt: string,
  occurrenceId: string | null,
  roomId: string | null = null,
) {
  const registrationId = crypto.randomUUID(),
    sponsorId = crypto.randomUUID(),
    deviceId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    ).bind(registrationId, eventId, pilot.person.userId, crypto.randomUUID(), now, now),
    env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Integrated pilot sponsor','active',?,?)",
    ).bind(sponsorId, eventId, now, now),
    env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:leads_capture','event_sponsor',?,?)",
    ).bind(crypto.randomUUID(), pilot.operatorId, sponsorId, now),
    env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:leads_export','event_sponsor',?,?)",
    ).bind(crypto.randomUUID(), pilot.operatorId, sponsorId, now),
    env.DB.prepare(
      "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','1',?)",
    ).bind(crypto.randomUUID(), eventId, now),
    env.DB.prepare(
      "INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at) VALUES(?,?,?,?,'attendee','sponsor-data-sharing','1',?)",
    ).bind(crypto.randomUUID(), registrationId, eventId, pilot.person.userId, now),
  ]);
  const base = `/api/v1/events/${slug}`;
  const badge = await pilot.api(`${base}/badges`, badgeIssueResponseSchema, {
    operationId: crypto.randomUUID(),
    userId: pilot.person.userId,
  });
  if (badge.result !== "issued") throw new Error("Expected issued pilot badge");
  const enrolled = await pilot.api(`${base}/scanner/devices/sessions`, scannerDeviceSessionEnrollmentResponseSchema, {
    operationId: crypto.randomUUID(),
    deviceId,
  });
  const query = new URLSearchParams({ epochId: enrolled.epochId, deviceId, ...(occurrenceId ? { occurrenceId } : {}) });
  const manifest = await pilot.api(`${base}/offline-eligibility?${query}`, enrolledOfflineEligibilityResponseSchema);
  let sequence = 0;
  function capture(extra: Record<string, unknown> = {}) {
    return enrolledEventScanRequestSchema.parse({
      operatorUserId: pilot.operatorId,
      operationId: crypto.randomUUID(),
      deviceId,
      badgeId: badge.credential,
      scannerSession: { epochId: enrolled.epochId, sequence: ++sequence },
      occurrenceId,
      roomId,
      action: "attendance",
      observedAt,
      capturePublicationRevision: manifest.publishedRevision,
      ...(manifest.nativeEventContext ? { nativeEventContext: manifest.nativeEventContext } : {}),
      ...extra,
    });
  }
  async function upload(body: ReturnType<typeof capture>) {
    return pilot.api(`${base}/scans`, enrolledEventScanResponseSchema, body);
  }
  async function reconcile() {
    const before = await queryAll(env.DB, "SELECT id,status FROM agenda_session_participations WHERE event_id=?", [
      eventId,
    ]);
    const original = capture();
    // Round-trip exactly the persisted ID-only payload before its first network upload.
    const saved = offlineScanRecordSchema.parse(JSON.parse(JSON.stringify({ eventId, scan: original })));
    const result = await upload(enrolledEventScanRequestSchema.parse(saved.scan));
    expect(result).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
    expect(await upload(original)).toEqual(result);
    const denied = await upload(capture({ badgeId: crypto.randomUUID() }));
    expect(denied).toMatchObject({ outcome: "unknown", attendanceRecorded: false });
    for (let index = 0; index < 2; index++)
      expect(
        await upload(capture({ action: "lead", occurrenceId: null, roomId: null, sponsorId, consentConfirmed: true })),
      ).toMatchObject({ outcome: "eligible" });
    expect(
      await queryAll(env.DB, "SELECT id FROM event_sponsor_leads WHERE event_id=? AND sponsor_id=? AND user_id=?", [
        eventId,
        sponsorId,
        pilot.person.userId,
      ]),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id,status FROM agenda_session_participations WHERE event_id=?", [eventId]),
    ).toEqual(before);
    expect(await queryAll(env.DB, "SELECT id FROM event_entry_admissions WHERE event_id=?", [eventId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM event_session_admissions WHERE event_id=?", [eventId])).toEqual([]);
    const summary = await pilot.api(`${base}/attendance/summary`, attendanceSummarySchema);
    expect(summary.attempts.successful).toBeGreaterThanOrEqual(1);
    const exported = await pilot.raw(`${base}/attendance/summary/exports`);
    expect(exported.status, await exported.clone().text()).toBe(200);
    const leads = await pilot.raw(`${base}/sponsors/${sponsorId}/leads.csv`);
    expect(leads.status, await leads.clone().text()).toBe(200);
    expect(leads.headers.get("content-type")).toContain("text/csv");
  }
  return { base, capture, upload, reconcile, manifest, registrationId };
}

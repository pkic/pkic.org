import { generateBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { issueBadge, revokeBadge, recordScan } from "../functions/_lib/services/event-participation/scanning";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { scannerTargets } from "../functions/_lib/services/event-participation/reporting";
import { personalAgenda } from "../functions/_lib/services/event-participation/personal-agenda";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import { offlineScanRecordSchema, eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";

import { mutateBeforeNextBatch } from "./helpers/database-races";
import { offlineEligibility } from "../functions/_lib/services/event-participation/offline-eligibility";
import { gateNextBatch } from "./helpers/d1-batch-gate";

const fixture = createEventScannerFixture();
const { eventId, userId, operatorId, occurrenceId, observedAt, scan, scanBody } = fixture;
describe("Event agenda scan evidence", () => {
  beforeEach(fixture.setup);
  it.each(["check", "attendance"])(
    "reports private preference registration information while recording %s evidence",
    async (action) => {
      const snapshot = await getAgenda(env.DB, eventId, "scan-test");
      snapshot.occurrences[0]!.visibility = "private";
      snapshot.occurrences[0]!.admissionPolicy = "preference";
      await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=0")
        .bind(JSON.stringify(snapshot), eventId)
        .run();
      const response = await scan(scanBody({ action }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        outcome: "warning",
        reason: "missing_registration",
        recorded: true,
        attendanceRecorded: action === "attendance",
      });
      expect(
        (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_session_admissions").first<{ total: number }>())
          ?.total,
      ).toBe(0);
      expect(
        (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first<{ total: number }>())
          ?.total,
      ).toBe(action === "attendance" ? 1 : 0);
    },
  );
  it("exports scoped offline eligibility with only identifiers and distinct revoked evidence", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, userId, {
      action: "reserve",
      attendanceMode: "physical",
    });
    const ready = await offlineEligibility(env.DB, eventId, operatorId, { occurrenceId });
    expect(ready.entries[0]).toMatchObject({
      userId,
      eventRegistered: true,
      physicalDayEligible: true,
      sessionEligible: true,
      revoked: false,
    });
    expect(Date.parse(ready.expiresAt) - Date.parse(ready.serverNow)).toBeGreaterThan(0);
    expect(Date.parse(ready.expiresAt) - Date.parse(ready.serverNow)).toBeLessThanOrEqual(15 * 60_000);
    expect(JSON.stringify(ready)).not.toContain("example.test");
    expect(JSON.stringify(ready)).not.toContain(fixture.badgeId);
    await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
      .bind(observedAt, eventId)
      .run();
    const revoked = await offlineEligibility(env.DB, eventId, operatorId, { occurrenceId });
    expect(revoked.entries[0]).toMatchObject({ revoked: true, sessionEligible: false });
    await expect(offlineEligibility(env.DB, eventId, operatorId, { publishedRevision: 1 })).rejects.toMatchObject({
      code: "OFFLINE_MANIFEST_CHANGED",
    });
  });
  it("pages a large identifier manifest without omissions and rejects stale revision pagination", async () => {
    const credentials = Array.from({ length: 260 }, () => ({
      id: crypto.randomUUID(),
      hash: "a".repeat(64) + crypto.randomUUID(),
    }));
    await env.DB.prepare(
      "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at) SELECT json_extract(value,'$.id'),?,?,substr(json_extract(value,'$.hash'),1,32)||replace(json_extract(value,'$.id'),'-',''),? FROM json_each(?)",
    )
      .bind(eventId, userId, observedAt, JSON.stringify(credentials))
      .run();
    const first = await offlineEligibility(env.DB, eventId, operatorId, {});
    expect(first.entries).toHaveLength(250);
    expect(first.nextBadgeId).not.toBeNull();
    const second = await offlineEligibility(env.DB, eventId, operatorId, {
      afterBadgeId: first.nextBadgeId!,
      publishedRevision: first.publishedRevision!,
    });
    expect(second.entries).toHaveLength(11);
    expect(second.nextBadgeId).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.badgeId)).size).toBe(261);
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=1 WHERE event_id=?").bind(eventId).run();
    await expect(
      offlineEligibility(env.DB, eventId, operatorId, { afterBadgeId: first.nextBadgeId!, publishedRevision: 0 }),
    ).rejects.toMatchObject({ code: "OFFLINE_MANIFEST_CHANGED" });
  });
  it("rejects a booking when the approved admission policy changes after preflight", async () => {
    const gate = gateNextBatch(env.DB);
    const booking = setSessionParticipation(gate.db, eventId, occurrenceId, userId, {
      action: "reserve",
      attendanceMode: "physical",
    });
    const rejected = expect(booking).rejects.toMatchObject({ code: "SESSION_PARTICIPATION_CONFLICT" });
    await gate.reached;
    try {
      const snapshot = await getAgenda(env.DB, eventId, "scan-test");
      snapshot.revision = 1;
      snapshot.publishedRevision = 1;
      snapshot.occurrences[0]!.admissionPolicy = "approval";
      await env.DB.prepare(
        "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), operatorId, observedAt)
        .run();
      await env.DB.prepare("UPDATE event_agenda_state SET revision=1,published_revision=1 WHERE event_id=?")
        .bind(eventId)
        .run();
    } finally {
      gate.release();
    }
    await rejected;
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM agenda_session_participations").first<{ total: number }>())
        ?.total,
    ).toBe(0);
  });
  it.each([false, true])(
    "rechecks a cancelled reservation atomically even with prior admission=%s",
    async (priorAdmission) => {
      await setSessionParticipation(env.DB, eventId, occurrenceId, userId, {
        action: "reserve",
        attendanceMode: "physical",
      });
      if (priorAdmission) {
        const response = await scan(scanBody());
        expect(await response.json()).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
      }
      const db = mutateBeforeNextBatch(env.DB, () =>
        setSessionParticipation(env.DB, eventId, occurrenceId, userId, {
          action: "cancel",
          attendanceMode: "physical",
        }),
      );
      const result = await recordScan(
        db,
        eventId,
        {
          operatorUserId: operatorId,
          canScan: true,
          canAdmitExceptions: false,
        },
        eventScanRequestSchema.parse(scanBody({ action: priorAdmission ? "attendance" : "check" })),
      );
      expect(result).toMatchObject({
        outcome: "warning",
        reason: "missing_registration",
        recorded: true,
        attendanceRecorded: priorAdmission,
      });
      expect(
        (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first<{ total: number }>())?.total,
      ).toBe(priorAdmission ? 2 : 1);
      expect(
        (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first<{ total: number }>())
          ?.total,
      ).toBe(priorAdmission ? 2 : 0);
      expect(
        (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_session_admissions").first<{ total: number }>())
          ?.total,
      ).toBe(0);
    },
  );
  it("records known scan attendance with informative missing registration and no personal response data", async () => {
    const response = await scan(scanBody());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
      recorded: true,
      attendanceRecorded: true,
    });
    expect(JSON.stringify(result)).not.toContain("example.test");
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first<{ total: number }>())?.total,
    ).toBe(1);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first<{ total: number }>())
        ?.total,
    ).toBe(1);
  });
  it("deduplicates concurrent retries and preserves original observation time", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, userId, {
      action: "reserve",
      attendanceMode: "physical",
    });
    const body = scanBody();
    const responses = await Promise.all([scan(body), scan(body)]);
    for (const response of responses)
      expect(await response.json()).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first<{ total: number }>())?.total,
    ).toBe(1);
    expect(
      (await env.DB.prepare("SELECT observed_at FROM event_attendance_observations").first<{ observed_at: string }>())
        ?.observed_at,
    ).toBe(observedAt);
  });
  it("rejects unknown credentials without storing their contents", async () => {
    const result = await (await scan(scanBody({ badgeId: generateBadgeCredential() }))).json();
    expect(result).toMatchObject({ outcome: "unknown", recorded: false });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first<{ total: number }>())?.total,
    ).toBe(0);
  });
  it("records a recognized badge without an event registration or available offline grant", async () => {
    await env.DB.prepare("DELETE FROM registrations WHERE event_id=? AND user_id=?").bind(eventId, userId).run();
    const body = scanBody({
      occurrenceId: null,
      offlineRight: { grantId: crypto.randomUUID(), activationId: crypto.randomUUID(), slot: 0 },
    });
    const result = await (await scan(body)).json();
    expect(result).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
      recorded: true,
      attendanceRecorded: true,
      admissionRecorded: false,
    });
    expect(await (await scan(body)).json()).toEqual(result);
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
      total: 1,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_offline_admission_spends").first()).toEqual({
      total: 0,
    });
  });
  it("preserves scan evidence when capacity changes between lookup and commit", async () => {
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE events SET capacity_in_person=0 WHERE id=?").bind(eventId).run(),
    );
    expect(
      await recordScan(
        db,
        eventId,
        { operatorUserId: operatorId, canScan: true, canAdmitExceptions: false },
        eventScanRequestSchema.parse(scanBody({ occurrenceId: null })),
      ),
    ).toMatchObject({ outcome: "eligible", attendanceRecorded: true, admissionRecorded: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_entry_admissions").first()).toEqual({ total: 0 });
  });
  it("records revoked credentials as denied and requires authentication", async () => {
    const badge = await env.DB.prepare("SELECT id FROM event_badge_credentials").first<{ id: string }>();
    await revokeBadge(env.DB, eventId, operatorId, badge!.id);
    expect(await (await scan(scanBody())).json()).toMatchObject({
      outcome: "denied",
      reason: "revoked_badge",
      recorded: true,
    });
    expect((await scan(scanBody(), false)).status).toBe(401);
  });
  it("rejects personal details from offline records", () => {
    expect(
      offlineScanRecordSchema.safeParse({ eventId, scan: scanBody(), email: "attendee@example.test" }).success,
    ).toBe(false);
  });
  it("records a known remote attendee with an informative attendance-mode warning", async () => {
    await env.DB.prepare("UPDATE registrations SET attendance_type='virtual' WHERE event_id=? AND user_id=?")
      .bind(eventId, userId)
      .run();
    expect(await (await scan(scanBody({ occurrenceId: null }))).json()).toMatchObject({
      outcome: "warning",
      reason: "wrong_attendance_mode",
      recorded: true,
      attendanceRecorded: true,
    });
  });
  it.each(["public", "private"])(
    "records a %s session exception without enforcing or allocating admission",
    async (visibility) => {
      const snapshot = await getAgenda(env.DB, eventId, "scan-test");
      snapshot.occurrences[0]!.visibility = visibility as "public" | "private";
      snapshot.occurrences[0]!.admissionPolicy = visibility === "private" ? "preference" : "reservation";
      await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=0")
        .bind(JSON.stringify(snapshot), eventId)
        .run();
      const response = await scan(scanBody({ action: "exception", exceptionReason: "organizer_approval" }));
      expect(await response.json()).toMatchObject({
        outcome: "warning",
        reason: "missing_registration",
        admissionRecorded: true,
        admissionDecision: "allowed",
        attendanceRecorded: false,
      });
      expect(
        (await env.DB.prepare("SELECT exception_reason FROM event_scan_attempts").first<{ exception_reason: string }>())
          ?.exception_reason,
      ).toBe("organizer_approval");
      const second = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email) VALUES(?,?,?)")
        .bind(second, `${second}@example.test`, `${second}@example.test`)
        .run();
      await env.DB.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, second, crypto.randomUUID(), now, now)
        .run();
      const credential = (
        await issueBadge(env.DB, eventId, operatorId, { userId: second, operationId: crypto.randomUUID() }, env)
      ).credential!;
      expect(
        await (
          await scan(scanBody({ badgeId: credential, action: "exception", exceptionReason: "registration_correction" }))
        ).json(),
      ).toMatchObject({
        outcome: "warning",
        reason: "missing_registration",
        recorded: true,
        attendanceRecorded: false,
      });
    },
  );
  it("refuses reuse of an operation ID for another scan payload", async () => {
    const body = scanBody();
    expect((await scan(body)).status).toBe(200);
    expect((await scan({ ...body, action: "check" })).status).toBe(409);
  });
  it("keeps booking, scanner targets and admission on the approved revision while organizers edit drafts", async () => {
    await env.DB.prepare(
      "UPDATE event_agenda_occurrences SET title='Unpublished title',capacity=0,admission_policy='approval' WHERE id=?",
    )
      .bind(occurrenceId)
      .run();
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, userId, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "reserved" });
    expect(await (await scan(scanBody())).json()).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
    expect((await scannerTargets(env.DB, eventId, { sort: "title" })).sessions).toMatchObject([
      { title: "Limited session" },
    ]);
    expect((await personalAgenda(env.DB, eventId, userId, { sort: "startAt" })).sessions).toMatchObject([
      { title: "Limited session", status: "reserved" },
    ]);
  });
  it("keeps a physical reservation when changing to a full remote pool", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, userId, {
      action: "reserve",
      attendanceMode: "physical",
    });
    await env.DB.prepare("UPDATE event_agenda_occurrences SET remote_capacity=0 WHERE id=?").bind(occurrenceId).run();
    await env.DB.prepare(
      "UPDATE event_agenda_publications SET snapshot_json=json_set(snapshot_json,'$.occurrences[0].remoteCapacity',0) WHERE event_id=?",
    )
      .bind(eventId)
      .run();
    await env.DB.prepare("UPDATE registrations SET attendance_type='virtual' WHERE user_id=? AND event_id=?")
      .bind(userId, eventId)
      .run();
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, userId, { action: "reserve", attendanceMode: "remote" }),
    ).rejects.toThrow("existing reservation has been preserved");
    expect(
      await env.DB.prepare("SELECT attendance_mode,status FROM agenda_session_participations WHERE user_id=?")
        .bind(userId)
        .first(),
    ).toMatchObject({ attendance_mode: "physical", status: "reserved" });
  });
  async function sponsorFixture() {
    const sponsorshipId = crypto.randomUUID();
    const grantId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES (?,'event',?,'Synthetic sponsor','active',?,?)",
    )
      .bind(sponsorshipId, eventId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,'agenda:leads_capture','event_sponsor',?,?)",
    )
      .bind(grantId, operatorId, sponsorshipId, now)
      .run();
    return { sponsorshipId, grantId };
  }
  async function leadConsent() {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO event_terms(id,event_id,audience_type,term_key,version,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','1',?)",
    )
      .bind(crypto.randomUUID(), eventId, new Date().toISOString())
      .run();
    const registration = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
      .bind(eventId, userId)
      .first<{ id: string }>();
    await env.DB.prepare(
      "INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at) VALUES(?,?,?,?,'attendee','sponsor-data-sharing','1',?)",
    )
      .bind(crypto.randomUUID(), registration!.id, eventId, userId, new Date().toISOString())
      .run();
  }
  it("captures only consented sponsor-scoped leads without exposing attendee contact data", async () => {
    const { sponsorshipId } = await sponsorFixture();
    const body = scanBody({ action: "lead", sponsorId: sponsorshipId, consentConfirmed: true, occurrenceId: null });
    expect(await (await scan(body)).json()).toMatchObject({ outcome: "warning", recorded: true });
    await leadConsent();
    const result = await (
      await scan(scanBody({ action: "lead", sponsorId: sponsorshipId, consentConfirmed: true, occurrenceId: null }))
    ).json();
    expect(result).toMatchObject({ outcome: "eligible", recorded: true, attendanceRecorded: false });
    expect(JSON.stringify(result)).not.toContain("example.test");
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_sponsor_leads").first<{ total: number }>())?.total,
    ).toBe(1);
    expect(
      (
        await callApi(env, "/api/v1/events/scan-test/badges/attendees", {
          headers: { authorization: `Bearer ${await createAdminSession(env.DB, userId, crypto.randomUUID())}` },
        })
      ).status,
    ).toBe(403);
  });
  it("records sponsor capture context for refused and successful scans and preserves unavailable-history attempts", async () => {
    const { sponsorshipId } = await sponsorFixture();
    const body = scanBody({
      action: "lead",
      sponsorId: sponsorshipId,
      consentConfirmed: true,
      occurrenceId: null,
      capturePublicationRevision: 0,
    });
    expect(await (await scan(body)).json()).toMatchObject({ outcome: "warning", recorded: true });
    expect(
      await env.DB.prepare(
        "SELECT capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE operation_id=?",
      )
        .bind(body.operationId)
        .first(),
    ).toEqual({
      capture_time_zone: "UTC",
      capture_publication_revision: 0,
      capture_context_source: "published_manifest",
    });
    await leadConsent();
    const eligible = scanBody({
      action: "lead",
      sponsorId: sponsorshipId,
      consentConfirmed: true,
      occurrenceId: null,
      capturePublicationRevision: 0,
    });
    expect(await (await scan(eligible)).json()).toMatchObject({ outcome: "eligible", recorded: true });
    const unavailable = scanBody({
      action: "lead",
      sponsorId: sponsorshipId,
      consentConfirmed: true,
      occurrenceId: null,
      capturePublicationRevision: 999,
    });
    expect(await (await scan(unavailable)).json()).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
      recorded: true,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_sponsor_leads").first()).toEqual({ total: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first()).toEqual({ total: 3 });
  });
  it("refuses historical sponsor consent after the active term version changes", async () => {
    const { sponsorshipId } = await sponsorFixture();
    await leadConsent();
    await env.DB.prepare("UPDATE event_terms SET active=0 WHERE event_id=? AND term_key='sponsor-data-sharing'")
      .bind(eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,created_at) VALUES(?,?,'attendee','sponsor-data-sharing','2',?)",
    )
      .bind(crypto.randomUUID(), eventId, new Date().toISOString())
      .run();
    const result = await (
      await scan(scanBody({ action: "lead", sponsorId: sponsorshipId, consentConfirmed: true, occurrenceId: null }))
    ).json();
    expect(result).toMatchObject({
      outcome: "warning",
      reason: "consent_required",
      recorded: true,
      attendanceRecorded: false,
    });
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_sponsor_leads").first<{ total: number }>())?.total,
    ).toBe(0);
  });
  it("does not grant sponsor lead capture implicitly to global administrators", async () => {
    const { sponsorshipId, grantId } = await sponsorFixture();
    await leadConsent();
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), grantId)
      .run();
    expect(
      (await scan(scanBody({ action: "lead", sponsorId: sponsorshipId, consentConfirmed: true, occurrenceId: null })))
        .status,
    ).toBe(403);
  });
  it("rejects expired sponsor grants and a sponsorship belonging to another event", async () => {
    const { sponsorshipId, grantId } = await sponsorFixture();
    await leadConsent();
    await env.DB.prepare("UPDATE permission_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .bind(grantId)
      .run();
    expect(
      (await scan(scanBody({ action: "lead", sponsorId: sponsorshipId, consentConfirmed: true, occurrenceId: null })))
        .status,
    ).toBe(403);
    await env.DB.prepare("UPDATE permission_grants SET expires_at=NULL WHERE id=?").bind(grantId).run();
    const otherEventId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'other-scan-test','Other','UTC','invite_or_open','{}',?,?)",
    )
      .bind(otherEventId, now, now)
      .run();
    await env.DB.prepare("UPDATE sponsorships SET event_id=? WHERE id=?").bind(otherEventId, sponsorshipId).run();
    expect(
      (await scan(scanBody({ action: "lead", sponsorId: sponsorshipId, consentConfirmed: true, occurrenceId: null })))
        .status,
    ).toBe(404);
  });
  it("records admission-button scans as evidence without allocating seats, and replays exactly", async () => {
    await env.DB.prepare(
      "UPDATE event_agenda_publications SET snapshot_json=json_set(snapshot_json,'$.occurrences[0].admissionPolicy','preference','$.occurrences[0].capacity',0) WHERE event_id=?",
    )
      .bind(eventId)
      .run();
    const checkBody = scanBody({ action: "check" });
    expect(await (await scan(checkBody)).json()).toMatchObject({
      outcome: "eligible",
      admissionRecorded: false,
      attendanceRecorded: false,
    });
    const body = scanBody({ action: "admission" });
    const response = await (await scan(body)).json();
    expect(response).toMatchObject({
      outcome: "eligible",
      admissionDecision: "allowed",
      admissionRecorded: true,
      attendanceRecorded: false,
    });
    expect(await (await scan(body)).json()).toEqual(response);
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
      total: 0,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_session_admissions").first()).toEqual({
      total: 0,
    });
  });
  it("records known canceled event-registration attendance without allocating entrance capacity", async () => {
    await env.DB.prepare("UPDATE events SET capacity_in_person=0 WHERE id=?").bind(eventId).run();
    expect(await (await scan(scanBody({ occurrenceId: null, action: "attendance" }))).json()).toMatchObject({
      outcome: "eligible",
      admissionRecorded: false,
      attendanceRecorded: true,
    });
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
      .bind(eventId, userId)
      .run();
    expect(await (await scan(scanBody({ occurrenceId: null, action: "attendance" }))).json()).toMatchObject({
      outcome: "warning",
      reason: "canceled_registration",
      admissionRecorded: false,
      attendanceRecorded: true,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_entry_admissions").first()).toEqual({ total: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
      total: 2,
    });
  });
  it("requires explicit presence confirmation for an exception observation", async () => {
    const response = await scan(
      scanBody({ action: "exception", exceptionReason: "organizer_approval", recordAttendance: true }),
    );
    expect(await response.json()).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
      admissionRecorded: true,
      admissionDecision: "allowed",
      attendanceRecorded: true,
    });
  });
});

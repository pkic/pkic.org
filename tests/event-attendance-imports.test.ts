import {
  attendanceImportRequestSchema,
  attendanceImportReviewSchema,
  attendanceImportApplySchema,
  attendanceImportReceiptSchema,
} from "../assets/shared/schemas/event-attendance-imports";
import { attendanceEvidenceResponseSchema } from "../assets/shared/schemas/event-attendance-corrections";
import { attendanceSummarySchema } from "../assets/shared/schemas/event-attendance-reporting";
import { attendanceReportSchema } from "../assets/shared/schemas/event-participation-reporting";
import { beforeEach, describe, expect, it } from "vitest";
import { grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  reviewAttendanceImport,
  applyAttendanceImport,
  attendanceImports,
} from "../functions/_lib/services/event-participation/attendance-imports";
import {
  attendanceEvidence,
  correctAttendance,
} from "../functions/_lib/services/event-participation/attendance-corrections";
import { attendanceReport } from "../functions/_lib/services/event-participation/reporting";
import { guardPermissionDatabase } from "../functions/_lib/auth/permissions";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { AppError } from "../functions/_lib/errors";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
const eventId = crypto.randomUUID(),
  actorId = crypto.randomUUID(),
  personId = crypto.randomUUID(),
  occurrenceId = crypto.randomUUID();
let token: string;
const observedAt = "2026-01-01T10:30:00.000Z";
function payload(overrides: Record<string, unknown> = {}) {
  return {
    operationId: crypto.randomUUID(),
    source: "vendor_attendance",
    sourceReference: "provider-export-1",
    rows: [
      {
        sourceRecordId: "record-1",
        userId: personId,
        occurrenceId,
        attendanceMode: "virtual",
        observedAt,
        verification: "unverified",
      },
    ],
    ...overrides,
  };
}
async function reviewAndApply(raw = payload()) {
  const review = await reviewAttendanceImport(env.DB, eventId, actorId, raw);
  return applyAttendanceImport(env.DB, eventId, actorId, {
    operationId: crypto.randomUUID(),
    reviewId: review.reviewId,
    payloadHash: review.payloadHash,
  });
}
describe("Reviewed attributable attendance imports", () => {
  beforeEach(async () => {
    await resetDb();
    const now = new Date().toISOString();
    for (const id of [actorId, personId])
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`)
        .run();
    await grantAdministrator(env.DB, actorId);
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'attendance-import','Import test','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at) VALUES(?,?,'Imported session','2026-01-01T10:00:00.000Z','2026-01-01T11:00:00.000Z')",
    )
      .bind(occurrenceId, eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, "attendance-import");
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), actorId, now)
      .run();
    token = await createAdminSession(env.DB, actorId, crypto.randomUUID());
  });
  it.each(["timezone", "publication", "interval", "legacy"])(
    "requires a fresh review when %s context changes",
    async (change) => {
      const review = await reviewAttendanceImport(env.DB, eventId, actorId, payload());
      expect(review.captureContext).toMatchObject({
        timeZone: "UTC",
        publicationRevision: 0,
        capturedDays: ["2026-01-01"],
      });
      if (change === "timezone")
        await env.DB.prepare("UPDATE events SET timezone='Europe/Amsterdam' WHERE id=?").bind(eventId).run();
      if (change === "publication")
        await env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?")
          .bind(eventId)
          .run();
      if (change === "legacy")
        await env.DB.prepare(
          "UPDATE event_attendance_import_reviews SET capture_context_json=NULL,capture_context_hash=NULL WHERE id=?",
        )
          .bind(review.reviewId)
          .run();
      if (change === "interval")
        await env.DB.prepare(
          "UPDATE event_agenda_publications SET snapshot_json=json_set(snapshot_json,'$.occurrences[0].startAt','2026-01-01T10:10:00.000Z') WHERE event_id=?",
        )
          .bind(eventId)
          .run();
      await expect(
        applyAttendanceImport(env.DB, eventId, actorId, {
          operationId: crypto.randomUUID(),
          reviewId: review.reviewId,
          payloadHash: review.payloadHash,
        }),
      ).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_REVIEW_CHANGED" });
      for (const table of [
        "event_attendance_observations",
        "event_attendance_import_provenance",
        "event_attendance_imports",
      ])
        expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).toEqual({ count: 0 });
    },
  );
  it("atomically refuses a timezone change after preflight without importing any observations", async () => {
    const review = await reviewAttendanceImport(env.DB, eventId, actorId, payload());
    const racing = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE events SET timezone='Europe/Amsterdam' WHERE id=?").bind(eventId).run();
    });
    await expect(
      applyAttendanceImport(racing, eventId, actorId, {
        operationId: crypto.randomUUID(),
        reviewId: review.reviewId,
        payloadHash: review.payloadHash,
      }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_REVIEW_CHANGED" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_observations").first()).toEqual({
      count: 0,
    });
  });
  it("persists the reviewed calendar context with original UTC and import provenance", async () => {
    await reviewAndApply();
    expect(
      await env.DB.prepare(
        "SELECT capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source,observed_at FROM event_attendance_observations",
      ).first(),
    ).toEqual({
      capture_day_date: "2026-01-01",
      capture_time_zone: "UTC",
      capture_publication_revision: 0,
      capture_context_source: "import_review",
      observed_at: observedAt,
    });
  });
  it("reviews without recording presence; applies immutable virtual evidence without manufacturing scans or admission", async () => {
    const input = payload();
    const review = await reviewAttendanceImport(env.DB, eventId, actorId, input);
    expect(await reviewAttendanceImport(env.DB, eventId, actorId, input)).toEqual(review);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_observations").first()).toEqual({
      count: 0,
    });
    const apply = { operationId: crypto.randomUUID(), reviewId: review.reviewId, payloadHash: review.payloadHash };
    const receipt = await applyAttendanceImport(env.DB, eventId, actorId, apply);
    expect(await applyAttendanceImport(env.DB, eventId, actorId, apply)).toEqual(receipt);
    const evidence = (await attendanceEvidence(env.DB, eventId, {})).observations[0];
    expect(evidence).toMatchObject({
      observedAt,
      source: "vendor_attendance",
      action: "import",
      sourceReference: "provider-export-1",
      deviceId: null,
      deviceTimeVerified: false,
      providerVerification: "unverified",
      attendanceMode: "virtual",
      operatorUserId: actorId,
    });
    expect(evidence.receivedAt > observedAt).toBe(true);
    expect((await attendanceReport(env.DB, eventId, {})).sessions[0]).toMatchObject({
      scans: 0,
      attendees: 1,
      physicalAttendees: 0,
      virtualAttendees: 1,
    });
    expect((await attendanceReport(env.DB, eventId, { attendanceMode: "physical" })).sessions[0].attendees).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scan_attempts").first()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_session_admissions").first()).toEqual({
      count: 0,
    });
    await correctAttendance(env.DB, eventId, evidence.id, actorId, {
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      kind: "void",
      reasonCode: "verified_evidence_review",
    });
    expect((await attendanceReport(env.DB, eventId, {})).sessions[0].attendees).toBe(0);
    expect((await attendanceEvidence(env.DB, eventId, {})).observations[0]).toMatchObject({
      source: "vendor_attendance",
      voided: true,
      observedAt,
    });
    expect((await attendanceImports(env.DB, eventId, { limit: 1 })).imports).toHaveLength(1);
  });
  it("mounts reviewed provider-asserted virtual evidence separately from manual evidence and physical presence", async () => {
    const path = "/api/v1/events/attendance-import/attendance";
    const mounted = (suffix: string, body?: unknown) =>
      callApi(env, `${path}${suffix}`, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    for (const [source, verification] of [
      ["vendor_attendance", "provider_verified"],
      ["manual_evidence", "unverified"],
    ] as const) {
      const input = attendanceImportRequestSchema.parse({
        operationId: crypto.randomUUID(),
        source,
        sourceReference: `${source}-reviewed-synthetic-source`,
        rows: [
          {
            sourceRecordId: `${source}-record`,
            userId: personId,
            occurrenceId,
            attendanceMode: "virtual",
            observedAt,
            verification,
          },
        ],
      });
      const reviewing = await mounted("/imports/reviews", input);
      expect(reviewing.status, await reviewing.clone().text()).toBe(200);
      const review = attendanceImportReviewSchema.parse(await reviewing.json());
      const applying = attendanceImportApplySchema.parse({
        operationId: crypto.randomUUID(),
        reviewId: review.reviewId,
        payloadHash: review.payloadHash,
      });
      const applied = await mounted("/imports", applying);
      expect(applied.status, await applied.clone().text()).toBe(200);
      const receipt = attendanceImportReceiptSchema.parse(await applied.json());
      expect(receipt).toMatchObject({
        actorUserId: actorId,
        reviewerUserId: actorId,
        source,
        sourceReference: input.sourceReference,
        rowCount: 1,
      });
      const replay = await mounted("/imports", applying);
      expect(replay.status).toBe(200);
      expect(attendanceImportReceiptSchema.parse(await replay.json())).toEqual(receipt);
    }
    const evidenceResponse = await mounted("/observations");
    expect(evidenceResponse.status).toBe(200);
    const evidence = attendanceEvidenceResponseSchema.parse(await evidenceResponse.json());
    expect(evidence.observations).toHaveLength(2);
    for (const [source, verification] of [
      ["vendor_attendance", "provider_verified"],
      ["manual_evidence", "unverified"],
    ] as const) {
      expect(evidence.observations.find((row) => row.source === source)).toMatchObject({
        userId: personId,
        occurrenceId,
        attendanceMode: "virtual",
        providerVerification: verification,
        observedAt,
        operatorUserId: actorId,
        deviceId: null,
        deviceTimeVerified: false,
        sourceReference: `${source}-reviewed-synthetic-source`,
        captureContext: { dayDate: "2026-01-01", timeZone: "UTC", publicationRevision: 0, source: "import_review" },
      });
    }
    const summaryResponse = await mounted("/summary?attendanceMode=virtual");
    expect(summaryResponse.status).toBe(200);
    const summary = attendanceSummarySchema.parse(await summaryResponse.json());
    expect(summary.observed).toMatchObject({
      uniquePeople: 1,
      virtualPeople: 1,
      physicalPeople: 0,
      providerAssertedVirtualPeople: 1,
      importedObservations: 2,
      originalObservations: 2,
    });
    expect(summary.evidence).toMatchObject({
      providerVerification: "source_assertion",
      clockVerification: "unverified",
      presenceDuration: "not_established",
    });
    const reportResponse = await mounted("");
    expect(reportResponse.status).toBe(200);
    expect(attendanceReportSchema.parse(await reportResponse.json()).sessions[0]).toMatchObject({
      occurrenceId,
      scans: 0,
      attendees: 1,
      physicalAttendees: 0,
      virtualAttendees: 1,
    });
    const physical = await mounted("?attendanceMode=physical");
    expect(attendanceReportSchema.parse(await physical.json()).sessions[0].attendees).toBe(0);
    for (const table of ["event_scan_attempts", "event_session_admissions"])
      expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).toEqual({ count: 0 });
  });

  it("rejects unknown people, out-of-interval time and manual verification claims", async () => {
    for (const change of [{ userId: crypto.randomUUID() }, { observedAt: "2026-01-01T11:00:00.000Z" }]) {
      const input = payload();
      input.rows[0] = { ...input.rows[0], ...change };
      await expect(reviewAttendanceImport(env.DB, eventId, actorId, input)).rejects.toMatchObject({
        code: "ATTENDANCE_IMPORT_EVIDENCE_INVALID",
      });
    }
    const input = payload({ source: "manual_evidence" });
    input.rows[0].verification = "provider_verified";
    await expect(reviewAttendanceImport(env.DB, eventId, actorId, input)).rejects.toThrow();
  });
  it("binds review to actor/hash and prevents duplicate source records from overwriting originals", async () => {
    const input = payload(),
      review = await reviewAttendanceImport(env.DB, eventId, actorId, input);
    await expect(
      applyAttendanceImport(env.DB, eventId, personId, {
        operationId: crypto.randomUUID(),
        reviewId: review.reviewId,
        payloadHash: review.payloadHash,
      }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_REVIEW_CHANGED" });
    await reviewAndApply(input);
    await expect(reviewAndApply(payload())).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_REVIEW_CHANGED" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_observations").first()).toEqual({
      count: 1,
    });
  });
  it("rolls back all rows if reviewed session changes before atomic commit", async () => {
    const review = await reviewAttendanceImport(env.DB, eventId, actorId, payload());
    const racing = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?").bind(eventId).run(),
    );
    await expect(
      applyAttendanceImport(racing, eventId, actorId, {
        operationId: crypto.randomUUID(),
        reviewId: review.reviewId,
        payloadHash: review.payloadHash,
      }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_REVIEW_CHANGED" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_imports").first()).toEqual({
      count: 0,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_observations").first()).toEqual({
      count: 0,
    });
  });
  it("mounted scoped review/apply is replay safe under concurrent retry", async () => {
    const reviewResponse = await callApi(env, "/api/v1/events/attendance-import/attendance/imports/reviews", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload()),
    });
    expect(reviewResponse.status).toBe(200);
    const review = (await reviewResponse.json()) as { reviewId: string; payloadHash: string };
    const body = JSON.stringify({
      operationId: crypto.randomUUID(),
      reviewId: review.reviewId,
      payloadHash: review.payloadHash,
    });
    const responses = await Promise.all(
      [1, 2].map(() =>
        callApi(env, "/api/v1/events/attendance-import/attendance/imports", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body,
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
  });
  it("keeps import permission independent from report access", async () => {
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), actorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:attendance_read','event',?,?)",
    )
      .bind(crypto.randomUUID(), actorId, eventId, new Date().toISOString())
      .run();
    expect(
      (
        await callApi(env, "/api/v1/events/attendance-import/attendance/imports", {
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await callApi(env, "/api/v1/events/attendance-import/attendance/imports/reviews", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(payload()),
        })
      ).status,
    ).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_import_reviews").first()).toEqual({
      count: 0,
    });
  });
  it("does not persist imported evidence or audit after import permission is revoked between preflight and batch", async () => {
    const review = await reviewAttendanceImport(env.DB, eventId, actorId, payload());
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), actorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:attendance_import','event',?,?)",
    )
      .bind(crypto.randomUUID(), actorId, eventId, new Date().toISOString())
      .run();
    const actor = createUserBackedAuthAdmin({
      id: actorId,
      email: "operator@example.test",
      scopes: [],
      grants: [{ permission: "agenda:attendance_import", contextType: "event", contextId: eventId }],
    });
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?")
        .bind(new Date().toISOString(), actorId)
        .run(),
    );
    const guarded = guardPermissionDatabase(
      raced,
      actor,
      [{ permission: "agenda:attendance_import", context: { type: "event", id: eventId } }],
      () => new AppError(403, "ATTENDANCE_IMPORT_PERMISSION_CHANGED", "Permission revoked."),
    );
    await expect(
      applyAttendanceImport(guarded, eventId, actorId, {
        operationId: crypto.randomUUID(),
        reviewId: review.reviewId,
        payloadHash: review.payloadHash,
      }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_PERMISSION_CHANGED" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_observations").first()).toEqual({
      count: 0,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_imports").first()).toEqual({
      count: 0,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='agenda.attendance.imported'").first(),
    ).toEqual({ count: 0 });
  });
});

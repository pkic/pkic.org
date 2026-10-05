import { eventScannerReconciliation } from "../functions/_lib/services/event-participation/scanner-reconciliation";
import { grantAdministrator } from "./helpers/administrator";
import { createEvidencePurgeReview } from "../functions/_lib/services/event-participation/retention-purge-review";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  evidencePurgePreviewSchema,
  evidencePurgeReviewResponseSchema,
  evidencePurgeRunResponseSchema,
  evidencePurgeChunkResponseSchema,
  EVIDENCE_PURGE_TABLES,
} from "../assets/shared/schemas/event-evidence-purge";
import { eventAttendanceSummary } from "../functions/_lib/services/event-participation/attendance-summary";
import { eventAttendanceReasons } from "../functions/_lib/services/event-participation/attendance-attempt-report";
import { commitEvidencePurgeChunk } from "../functions/_lib/services/event-participation/retention-purge-chunks";
import type { UserBackedAuthAdmin, DatabaseLike, StatementLike } from "../functions/_lib/types";
beforeEach(resetDb);
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB),
    actorId = await insertUser(env.DB, "purge-operator@example.test"),
    person = await insertUser(env.DB, "purge-attendee@example.test");
  const grants = await grantAdministrator(env.DB, actorId);
  const token = await createAdminSession(env.DB, actorId, crypto.randomUUID()),
    now = new Date().toISOString();
  const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(actorId).first<{ id: string }>();
  const actor: UserBackedAuthAdmin = {
    identityType: "user",
    id: actorId,
    email: "purge-operator@example.test",
    grants,
    sessionId: session!.id,
  };
  await env.DB.prepare("UPDATE event_scanner_reconciliation_coverage SET coverage_started_at=? WHERE event_id=?")
    .bind(now, eventId)
    .run();
  const endpoint = `/api/v1/retention/events/${eventId}`;
  const send = (path: string, body?: unknown) =>
    callApi(env, endpoint + path, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  await env.DB.prepare("UPDATE events SET ends_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(eventId).run();
  await env.DB.prepare("INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES(?,1,?)")
    .bind(eventId, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_evidence_retention_policies(event_id,revision,evidence_until,purpose_code,legal_hold,updated_by,updated_at) VALUES(?,1,'2020-01-02T00:00:00.000Z','attendance_review',0,?,?)",
  )
    .bind(eventId, actorId, now)
    .run();
  const occurrences = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of occurrences)
    await env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Retained scope')")
      .bind(id, eventId)
      .run();
  return { eventId, actorId, person, actor, occurrences, send, now };
}
async function observation(
  f: Awaited<ReturnType<typeof fixture>>,
  occurrence: string | null,
  mode = "physical",
  missing = false,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO event_attendance_observations(id,event_id,occurrence_id,user_id,attendance_mode,observed_at,capture_day_date,capture_time_zone,capture_context_source) VALUES(?,?,?,?,?,'2020-01-01T12:00:00.000Z',?,?,?)",
  )
    .bind(
      id,
      f.eventId,
      occurrence,
      f.person,
      mode,
      missing ? null : "2020-01-01",
      missing ? null : "UTC",
      missing ? null : "import_review",
    )
    .run();
  return id;
}
async function evidenceGraph(f: Awaited<ReturnType<typeof fixture>>, ids: string[]) {
  const badge = crypto.randomUUID(),
    attempt = crypto.randomUUID(),
    operation = crypto.randomUUID(),
    epoch = crypto.randomUUID(),
    device = crypto.randomUUID(),
    review = crypto.randomUUID(),
    importId = crypto.randomUUID(),
    grant = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at) VALUES(?,?,?,?,?)",
    ).bind(badge, f.eventId, f.person, crypto.randomUUID(), f.now),
    env.DB.prepare(
      "INSERT INTO event_scan_attempts(id,event_id,occurrence_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at,capture_day_date,capture_time_zone,capture_context_source) VALUES(?,?,?,?,?,?,?,?,?,'eligible','recorded','attendance','2020-01-01T12:00:00.000Z',?,'2020-01-01','UTC','server_receipt')",
    ).bind(attempt, f.eventId, f.occurrences[0], badge, f.person, f.actorId, device, operation, "synthetic", f.now),
    env.DB.prepare("UPDATE event_attendance_observations SET attempt_id=? WHERE id=?").bind(attempt, ids[0]),
    env.DB.prepare(
      "INSERT INTO event_scanner_device_sessions(id,event_id,operator_user_id,device_id,enrollment_operation_id,opened_at) VALUES(?,?,?,?,?,?)",
    ).bind(epoch, f.eventId, f.actorId, device, crypto.randomUUID(), f.now),
    env.DB.prepare(
      "INSERT INTO event_scanner_upload_receipts(epoch_id,sequence,operation_id,request_hash,response_json,received_at) VALUES(?,1,?,?,?,?)",
    ).bind(epoch, operation, "synthetic", JSON.stringify({ userId: f.person }), f.now),
    env.DB.prepare(
      "UPDATE event_scanner_device_sessions SET high_water_sequence=1,closing_operation_id=?,closing_declared_at=?,closed_at=? WHERE id=?",
    ).bind(crypto.randomUUID(), f.now, f.now, epoch),
    env.DB.prepare(
      "INSERT INTO event_attendance_import_reviews(id,event_id,operation_id,actor_user_id,payload_hash,payload_json,reviewed_at,expires_at,applied_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).bind(
      review,
      f.eventId,
      crypto.randomUUID(),
      f.actorId,
      "synthetic",
      JSON.stringify({ userId: f.person }),
      f.now,
      "2099-01-01T00:00:00.000Z",
      f.now,
    ),
    env.DB.prepare(
      "INSERT INTO event_attendance_imports(id,event_id,operation_id,review_id,reviewer_user_id,actor_user_id,source,source_reference,row_count,received_at) VALUES(?,?,?,?,?,?,'vendor_attendance','sensitive-original',1,?)",
    ).bind(importId, f.eventId, crypto.randomUUID(), review, f.actorId, f.actorId, f.now),
    env.DB.prepare(
      "INSERT INTO event_attendance_import_provenance(observation_id,import_id,event_id,source,source_reference,source_record_id,verification) VALUES(?,?,?,'vendor_attendance','sensitive-original','personal-record','unverified')",
    ).bind(ids[1], importId, f.eventId),
    env.DB.prepare(
      "INSERT INTO event_attendance_corrections(id,observation_id,event_id,actor_user_id,operation_id,revision,kind,reason_code,created_at) VALUES(?,?,?,?,?,1,'void','duplicate_capture',?)",
    ).bind(crypto.randomUUID(), ids[3], f.eventId, f.actorId, crypto.randomUUID(), f.now),
    env.DB.prepare("INSERT INTO event_attendance_correction_state(observation_id,revision,voided) VALUES(?,1,1)").bind(
      ids[3],
    ),
    env.DB.prepare(
      "INSERT INTO event_sponsor_leads(id,event_id,sponsor_id,user_id,operator_user_id,observed_at) VALUES(?,?,'synthetic-sponsor',?,?,?)",
    ).bind(crypto.randomUUID(), f.eventId, f.person, f.actorId, f.now),
    env.DB.prepare(
      "INSERT INTO event_offline_admission_grants(id,event_id,occurrence_id,day_date,operator_user_id,device_id,quantity,issued_at,expires_at,closed_at,created_by) VALUES(?,?,?,'2020-01-01',?,?,1,'2020-01-01T00:00:00.000Z','2020-01-02T00:00:00.000Z',?,?)",
    ).bind(grant, f.eventId, f.occurrences[0], f.actorId, device, f.now, f.actorId),
    env.DB.prepare("INSERT INTO event_offline_admission_entitlements(grant_id,user_id) VALUES(?,?)").bind(
      grant,
      f.person,
    ),
    env.DB.prepare("INSERT INTO event_offline_admission_access(grant_id,user_id) VALUES(?,?)").bind(grant, f.person),
    env.DB.prepare(
      "INSERT INTO event_offline_admission_spends(operation_id,grant_id,slot,user_id,observed_at,accepted_at) VALUES(?,?,0,?,'2020-01-01T12:00:00.000Z',?)",
    ).bind(operation, grant, f.person, f.now),
    env.DB.prepare(
      "INSERT INTO event_entry_admissions(id,event_id,day_date,user_id,operation_id,admitted_at) VALUES(?,?,'2020-01-01',?,?,?)",
    ).bind(crypto.randomUUID(), f.eventId, f.person, crypto.randomUUID(), f.now),
    env.DB.prepare(
      "INSERT INTO event_session_admissions(id,event_id,occurrence_id,user_id,operation_id,admitted_at) VALUES(?,?,?,?,?,?)",
    ).bind(crypto.randomUUID(), f.eventId, f.occurrences[0], f.person, crypto.randomUUID(), f.now),
  ]);
}
async function start(f: Awaited<ReturnType<typeof fixture>>) {
  const previewResponse = await f.send("/evidence");
  expect(previewResponse.status, await previewResponse.clone().text()).toBe(200);
  const preview = evidencePurgePreviewSchema.parse(await previewResponse.json());
  expect(preview.blockers).toEqual([]);
  const reviewed = await f.send("/reviews", {
    operationId: crypto.randomUUID(),
    expectedPreviewHash: preview.previewHash,
    expectedPolicyRevision: preview.policyRevision,
    expectedGeneration: preview.sourceGeneration,
  });
  expect(reviewed.status, await reviewed.clone().text()).toBe(200);
  const review = evidencePurgeReviewResponseSchema.parse(await reviewed.json());
  const response = await f.send("/runs", {
    operationId: crypto.randomUUID(),
    reviewId: review.reviewId,
    reviewHash: review.reviewHash,
    retireCapture: true,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return evidencePurgeRunResponseSchema.parse(await response.json());
}
describe("reviewed bounded raw evidence removal", () => {
  it("preserves exact intersecting unique populations and permanent transport proof, deletes every raw chain, and rejects late capture", async () => {
    const f = await fixture();
    const ids = [
      await observation(f, f.occurrences[0]),
      await observation(f, f.occurrences[1]),
      await observation(f, f.occurrences[0], "virtual"),
      await observation(f, null, "physical", true),
    ];
    await evidenceGraph(f, ids);
    const before = await eventAttendanceSummary(env.DB, f.eventId, {});
    expect(before.observed).toMatchObject({
      uniquePeople: 1,
      physicalPeople: 1,
      virtualPeople: 1,
      originalObservations: 4,
    });
    const transportSnapshot = await eventScannerReconciliation(env.DB, f.eventId);
    const run = await start(f);
    expect(await eventScannerReconciliation(env.DB, f.eventId)).toEqual({
      ...transportSnapshot,
      sourceState: "retention_in_progress",
    });
    expect(
      (
        await f.send("/runs", {
          operationId: crypto.randomUUID(),
          reviewId: crypto.randomUUID(),
          reviewHash: "0".repeat(64),
          retireCapture: true,
        })
      ).status,
    ).toBe(409);
    await expect(eventAttendanceSummary(env.DB, f.eventId, {})).rejects.toMatchObject({
      code: "EVIDENCE_RETENTION_IN_PROGRESS",
    });
    let progress = run,
      firstReceipt: unknown,
      firstRequest: unknown;
    for (let step = 0; step < 80 && progress.status !== "complete"; step++) {
      const request = { operationId: crypto.randomUUID(), expectedOrdinal: progress.ordinal };
      const response = await f.send(`/runs/${run.runId}/chunks`, request);
      expect(response.status, await response.clone().text()).toBe(200);
      const receipt = evidencePurgeChunkResponseSchema.parse(await response.json());
      expect(receipt.rowCount).toBeLessThanOrEqual(100);
      if (step === 0) {
        firstReceipt = receipt;
        firstRequest = request;
      }
      progress = evidencePurgeRunResponseSchema.parse(await (await f.send(`/runs/${run.runId}`)).json());
    }
    expect(progress.status).toBe("complete");
    expect(await eventScannerReconciliation(env.DB, f.eventId)).toEqual({
      ...transportSnapshot,
      sourceState: "purged",
    });
    expect(await (await f.send(`/runs/${run.runId}/chunks`, firstRequest)).json()).toEqual(firstReceipt);
    for (const table of EVIDENCE_PURGE_TABLES)
      expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).toEqual({ count: 0 });
    for (const table of ["event_evidence_retention_progress", "event_evidence_retention_delete_permits"])
      expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).toEqual({ count: 0 });
    const after = await eventAttendanceSummary(env.DB, f.eventId, {});
    expect(after.observed).toEqual(before.observed);
    expect(after.classification).toEqual(before.classification);
    expect(
      (await eventAttendanceSummary(env.DB, f.eventId, { dayDate: "2020-01-01", occurrenceId: f.occurrences[0] }))
        .observed,
    ).toMatchObject({ uniquePeople: 1, physicalPeople: 1, virtualPeople: 1, originalObservations: 2 });
    expect(await eventAttendanceReasons(env.DB, f.eventId, {})).toMatchObject({
      reasons: [{ action: "attendance", reason: "recorded", count: 1, exceptionReason: null }],
    });
    expect(
      await env.DB.prepare("SELECT sponsor_id,lead_count FROM event_evidence_retention_sponsors WHERE run_id=?")
        .bind(run.runId)
        .first(),
    ).toEqual({ sponsor_id: "synthetic-sponsor", lead_count: 1 });
    const emptyDay = await eventAttendanceSummary(env.DB, f.eventId, { dayDate: "2099-01-01" });
    expect(emptyDay.observed).toMatchObject({ uniquePeople: 0, originalObservations: 0 });
    expect(emptyDay.classification).toMatchObject({
      missingObservations: before.classification.missingObservations,
      missingAttempts: before.classification.missingAttempts,
      capturedTimeZones: 0,
      dayFilterExcludesMissing: true,
    });
    expect(emptyDay.sync).toMatchObject({
      knownGrants: 0,
      reconciledAdmissions: 0,
      lastReceivedAt: null,
      scannerReconciliation: { sourceState: "purged", closedEpochs: transportSnapshot.closedEpochs },
    });
    expect(await eventAttendanceReasons(env.DB, f.eventId, { dayDate: "2099-01-01" })).toMatchObject({
      reasons: [],
      page: { total: 0 },
    });
    await expect(
      eventAttendanceSummary(env.DB, f.eventId, { dayDate: "2099-01-01", occurrenceId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "ATTENDANCE_OCCURRENCE_NOT_FOUND" });
    expect(after.sync.scannerReconciliation.deviceBacklog).toBe("complete");
    await expect(observation(f, null)).rejects.toThrow("EVENT_EVIDENCE_CAPTURE_CLOSED");
    expect(await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(f.person).first()).toEqual({
      email: "purge-attendee@example.test",
    });
    const receiptText = JSON.stringify(
      await env.DB.prepare(
        "SELECT row_count,phase,source_generation_before,source_generation_after FROM event_evidence_retention_chunks",
      ).all(),
    );
    for (const id of [...ids, f.person]) expect(receiptText).not.toContain(id);
  });
  it.each(["session", "hold"])("rolls back a prepared materialization step when %s changes at commit", async (kind) => {
    const f = await fixture();
    await observation(f, null);
    const run = await start(f);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      kind === "session"
        ? env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(f.now, f.actor.sessionId!).run()
        : env.DB.prepare(
            "UPDATE event_evidence_retention_policies SET revision=revision+1,legal_hold=1,hold_reason_code='review_in_progress' WHERE event_id=?",
          )
            .bind(f.eventId)
            .run(),
    );
    await expect(
      commitEvidencePurgeChunk(racingDb, f.actor, f.eventId, run.runId, {
        operationId: crypto.randomUUID(),
        expectedOrdinal: 0,
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_PURGE_CONTEXT_CHANGED" });
    for (const table of [
      "event_evidence_retention_chunks",
      "event_evidence_retention_grains",
      "event_evidence_retention_delete_permits",
    ])
      expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT ordinal FROM event_evidence_retention_runs WHERE id=?").bind(run.runId).first(),
    ).toEqual({ ordinal: 0 });
    expect(
      await env.DB.prepare("SELECT active_run_id FROM event_evidence_retention_state WHERE event_id=?")
        .bind(f.eventId)
        .first(),
    ).toEqual({ active_run_id: run.runId });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE action='event_evidence_removal_step'",
      ).first(),
    ).toEqual({ count: 0 });
  });
  it("refuses unknown legacy device coverage", async () => {
    const f = await fixture();
    await env.DB.prepare("DELETE FROM event_scanner_reconciliation_coverage WHERE event_id=?").bind(f.eventId).run();
    const preview = evidencePurgePreviewSchema.parse(await (await f.send("/evidence")).json());
    expect(preview.blockers).toContain("device_reconciliation_incomplete");
    expect(
      (
        await f.send("/reviews", {
          operationId: crypto.randomUUID(),
          expectedPreviewHash: preview.previewHash,
          expectedPolicyRevision: preview.policyRevision,
          expectedGeneration: preview.sourceGeneration,
        })
      ).status,
    ).toBe(409);
  });
});

it("renews a changed policy and resumes the same run without reopening capture", async () => {
  const f = await fixture();
  await observation(f, null);
  const run = await start(f);
  const first = await f.send(`/runs/${run.runId}/chunks`, { operationId: crypto.randomUUID(), expectedOrdinal: 0 });
  expect(first.status).toBe(200);
  await env.DB.prepare(
    "UPDATE event_evidence_retention_policies SET revision=2,legal_hold=1,hold_reason_code='review_in_progress' WHERE event_id=?",
  )
    .bind(f.eventId)
    .run();
  const held = evidencePurgeRunResponseSchema.parse(await (await f.send(`/runs/${run.runId}`)).json());
  expect(held.reviewRequired).toBe(true);
  expect(
    (
      await f.send(`/runs/${run.runId}/reviews`, {
        operationId: crypto.randomUUID(),
        expectedPreviewHash: evidencePurgePreviewSchema.parse(await (await f.send("/evidence")).json()).previewHash,
        expectedPolicyRevision: 2,
        expectedGeneration: held.sourceGeneration,
      })
    ).status,
  ).toBe(409);
  await env.DB.prepare(
    "UPDATE event_evidence_retention_policies SET revision=3,legal_hold=0,hold_reason_code=NULL WHERE event_id=?",
  )
    .bind(f.eventId)
    .run();
  const renewedResponse = await f.send(`/runs/${run.runId}/reviews`, {
    operationId: crypto.randomUUID(),
    expectedPreviewHash: evidencePurgePreviewSchema.parse(await (await f.send("/evidence")).json()).previewHash,
    expectedPolicyRevision: 3,
    expectedGeneration: held.sourceGeneration,
  });
  expect(renewedResponse.status, await renewedResponse.clone().text()).toBe(200);
  const renewed = evidencePurgeReviewResponseSchema.parse(await renewedResponse.json());
  expect(renewed.activeRunId).toBe(run.runId);
  const request = { operationId: crypto.randomUUID(), reviewId: renewed.reviewId, reviewHash: renewed.reviewHash };
  const resumedResponse = await f.send(`/runs/${run.runId}/resumptions`, request);
  expect(resumedResponse.status, await resumedResponse.clone().text()).toBe(200);
  const resumed = evidencePurgeRunResponseSchema.parse(await resumedResponse.json());
  expect(resumed).toMatchObject({ runId: run.runId, ordinal: 1, reviewRequired: false, status: "running" });
  expect((await f.send(`/runs/${run.runId}/resumptions`, request)).status).toBe(200);
  expect(
    (await f.send(`/runs/${run.runId}/chunks`, { operationId: crypto.randomUUID(), expectedOrdinal: 1 })).status,
  ).toBe(200);
  await expect(observation(f, null)).rejects.toThrow("EVENT_EVIDENCE_CAPTURE_CLOSED");
});

it("processes 2000 people and a skewed repeat population in bounded retry-safe chunks", async () => {
  const f = await fixture();
  const cohort = Array.from({ length: 1999 }, (_, index) => ({
    id: crypto.randomUUID(),
    email: `purge-scale-${index}@example.test`,
  }));
  await env.DB.prepare(
    "INSERT INTO users(id,email,normalized_email,active) SELECT json_extract(value,'$.id'),json_extract(value,'$.email'),json_extract(value,'$.email'),1 FROM json_each(?)",
  )
    .bind(JSON.stringify(cohort))
    .run();
  const rows = [
    ...cohort.map((person) => ({ id: crypto.randomUUID(), userId: person.id })),
    ...Array.from({ length: 2000 }, () => ({ id: crypto.randomUUID(), userId: f.person })),
  ];
  await env.DB.prepare(
    "INSERT INTO event_attendance_observations(id,event_id,user_id,attendance_mode,observed_at,capture_day_date,capture_time_zone,capture_context_source) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.userId'),'physical','2020-01-01T12:00:00.000Z','2020-01-01','UTC','import_review' FROM json_each(?)",
  )
    .bind(f.eventId, JSON.stringify(rows))
    .run();
  expect((await eventAttendanceSummary(env.DB, f.eventId, {})).observed).toMatchObject({
    uniquePeople: 2000,
    originalObservations: 3999,
  });
  let progress = await start(f),
    steps = 0,
    maxQueries = 0,
    maxManifest = 0;
  while (progress.status !== "complete" && steps < 100) {
    let queries = 0;
    const db: DatabaseLike = {
      prepare: (sql) => {
        queries++;
        const statement = env.DB.prepare(sql);
        return {
          ...statement,
          bind: (...values: unknown[]) => {
            if (sql.startsWith("INSERT INTO event_evidence_retention_delete_permits"))
              maxManifest = Math.max(maxManifest, JSON.parse(String(values.at(-1))).length);
            return statement.bind(...values);
          },
        } as StatementLike;
      },
      batch: (statements) => env.DB.batch(statements),
    };
    const input = { operationId: crypto.randomUUID(), expectedOrdinal: progress.ordinal };
    const receipt = await commitEvidencePurgeChunk(db, f.actor, f.eventId, progress.runId, input);
    expect(receipt.rowCount).toBeLessThanOrEqual(100);
    maxQueries = Math.max(maxQueries, queries);
    if (steps === 0)
      expect(await commitEvidencePurgeChunk(env.DB, f.actor, f.eventId, progress.runId, input)).toEqual(receipt);
    progress = evidencePurgeRunResponseSchema.parse(await (await f.send(`/runs/${progress.runId}`)).json());
    steps++;
  }
  expect(progress.status).toBe("complete");
  expect(steps).toBeLessThan(100);
  expect(maxManifest).toBe(100);
  expect(maxQueries).toBeLessThanOrEqual(40);
  expect((await eventAttendanceSummary(env.DB, f.eventId, {})).observed).toMatchObject({
    uniquePeople: 2000,
    originalObservations: 3999,
  });
}, 60000);

it("pins the count-only preview hash and rolls back a publication context race", async () => {
  const f = await fixture();
  await observation(f, null);
  const preview = evidencePurgePreviewSchema.parse(await (await f.send("/evidence")).json());
  const input = {
    operationId: crypto.randomUUID(),
    expectedPreviewHash: preview.previewHash,
    expectedPolicyRevision: preview.policyRevision,
    expectedGeneration: preview.sourceGeneration,
  };
  await env.DB.prepare("UPDATE events SET timezone='UTC' WHERE id=?").bind(f.eventId).run();
  expect((await f.send("/reviews", input)).status).toBe(409);
  const fresh = evidencePurgePreviewSchema.parse(await (await f.send("/evidence")).json());
  const racingDb = mutateBeforeNextBatch(env.DB, () =>
    env.DB.prepare("UPDATE events SET timezone='Europe/London' WHERE id=?").bind(f.eventId).run(),
  );
  await expect(
    createEvidencePurgeReview(racingDb, f.actor, f.eventId, { ...input, expectedPreviewHash: fresh.previewHash }),
  ).rejects.toMatchObject({ code: "EVIDENCE_PURGE_CONTEXT_CHANGED" });
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_evidence_retention_reviews").first()).toEqual({
    count: 0,
  });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action='event_evidence_removal_reviewed'",
    ).first(),
  ).toEqual({ count: 0 });
});
it("returns the same committed receipt for concurrent retries of one step", async () => {
  const f = await fixture();
  await observation(f, null);
  const run = await start(f),
    input = { operationId: crypto.randomUUID(), expectedOrdinal: 0 };
  const [left, right] = await Promise.all([
    commitEvidencePurgeChunk(env.DB, f.actor, f.eventId, run.runId, input),
    commitEvidencePurgeChunk(env.DB, f.actor, f.eventId, run.runId, input),
  ]);
  expect(left).toEqual(right);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS count FROM event_evidence_retention_chunks WHERE run_id=?")
      .bind(run.runId)
      .first(),
  ).toEqual({ count: 1 });
});

it("proves valid empty day scopes only after exact aggregate enumeration finishes", async () => {
  const f = await fixture();
  await observation(f, f.occurrences[0]);
  await observation(f, f.occurrences[0], "physical", true);
  const run = await start(f),
    query = { dayDate: "2020-01-05", occurrenceId: f.occurrences[0], attendanceMode: "physical" };
  await expect(eventAttendanceSummary(env.DB, f.eventId, query)).rejects.toMatchObject({
    code: "EVIDENCE_RETENTION_IN_PROGRESS",
  });
  await expect(eventAttendanceReasons(env.DB, f.eventId, query)).rejects.toMatchObject({
    code: "EVIDENCE_RETENTION_IN_PROGRESS",
  });
  await expect(
    eventAttendanceSummary(env.DB, f.eventId, { ...query, occurrenceId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ code: "ATTENDANCE_OCCURRENCE_NOT_FOUND" });
  let progress = run;
  for (let step = 0; step < 30 && progress.phase === "aggregates"; step++) {
    const response = await f.send(`/runs/${run.runId}/chunks`, {
      operationId: crypto.randomUUID(),
      expectedOrdinal: progress.ordinal,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    progress = evidencePurgeRunResponseSchema.parse(await (await f.send(`/runs/${run.runId}`)).json());
  }
  expect(progress.phase).not.toBe("aggregates");
  const empty = await eventAttendanceSummary(env.DB, f.eventId, query);
  expect(empty.observed).toMatchObject({ uniquePeople: 0, originalObservations: 0 });
  expect(empty.classification).toMatchObject({
    missingObservations: 1,
    missingAttempts: 0,
    capturedTimeZones: 0,
    dayFilterExcludesMissing: true,
    missingScope: "event_occurrence_mode_without_day",
  });
  expect(empty.currentIntent).toMatchObject({
    timeZone: "Europe/Amsterdam",
    startAt: "2020-01-04T23:00:00.000Z",
    endAt: "2020-01-05T23:00:00.000Z",
  });
  expect(empty.sync.scannerReconciliation.sourceState).toBe("retention_in_progress");
  expect(await eventAttendanceReasons(env.DB, f.eventId, query)).toMatchObject({ reasons: [], page: { total: 0 } });
});

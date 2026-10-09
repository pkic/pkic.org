import { env } from "cloudflare:workers";
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventRecordingAcquireSchema,
  eventRecordingAcquisitionSchema,
  eventRecordingSourceSchema,
} from "../assets/shared/schemas/event-recordings";
import { eventSlugParamsSchema } from "../assets/shared/schemas/api-common";
import { ok } from "../assets/shared/schemas/route-contract";
import { requireEventPermission } from "../functions/api/v1/events/[eventSlug]/authorization";
import { openApiRoute } from "../functions/_lib/openapi/route";
import { handleError, jsonNoStore } from "../functions/_lib/http";
import type { AdminContext } from "../functions/_lib/db/context";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import {
  requestRecordingAcquisition,
  claimRecordingAcquisition,
  prepareRecordingAcquisitionCompletion,
  finishRecordingAcquisitionFailure,
  dueRecordingAcquisitionIds,
  recordingAcquisitionObjectKey,
  type RecordingAcquisitionClaim,
  type VerifiedRecordingAcquisitionVersion,
} from "../functions/_lib/services/event-recordings/acquisitions";
import { createAdminSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";

/** Mounted request boundary: real canonical validation, authentication and D1, without provider/storage calls. */
function mounted() {
  const app = new Hono<{ Bindings: Env }>();
  app.onError(handleError);
  fromHono(app).post(
    "/events/:eventSlug/recordings/:sourceId/acquisitions",
    openApiRoute(
      {
        request: {
          params: eventSlugParamsSchema.extend({ sourceId: eventRecordingSourceSchema.shape.id }),
          body: { content: { "application/json": { schema: eventRecordingAcquireSchema } }, required: true },
        },
        responses: ok("Durable acquisition intent", eventRecordingAcquisitionSchema),
      },
      async (c: AdminContext, data) => {
        const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
        return jsonNoStore(await requestRecordingAcquisition(db, event.id, data.params.sourceId, actor, data.body));
      },
    ),
  );
  return app;
}
async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const sourceId = crypto.randomUUID(),
    now = nowIso();
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId: admin.id, now });
  await env.DB.prepare(
    `INSERT INTO event_recording_sources(id,event_id,meeting_link_id,provider_type,provider_account_id,
    provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,provider_status,
    provider_invoked_at,provider_started_at,provider_file_size,metadata_revision,observed_at,
    created_by_user_id,created_at,updated_at) VALUES(?,?,?,'realtimekit',?,'synthetic-app',?,?,?,'UPLOADED',?,?,16,1,?,?,?,?)`,
  )
    .bind(
      sourceId,
      eventId,
      meeting.meetingLinkId,
      meeting.providerAccountId,
      meeting.providerMeetingId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      now,
      now,
      now,
      admin.id,
      now,
      now,
    )
    .run();
  const app = mounted(),
    request = eventRecordingAcquireSchema.parse({ operationId: crypto.randomUUID(), expectedMetadataRevision: 1 });
  const call = (
    body: unknown = request,
    db: DatabaseLike = env.DB,
    bearer: string | null = token,
    source = sourceId,
    slug = "pqc-2026",
  ) =>
    app.request(
      `/events/${slug}/recordings/${source}/acquisitions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(body),
      },
      { ...env, DB: db },
    );
  const enqueue = async (body = request, db: DatabaseLike = env.DB) => {
    const response = await call(body, db);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    return eventRecordingAcquisitionSchema.parse(await response.json());
  };
  const claim = async (id: string) => {
    const result = await claimRecordingAcquisition(env.DB, id);
    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected an owned claim");
    return result;
  };
  return { eventId, admin, token, sourceId, request, call, enqueue, claim };
}
function version(
  claim: RecordingAcquisitionClaim,
  overrides: Partial<VerifiedRecordingAcquisitionVersion> = {},
): VerifiedRecordingAcquisitionVersion {
  const id = crypto.randomUUID();
  return {
    id,
    eventId: claim.acquisition.eventId,
    sourceId: claim.acquisition.sourceId,
    acquisitionId: claim.acquisition.id,
    version: 1,
    sourceMetadataRevision: claim.acquisition.expectedMetadataRevision,
    digest: "a".repeat(64),
    fileBytes: 16,
    mimeType: "video/mp4",
    acquiredAt: nowIso(),
    deletedAt: null,
    r2Key: recordingAcquisitionObjectKey(claim, id),
    objectETag: "verified-owned-object",
    ...overrides,
  };
}
const acquisitionRows = () => queryAll(env.DB, "SELECT id,status,attempts FROM event_recording_acquisitions");
const audits = (action?: string) =>
  queryAll(
    env.DB,
    `SELECT action,entity_id FROM audit_log WHERE action ${action ? "=?" : "LIKE 'recording_acquisition_%'"}`,
    ...(action ? [action] : []),
  );
async function expireLease(id: string) {
  await env.DB.prepare("UPDATE event_recording_acquisitions SET claimed_at=?,lease_expires_at=? WHERE id=?")
    .bind("2000-01-01T00:00:00.000Z", "2000-01-01T00:05:00.000Z", id)
    .run();
}
async function revoke(userId: string) {
  await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), userId).run();
}

describe("durable owned recording acquisitions", () => {
  beforeEach(resetDb);
  it("enqueues an immutable metadata-only intent and replays it once", async () => {
    const f = await fixture(),
      first = await f.enqueue(),
      again = await f.enqueue();
    expect(again).toEqual(first);
    expect(first).toMatchObject({
      eventId: f.eventId,
      sourceId: f.sourceId,
      status: "queued",
      attempts: 0,
      versionId: null,
    });
    expect(await acquisitionRows()).toHaveLength(1);
    expect(await audits()).toEqual([{ action: "recording_acquisition_requested", entity_id: first.id }]);
    expect(JSON.stringify(first)).not.toMatch(/payloadHash|processingToken|r2Key|apiToken|requestedByUserId/);
  });
  it("returns one durable intent for concurrent identical requests", async () => {
    const f = await fixture();
    const receipts = await Promise.all([f.enqueue(), f.enqueue()]);
    expect(receipts[0].id).toBe(receipts[1].id);
    expect(await acquisitionRows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });
  it("rolls back an actual unique collision and returns the exact committed receipt", async () => {
    const f = await fixture();
    let committedId: string | undefined;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO event_recording_acquisitions"),
      async () => {
        committedId = (await f.enqueue()).id;
      },
    );
    const recovered = await f.enqueue(f.request, db);
    expect(committedId).toBeDefined();
    expect(recovered.id).toBe(committedId);
    expect(await acquisitionRows()).toEqual([{ id: committedId, status: "queued", attempts: 0 }]);
    expect(await audits()).toEqual([{ action: "recording_acquisition_requested", entity_id: committedId }]);
  });
  it("recovers the same intent after an actual successful batch response is lost", async () => {
    const f = await fixture();
    let committed = false;
    const db: DatabaseLike = {
      prepare: (sql) => env.DB.prepare(sql),
      batch: async (statements) => {
        const result = await env.DB.batch(statements as D1PreparedStatement[]);
        if (
          !committed &&
          result.some((row) => row.meta?.changes === 1) &&
          (await acquisitionRows().then((rows) => rows.length > 0))
        ) {
          committed = true;
          throw new Error("Lost committed acquisition response");
        }
        return result;
      },
    };
    expect((await f.call(f.request, db)).status).toBe(500);
    const recovered = await f.enqueue();
    expect(recovered.status).toBe("queued");
    expect(await acquisitionRows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });
  it.each(["revision", "source", "actor"])("refuses an operation reused with another %s", async (difference) => {
    const f = await fixture();
    await f.enqueue();
    let body = f.request,
      source = f.sourceId,
      token = f.token;
    if (difference === "revision") body = { ...body, expectedMetadataRevision: 2 };
    if (difference === "source") {
      source = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO event_recording_sources (id,event_id,meeting_link_id,native_series_id,native_occurrence_id,
        provider_type,provider_account_id,provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,provider_status,
        provider_invoked_at,provider_started_at,provider_stopped_at,provider_file_size,metadata_revision,observed_at,
        disabled_at,created_by_user_id,created_at,updated_at) SELECT ?,event_id,meeting_link_id,native_series_id,native_occurrence_id,
        provider_type,provider_account_id,provider_app_id,provider_meeting_id,provider_session_id,?,provider_status,
        provider_invoked_at,provider_started_at,provider_stopped_at,provider_file_size,metadata_revision,observed_at,
        disabled_at,created_by_user_id,created_at,updated_at FROM event_recording_sources WHERE id=?`,
      )
        .bind(source, crypto.randomUUID(), f.sourceId)
        .run();
    }
    if (difference === "actor") {
      const userId = crypto.randomUUID(),
        now = nowIso();
      await env.DB.prepare(
        "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      )
        .bind(userId, "second-recording@example.test", "second-recording@example.test", now, now)
        .run();
      await grantAdministrator(env.DB, userId);
      token = await createAdminSession(env.DB, userId, crypto.randomUUID());
    }
    expect((await f.call(body, env.DB, token, source)).status).toBe(409);
    expect(await acquisitionRows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });
  it.each(["revision", "disabled", "not_uploaded", "zero_bytes"])(
    "refuses an unavailable %s source without writes",
    async (state) => {
      const f = await fixture();
      const sql = {
        revision: "metadata_revision=2",
        disabled: "disabled_at='2026-10-07T00:00:00.000Z'",
        not_uploaded: "provider_status='UPLOADING'",
        zero_bytes: "provider_file_size=0",
      }[state];
      await env.DB.prepare(`UPDATE event_recording_sources SET ${sql} WHERE id=?`).bind(f.sourceId).run();
      expect((await f.call()).status).toBe(409);
      expect(await acquisitionRows()).toEqual([]);
      expect(await audits()).toEqual([]);
    },
  );
  it("does not mistake the single-put transfer threshold for recording admission", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE event_recording_sources SET provider_file_size=? WHERE id=?")
      .bind(6 * 1024 ** 3, f.sourceId)
      .run();
    expect((await f.enqueue()).status).toBe("queued");
  });
  it("refuses unauthenticated, foreign-event and invalid-schema requests without intents", async () => {
    const f = await fixture();
    expect((await f.call(f.request, env.DB, null)).status).toBe(401);
    expect((await f.call({ ...f.request, downloadUrl: "https://private.test/video" })).status).toBe(400);
    expect((await f.call({ ...f.request, operationId: "not-an-id" })).status).toBe(400);
    const now = nowIso(),
      otherEvent = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,settings_json,created_at,updated_at) VALUES(?,'other-event','Other event','UTC',?,?,'{}',?,?)",
    )
      .bind(otherEvent, now, now, now, now)
      .run();
    expect((await f.call(f.request, env.DB, f.token, f.sourceId, "other-event")).status).toBe(404);
    expect(await acquisitionRows()).toEqual([]);
    expect(await audits()).toEqual([]);
  });
  it.each(["session", "permission", "source"])(
    "aborts an enqueue whose %s changes before its final batch",
    async (change) => {
      const f = await fixture();
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("INSERT INTO event_recording_acquisitions"),
        async () => {
          if (change === "session")
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
          if (change === "permission") await revoke(f.admin.id);
          if (change === "source")
            await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=2 WHERE id=?")
              .bind(f.sourceId)
              .run();
        },
      );
      expect([403, 409]).toContain((await f.call(f.request, db)).status);
      expect(await acquisitionRows()).toEqual([]);
      expect(await audits()).toEqual([]);
    },
  );
  it("does not strip browser session evidence and denies replay after revocation", async () => {
    const f = await fixture();
    await expect(requestRecordingAcquisition(env.DB, f.eventId, f.sourceId, f.admin, f.request)).rejects.toMatchObject({
      code: "RECORDING_SESSION_REQUIRED",
    });
    await f.enqueue();
    await revoke(f.admin.id);
    const refused = await f.call();
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: { code: "AUTH_INVALID" } });
    expect(await acquisitionRows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_versions")).toEqual([]);
  });
  it("claims once, independently of expired browser sessions, and reclaims an expired worker lease", async () => {
    const f = await fixture(),
      intent = await f.enqueue();
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
    const [a, b] = await Promise.all([
      claimRecordingAcquisition(env.DB, intent.id),
      claimRecordingAcquisition(env.DB, intent.id),
    ]);
    const owner = a ?? b;
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(owner?.requester.sessionId).toBeUndefined();
    expect(owner?.acquisition.attempts).toBe(1);
    await expireLease(intent.id);
    const next = await f.claim(intent.id);
    expect(next.lease.token).not.toBe(owner?.lease.token);
    expect(next.acquisition.attempts).toBe(2);
    expect(await audits()).toHaveLength(1);
  });
  it.each(["permission", "inactive", "source"])("does not claim when current %s evidence refuses", async (change) => {
    const f = await fixture(),
      intent = await f.enqueue();
    if (change === "permission") await revoke(f.admin.id);
    if (change === "inactive") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.admin.id).run();
    if (change === "source")
      await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?")
        .bind(nowIso(), f.sourceId)
        .run();
    expect(await claimRecordingAcquisition(env.DB, intent.id)).toBeNull();
    expect(await acquisitionRows()).toEqual([{ id: intent.id, status: "queued", attempts: 0 }]);
  });
  it("preserves the owned object key across lease reclaim while fencing the previous worker", async () => {
    const f = await fixture(),
      intent = await f.enqueue(),
      previous = await f.claim(intent.id),
      owned = version(previous);
    const previousStatements = prepareRecordingAcquisitionCompletion(env.DB, previous, owned);
    await expireLease(intent.id);
    const current = await f.claim(intent.id);
    expect(current.lease.token).not.toBe(previous.lease.token);
    expect(recordingAcquisitionObjectKey(current, owned.id)).toBe(owned.r2Key);
    expect(recordingAcquisitionObjectKey(current, crypto.randomUUID())).not.toBe(owned.r2Key);
    await expect(env.DB.batch(previousStatements as D1PreparedStatement[])).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_versions")).toEqual([]);
    expect(await audits("recording_acquisition_completed")).toEqual([]);
    await env.DB.batch(prepareRecordingAcquisitionCompletion(env.DB, current, owned) as D1PreparedStatement[]);
    expect(await queryAll(env.DB, "SELECT id,r2_key FROM event_recording_versions")).toEqual([
      { id: owned.id, r2_key: owned.r2Key },
    ]);
    expect(await audits("recording_acquisition_completed")).toHaveLength(1);
  });
  it("selects only bounded due or expired jobs and preserves not-due/completed exclusions", async () => {
    const f = await fixture(),
      first = await f.enqueue(),
      second = await f.enqueue({ ...f.request, operationId: crypto.randomUUID() });
    await env.DB.prepare(
      "UPDATE event_recording_acquisitions SET next_attempt_at='2999-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(second.id)
      .run();
    expect(await dueRecordingAcquisitionIds(env.DB, 1)).toEqual([first.id]);
    expect(await claimRecordingAcquisition(env.DB, second.id)).toBeNull();
    await f.claim(first.id);
    expect(await dueRecordingAcquisitionIds(env.DB, 10)).toEqual([]);
    await expireLease(first.id);
    expect(await dueRecordingAcquisitionIds(env.DB, 10)).toEqual([first.id]);
    await expect(dueRecordingAcquisitionIds(env.DB, 101)).rejects.toThrow();
  });
  it("atomically stores one owned immutable version and a completion audit", async () => {
    const f = await fixture(),
      intent = await f.enqueue(),
      claim = await f.claim(intent.id),
      owned = version(claim);
    await env.DB.batch(prepareRecordingAcquisitionCompletion(env.DB, claim, owned) as D1PreparedStatement[]);
    const receipt = await f.enqueue();
    expect(receipt).toMatchObject({ status: "completed", versionId: owned.id, attempts: 1 });
    expect(await claimRecordingAcquisition(env.DB, intent.id)).toBeNull();
    expect(await finishRecordingAcquisitionFailure(env.DB, claim, "storage_unavailable", 503)).toBe(false);
    await expect(
      env.DB.batch(prepareRecordingAcquisitionCompletion(env.DB, claim, owned) as D1PreparedStatement[]),
    ).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_versions")).toEqual([{ id: owned.id }]);
    expect(await audits("recording_acquisition_completed")).toEqual([
      { action: "recording_acquisition_completed", entity_id: intent.id },
    ]);
  });
  it.each(["expired", "reclaimed", "permission", "inactive", "source"])(
    "rolls back dependent version/audit on %s completion",
    async (change) => {
      const f = await fixture(),
        intent = await f.enqueue(),
        claim = await f.claim(intent.id),
        owned = version(claim);
      const statements = prepareRecordingAcquisitionCompletion(env.DB, claim, owned);
      if (change === "expired" || change === "reclaimed") await expireLease(intent.id);
      if (change === "reclaimed") await f.claim(intent.id);
      if (change === "permission") await revoke(f.admin.id);
      if (change === "inactive") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.admin.id).run();
      if (change === "source")
        await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=2 WHERE id=?")
          .bind(f.sourceId)
          .run();
      await expect(env.DB.batch(statements as D1PreparedStatement[])).rejects.toThrow();
      expect(await queryAll(env.DB, "SELECT id FROM event_recording_versions")).toEqual([]);
      expect(await audits("recording_acquisition_completed")).toEqual([]);
      expect((await acquisitionRows())[0]).not.toMatchObject({ status: "completed" });
    },
  );
  it.each(["zero_cas", "audit_refused"])("rolls back completion dependencies on %s", async (failure) => {
    const f = await fixture(),
      intent = await f.enqueue(),
      claim = await f.claim(intent.id);
    const trigger =
      failure === "zero_cas"
        ? "BEFORE UPDATE ON event_recording_acquisitions WHEN NEW.status='completed' BEGIN SELECT RAISE(IGNORE); END"
        : "BEFORE INSERT ON audit_log WHEN NEW.action='recording_acquisition_completed' BEGIN SELECT RAISE(ABORT,'TEST_RECORDING_AUDIT_REFUSED'); END";
    await env.DB.prepare(`CREATE TRIGGER test_recording_completion_failure ${trigger}`).run();
    try {
      await expect(
        env.DB.batch(prepareRecordingAcquisitionCompletion(env.DB, claim, version(claim)) as D1PreparedStatement[]),
      ).rejects.toThrow();
      expect(await queryAll(env.DB, "SELECT id FROM event_recording_versions")).toEqual([]);
      expect(await audits("recording_acquisition_completed")).toEqual([]);
      expect(await acquisitionRows()).toEqual([{ id: intent.id, status: "processing", attempts: 1 }]);
    } finally {
      await env.DB.prepare("DROP TRIGGER test_recording_completion_failure").run();
    }
  });
  it("reuses only a verified exact same-source nondeleted version without changing its original provenance", async () => {
    const f = await fixture(),
      initial = await f.enqueue(),
      first = await f.claim(initial.id),
      owned = version(first);
    await env.DB.batch(prepareRecordingAcquisitionCompletion(env.DB, first, owned) as D1PreparedStatement[]);
    const second = await f.enqueue({ ...f.request, operationId: crypto.randomUUID() }),
      claim = await f.claim(second.id);
    const original = await queryAll(
      env.DB,
      "SELECT id,acquisition_id,digest,r2_key,object_etag FROM event_recording_versions",
    );
    await env.DB.batch(prepareRecordingAcquisitionCompletion(env.DB, claim, owned, true) as D1PreparedStatement[]);
    expect(
      await queryAll(env.DB, "SELECT id,acquisition_id,digest,r2_key,object_etag FROM event_recording_versions"),
    ).toEqual(original);
    expect(await audits("recording_acquisition_completed")).toHaveLength(2);
    expect((await f.enqueue({ ...f.request, operationId: second.operationId })).versionId).toBe(owned.id);
    const third = await f.enqueue({ ...f.request, operationId: crypto.randomUUID() }),
      thirdClaim = await f.claim(third.id);
    const statements = prepareRecordingAcquisitionCompletion(env.DB, thirdClaim, owned, true);
    await env.DB.prepare("UPDATE event_recording_versions SET deleted_at=? WHERE id=?").bind(nowIso(), owned.id).run();
    await expect(env.DB.batch(statements as D1PreparedStatement[])).rejects.toThrow();
    expect(await audits("recording_acquisition_completed")).toHaveLength(2);
  });
  it("refuses foreign version scope, changed verified object metadata and foreign upload keys", async () => {
    const f = await fixture(),
      intent = await f.enqueue(),
      claim = await f.claim(intent.id);
    const owned = version(claim);
    for (const override of [
      { eventId: crypto.randomUUID() },
      { sourceId: crypto.randomUUID() },
      { r2Key: "foreign/object" },
      { sourceMetadataRevision: 2 },
      { fileBytes: 15 },
      { acquisitionId: crypto.randomUUID() },
    ])
      expect(() => prepareRecordingAcquisitionCompletion(env.DB, claim, { ...owned, ...override })).toThrow();
    await env.DB.batch(prepareRecordingAcquisitionCompletion(env.DB, claim, owned) as D1PreparedStatement[]);
    const next = await f.enqueue({ ...f.request, operationId: crypto.randomUUID() }),
      nextClaim = await f.claim(next.id);
    expect(() => prepareRecordingAcquisitionCompletion(env.DB, nextClaim, { ...owned, fileBytes: 15 }, true)).toThrow();
    await expect(
      env.DB.batch(
        prepareRecordingAcquisitionCompletion(
          env.DB,
          nextClaim,
          { ...owned, objectETag: "changed" },
          true,
        ) as D1PreparedStatement[],
      ),
    ).rejects.toThrow();
    expect(await audits("recording_acquisition_completed")).toHaveLength(1);
  });
  it("records a fixed retry and ignores a late old-owner failure after reclaim", async () => {
    const f = await fixture(),
      intent = await f.enqueue(),
      claim = await f.claim(intent.id);
    expect(await finishRecordingAcquisitionFailure(env.DB, claim, "download_unavailable", 503)).toBe(true);
    const receipt = await f.enqueue();
    expect(receipt).toMatchObject({
      status: "retrying",
      attempts: 1,
      failure: "download_unavailable",
      providerStatus: 503,
    });
    expect(Date.parse(receipt.nextAttemptAt)).toBeGreaterThan(Date.parse(receipt.updatedAt));
    expect(await claimRecordingAcquisition(env.DB, intent.id)).toBeNull();
    await env.DB.prepare("UPDATE event_recording_acquisitions SET next_attempt_at=? WHERE id=?")
      .bind(nowIso(), intent.id)
      .run();
    const next = await f.claim(intent.id);
    expect(await finishRecordingAcquisitionFailure(env.DB, claim, "integrity_failed", 400)).toBe(false);
    expect(await finishRecordingAcquisitionFailure(env.DB, next, "source_changed")).toBe(true);
    expect((await f.enqueue()).status).toBe("failed");
    expect(await audits()).toHaveLength(1);
  });
  it("ends retry at the shared bounded attempt count", async () => {
    const f = await fixture(),
      intent = await f.enqueue();
    await env.DB.prepare("UPDATE event_recording_acquisitions SET attempts=9 WHERE id=?").bind(intent.id).run();
    const claim = await f.claim(intent.id);
    expect(await finishRecordingAcquisitionFailure(env.DB, claim, "storage_unavailable", 503)).toBe(true);
    expect(await f.enqueue()).toMatchObject({ status: "failed", attempts: 10, failure: "storage_unavailable" });
  });
});

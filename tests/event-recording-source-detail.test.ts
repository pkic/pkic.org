import { env } from "cloudflare:workers";
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import {
  eventRecordingAcquisitionsResponseSchema,
  eventRecordingAcquisitionsRouteSchema,
  eventRecordingSourceDetailRouteSchema,
} from "../assets/shared/schemas/event-recording-acquisition-catalog";
import { eventRecordingSourceSchema } from "../assets/shared/schemas/event-recordings";
import { requireEventPermission } from "../functions/api/v1/events/[eventSlug]/authorization";
import type { AdminContext } from "../functions/_lib/db/context";
import { handleError, jsonNoStore } from "../functions/_lib/http";
import { openApiRoute } from "../functions/_lib/openapi/route";
import {
  getRecordingSource,
  listSourceRecordingAcquisitions,
} from "../functions/_lib/services/event-recordings/source-detail";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";
import { resetDb } from "./helpers/reset-db";

function mounted() {
  const app = new Hono<{ Bindings: Env }>();
  app.onError(handleError);
  const routes = fromHono(app);
  routes.get(
    "/events/:eventSlug/recordings/sources/:sourceId",
    openApiRoute(eventRecordingSourceDetailRouteSchema, async (c: AdminContext, data) => {
      const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
      return jsonNoStore(await getRecordingSource(db, event.id, data.params.sourceId, actor));
    }),
  );
  routes.get(
    "/events/:eventSlug/recordings/sources/:sourceId/acquisitions",
    openApiRoute(eventRecordingAcquisitionsRouteSchema, async (c: AdminContext, data) => {
      const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
      return jsonNoStore(await listSourceRecordingAcquisitions(db, event.id, data.params.sourceId, actor, data.query));
    }),
  );
  return app;
}

async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const now = nowIso(),
    sourceId = crypto.randomUUID();
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId: admin.id, now });
  await env.DB.prepare(
    `INSERT INTO event_recording_sources(id,event_id,meeting_link_id,provider_type,
    provider_account_id,provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,
    provider_status,provider_invoked_at,provider_started_at,provider_file_size,metadata_revision,
    observed_at,created_by_user_id,created_at,updated_at)
    VALUES(?,?,?,'realtimekit',?,?,?,?,?,'UPLOADED',?,?,16,1,?,?,?,?)`,
  )
    .bind(
      sourceId,
      eventId,
      meeting.meetingLinkId,
      meeting.providerAccountId,
      meeting.providerAppId,
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
  const app = mounted();
  const call = (suffix = "", db: DatabaseLike = env.DB, bearer: string | null = token, source = sourceId) =>
    app.request(
      `/events/pqc-2026/recordings/sources/${source}${suffix}`,
      { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} },
      { ...env, DB: db },
    );
  const acquisition = async (status: "queued" | "processing" | "retrying", createdAt = now) => {
    const id = crypto.randomUUID(),
      operationId = crypto.randomUUID();
    const lease = status === "processing" ? new Date(Date.parse(now) + 60_000).toISOString() : null;
    await env.DB.prepare(
      `INSERT INTO event_recording_acquisitions(id,event_id,source_id,operation_id,payload_hash,
      expected_metadata_revision,requested_by_user_id,status,next_attempt_at,created_at,updated_at,
      processing_token,claimed_at,lease_expires_at,last_failure_kind,last_provider_status)
      VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
        eventId,
        sourceId,
        operationId,
        "a".repeat(64),
        admin.id,
        status,
        now,
        createdAt,
        now,
        status === "processing" ? "private-processing-token" : null,
        status === "processing" ? now : null,
        lease,
        status === "retrying" ? "download_unavailable" : null,
        status === "retrying" ? 503 : null,
      )
      .run();
    return { id, operationId };
  };
  return { eventId, admin, now, sourceId, meeting, call, acquisition };
}

beforeEach(resetDb);
describe("event-owned recording source detail and acquisition catalog", () => {
  it("returns current canonical source metadata, including disabled sources, without private provider configuration", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?").bind(f.now, f.sourceId).run();
    const response = await f.call();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text(),
      source = eventRecordingSourceSchema.parse(JSON.parse(text));
    expect(source).toMatchObject({
      id: f.sourceId,
      eventId: f.eventId,
      meetingLinkId: f.meeting.meetingLinkId,
      disabledAt: f.now,
    });
    expect(text).not.toContain(f.meeting.providerAccountId);
    expect(text).not.toContain(f.meeting.providerAppId);
    expect(text).not.toContain("createdByUserId");
  });

  it("filters and sorts real acquisition pages with exact totals and a final and empty page", async () => {
    const f = await fixture();
    const early = await f.acquisition("queued", "2026-10-01T00:00:00.000Z");
    await f.acquisition("processing");
    const late = await f.acquisition("queued", "2026-10-02T00:00:00.000Z");
    const read = async (offset: number) => {
      const response = await f.call(`/acquisitions?status=queued&sort=createdAt&limit=1&offset=${offset}`);
      expect(response.status, await response.clone().text()).toBe(200);
      return eventRecordingAcquisitionsResponseSchema.parse(await response.json());
    };
    const first = await read(0),
      final = await read(1),
      empty = await read(2);
    expect(first.acquisitions.map(({ id }) => id)).toEqual([early.id]);
    expect(first.page).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true });
    expect(final.acquisitions.map(({ id }) => id)).toEqual([late.id]);
    expect(final.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect(empty.acquisitions).toEqual([]);
    expect(empty.page).toEqual({ limit: 1, offset: 2, total: 2, hasMore: false });
  });

  it("reads safe processing and failure metadata without lease tokens, payload hashes or storage locations", async () => {
    const f = await fixture();
    await f.acquisition("processing");
    const retry = await f.acquisition("retrying");
    const response = await f.call("/acquisitions?sort=status");
    expect(response.status, await response.clone().text()).toBe(200);
    const text = await response.text(),
      body = eventRecordingAcquisitionsResponseSchema.parse(JSON.parse(text));
    expect(body.acquisitions).toHaveLength(2);
    expect(body.acquisitions.find(({ id }) => id === retry.id)).toMatchObject({
      status: "retrying",
      failure: "download_unavailable",
      providerStatus: 503,
    });
    for (const privateValue of [
      "private-processing-token",
      "a".repeat(64),
      "processingToken",
      "leaseExpiresAt",
      "payloadHash",
      "r2Key",
      "sourceUrl",
    ])
      expect(text).not.toContain(privateValue);
    const matched = await f.call(`/acquisitions?q=${retry.operationId}`);
    expect(
      eventRecordingAcquisitionsResponseSchema.parse(await matched.json()).acquisitions.map(({ id }) => id),
    ).toEqual([retry.id]);
    const literal = await f.call("/acquisitions?q=%25");
    expect(eventRecordingAcquisitionsResponseSchema.parse(await literal.json()).page.total).toBe(0);
  });

  it("rejects unbounded, unsupported and private-field queries through the mounted contract", async () => {
    const f = await fixture();
    for (const query of [
      "limit=201",
      "offset=10001",
      "status=invalid",
      "sort=processingToken",
      "sourceUrl=https://private.invalid",
    ])
      expect((await f.call(`/acquisitions?${query}`)).status).toBe(400);
  });

  it("returns 404 for missing and foreign sources instead of an empty acquisition catalog", async () => {
    const f = await fixture();
    const otherId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,settings_json,created_at,updated_at)
      VALUES(?,'foreign-recordings','Foreign recordings','UTC',?,?,'{}',?,?)`,
    )
      .bind(otherId, f.now, f.now, f.now, f.now)
      .run();
    const meeting = await seedRecordingMeeting(env.DB, { eventId: otherId, userId: f.admin.id, now: f.now });
    const foreign = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event_recording_sources(id,event_id,meeting_link_id,provider_type,provider_account_id,
      provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,provider_status,provider_invoked_at,
      provider_started_at,provider_file_size,metadata_revision,observed_at,created_by_user_id,created_at,updated_at)
      SELECT ?,?,?,provider_type,provider_account_id,provider_app_id,?,provider_session_id,?,provider_status,
      provider_invoked_at,provider_started_at,provider_file_size,metadata_revision,observed_at,created_by_user_id,created_at,updated_at
      FROM event_recording_sources WHERE id=?`,
    )
      .bind(foreign, otherId, meeting.meetingLinkId, meeting.providerMeetingId, crypto.randomUUID(), f.sourceId)
      .run();
    for (const source of [crypto.randomUUID(), foreign])
      for (const suffix of ["", "/acquisitions"])
        expect((await f.call(suffix, env.DB, undefined, source)).status).toBe(404);
  });

  it("requires authenticated event management for both reads", async () => {
    const f = await fixture();
    for (const suffix of ["", "/acquisitions"]) expect((await f.call(suffix, env.DB, null)).status).toBe(401);
    const ordinaryId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,'recording-reader@example.test','recording-reader@example.test',1,?,?)",
    )
      .bind(ordinaryId, f.now, f.now)
      .run();
    await env.DB.prepare(
      `INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,
        manage_link_secret,created_at,updated_at)
       VALUES(?,?,?,'registered','in_person','direct',?,?,?)`,
    )
      .bind(crypto.randomUUID(), f.eventId, ordinaryId, crypto.randomUUID(), f.now, f.now)
      .run();
    const token = await createAdminSession(env.DB, ordinaryId, crypto.randomUUID());
    for (const suffix of ["", "/acquisitions"]) {
      const response = await f.call(suffix, env.DB, token);
      expect(response.status).toBe(403);
      expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("PERMISSION_REQUIRED");
    }
  });

  it.each(["source", "acquisitions"] as const)(
    "rechecks a revoked management grant immediately before the %s read",
    async (target) => {
      const f = await fixture();
      await f.acquisition("queued");
      let revoked = false;
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) =>
          sql.includes(target === "source" ? "FROM event_recording_sources" : "FROM event_recording_acquisitions"),
        async () => {
          revoked = true;
          await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
            .bind(f.now, f.admin.id)
            .run();
        },
      );
      const response = await f.call(target === "source" ? "" : "/acquisitions", db);
      expect(revoked).toBe(true);
      expect(response.status, await response.clone().text()).toBe(403);
      expect(await response.text()).not.toContain("acquisitions");
    },
  );
});

import { env } from "cloudflare:workers";
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventRecordingAcquisitionSchema,
  eventRecordingSourceSchema,
  eventRecordingSourceRefreshSchema,
} from "../assets/shared/schemas/event-recordings";
import eventRouter from "../functions/api/v1/events/[eventSlug]/router";
import {
  EventRecordingAcquirePost,
  recordingSourceBindRoute,
  recordingSourceRefreshRoute,
} from "../functions/api/v1/events/[eventSlug]/recordings";
import { handleError } from "../functions/_lib/http";
import { processRecordingAcquisition } from "../functions/_lib/services/event-recordings/processor";
import type { RealtimeKitRecordingConfiguration } from "../functions/_lib/services/event-series/realtimekit-recording-contracts";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";
import { resetDb } from "./helpers/reset-db";

const configuration = {
  accountId: "0123456789abcdef0123456789abcdef",
  appId: "synthetic-app",
  apiToken: "synthetic-refresh-secret",
};
const instant = "2026-12-01T09:00:00.000Z";

async function fixture(refreshConfiguration: RealtimeKitRecordingConfiguration | null = configuration) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId: admin.id });
  const recordingId = crypto.randomUUID(),
    sessionId = crypto.randomUUID();
  const wire = {
    id: recordingId,
    session_id: sessionId,
    meeting: { id: meeting.providerMeetingId },
    status: "UPLOADING",
    invoked_time: instant,
    started_time: instant,
    file_size: 0,
    download_url: "https://private.example.test/recording?private=secret",
    diagnostic: "PRIVATE_PROVIDER_DETAIL",
  };
  let observation: Record<string, unknown> = wire;
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    Response.json(
      String(url).endsWith(`/recordings/${recordingId}`)
        ? { success: true, data: observation }
        : { success: true, data: [wire], paging: { start_offset: 1, end_offset: 1, total_count: 1 } },
    ),
  );
  const app = new Hono<{ Bindings: Env }>();
  app.onError(handleError);
  const routes = fromHono(app),
    path = "/events/:eventSlug/recordings/sources";
  routes.post(path, recordingSourceBindRoute({ configuration: () => configuration, fetcher }));
  routes.post(
    `${path}/:sourceId/refresh`,
    recordingSourceRefreshRoute({ configuration: () => refreshConfiguration, fetcher }),
  );
  routes.post(`${path}/:sourceId/acquisitions`, EventRecordingAcquirePost);
  const request = (suffix: string, body: unknown, db: DatabaseLike = env.DB, bearer: string | null = token) =>
    app.request(
      `/events/pqc-2026/recordings/sources${suffix}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(body),
      },
      { ...env, DB: db },
    );
  const bound = await request("", { meetingLinkId: meeting.meetingLinkId, recordingId });
  expect(bound.status, await bound.clone().text()).toBe(200);
  const source = eventRecordingSourceSchema.parse(await bound.json());
  fetcher.mockClear();
  const observe = (changes: Record<string, unknown> = {}) => {
    observation = { ...wire, ...changes };
  };
  const refresh = (revision = source.metadataRevision, db: DatabaseLike = env.DB, bearer: string | null = token) =>
    request(
      `/${source.id}/refresh`,
      eventRecordingSourceRefreshSchema.parse({ expectedMetadataRevision: revision }),
      db,
      bearer,
    );
  const acquire = (revision: number) =>
    request(`/${source.id}/acquisitions`, { operationId: crypto.randomUUID(), expectedMetadataRevision: revision });
  return {
    app,
    eventId,
    admin,
    token,
    meeting,
    recordingId,
    sessionId,
    source,
    wire,
    observe,
    fetcher,
    refresh,
    acquire,
    request,
  };
}

beforeEach(resetDb);
describe("mounted immutable recording source lifecycle refresh", () => {
  it("keeps ongoing binding available, then advances completed metadata and permits explicit acquisition", async () => {
    const f = await fixture();
    expect(f.source).toMatchObject({ status: "UPLOADING", fileBytes: 0, metadataRevision: 1 });
    expect((await f.acquire(1)).status).toBe(409);
    f.observe({ status: "UPLOADED", file_size: 16, stopped_time: "2026-12-01T10:00:00Z" });
    const response = await f.refresh();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text(),
      source = eventRecordingSourceSchema.parse(JSON.parse(text));
    expect(source).toMatchObject({
      ...f.source,
      status: "UPLOADED",
      fileBytes: 16,
      metadataRevision: 2,
      stoppedAt: "2026-12-01T10:00:00.000Z",
      observedAt: expect.any(String),
    });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(String(f.fetcher.mock.calls[0][0])).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${configuration.accountId}/realtime/kit/${configuration.appId}/recordings/${f.recordingId}`,
    );
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_acquisitions")).toEqual([]);
    const acquired = await f.acquire(2);
    expect(acquired.status, await acquired.clone().text()).toBe(200);
    expect(eventRecordingAcquisitionSchema.parse(await acquired.json())).toMatchObject({
      sourceId: f.source.id,
      expectedMetadataRevision: 2,
      status: "queued",
    });
    const audit = await queryAll(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action='recording_source_refreshed'",
    );
    expect(audit).toHaveLength(1);
    for (const secret of [
      configuration.apiToken,
      "private.example.test",
      "download_url",
      "PRIVATE_PROVIDER_DETAIL",
      "r2_key",
      "processing_token",
    ])
      expect(JSON.stringify([text, audit])).not.toContain(secret);
  });

  it("retains revision and observation on a no-op, with no second creation or refresh audit", async () => {
    const f = await fixture();
    for (let pass = 0; pass < 2; pass++) {
      const response = await f.refresh();
      expect(response.status, await response.clone().text()).toBe(200);
      expect(eventRecordingSourceSchema.parse(await response.json())).toEqual(f.source);
    }
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='recording_source_refreshed'")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='recording_source_bound'")).toHaveLength(1);
  });

  it("refuses stale or disabled sources before provider I/O", async () => {
    const f = await fixture();
    expect((await f.refresh(2)).status).toBe(409);
    await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?")
      .bind(nowIso(), f.source.id)
      .run();
    expect((await f.refresh()).status).toBe(409);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each([null, { ...configuration, appId: "foreign-app" }, { ...configuration, accountId: "f".repeat(32) }])(
    "refuses missing or changed configured provider scope before I/O: %s",
    async (config) => {
      const f = await fixture(config);
      expect((await f.refresh()).status).toBe(config === null ? 503 : 409);
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );

  it("refuses an event-scoped source mismatch before provider I/O", async () => {
    const f = await fixture();
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,settings_json,created_at,updated_at) VALUES(?,'other-event','Other event','UTC',?,?,'{}',?,?)",
    )
      .bind(crypto.randomUUID(), instant, "2026-12-01T18:00:00Z", now, now)
      .run();
    const response = await f.app.request(
      `/events/other-event/recordings/sources/${f.source.id}/refresh`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${f.token}` },
        body: JSON.stringify({ expectedMetadataRevision: 1 }),
      },
      env,
    );
    expect(response.status).toBe(404);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(["recording", "session", "meeting"] as const)(
    "refuses changed provider %s identity without updating metadata",
    async (identity) => {
      const f = await fixture();
      f.observe(
        identity === "recording"
          ? { id: crypto.randomUUID() }
          : identity === "session"
            ? { session_id: crypto.randomUUID() }
            : { meeting: { id: crypto.randomUUID() } },
      );
      expect((await f.refresh()).status).toBe(409);
      expect(
        await queryAll(env.DB, "SELECT metadata_revision,provider_status FROM event_recording_sources WHERE id=?", [
          f.source.id,
        ]),
      ).toEqual([{ metadata_revision: 1, provider_status: "UPLOADING" }]);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='recording_source_refreshed'")).toEqual([]);
    },
  );

  it("accepts missing wire meeting metadata only for the already bound exact recording/session", async () => {
    const f = await fixture();
    f.observe({ meeting: undefined, status: "UPLOADED", file_size: 16 });
    const response = await f.refresh();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(eventRecordingSourceSchema.parse(await response.json())).toMatchObject({
      meetingLinkId: f.meeting.meetingLinkId,
      metadataRevision: 2,
    });
  });

  it.each(["session", "user", "grant", "revision", "disabled"] as const)(
    "rolls back observation and audit when final %s evidence changes",
    async (change) => {
      const f = await fixture();
      f.observe({ status: "UPLOADED", file_size: 16 });
      const raced = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("UPDATE event_recording_sources AS source"),
        async () => {
          if (change === "session")
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
          if (change === "user") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.admin.id).run();
          if (change === "grant")
            await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
          if (change === "revision")
            await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=2 WHERE id=?")
              .bind(f.source.id)
              .run();
          if (change === "disabled")
            await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?")
              .bind(nowIso(), f.source.id)
              .run();
        },
      );
      expect((await f.refresh(1, raced)).status).toBe(["revision", "disabled"].includes(change) ? 409 : 403);
      expect(
        await queryAll(env.DB, "SELECT provider_status FROM event_recording_sources WHERE id=?", [f.source.id]),
      ).toEqual([{ provider_status: "UPLOADING" }]);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='recording_source_refreshed'")).toEqual([]);
    },
  );

  it("retires an older queued revision through the existing processor without provider I/O", async () => {
    const f = await fixture();
    f.observe({ status: "UPLOADED", file_size: 16 });
    expect((await f.refresh()).status).toBe(200);
    const acquired = await f.acquire(2);
    expect(acquired.status, await acquired.clone().text()).toBe(200);
    const intent = eventRecordingAcquisitionSchema.parse(await acquired.json());
    f.observe({ status: "UPLOADED", file_size: 32 });
    expect((await f.refresh(2)).status).toBe(200);
    const provider = vi.fn<typeof fetch>();
    const bucket = env.SPEAKER_UPLOADS_BUCKET;
    if (!bucket) throw new Error("Expected native owned recording storage");
    expect(
      await processRecordingAcquisition(env.DB, intent.id, {
        configuration,
        configuredOrigins: ["https://private.example.test"],
        bucket,
        fetcher: provider,
      }),
    ).toEqual({ status: "failed", partsTransferred: 0, verifiedBytes: 0 });
    expect(provider).not.toHaveBeenCalled();
    expect(
      await queryAll(env.DB, "SELECT status,last_failure_kind FROM event_recording_acquisitions WHERE id=?", [
        intent.id,
      ]),
    ).toEqual([{ status: "failed", last_failure_kind: "source_changed" }]);
  });

  it("mounts the real production refresh route and validates its canonical request before provider work", async () => {
    const f = await fixture();
    const app = new Hono<{ Bindings: Env }>();
    app.onError(handleError);
    fromHono(app).route("/events/:eventSlug", eventRouter);
    const call = (body: unknown, bearer: string | null = f.token, sourceId = f.source.id) =>
      app.request(
        `/events/pqc-2026/recordings/sources/${sourceId}/refresh`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
          body: JSON.stringify(body),
        },
        { ...env, REALTIMEKIT_ACCOUNT_ID: undefined, REALTIMEKIT_APP_ID: undefined, REALTIMEKIT_API_TOKEN: undefined },
      );
    expect((await call({ expectedMetadataRevision: 1 })).status).toBe(503);
    expect((await call({ expectedMetadataRevision: 0 })).status).toBe(400);
    expect((await call({ expectedMetadataRevision: 1, meetingId: f.meeting.providerMeetingId })).status).toBe(400);
    expect((await call({ expectedMetadataRevision: 1 }, null)).status).toBe(401);
    expect((await call({ expectedMetadataRevision: 1 }, f.token, crypto.randomUUID())).status).toBe(404);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

import { env } from "cloudflare:workers";
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventRecordingSourceBindSchema,
  eventRecordingAcquisitionSchema,
  eventRecordingSourceSchema,
  eventRecordingSourcesResponseSchema,
  eventRecordingVersionsResponseSchema,
} from "../assets/shared/schemas/event-recordings";
import {
  recordingSourceBindRoute,
  EventRecordingSourcesGet,
  EventRecordingVersionsGet,
  EventRecordingAcquirePost,
  EventRecordingAcquisitionGet,
} from "../functions/api/v1/events/[eventSlug]/recordings";
import { handleError } from "../functions/_lib/http";
import type { RealtimeKitRecordingConfiguration } from "../functions/_lib/services/event-series/realtimekit-recording-contracts";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";

const configuration = {
  accountId: "0123456789abcdef0123456789abcdef",
  appId: "synthetic-app",
  apiToken: "synthetic-recording-token",
};
const meetingId = "10000000-0000-4000-8000-000000000001";
const meetingLinkId = "40000000-0000-4000-8000-000000000001";
const recordingId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const instant = "2026-12-01T09:00:00.000Z";
const request = eventRecordingSourceBindSchema.parse({ meetingLinkId, recordingId });
function wire(id = recordingId) {
  return {
    id,
    session_id: sessionId,
    status: "UPLOADED",
    invoked_time: instant,
    started_time: instant,
    stopped_time: "2026-12-01T10:00:00.000Z",
    file_size: 16,
    meeting: { id: meetingId },
    download_url: "https://untrusted.test/private-provider-artifact",
    diagnostic: "private-provider-diagnostic",
  };
}

/** Production route classes vary only provider transport; authentication, contracts and D1 remain real. */
function mounted(fetcher: typeof fetch, config: RealtimeKitRecordingConfiguration | null) {
  const app = new Hono<{ Bindings: Env }>();
  app.onError(handleError);
  const routes = fromHono(app),
    path = "/events/:eventSlug/recordings";
  routes.post(`${path}/sources`, recordingSourceBindRoute({ configuration: () => config, fetcher }));
  routes.get(`${path}/sources`, EventRecordingSourcesGet);
  routes.get(`${path}/versions`, EventRecordingVersionsGet);
  routes.post(`${path}/sources/:sourceId/acquisitions`, EventRecordingAcquirePost);
  routes.get(`${path}/sources/:sourceId/acquisitions/:acquisitionId`, EventRecordingAcquisitionGet);
  return app;
}

async function fixture(config: RealtimeKitRecordingConfiguration | null = configuration) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const otherEventId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,settings_json,created_at,updated_at) VALUES(?,?,'Other private event','UTC',?,?, '{}',?,?)",
  )
    .bind(otherEventId, "other-event", instant, "2026-12-01T18:00:00.000Z", nowIso(), nowIso())
    .run();
  const link = async (
    event = eventId,
    native: { series: string; occurrence: string } | null = null,
    id = crypto.randomUUID(),
    providerMeetingId = meetingId,
  ) => {
    await seedRecordingMeeting(env.DB, {
      eventId: event,
      userId: admin.id,
      meetingLinkId: id,
      providerMeetingId,
      providerAccountId: configuration.accountId,
      providerAppId: configuration.appId,
      nativeSeriesId: native?.series,
      nativeOccurrenceId: native?.occurrence,
    });
    return id;
  };
  await link(eventId, null, meetingLinkId);
  const otherMeetingLinkId = await link(otherEventId);
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ success: true, data: [wire()], paging: { start_offset: 1, end_offset: 1, total_count: 1 } }),
  );
  const app = mounted(fetcher, config);
  const call = (
    body: unknown = request,
    db: DatabaseLike = env.DB,
    bearer: string | null = token,
    slug = "pqc-2026",
    method = "POST",
    query = "",
  ) =>
    app.request(
      `/events/${slug}/recordings${query.startsWith("/") ? query : `/sources${query}`}`,
      {
        method,
        headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      },
      { ...env, DB: db },
    );
  const native = async (event = eventId) => {
    const series = crypto.randomUUID(),
      occurrence = crypto.randomUUID(),
      timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO event_series(id,event_id,starts_at,recurrence_rule,timezone,duration_minutes,created_at,updated_at) VALUES(?, ?, ?, 'FREQ=WEEKLY;COUNT=1','UTC',60,?,?)",
      ).bind(series, event, instant, timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO event_occurrences(id,series_id,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ).bind(occurrence, series, instant, "2026-12-01T10:00:00.000Z", timestamp, timestamp),
    ]);
    return { series, occurrence, meetingLinkId: await link(event, { series, occurrence }) };
  };
  const bound = async (body = request) => {
    const response = await call(body);
    expect(response.status, await response.clone().text()).toBe(200);
    return eventRecordingSourceSchema.parse(await response.json());
  };
  return { eventId, otherEventId, otherMeetingLinkId, admin, fetcher, call, native, bound, link };
}

async function effects() {
  return Promise.all(
    [
      "event_recording_meetings",
      "event_recording_sources",
      "event_recording_acquisitions",
      "event_recording_versions",
      "audit_log",
      "email_outbox",
      "events",
      "event_agenda_state",
      "registrations",
    ].map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`)),
  );
}
beforeEach(resetDb);
describe("canonical owned recording source binding", () => {
  it("binds exactly the filtered discovery page, freezes native ownership, and exposes only metadata", async () => {
    const f = await fixture(),
      native = await f.native();
    const result = await f.bound({ ...request, meetingLinkId: native.meetingLinkId, discoveryPage: 2 });
    expect(result).toMatchObject({
      eventId: f.eventId,
      nativeOccurrenceId: native.occurrence,
      sessionId,
      recordingId,
      fileBytes: 16,
      metadataRevision: 1,
    });
    const url = new URL(String(f.fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("meeting_id")).toBe(meetingId);
    expect(url.searchParams.get("page_no")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(await queryAll(env.DB, "SELECT native_series_id,provider_session_id FROM event_recording_sources")).toEqual([
      { native_series_id: native.series, provider_session_id: sessionId },
    ]);
    const response = await f.call(undefined, env.DB, undefined, "pqc-2026", "GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const catalog = eventRecordingSourcesResponseSchema.parse(await response.json());
    expect(catalog.sources).toEqual([result]);
    const serialized = JSON.stringify([
      catalog,
      await queryAll(env.DB, "SELECT details_json FROM audit_log WHERE action='recording_source_bound'"),
    ]);
    for (const secret of [
      configuration.apiToken,
      "download_url",
      "untrusted.test",
      "private-provider-diagnostic",
      "provider_account_id",
      "r2_key",
    ])
      expect(serialized).not.toContain(secret);
    expect(
      await queryAll(
        env.DB,
        "SELECT scope_type,scope_id,actor_id FROM audit_log WHERE action='recording_source_bound'",
      ),
    ).toEqual([{ scope_type: "event", scope_id: f.eventId, actor_id: f.admin.id }]);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_acquisitions")).toEqual([]);
  });

  it("returns the same immutable binding on an authorized retry without a provider read or extra effects", async () => {
    const f = await fixture(),
      first = await f.bound(),
      before = await effects();
    f.fetcher.mockImplementation(async () => {
      throw new Error("No provider operation on an identical retry");
    });
    expect(await f.bound()).toEqual(first);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(await effects()).toEqual(before);
  });

  it("deduplicates two source commands that both finish policy reads before competing inserts", async () => {
    const f = await fixture();
    let arrived = 0,
      release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.fetcher.mockImplementation(async () => {
      if (++arrived === 2) release();
      await ready;
      return Response.json({
        success: true,
        data: [wire()],
        paging: { start_offset: 1, end_offset: 1, total_count: 1 },
      });
    });
    const responses = await Promise.all([f.call(), f.call()]);
    for (const response of responses) expect(response.status, await response.clone().text()).toBe(200);
    const rows = await Promise.all(
      responses.map(async (response) => eventRecordingSourceSchema.parse(await response.json())),
    );
    expect(rows[0]).toEqual(rows[1]);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_sources")).toEqual([{ id: rows[0]!.id }]);
    expect(await queryAll(env.DB, "SELECT entity_id FROM audit_log WHERE action='recording_source_bound'")).toEqual([
      { entity_id: rows[0]!.id },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_acquisitions")).toEqual([]);
  });

  it("refuses foreign event, changed meeting and changed native scope generically without enumeration or effects", async () => {
    const f = await fixture(),
      first = await f.bound(),
      native = await f.native(),
      before = await effects();
    for (const [body, slug] of [
      [request, "other-event"],
      [{ ...request, meetingLinkId: crypto.randomUUID() }, "pqc-2026"],
      [{ ...request, meetingLinkId: native.meetingLinkId }, "pqc-2026"],
    ] as const) {
      const response = await f.call(body, env.DB, undefined, slug);
      expect(response.status).toBe(409);
      const error = JSON.stringify(await response.json());
      expect(error).toContain("RECORDING_SOURCE_CONFLICT");
      expect(error).not.toContain(first.id);
      expect(error).not.toContain(f.eventId);
    }
    expect(await effects()).toEqual(before);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses anonymous, unrelated event grants and session revocation before any provider operation", async () => {
    const f = await fixture(),
      userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,'recorder@example.test','recorder@example.test',1,?,?)",
    )
      .bind(userId, nowIso(), nowIso())
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,granted_by_user_id,created_at) VALUES(?,?,'events:manage','event',?,?,?)",
    )
      .bind(crypto.randomUUID(), userId, f.eventId, f.admin.id, nowIso())
      .run();
    const token = await createAdminSession(env.DB, userId, crypto.randomUUID());
    expect((await f.call(request, env.DB, null)).status).toBe(401);
    expect((await f.call(request, env.DB, token, "other-event")).status).toBe(403);
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), userId).run();
    const before = await effects();
    expect((await f.call(request, env.DB, token)).status).toBe(401);
    expect(await effects()).toEqual(before);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(["user", "session", "grant"])(
    "rolls back source and audit when %s authority changes at the final insert",
    async (kind) => {
      const f = await fixture();
      let captured: unknown;
      const raced = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("INSERT INTO event_recording_sources"),
        async () => {
          if (kind === "user") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.admin.id).run();
          else if (kind === "session")
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
          else {
            await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
            await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?")
              .bind(nowIso(), f.admin.id)
              .run();
          }
          captured = await effects();
        },
      );
      expect((await f.call(request, raced)).status).toBe(403);
      expect(captured).toBeDefined();
      expect(await effects()).toEqual(captured);
    },
  );

  it("checks link event ownership before discovery and rechecks the immutable link in the final domain batch", async () => {
    const f = await fixture(),
      foreign = await f.native(f.otherEventId),
      before = await effects();
    expect((await f.call({ ...request, meetingLinkId: foreign.meetingLinkId })).status).toBe(404);
    expect(await effects()).toEqual(before);
    expect(f.fetcher).not.toHaveBeenCalled();
    const own = await f.native();
    // The stored native link structurally prevents occurrence reparenting.
    await expect(
      env.DB.prepare("UPDATE event_occurrences SET series_id=?, starts_at=?, ends_at=? WHERE id=?")
        .bind(foreign.series, "2026-12-01T11:00:00.000Z", "2026-12-01T12:00:00.000Z", own.occurrence)
        .run(),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO event_recording_sources"),
      async () => {
        await env.DB.prepare("DELETE FROM event_recording_meetings WHERE id=?").bind(own.meetingLinkId).run();
      },
    );
    expect((await f.call({ ...request, meetingLinkId: own.meetingLinkId }, raced)).status).toBe(409);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_sources")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='recording_source_bound'")).toEqual([]);
  });

  it("rejects invented metadata fields and refuses missing configuration or a page without the selected recording", async () => {
    const missing = await fixture(null),
      before = await effects();
    expect((await missing.call()).status).toBe(503);
    expect(missing.fetcher).not.toHaveBeenCalled();
    expect(await effects()).toEqual(before);
    const configured = mounted(missing.fetcher, configuration);
    const token = await createAdminSession(env.DB, missing.admin.id, crypto.randomUUID());
    const post = (body: unknown) =>
      configured.request(
        "/events/pqc-2026/recordings/sources",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        env,
      );
    expect((await post({ ...request, sessionId })).status).toBe(400);
    expect(missing.fetcher).not.toHaveBeenCalled();
    expect((await post({ ...request, recordingId: crypto.randomUUID() })).status).toBe(404);
    expect(await effects()).toEqual(before);
  });

  it("keeps pagination/filter totals event scoped and version responses free of storage fields", async () => {
    const f = await fixture();
    await f.bound();
    const nextId = crypto.randomUUID();
    f.fetcher.mockResolvedValue(
      Response.json({
        success: true,
        data: [{ ...wire(nextId), status: "PAUSED" }],
        paging: { start_offset: 1, end_offset: 1, total_count: 1 },
      }),
    );
    await f.bound({ ...request, recordingId: nextId });
    let response = await f.call(undefined, env.DB, undefined, "pqc-2026", "GET", "?limit=1&offset=0");
    let page = eventRecordingSourcesResponseSchema.parse(await response.json());
    expect(page.page).toMatchObject({ total: 2, hasMore: true });
    response = await f.call(undefined, env.DB, undefined, "pqc-2026", "GET", "?status=PAUSED&q=" + nextId);
    page = eventRecordingSourcesResponseSchema.parse(await response.json());
    expect(page.sources.map((row) => row.recordingId)).toEqual([nextId]);
    expect(page.page.total).toBe(1);
    response = await f.call(undefined, env.DB, undefined, "other-event", "GET");
    expect(eventRecordingSourcesResponseSchema.parse(await response.json()).page.total).toBe(0);
    response = await f.call(undefined, env.DB, undefined, "pqc-2026", "GET", "/versions");
    expect(eventRecordingVersionsResponseSchema.parse(await response.json()).versions).toEqual([]);
  });
  it("requests and polls acquisition metadata through the canonical mounted routes", async () => {
    const f = await fixture(),
      source = await f.bound(),
      path = `/sources/${source.id}/acquisitions`;
    const response = await f.call(
      { operationId: crypto.randomUUID(), expectedMetadataRevision: source.metadataRevision },
      env.DB,
      undefined,
      "pqc-2026",
      "POST",
      path,
    );
    expect(response.status).toBe(200);
    const acquisition = eventRecordingAcquisitionSchema.parse(await response.json());
    const polled = await f.call(undefined, env.DB, undefined, "pqc-2026", "GET", `${path}/${acquisition.id}`);
    expect(polled.status).toBe(200);
    expect(eventRecordingAcquisitionSchema.parse(await polled.json())).toEqual(acquisition);
    expect(polled.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(acquisition)).not.toMatch(
      /payloadHash|requestedByUserId|processingToken|transfer_|verification_|r2_key/,
    );
    const foreign = await f.call(
      undefined,
      env.DB,
      undefined,
      "pqc-2026",
      "GET",
      `/sources/${crypto.randomUUID()}/acquisitions/${acquisition.id}`,
    );
    expect(foreign.status).toBe(404);
    const anonymous = await f.call(undefined, env.DB, null, "pqc-2026", "GET", `${path}/${acquisition.id}`);
    expect(anonymous.status).toBe(401);
  });

  it("enforces source/version event ownership and permits only atomic cleanup of completed acquisition provenance", async () => {
    const f = await fixture(),
      source = await f.bound();
    const recording = crypto.randomUUID();
    f.fetcher.mockResolvedValueOnce(
      Response.json({
        success: true,
        data: [wire(recording)],
        paging: { start_offset: 1, end_offset: 1, total_count: 1 },
      }),
    );
    const otherResponse = await f.call(
      { ...request, meetingLinkId: f.otherMeetingLinkId, recordingId: recording },
      env.DB,
      undefined,
      "other-event",
    );
    expect(otherResponse.status).toBe(200);
    const other = eventRecordingSourceSchema.parse(await otherResponse.json());
    // These synthetic byte records exercise migration keys only, not storage/provider export acceptance.
    async function completed(eventId: string, sourceId: string, versionNumber = 1) {
      const acquisition = crypto.randomUUID(),
        version = crypto.randomUUID(),
        timestamp = nowIso();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO event_recording_acquisitions
          (id,event_id,source_id,operation_id,payload_hash,expected_metadata_revision,requested_by_user_id,status,next_attempt_at,created_at,updated_at)
          VALUES(?,?,?,?,?,1,?,'queued',?,?,?)`,
        ).bind(
          acquisition,
          eventId,
          sourceId,
          crypto.randomUUID(),
          "a".repeat(64),
          f.admin.id,
          timestamp,
          timestamp,
          timestamp,
        ),
        env.DB.prepare(
          `INSERT INTO event_recording_versions
          (id,event_id,source_id,acquisition_id,version_number,source_metadata_revision,r2_key,digest,file_size,mime_type,object_etag,acquired_at)
          VALUES(?,?,?,?,?,1,?,?,16,'video/mp4','synthetic-etag',?)`,
        ).bind(
          version,
          eventId,
          sourceId,
          acquisition,
          versionNumber,
          `synthetic-recording/${version}`,
          "a".repeat(64),
          timestamp,
        ),
        env.DB.prepare(
          "UPDATE event_recording_acquisitions SET status='completed',completed_version_id=?,completed_at=? WHERE id=?",
        ).bind(version, timestamp, acquisition),
      ]);
      return { acquisition, version };
    }
    const own = await completed(f.eventId, source.id),
      foreign = await completed(f.otherEventId, other.id);
    const before = await effects();
    await expect(
      env.DB.prepare("DELETE FROM event_recording_acquisitions WHERE id=?").bind(own.acquisition).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      env.DB.prepare("DELETE FROM event_recording_versions WHERE id=?").bind(own.version).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(await effects()).toEqual(before);
    await expect(
      env.DB.prepare(
        `INSERT INTO event_recording_acquisitions
      (id,event_id,source_id,operation_id,payload_hash,expected_metadata_revision,requested_by_user_id,status,next_attempt_at,completed_version_id,completed_at,created_at,updated_at)
      VALUES(?,?,?,?,?,1,?,'completed',?,?,?,?,?)`,
      )
        .bind(
          crypto.randomUUID(),
          f.eventId,
          source.id,
          crypto.randomUUID(),
          "b".repeat(64),
          f.admin.id,
          nowIso(),
          foreign.version,
          nowIso(),
          nowIso(),
          nowIso(),
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    expect(await effects()).toEqual(before);
    const versionResponse = await f.call(undefined, env.DB, undefined, "pqc-2026", "GET", "/versions");
    const catalog = eventRecordingVersionsResponseSchema.parse(await versionResponse.json());
    expect(catalog.versions.map((row) => row.id)).toEqual([own.version]);
    expect(JSON.stringify(catalog)).not.toMatch(/r2_key|synthetic-recording|synthetic-etag|acquisition_id/);
    // Live digests deduplicate, while terminal storage deletion retains provenance
    // and permits a new version with the same bytes.
    await expect(completed(f.eventId, source.id, 2)).rejects.toThrow(/UNIQUE/);
    const deletedAt = nowIso();
    await env.DB.prepare("UPDATE event_recording_versions SET deleted_at=? WHERE id=?")
      .bind(deletedAt, own.version)
      .run();
    for (const replacement of [null, "2026-12-02T10:00:00.000Z"])
      await expect(
        env.DB.prepare("UPDATE event_recording_versions SET deleted_at=? WHERE id=?")
          .bind(replacement, own.version)
          .run(),
      ).rejects.toThrow("RECORDING_VERSION_DELETION_IMMUTABLE");
    const fresh = await completed(f.eventId, source.id, 2);
    expect(
      await queryAll(
        env.DB,
        "SELECT id,version_number,deleted_at FROM event_recording_versions WHERE source_id=? ORDER BY version_number",
        [source.id],
      ),
    ).toEqual([
      { id: own.version, version_number: 1, deleted_at: deletedAt },
      { id: fresh.version, version_number: 2, deleted_at: null },
    ]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM event_recording_acquisitions WHERE id=?").bind(fresh.acquisition),
      env.DB.prepare("DELETE FROM event_recording_versions WHERE id=?").bind(fresh.version),
    ]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM event_recording_acquisitions WHERE event_id=? AND id=?").bind(
        f.eventId,
        own.acquisition,
      ),
      env.DB.prepare("DELETE FROM event_recording_versions WHERE event_id=? AND id=?").bind(f.eventId, own.version),
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_acquisitions")).toEqual([
      { id: foreign.acquisition },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_versions")).toEqual([{ id: foreign.version }]);
    await resetDb();
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_acquisitions")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_versions")).toEqual([]);
  });
});

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventRecordingDiscoveryResponseSchema,
  eventRecordingMeetingLinkSchema,
  eventRecordingMeetingSchema,
  eventRecordingMeetingsResponseSchema,
  eventRecordingProviderMeetingsResponseSchema,
} from "../assets/shared/schemas/event-recording-discovery";
import {
  recordingDiscoveryRoute,
  recordingMeetingLinkRoute,
  recordingProviderMeetingsRoute,
  EventRecordingMeetingsGet,
} from "../functions/api/v1/events/[eventSlug]/recording-discovery";
import workerApp from "../functions/router";
import { handleError } from "../functions/_lib/http";
import type { RealtimeKitRecordingConfiguration } from "../functions/_lib/services/event-series/realtimekit-recording-contracts";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

const configuration = {
  accountId: "0123456789abcdef0123456789abcdef",
  appId: "synthetic-app",
  apiToken: "private-provider-token",
};
const meetingId = "10000000-0000-4000-8000-000000000001";
const recordingId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const foreignId = "40000000-0000-4000-8000-000000000001";
const instant = "2026-12-01T09:00:00.000Z";
const privateDiagnostic = "private-download-url-provider-key";
function meeting(id = meetingId) {
  return {
    id,
    title: "Technical meeting",
    status: "ACTIVE",
    created_at: instant,
    updated_at: instant,
    recording_config: { storage_config: { password: privateDiagnostic } },
    join_url: privateDiagnostic,
  };
}
function recording() {
  return {
    id: recordingId,
    session_id: sessionId,
    status: "UPLOADED",
    invoked_time: instant,
    started_time: instant,
    stopped_time: instant,
    file_size: 12345,
    meeting: { id: meetingId },
    download_url: privateDiagnostic,
  };
}
function mounted(fetcher: typeof fetch, config: RealtimeKitRecordingConfiguration | null) {
  const app = new Hono<{ Bindings: Env }>();
  app.onError(handleError);
  const routes = fromHono(app),
    dependencies = { configuration: () => config, fetcher },
    path = "/events/:eventSlug/recordings";
  routes.get(`${path}/meetings/discovery`, recordingProviderMeetingsRoute(dependencies));
  routes.post(`${path}/meetings`, recordingMeetingLinkRoute(dependencies));
  routes.get(`${path}/meetings`, EventRecordingMeetingsGet);
  routes.get(`${path}/discovery`, recordingDiscoveryRoute(dependencies));
  return app;
}
async function fixture(config: RealtimeKitRecordingConfiguration | null = configuration) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB),
    token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const otherEventId = crypto.randomUUID(),
    timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,settings_json,created_at,updated_at) VALUES(?,'other-event','Other event','UTC',?,?,'{}',?,?)",
  )
    .bind(otherEventId, instant, "2026-12-01T18:00:00.000Z", timestamp, timestamp)
    .run();
  const fetcher = vi.fn<typeof fetch>(async (location) => {
    const url = new URL(String(location));
    if (url.pathname.endsWith("/meetings"))
      return Response.json({
        success: true,
        data: [meeting()],
        paging: { start_offset: 1, end_offset: 1, total_count: 101 },
      });
    if (url.pathname.endsWith(`/meetings/${meetingId}`)) return Response.json({ success: true, data: meeting() });
    return Response.json({
      success: true,
      data: [recording()],
      paging: { start_offset: 1, end_offset: 1, total_count: 101 },
    });
  });
  const app = mounted(fetcher, config);
  const call = (
    path: string,
    body?: unknown,
    db: DatabaseLike = env.DB,
    bearer: string | null = token,
    slug = "pqc-2026",
  ) =>
    app.request(
      `/events/${slug}/recordings${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      { ...env, DB: db },
    );
  const native = async (event = eventId) => {
    const series = crypto.randomUUID(),
      occurrence = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO event_series(id,event_id,starts_at,recurrence_rule,timezone,duration_minutes,created_at,updated_at) VALUES(?,?,?,'FREQ=WEEKLY;COUNT=1','UTC',60,?,?)",
      ).bind(series, event, instant, timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO event_occurrences(id,series_id,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ).bind(occurrence, series, instant, "2026-12-01T10:00:00.000Z", timestamp, timestamp),
    ]);
    return { series, occurrence };
  };
  const link = async (nativeOccurrenceId?: string, slug = "pqc-2026") => {
    const body = eventRecordingMeetingLinkSchema.parse({
      providerMeetingId: meetingId,
      ...(nativeOccurrenceId ? { nativeOccurrenceId } : {}),
    });
    const response = await call("/meetings", body, env.DB, token, slug);
    expect(response.status, await response.clone().text()).toBe(200);
    return eventRecordingMeetingSchema.parse(await response.json());
  };
  const scopedManager = async () => {
    const id = crypto.randomUUID();
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,'scoped-recorder@example.test','scoped-recorder@example.test',1,?,?)",
    )
      .bind(id, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,granted_by_user_id,created_at) VALUES(?,?,'events:manage','event',?,?,?)",
    )
      .bind(crypto.randomUUID(), id, eventId, admin.id, nowIso())
      .run();
    return { id, token: await createAdminSession(env.DB, id, crypto.randomUUID()) };
  };
  return { eventId, otherEventId, admin, token, fetcher, call, native, link, scopedManager };
}
async function effects() {
  return Promise.all(
    [
      "event_recording_meetings",
      "event_recording_sources",
      "event_recording_acquisitions",
      "event_recording_versions",
      "email_outbox",
      "audit_log",
    ].map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`)),
  );
}
beforeEach(resetDb);

describe("recording routes authenticate before validating private inputs", () => {
  it.each([
    "/discovery",
    "/sources/not-a-uuid",
    "/sources/not-a-uuid/acquisitions",
    `/sources/${recordingId}/acquisitions/not-a-uuid`,
  ])("refuses anonymous malformed input and validates an authenticated request: %s", async (path) => {
    const f = await fixture(),
      before = await effects(),
      url = `https://app.test/api/v1/events/pqc-2026/recordings${path}`;
    const anonymous = await workerApp.fetch(new Request(url), env as unknown as Env, createExecutionContext());
    expect(anonymous.status, await anonymous.clone().text()).toBe(401);
    const refusal = await anonymous.json();
    expect(refusal).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(JSON.stringify(refusal)).not.toContain("meetingLinkId");
    expect(JSON.stringify(refusal)).not.toContain("Invalid UUID");
    const authenticated = await workerApp.fetch(
      new Request(url, { headers: { authorization: `Bearer ${f.token}` } }),
      env as unknown as Env,
      createExecutionContext(),
    );
    expect(authenticated.status, await authenticated.clone().text()).toBe(400);
    expect(await effects()).toEqual(before);
  });
});

describe("authenticated provider meeting chooser and explicit event linkage", () => {
  it("lists one app-owned provider page with server search and status, returning only shared metadata", async () => {
    const f = await fixture(),
      before = await effects();
    const response = await f.call("/meetings/discovery?offset=50&limit=50&q=Technical&status=ACTIVE");
    expect(response.status).toBe(200);
    const result = eventRecordingProviderMeetingsResponseSchema.parse(await response.json());
    expect(result.meetings).toEqual([
      {
        providerMeetingId: meetingId,
        title: "Technical meeting",
        status: "ACTIVE",
        createdAt: instant,
        updatedAt: instant,
      },
    ]);
    expect(result.page).toEqual({ limit: 50, offset: 50, total: 101, hasMore: true });
    const url = new URL(String(f.fetcher.mock.calls[0]![0]));
    expect(url.pathname).toBe(`/client/v4/accounts/${configuration.accountId}/realtime/kit/synthetic-app/meetings`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page_no: "1",
      per_page: "50",
      search: "Technical",
      status: "ACTIVE",
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain(privateDiagnostic);
    expect(text).not.toContain(configuration.apiToken);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await effects()).toEqual(before);
  });
  it("links an exact provider meeting to the owned native occurrence and replays without extra writes", async () => {
    const f = await fixture(),
      native = await f.native(),
      first = await f.link(native.occurrence);
    expect(first).toMatchObject({
      eventId: f.eventId,
      nativeOccurrenceId: native.occurrence,
      providerMeetingId: meetingId,
    });
    const replay = await f.link(native.occurrence);
    expect(replay).toEqual(first);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(
      await queryAll(
        env.DB,
        "SELECT event_id,native_series_id,native_occurrence_id,provider_meeting_id FROM event_recording_meetings",
      ),
    ).toEqual([
      {
        event_id: f.eventId,
        native_series_id: native.series,
        native_occurrence_id: native.occurrence,
        provider_meeting_id: meetingId,
      },
    ]);
    expect(await queryAll(env.DB, "SELECT entity_id FROM audit_log WHERE action='recording_meeting_linked'")).toEqual([
      { entity_id: first.id },
    ]);
    const response = await f.call("/meetings?q=Technical&sort=title&limit=1");
    expect(eventRecordingMeetingsResponseSchema.parse(await response.json())).toMatchObject({
      meetings: [first],
      page: { total: 1, limit: 1, offset: 0, hasMore: false },
    });
  });
  it.each([
    { name: "duplicate identities", data: [meeting(), meeting()], total: 2, end: 2 },
    { name: "rows beyond the requested page", data: [meeting(), meeting(foreignId)], total: 2, end: 2 },
    { name: "incorrect status filter", data: [{ ...meeting(), status: "INACTIVE" }], total: 1, end: 1 },
    { name: "impossible paging", data: [meeting()], total: 0, end: 1 },
    { name: "malformed provider metadata", data: [{ ...meeting(), id: "invalid" }], total: 1, end: 1 },
  ])("refuses $name without extra provider pages or exposed diagnostics", async ({ data, total, end }) => {
    const f = await fixture(),
      before = await effects();
    f.fetcher.mockResolvedValueOnce(
      Response.json({
        success: true,
        data,
        paging: { start_offset: 1, end_offset: end, total_count: total },
        diagnostic: privateDiagnostic,
      }),
    );
    const response = await f.call("/meetings/discovery?limit=1&status=ACTIVE");
    expect(response.status).toBe(503);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain(privateDiagnostic);
    expect(await effects()).toEqual(before);
  });
  it("rechecks current chooser access after provider latency", async () => {
    const f = await fixture(),
      before = await effects();
    f.fetcher.mockImplementationOnce(async () => {
      await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
      return Response.json({
        success: true,
        data: [meeting()],
        paging: { start_offset: 1, end_offset: 1, total_count: 1 },
      });
    });
    const response = await f.call("/meetings/discovery");
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain(meetingId);
    expect(await effects()).toEqual(before);
  });
  it("allows explicit reused provider meeting links for different owned scopes", async () => {
    const f = await fixture(),
      native = await f.native(),
      seriesLink = await f.link(),
      nativeLink = await f.link(native.occurrence),
      other = await f.link(undefined, "other-event");
    expect(new Set([seriesLink.id, nativeLink.id, other.id]).size).toBe(3);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_meetings")).toHaveLength(3);
  });
  it("rejects a foreign native occurrence before any provider request or write", async () => {
    const f = await fixture(),
      native = await f.native(f.otherEventId),
      before = await effects();
    const response = await f.call("/meetings", { providerMeetingId: meetingId, nativeOccurrenceId: native.occurrence });
    expect(response.status).toBe(422);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await effects()).toEqual(before);
  });
  it("rejects mismatched app-owned detail identity without persisting a link", async () => {
    const f = await fixture(),
      before = await effects();
    f.fetcher.mockResolvedValueOnce(Response.json({ success: true, data: meeting(foreignId) }));
    const response = await f.call("/meetings", { providerMeetingId: meetingId });
    expect(response.status).toBe(503);
    expect(await effects()).toEqual(before);
  });
  it.each(["permission", "session", "native"])(
    "rolls back an explicit link after %s changes before its command",
    async (kind) => {
      const f = await fixture(),
        native = await f.native(),
        before = await effects();
      const raced = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("INSERT INTO event_recording_meetings"),
        async () => {
          if (kind === "session")
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
          else if (kind === "permission")
            await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
          else
            await env.DB.prepare("UPDATE event_series SET event_id=? WHERE id=?")
              .bind(f.otherEventId, native.series)
              .run();
        },
      );
      const response = await f.call(
        "/meetings",
        { providerMeetingId: meetingId, nativeOccurrenceId: native.occurrence },
        raced,
      );
      expect(response.status).toBe(kind === "native" ? 409 : 403);
      expect(await effects()).toEqual(before);
    },
  );
  it("makes concurrent identical links converge on one link and audit", async () => {
    const f = await fixture();
    const responses = await Promise.all([
      f.call("/meetings", { providerMeetingId: meetingId }),
      f.call("/meetings", { providerMeetingId: meetingId }),
    ]);
    expect(responses.map((row) => row.status)).toEqual([200, 200]);
    const [first, second] = await Promise.all(
      responses.map(async (row) => eventRecordingMeetingSchema.parse(await row.json())),
    );
    expect(first.id).toBe(second.id);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_meetings")).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='recording_meeting_linked'")).toHaveLength(1);
  });
  it.each([
    "/meetings/discovery?offset=1&limit=50",
    "/meetings/discovery?limit=101",
    "/meetings/discovery?sort=title",
    "/discovery",
    "/discovery?meetingLinkId=not-a-uuid",
    "/discovery?meetingLinkId=10000000-0000-4000-8000-000000000001&limit=50",
    "/discovery?meetingLinkId=10000000-0000-4000-8000-000000000001&offset=1",
    "/discovery?providerMeetingId=10000000-0000-4000-8000-000000000001",
  ])("validates the canonical mounted query before provider I/O: %s", async (path) => {
    const f = await fixture(),
      response = await f.call(path);
    expect(response.status).toBe(400);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("requires a current authorized user session before listing provider metadata", async () => {
    const f = await fixture();
    expect((await f.call("/meetings/discovery", undefined, env.DB, null)).status).toBe(401);
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
    expect((await f.call("/meetings/discovery")).status).toBe(401);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("keeps event-only managers out of app-wide provider browsing and linking while permitting bound discovery", async () => {
    const f = await fixture(),
      link = await f.link(),
      manager = await f.scopedManager(),
      before = await effects();
    f.fetcher.mockClear();
    expect((await f.call("/meetings/discovery", undefined, env.DB, manager.token)).status).toBe(403);
    expect((await f.call("/meetings", { providerMeetingId: meetingId }, env.DB, manager.token)).status).toBe(403);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect((await f.call("/meetings", undefined, env.DB, manager.token)).status).toBe(200);
    const discovery = await f.call(`/discovery?meetingLinkId=${link.id}`, undefined, env.DB, manager.token);
    expect(discovery.status).toBe(200);
    expect(eventRecordingDiscoveryResponseSchema.parse(await discovery.json()).meeting.id).toBe(link.id);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(await effects()).toEqual(before);
  });
  it("rechecks the global grant in the atomic link command even when an event grant remains, and accepts a regrant", async () => {
    const f = await fixture(),
      before = await effects();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,granted_by_user_id,created_at) VALUES(?,?,'events:manage','event',?,?,?)",
    )
      .bind(crypto.randomUUID(), f.admin.id, f.eventId, f.admin.id, nowIso())
      .run();
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO event_recording_meetings"),
      async () => {
        await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
      },
    );
    expect((await f.call("/meetings", { providerMeetingId: meetingId }, raced)).status).toBe(403);
    expect(await effects()).toEqual(before);
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,granted_by_user_id,created_at) VALUES(?,?,'events:manage',?,?)",
    )
      .bind(crypto.randomUUID(), f.admin.id, f.admin.id, nowIso())
      .run();
    expect((await f.call("/meetings", { providerMeetingId: meetingId })).status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM event_recording_meetings")).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='recording_meeting_linked'")).toHaveLength(1);
  });
  it("does not expose app-wide metadata after a global grant is revoked while an event grant remains", async () => {
    const f = await fixture(),
      before = await effects();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,granted_by_user_id,created_at) VALUES(?,?,'events:manage','event',?,?,?)",
    )
      .bind(crypto.randomUUID(), f.admin.id, f.eventId, f.admin.id, nowIso())
      .run();
    f.fetcher.mockImplementationOnce(async () => {
      await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
      return Response.json({
        success: true,
        data: [meeting()],
        paging: { start_offset: 1, end_offset: 1, total_count: 1 },
      });
    });
    const response = await f.call("/meetings/discovery");
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain(meetingId);
    expect(await effects()).toEqual(before);
  });
});

describe("meeting-bound recording metadata discovery", () => {
  it("resolves the exact event-owned link and provider page, returning only selectable metadata", async () => {
    const f = await fixture(),
      link = await f.link(),
      before = await effects();
    const response = await f.call(`/discovery?meetingLinkId=${link.id}&offset=100`);
    expect(response.status).toBe(200);
    const result = eventRecordingDiscoveryResponseSchema.parse(await response.json());
    expect(result).toEqual({
      meeting: link,
      recordings: [
        {
          recordingId,
          sessionId,
          status: "UPLOADED",
          invokedAt: instant,
          startedAt: instant,
          stoppedAt: instant,
          fileBytes: 12345,
        },
      ],
      page: { limit: 100, offset: 100, total: 101, hasMore: false },
    });
    const url = new URL(String(f.fetcher.mock.calls[1]![0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      meeting_id: meetingId,
      page_no: "1",
      per_page: "100",
      sort_by: "invokedTime",
      sort_order: "ASC",
    });
    expect(JSON.stringify(result)).not.toContain(privateDiagnostic);
    expect(JSON.stringify(result)).not.toContain(configuration.apiToken);
    expect(await effects()).toEqual(before);
  });
  it("refuses a link belonging to another event without provider enumeration", async () => {
    const f = await fixture(),
      link = await f.link(),
      before = await effects();
    f.fetcher.mockClear();
    expect(
      (await f.call(`/discovery?meetingLinkId=${link.id}`, undefined, env.DB, f.token, "other-event")).status,
    ).toBe(404);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await effects()).toEqual(before);
  });
  it("refuses a link from a different configured provider app", async () => {
    const f = await fixture(),
      link = await f.link();
    const app = mounted(f.fetcher, { ...configuration, appId: "other-app" });
    f.fetcher.mockClear();
    const response = await app.request(
      `/events/pqc-2026/recordings/discovery?meetingLinkId=${link.id}`,
      { headers: { authorization: `Bearer ${f.token}` } },
      env,
    );
    expect(response.status).toBe(404);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rechecks live access after a provider response before exposing metadata", async () => {
    const f = await fixture(),
      link = await f.link(),
      before = await effects();
    f.fetcher.mockImplementationOnce(async () => {
      await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
      return Response.json({
        success: true,
        data: [recording()],
        paging: { start_offset: 1, end_offset: 1, total_count: 1 },
      });
    });
    const response = await f.call(`/discovery?meetingLinkId=${link.id}`);
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain(recordingId);
    expect(await effects()).toEqual(before);
  });
  it("keeps provider configuration failures bounded and performs no external calls", async () => {
    const f = await fixture(null);
    const response = await f.call("/meetings/discovery");
    expect(response.status).toBe(503);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(configuration.apiToken);
  });
});

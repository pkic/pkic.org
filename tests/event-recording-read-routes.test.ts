import { env } from "cloudflare:workers";
import { fromHono } from "chanfana";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { eventRecordingAcquisitionsResponseSchema } from "../assets/shared/schemas/event-recording-acquisition-catalog";
import { eventRecordingSourceSchema } from "../assets/shared/schemas/event-recordings";
import eventRouter from "../functions/api/v1/events/[eventSlug]/router";
import { handleError } from "../functions/_lib/http";
import type { Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";
import { resetDb } from "./helpers/reset-db";

/** This imports the production event router, so omitted mounts cannot pass. */
async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const now = nowIso(),
    sourceId = crypto.randomUUID(),
    acquisitionId = crypto.randomUUID();
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId: admin.id, now });
  await env.DB.prepare(
    `INSERT INTO event_recording_sources
    (id,event_id,meeting_link_id,provider_type,provider_account_id,provider_app_id,
     provider_meeting_id,provider_session_id,provider_recording_id,provider_status,
     provider_invoked_at,provider_started_at,provider_file_size,metadata_revision,
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
  await env.DB.prepare(
    `INSERT INTO event_recording_acquisitions
    (id,event_id,source_id,operation_id,payload_hash,expected_metadata_revision,
     requested_by_user_id,status,next_attempt_at,created_at,updated_at)
    VALUES(?,?,?,?,?,1,?,'queued',?,?,?)`,
  )
    .bind(acquisitionId, eventId, sourceId, crypto.randomUUID(), "a".repeat(64), admin.id, now, now, now)
    .run();
  const app = new Hono<{ Bindings: Env }>();
  app.onError(handleError);
  fromHono(app).route("/events/:eventSlug", eventRouter);
  const call = (suffix = "", bearer: string | null = token, source = sourceId) =>
    app.request(
      `/events/pqc-2026/recordings/sources/${source}${suffix}`,
      { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} },
      env,
    );
  return { sourceId, acquisitionId, meeting, call };
}

beforeEach(resetDb);
describe("production event recording read mounts", () => {
  it("mounts canonical source detail and source acquisition catalog with private responses", async () => {
    const f = await fixture();
    const detail = await f.call();
    expect(detail.status, await detail.clone().text()).toBe(200);
    expect(eventRecordingSourceSchema.parse(await detail.json())).toMatchObject({
      id: f.sourceId,
      meetingLinkId: f.meeting.meetingLinkId,
    });
    const catalog = await f.call("/acquisitions?limit=1&sort=createdAt&status=queued");
    expect(catalog.status, await catalog.clone().text()).toBe(200);
    const text = await catalog.text(),
      result = eventRecordingAcquisitionsResponseSchema.parse(JSON.parse(text));
    expect(result.acquisitions.map(({ id }) => id)).toEqual([f.acquisitionId]);
    expect(result.page).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });
    expect(text).not.toContain("a".repeat(64));
    for (const response of [detail, catalog]) expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("enforces authentication on both production read mounts", async () => {
    const f = await fixture();
    for (const suffix of ["", "/acquisitions"]) expect((await f.call(suffix, null)).status).toBe(401);
  });
  it("returns a source absence on both production mounts instead of a catalog or fallback response", async () => {
    const f = await fixture();
    for (const suffix of ["", "/acquisitions"])
      expect((await f.call(suffix, undefined, crypto.randomUUID())).status).toBe(404);
  });
  it("validates the production catalog query through its shared bounded contract", async () => {
    const f = await fixture();
    for (const query of ["limit=201", "offset=10001", "sort=processingToken", "status=invalid"])
      expect((await f.call(`/acquisitions?${query}`)).status).toBe(400);
  });
});

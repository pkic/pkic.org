import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import {
  locationLiveStreamResponseSchema,
  virtualRoomResponseSchema,
} from "../assets/shared/schemas/event-live-stream";
import { personalAgendaResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const base = "/api/v1/events/pqc-2026/agenda";
const usual = "jfKfPfyJRdk";
const dayTwo = "o-1sSF_xP5Q";
beforeEach(resetDb);

async function signedInUser(email: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES(?,?,?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
  )
    .bind(id, email, email)
    .run();
  return { id, token: await createAdminSession(env.DB, id, crypto.randomUUID()) };
}

async function fixture({ streamed = true }: { streamed?: boolean } = {}) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const staffToken = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const call = (path: string, token: string | null, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    callApi(env, path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const room = await call(`${base}/rooms`, staffToken, {
    expectedRevision: 0,
    name: "Main hall",
    capacity: 50,
    equipment: ["live_streaming"],
  });
  expect(room.status, await room.clone().text()).toBe(200);
  let snapshot = agendaSnapshotSchema.parse(await room.json());
  const roomId = snapshot.rooms[0]!.id;
  const session = await call(`${base}/occurrences`, staffToken, {
    expectedRevision: snapshot.revision,
    title: "Opening keynote",
    description: "A substantive keynote about reliable certificate operations and cryptographic agility.",
    startAt: "2026-12-02T09:00:00.000Z",
    endAt: "2026-12-02T10:00:00.000Z",
    roomId,
  });
  expect(session.status, await session.clone().text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await session.json());
  const occurrenceId = snapshot.occurrences[0]!.id;
  const published = await call(`${base}/publications`, staffToken, { expectedRevision: snapshot.revision });
  expect(published.status, await published.clone().text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await published.json());
  const streamPath = `${base}/rooms/${roomId}/stream`;
  if (streamed) {
    const configured = await call(
      streamPath,
      staffToken,
      { videoId: `https://www.youtube.com/watch?v=${usual}`, days: [{ dayDate: "2026-12-03", videoId: dayTwo }] },
      "PUT",
    );
    expect(configured.status, await configured.clone().text()).toBe(200);
  }
  async function register(userId: string, attendanceType = "on_demand", status = "registered") {
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,?,?,'test',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    )
      .bind(crypto.randomUUID(), eventId, userId, status, attendanceType, crypto.randomUUID())
      .run();
  }
  return { eventId, adminId: admin.id, staffToken, call, roomId, occurrenceId, snapshot, streamPath, register };
}

describe("location live stream configuration", () => {
  it("stores only the video ID from a full YouTube address, with per-day replacements on event days", async () => {
    const f = await fixture();
    const read = await f.call(f.streamPath, f.staffToken);
    expect(read.status).toBe(200);
    const stream = locationLiveStreamResponseSchema.parse(await read.json());
    expect(stream).toMatchObject({
      roomId: f.roomId,
      roomName: "Main hall",
      stream: { provider: "youtube", videoId: usual },
      days: [{ dayDate: "2026-12-03", stream: { provider: "youtube", videoId: dayTwo } }],
      eventDays: ["2026-12-01", "2026-12-02", "2026-12-03"],
      timeZone: "Europe/Amsterdam",
    });
    const rows = await queryAll<{ day_date: string | null; provider: string; stream_ref: string }>(
      env.DB,
      "SELECT day_date,provider,stream_ref FROM event_agenda_room_streams ORDER BY day_date IS NOT NULL,day_date",
    );
    expect(rows).toEqual([
      { day_date: null, provider: "youtube", stream_ref: usual },
      { day_date: "2026-12-03", provider: "youtube", stream_ref: dayTwo },
    ]);
    const audit = await queryAll(env.DB, "SELECT action FROM audit_log WHERE action='agenda_location_stream_replaced'");
    expect(audit).toHaveLength(1);
  });

  it("refuses an address that is not a YouTube video and a day outside the event without changing anything", async () => {
    const f = await fixture();
    for (const body of [
      { videoId: "https://youtube.com.example.test/watch?v=jfKfPfyJRdk", days: [] },
      { videoId: usual, days: [{ dayDate: "2026-12-09", videoId: dayTwo }] },
    ]) {
      const refused = await f.call(f.streamPath, f.staffToken, body, "PUT");
      expect(refused.status, await refused.clone().text()).toBe(400);
    }
    const rows = await queryAll(env.DB, "SELECT stream_ref FROM event_agenda_room_streams ORDER BY day_date");
    expect(rows).toHaveLength(2);
  });

  it("clears the configuration and requires agenda permissions to read or change it", async () => {
    const f = await fixture();
    const attendee = await signedInUser("attendee@example.test");
    await f.register(attendee.id);
    expect((await f.call(f.streamPath, null)).status).toBe(401);
    const attendeeRead = await f.call(f.streamPath, attendee.token);
    expect(attendeeRead.status).toBe(403);
    expect(await attendeeRead.text()).not.toContain(usual);
    expect((await f.call(f.streamPath, attendee.token, { videoId: null, days: [] }, "PUT")).status).toBe(403);
    const cleared = await f.call(f.streamPath, f.staffToken, { videoId: null, days: [] }, "PUT");
    expect(locationLiveStreamResponseSchema.parse(await cleared.json())).toMatchObject({ stream: null, days: [] });
    expect((await f.call(`${base}/rooms/unknown-room/stream`, f.staffToken)).status).toBe(404);
  });
});

describe("virtual room access", () => {
  it("releases streams to registered attendees of any attendance type and to event staff only", async () => {
    const f = await fixture();
    const outsider = await signedInUser("outsider@example.test");
    const attendee = await signedInUser("attendee@example.test");
    // Signed in through an unconfirmed registration: a portal session, but no confirmed attendance.
    await f.register(outsider.id, "virtual", "pending_email_confirmation");
    await f.register(attendee.id, "on_demand");
    const anonymous = await f.call(`${base}/streams`, null);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).not.toContain(usual);
    const refused = await f.call(`${base}/streams`, outsider.token);
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain(usual);
    for (const token of [attendee.token, f.staffToken]) {
      const allowed = await f.call(`${base}/streams`, token);
      expect(allowed.status, await allowed.clone().text()).toBe(200);
      expect(allowed.headers.get("cache-control")).toContain("no-store");
      expect(virtualRoomResponseSchema.parse(await allowed.json())).toEqual({
        timeZone: "Europe/Amsterdam",
        locations: [
          {
            id: f.roomId,
            name: "Main hall",
            stream: { provider: "youtube", videoId: usual },
            days: [{ dayDate: "2026-12-03", stream: { provider: "youtube", videoId: dayTwo } }],
          },
        ],
      });
    }
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE user_id=?").bind(attendee.id).run();
    const cancelled = await f.call(`${base}/streams`, attendee.token);
    expect(cancelled.status).toBe(403);
    expect(await cancelled.text()).not.toContain(usual);
  });

  it("names the streaming location on the session only for a registered viewer and never in public data", async () => {
    const f = await fixture();
    const attendee = await signedInUser("attendee@example.test");
    const listing = async () =>
      personalAgendaResponseSchema.parse(await (await f.call(`${base}/participation`, attendee.token)).json());
    await f.register(attendee.id, "virtual", "pending_email_confirmation");
    expect((await listing()).sessions[0]!.liveStreamRoomId).toBeNull();
    await env.DB.prepare("UPDATE registrations SET status='registered' WHERE user_id=?").bind(attendee.id).run();
    expect((await listing()).sessions[0]!.liveStreamRoomId).toBe(f.roomId);
    const program = await f.call(`${base}/participation/program`, attendee.token);
    expect(program.status).toBe(200);
    const text = await program.text();
    expect(text).not.toContain(usual);
    expect(text).not.toContain(dayTwo);
  });

  it("does not offer a stream for a session whose own media plan excludes live streaming", async () => {
    const f = await fixture();
    const attendee = await signedInUser("attendee@example.test");
    await f.register(attendee.id, "virtual");
    const agenda = agendaSnapshotSchema.parse(await (await f.call(base, f.staffToken)).json());
    const patched = await f.call(
      `${base}/occurrences/${f.occurrenceId}`,
      f.staffToken,
      { expectedRevision: agenda.revision, plannedMedia: { recording: false, liveStreaming: false } },
      "PATCH",
    );
    expect(patched.status, await patched.clone().text()).toBe(200);
    const revision = agendaSnapshotSchema.parse(await patched.json()).revision;
    expect((await f.call(`${base}/publications`, f.staffToken, { expectedRevision: revision })).status).toBe(200);
    const listing = personalAgendaResponseSchema.parse(
      await (await f.call(`${base}/participation`, attendee.token)).json(),
    );
    expect(listing.sessions[0]!.liveStreamRoomId).toBeNull();
  });
});

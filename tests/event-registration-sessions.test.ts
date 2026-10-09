import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { registrationSessionsResponseSchema } from "../assets/shared/schemas/event-registration-sessions";
import { sessionParticipationStatusSchema } from "../assets/shared/schemas/event-participation-scanning";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const environment = env as unknown as Env;
const now = "2026-10-07T09:00:00.000Z";
let eventId: string, registrationId: string, ownerId: string, adminId: string, token: string;
let roomA: string, roomB: string, sessions: string[];
const titles = ["Alpha favorite", "Beta reserved", "Gamma approval", "Delta waitlisted", "Epsilon canceled"];

async function request(
  query = "",
  credential: string | null = token,
  db: DatabaseLike = env.DB,
  slug = "pqc-2026",
  id = registrationId,
) {
  return callApi({ ...environment, DB: db }, `/api/v1/events/${slug}/registrations/${id}/sessions${query}`, {
    headers: credential ? { authorization: `Bearer ${credential}` } : {},
  });
}
async function page(query = "") {
  const response = await request(query);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  return registrationSessionsResponseSchema.parse(await response.json());
}
async function actor(permission: string) {
  const userId = await insertUser(env.DB);
  const grantId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,'event',?,?)",
  )
    .bind(grantId, userId, permission, eventId, now)
    .run();
  return { grantId, token: await createAdminSession(env.DB, userId, crypto.randomUUID()) };
}
async function effects() {
  const rows = await queryAll(
    env.DB,
    "SELECT id,status,saved,room_id,allocation_revision FROM agenda_session_participations ORDER BY id",
  );
  const counts = await queryAll(
    env.DB,
    `SELECT (SELECT COUNT(*) FROM event_session_admissions) AS admissions,
    (SELECT COUNT(*) FROM audit_log) AS audits,(SELECT COUNT(*) FROM email_outbox) AS messages`,
  );
  return { rows, counts };
}

beforeEach(async () => {
  await resetDb();
  const seeded = await seedEventAndAdmin(env.DB);
  eventId = seeded.eventId;
  adminId = seeded.admin.id;
  token = await createAdminSession(env.DB, adminId, crypto.randomUUID());
  ownerId = await insertUser(env.DB);
  registrationId = crypto.randomUUID();
  roomA = crypto.randomUUID();
  roomB = crypto.randomUUID();
  sessions = titles.map(() => crypto.randomUUID());
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','direct',?,?,?)",
    ).bind(registrationId, eventId, ownerId, crypto.randomUUID(), now, now),
    env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,2,1,?)",
    ).bind(eventId, now),
    ...[roomA, roomB].map((id, index) =>
      env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,0)").bind(
        id,
        eventId,
        `Draft room ${index + 1}`,
      ),
    ),
    ...sessions.map((id) =>
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,capacity) VALUES(?,?,'Private draft title',0)",
      ).bind(id, eventId),
    ),
    ...sessionParticipationStatusSchema.options.map((status, index) =>
      env.DB.prepare(
        "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,saved,room_id,created_at,updated_at) VALUES(?,?,?,?,'physical',?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        eventId,
        sessions[index],
        ownerId,
        status,
        index < 2 ? 1 : 0,
        index === 1 ? roomB : null,
        now,
        now,
      ),
    ),
    env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
    ).bind(
      crypto.randomUUID(),
      eventId,
      JSON.stringify({
        timeZone: "Europe/Amsterdam",
        rooms: [
          { id: roomA, name: "Published room A", capacity: 100 },
          { id: roomB, name: "Published room B", capacity: null },
        ],
        occurrences: sessions.map((id, index) => ({
          id,
          title: titles[index],
          startAt: `2026-12-01T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
          endAt: `2026-12-01T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
          roomId: roomA,
          additionalRoomIds: index === 1 ? [roomB] : [],
          visibility: index === 1 ? "private" : "public",
          admissionPolicy: index === 0 ? "preference" : "optional_reservation",
          virtualRoomUrl: "https://private-room.example.test/never-release",
        })),
      }),
      adminId,
      now,
    ),
  ]);
});

describe("event-owned attendee session intent", () => {
  it("keeps favorites independent of reservations and approved details separate from drafts and presence", async () => {
    const before = await effects();
    const data = await page("?sort=startAt");
    expect(data.page.total).toBe(5);
    expect(data.sessions.map((row) => row.status)).toEqual(sessionParticipationStatusSchema.options);
    expect(data.sessions[0]).toMatchObject({
      id: sessions[0],
      title: titles[0],
      saved: true,
      status: "saved",
      publishedRevision: 1,
    });
    expect(data.sessions[1]).toMatchObject({
      saved: true,
      status: "reserved",
      roomId: roomB,
      visibility: "private",
      rooms: [
        { id: roomA, name: "Published room A" },
        { id: roomB, name: "Published room B" },
      ],
    });
    const serialized = JSON.stringify(data);
    for (const privateValue of [
      "Private draft title",
      "virtualRoomUrl",
      "never-release",
      "credential",
      "availability",
      "admittedAt",
    ])
      expect(serialized).not.toContain(privateValue);
    expect(await effects()).toEqual(before);
  });

  it("filters, searches and sorts the server population with final and empty pages", async () => {
    const first = await page("?saved=true&sort=-title&limit=1");
    expect(first.sessions.map((row) => row.title)).toEqual([titles[1]]);
    expect(first.page).toMatchObject({ total: 2, hasMore: true });
    const last = await page("?saved=true&sort=-title&limit=1&offset=1");
    expect(last.sessions.map((row) => row.title)).toEqual([titles[0]]);
    expect(last.page.hasMore).toBe(false);
    const empty = await page("?saved=true&sort=-title&limit=1&offset=2");
    expect(empty.sessions).toEqual([]);
    expect(empty.page).toMatchObject({ total: 2, hasMore: false });
    expect((await page("?q=GAMMA&status=approval_pending&saved=false")).sessions.map((row) => row.id)).toEqual([
      sessions[2],
    ]);
    expect((await page("?status=canceled")).sessions[0]?.saved).toBe(false);
  });

  it("requires management independently of event read, write or attendance reading", async () => {
    expect((await request("", null)).status).toBe(401);
    for (const permission of ["events:read", "events:write", "agenda:attendance_read"]) {
      const viewer = await actor(permission);
      expect((await request("", viewer.token)).status, permission).toBe(403);
    }
    expect((await request("", (await actor("events:manage")).token)).status).toBe(200);
  });

  it("refuses another event's registration and does not accept a caller-supplied attendee", async () => {
    const foreignEvent = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,'another-event','Another event','UTC',?,?)",
    )
      .bind(foreignEvent, now, now)
      .run();
    expect((await request("", token, env.DB, "another-event")).status).toBe(404);
    const outsider = await insertUser(env.DB);
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'remote','reserved',?,?)",
    )
      .bind(crypto.randomUUID(), eventId, sessions[0], outsider, now, now)
      .run();
    expect((await page()).page.total).toBe(5);
    expect((await request(`?userId=${outsider}`)).status).toBe(400);
  });

  it("does not include unpublished occurrences or invent intent for an attendee with none", async () => {
    const unpublished = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Unpublished')").bind(
        unpublished,
        eventId,
      ),
      env.DB.prepare(
        "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,saved,created_at,updated_at) VALUES(?,?,?,?,'remote','saved',1,?,?)",
      ).bind(crypto.randomUUID(), eventId, unpublished, ownerId, now, now),
    ]);
    expect((await page()).page.total).toBe(5);
    await env.DB.prepare("DELETE FROM agenda_session_participations WHERE user_id=?").bind(ownerId).run();
    const empty = await page();
    expect(empty.sessions).toEqual([]);
    expect(empty.page.total).toBe(0);
  });

  it("refuses a revoked management grant at the actual page boundary without side effects", async () => {
    const manager = await actor("events:manage");
    const before = await effects();
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE id=?").bind(now, manager.grantId).run(),
    );
    const response = await request("", manager.token, db);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "EVENT_REGISTRATION_AUTHORIZATION_CHANGED" } });
    expect(await effects()).toEqual(before);
  });

  it("refuses contact-retention closure committed before the page batch rather than returning false zero", async () => {
    const before = await effects();
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("INSERT INTO event_contact_retention_state(event_id,closed_at,deadline_at) VALUES(?,?,?)")
        .bind(eventId, now, now)
        .run(),
    );
    const response = await request("", token, db);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "EVENT_CONTACT_RETENTION_EXPIRED" } });
    expect(await effects()).toEqual(before);
  });

  it("does not release a redacted owner's session intent", async () => {
    await env.DB.prepare("UPDATE users SET pii_redacted_at=? WHERE id=?").bind(now, ownerId).run();
    expect((await request()).status).toBe(404);
  });

  it.each(["?sort=credential", "?limit=201", "?offset=10001", "?saved=1", "?status=admitted"])(
    "validates the canonical bounded query %s",
    async (query) => {
      expect((await request(query)).status).toBe(400);
    },
  );
});

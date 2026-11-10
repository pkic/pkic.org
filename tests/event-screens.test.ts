import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { SCREEN_POLICY, SCREEN_SESSION_MAX_AGE_SECONDS } from "../assets/shared/event-screen-policy";
import { apiValidationErrorDetailsSchema } from "../assets/shared/schemas/api-common";
import { screenConnection, screenConnectionDisplay } from "../assets/shared/event-screen-connection";
import { agendaRoomCreateSchema } from "../assets/shared/schemas/event-agenda";
import { agendaRoomsListSchema } from "../assets/shared/schemas/event-agenda-room-list";
import {
  eventScreensListSchema,
  screenPairingResponseSchema,
  screenReadResponseSchema,
  screenRecordSchema,
  screenSessionPollResponseSchema,
  type ScreenOwnView,
} from "../assets/shared/schemas/event-screens";
import { verifyLiveOverlayToken } from "../functions/_lib/auth/live-session-overlay-token";
import { signJwt } from "../functions/_lib/utils/jwt";
import type { Env } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { createTestRateLimiter } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

const SECRET = env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret";
const SCREEN = "ABC234";
const EVENT = { id: crypto.randomUUID(), slug: "screens-a", roomId: crypto.randomUUID() };
const OTHER_EVENT = { id: crypto.randomUUID(), slug: "screens-b", roomId: crypto.randomUUID() };
type Staff = "manager" | "moderator" | "reader" | "otherManager";
const users: Record<Staff, string> = {
  manager: crypto.randomUUID(),
  moderator: crypto.randomUUID(),
  reader: crypto.randomUUID(),
  otherManager: crypto.randomUUID(),
};
const tokens = {} as Record<Staff, string>;
let testEnv: Env;

async function seed() {
  await resetDb();
  testEnv = { ...env, IP_RATE_LIMITER: createTestRateLimiter(1000) } as Env;
  const now = new Date().toISOString();
  for (const event of [EVENT, OTHER_EVENT]) {
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES (?,?,'Screens test','Europe/Amsterdam','invite_or_open','{}',?,?)",
    )
      .bind(event.id, event.slug, now, now)
      .run();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name) VALUES (?,?,'Main hall')")
      .bind(event.roomId, event.id)
      .run();
  }
  const grants: Record<Staff, [string, string]> = {
    manager: ["agenda:screens_manage", EVENT.id],
    moderator: ["agenda:live_moderate", EVENT.id],
    reader: ["agenda:read", EVENT.id],
    otherManager: ["agenda:screens_manage", OTHER_EVENT.id],
  };
  for (const person of Object.keys(users) as Staff[]) {
    await env.DB.prepare("INSERT INTO users (id,email,normalized_email,active) VALUES (?,?,?,1)")
      .bind(users[person], `${person}@example.test`, `${person}@example.test`)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,?,'event',?,?)",
    )
      .bind(crypto.randomUUID(), users[person], grants[person][0], grants[person][1], now)
      .run();
    tokens[person] = await createAdminSession(env.DB, users[person], crypto.randomUUID());
  }
}

const staff = (person: Staff) => ({
  authorization: `Bearer ${tokens[person]}`,
  origin: "https://app.test",
  "content-type": "application/json",
});

function cookieValue(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`No ${name} cookie`);
  return cookie.slice(name.length + 1).split(";")[0];
}
function setCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
}

async function startPairing(screenId = SCREEN) {
  const response = await callApi(
    testEnv,
    `/api/v1/screens/${screenId}/pairings`,
    { method: "POST", headers: { origin: "https://app.test" } },
    { maxRoundTrips: 0 },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return {
    response,
    ...screenPairingResponseSchema.parse(await response.json()),
    cookie: `pkic_screen_pairing=${cookieValue(response, "pkic_screen_pairing")}`,
  };
}

const poll = (cookie: string, screenId = SCREEN) =>
  callApi(
    testEnv,
    `/api/v1/screens/${screenId}/session`,
    { method: "POST", headers: { cookie } },
    { maxRoundTrips: 1 },
  );

function approve(person: Staff, body: Record<string, unknown>, eventSlug = EVENT.slug) {
  return callApi(
    testEnv,
    `/api/v1/events/${eventSlug}/screens`,
    { method: "POST", headers: staff(person), body: JSON.stringify({ screenId: SCREEN, name: "Foyer", ...body }) },
    { maxRoundTrips: 2 },
  );
}

/** Pair the screen end to end and return its sign-in cookie. */
async function pair(assignment?: unknown, screenId = SCREEN) {
  const challenge = await startPairing(screenId);
  const approved = await approve("manager", {
    screenId,
    pairingCode: challenge.code,
    ...(assignment !== undefined ? { assignment } : {}),
  });
  expect(approved.status, await approved.clone().text()).toBe(201);
  const activated = await poll(challenge.cookie, screenId);
  expect(activated.status, await activated.clone().text()).toBe(201);
  return { challenge, activated, cookie: `pkic_screen_session=${cookieValue(activated, "pkic_screen_session")}` };
}

const readAsScreen = (cookie: string, screenId = SCREEN) =>
  callApi(testEnv, `/api/v1/screens/${screenId}`, { headers: { cookie } }, { maxRoundTrips: 1 });

async function auditCount(action: string) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action=? AND entity_id=?")
    .bind(action, SCREEN)
    .first<{ total: number }>();
  return row!.total;
}

const assignment = { roomId: EVENT.roomId, output: "projector", layout: "lower-third" };

describe("event screen pairing", () => {
  beforeEach(seed);

  it("pairs a screen end to end and signs it in with a long-lived, read-only cookie", async () => {
    const challenge = await startPairing();
    expect(setCookie(challenge.response, "pkic_screen_pairing")).toMatch(
      new RegExp(
        `Path=/api/v1/screens/${SCREEN}; HttpOnly; SameSite=Strict; Max-Age=${SCREEN_POLICY.pairingMinutes * 60}; Secure`,
      ),
    );
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM screens").first("n")).toBe(0);

    const waiting = await poll(challenge.cookie);
    expect(waiting.status).toBe(202);
    expect(screenSessionPollResponseSchema.parse(await waiting.json()).status).toBe("pending");

    const spaced = `${challenge.code.slice(0, 4).toLowerCase()}-${challenge.code.slice(4)}`;
    const approved = await approve("manager", { pairingCode: spaced, assignment });
    expect(approved.status, await approved.clone().text()).toBe(201);
    const record = screenRecordSchema.parse(await approved.json());
    expect(record).toMatchObject({ id: SCREEN, name: "Foyer", eventId: EVENT.id, session: { state: "pending" } });
    expect(record.assignment).toMatchObject({ roomId: EVENT.roomId, roomName: "Main hall", output: "projector" });
    expect(await auditCount("screen.paired")).toBe(1);

    const activated = await poll(challenge.cookie);
    expect(activated.status).toBe(201);
    expect(setCookie(activated, "pkic_screen_session")).toMatch(
      new RegExp(`Path=/api/v1/screens; HttpOnly; SameSite=Lax; Max-Age=${SCREEN_SESSION_MAX_AGE_SECONDS}; Secure`),
    );
    expect(setCookie(activated, "pkic_screen_pairing")).toContain("Max-Age=0");
    expect(SCREEN_SESSION_MAX_AGE_SECONDS).toBe(34_560_000);

    const own = await readAsScreen(`pkic_screen_session=${cookieValue(activated, "pkic_screen_session")}`);
    expect(own.status, await own.clone().text()).toBe(200);
    expect(own.headers.get("cache-control")).toContain("no-store");
    const view = screenReadResponseSchema.parse(await own.json()) as ScreenOwnView;
    expect(view.viewer).toBe("screen");
    expect(view.screen.assignment).toEqual({
      eventSlug: EVENT.slug,
      roomId: EVENT.roomId,
      roomName: "Main hall",
      output: "projector",
      layout: "lower-third",
    });
    expect(Math.abs(Date.parse(view.serverNow) - Date.now())).toBeLessThan(60_000);
    const claims = await verifyLiveOverlayToken(SECRET, view.overlay!.token, {
      eventId: EVENT.id,
      roomId: EVENT.roomId,
    });
    expect(claims).toMatchObject({ scr: SCREEN, iss: users.manager });
    expect(Date.parse(view.overlay!.expiresAt) - Date.now()).toBeLessThanOrEqual(
      SCREEN_POLICY.overlayAccessMinutes * 60_000,
    );
  });

  it("keeps waiting for a wrong code and leaves the current sign-in untouched", async () => {
    const first = await pair();
    const challenge = await startPairing();
    const approved = await approve("manager", { pairingCode: challenge.code === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA" });
    expect(approved.status).toBe(201);
    expect((await poll(challenge.cookie)).status).toBe(202);
    expect((await readAsScreen(first.cookie)).status).toBe(200);
  });

  it("shows staff an approval the screen never collected once its window passed", async () => {
    const challenge = await startPairing();
    const wrong = challenge.code === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA";
    expect((await approve("manager", { pairingCode: wrong })).status).toBe(201);
    await env.DB.prepare("UPDATE screen_sessions SET expires_at=? WHERE screen_id=? AND activated_at IS NULL")
      .bind(new Date(Date.now() - 1000).toISOString(), SCREEN)
      .run();
    const list = await callApi(testEnv, `/api/v1/events/${EVENT.slug}/screens`, { headers: staff("manager") });
    const [listed] = eventScreensListSchema.parse(await list.json()).screens;
    expect(screenConnectionDisplay(screenConnection(listed!.session, Date.now()))).toEqual({
      label: "Code not used",
      tone: "warn",
    });
  });

  it("refuses an expired challenge and replays of a used one", async () => {
    const expired = await signJwt(SECRET, {
      typ: "screen-pairing",
      sub: SCREEN,
      nonce: "expired-nonce",
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const gone = await callApi(
      testEnv,
      `/api/v1/screens/${SCREEN}/session`,
      { method: "POST", headers: { cookie: `pkic_screen_pairing=${expired}` } },
      { maxRoundTrips: 0 },
    );
    expect(gone.status).toBe(410);
    expect(((await gone.json()) as { error: { code: string } }).error.code).toBe("SCREEN_PAIRING_EXPIRED");

    const { challenge } = await pair();
    const replay = await poll(challenge.cookie);
    expect(replay.status).toBe(410);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe("SCREEN_PAIRING_USED");
    const active = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM screen_sessions WHERE screen_id=? AND activated_at IS NOT NULL AND revoked_at IS NULL",
    )
      .bind(SCREEN)
      .first("n");
    expect(active).toBe(1);

    const otherScreen = await poll(challenge.cookie, "XYZ567");
    expect(otherScreen.status).toBe(401);
  });

  it("revokes older sign-ins when a screen pairs again", async () => {
    const first = await pair();
    const second = await pair();
    expect((await readAsScreen(second.cookie)).status).toBe(200);
    const old = await readAsScreen(first.cookie);
    expect(old.status).toBe(401);
    expect(((await old.json()) as { error: { code: string } }).error.code).toBe("SCREEN_SESSION_REVOKED");
  });

  it("tells a screen without a sign-in to pair", async () => {
    const response = await callApi(testEnv, `/api/v1/screens/${SCREEN}`, {}, { maxRoundTrips: 0 });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("SCREEN_SESSION_MISSING");
  });
});

describe("a paired screen", () => {
  beforeEach(seed);

  it("receives overlay access only while assigned", async () => {
    const { cookie } = await pair();
    const view = screenReadResponseSchema.parse(await (await readAsScreen(cookie)).json()) as ScreenOwnView;
    expect(view.screen.assignment).toBeNull();
    expect(view.overlay).toBeNull();
  });

  it("receives its room's published agenda around now, and only when its copy is out of date", async () => {
    const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
    const session = (id: string, from: number, to: number, extra: Record<string, unknown> = {}) => ({
      id,
      title: `Session ${id}`,
      startAt: at(from),
      endAt: at(to),
      roomId: EVENT.roomId,
      visibility: "public",
      kind: "session",
      ...extra,
    });
    const otherRoom = crypto.randomUUID();
    const snapshot = {
      timeZone: "Europe/Amsterdam",
      occurrences: [
        session("later", 3, 4),
        session("now", -1, 1),
        session("plenary", 5, 6, { roomId: null, kind: "plenary" }),
        session("shared", 7, 8, { roomId: otherRoom, additionalRoomIds: [EVENT.roomId] }),
        session("elsewhere", 2, 3, { roomId: otherRoom }),
        session("private", 2, 3, { visibility: "private" }),
        session("placeholder", 2, 3, { placeholder: true }),
        session("ended", -20, -14),
        session("next-week", 24 * 7, 24 * 7 + 1),
      ],
    };
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,3,3,?)",
    )
      .bind(EVENT.id, at(0))
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,3,?,?,?)",
    )
      .bind(crypto.randomUUID(), EVENT.id, JSON.stringify(snapshot), users.manager, at(0))
      .run();
    // The other event's agenda never reaches this screen.
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,1,1,?)",
    )
      .bind(OTHER_EVENT.id, at(0))
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        OTHER_EVENT.id,
        JSON.stringify({ ...snapshot, occurrences: [session("foreign", 1, 2, { roomId: OTHER_EVENT.roomId })] }),
        users.manager,
        at(0),
      )
      .run();

    const { cookie } = await pair(assignment);
    const view = screenReadResponseSchema.parse(await (await readAsScreen(cookie)).json()) as ScreenOwnView;
    expect(view.agenda?.revision).toBe(3);
    expect(view.agenda?.timeZone).toBe("Europe/Amsterdam");
    expect(view.agenda?.sessions?.map((entry) => entry.id)).toEqual(["now", "later", "plenary", "shared"]);

    const current = await callApi(
      testEnv,
      `/api/v1/screens/${SCREEN}?agendaRevision=3`,
      { headers: { cookie } },
      { maxRoundTrips: 1 },
    );
    const unchanged = screenReadResponseSchema.parse(await current.json()) as ScreenOwnView;
    expect(unchanged.agenda).toMatchObject({ revision: 3, sessions: null });
    const stale = await callApi(
      testEnv,
      `/api/v1/screens/${SCREEN}?agendaRevision=2`,
      { headers: { cookie } },
      { maxRoundTrips: 1 },
    );
    expect((screenReadResponseSchema.parse(await stale.json()) as ScreenOwnView).agenda?.sessions).toHaveLength(4);

    const unassigned = await callApi(testEnv, `/api/v1/screens/${SCREEN}`, {
      method: "PATCH",
      headers: staff("manager"),
      body: JSON.stringify({ expectedRevision: 0, assignment: null }),
    });
    expect(unassigned.status, await unassigned.clone().text()).toBe(200);
    expect(
      (screenReadResponseSchema.parse(await (await readAsScreen(cookie)).json()) as ScreenOwnView).agenda,
    ).toBeNull();
  });

  it("renews its sign-in only once the last renewal is a day old", async () => {
    const { cookie } = await pair();
    expect(setCookie(await readAsScreen(cookie), "pkic_screen_session")).toBeUndefined();
    const aged = new Date(Date.now() + (SCREEN_POLICY.sessionDays * 24 - 25) * 3_600_000).toISOString();
    await env.DB.prepare("UPDATE screen_sessions SET expires_at=? WHERE screen_id=? AND revoked_at IS NULL")
      .bind(aged, SCREEN)
      .run();
    const renewed = await readAsScreen(cookie);
    expect(setCookie(renewed, "pkic_screen_session")).toContain(`Max-Age=${SCREEN_SESSION_MAX_AGE_SECONDS}`);
    const row = await env.DB.prepare("SELECT expires_at FROM screen_sessions WHERE screen_id=? AND revoked_at IS NULL")
      .bind(SCREEN)
      .first<{ expires_at: string }>();
    expect(row!.expires_at > aged).toBe(true);
  });

  it("is signed out once staff revoke it, and its cookie never passes a staff guard", async () => {
    const { cookie } = await pair(assignment);
    for (const [method, path] of [
      ["PATCH", `/api/v1/screens/${SCREEN}`],
      ["DELETE", `/api/v1/screens/${SCREEN}/session`],
      ["GET", `/api/v1/events/${EVENT.slug}/screens`],
    ] as const) {
      const refused = await callApi(testEnv, path, {
        method,
        headers: { cookie, origin: "https://app.test", "content-type": "application/json" },
        ...(method === "PATCH" ? { body: JSON.stringify({ expectedRevision: 0, name: "Hijacked" }) } : {}),
      });
      expect(refused.status, `${method} ${path}`).toBe(401);
    }

    const revoked = await callApi(
      testEnv,
      `/api/v1/screens/${SCREEN}/session`,
      { method: "DELETE", headers: staff("manager") },
      { maxRoundTrips: 2 },
    );
    expect(revoked.status).toBe(204);
    expect(await auditCount("screen.sessions_revoked")).toBe(1);
    const refused = await readAsScreen(cookie);
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("SCREEN_SESSION_REVOKED");
    await callApi(testEnv, `/api/v1/screens/${SCREEN}/session`, { method: "DELETE", headers: staff("manager") });
    expect(await auditCount("screen.sessions_revoked")).toBe(1);
  });
});

describe("screen staff permissions", () => {
  beforeEach(seed);

  const patch = (person: Staff, body: Record<string, unknown>) =>
    callApi(
      testEnv,
      `/api/v1/screens/${SCREEN}`,
      { method: "PATCH", headers: staff(person), body: JSON.stringify(body) },
      { maxRoundTrips: 2 },
    );

  it("refuses staff without the permission", async () => {
    await pair();
    const challenge = await startPairing();
    expect((await approve("reader", { pairingCode: challenge.code })).status).toBe(403);
    expect((await patch("reader", { expectedRevision: 0, name: "Moved" })).status).toBe(403);
    expect(
      (await callApi(testEnv, `/api/v1/screens/${SCREEN}/session`, { method: "DELETE", headers: staff("reader") }))
        .status,
    ).toBe(403);
    expect((await callApi(testEnv, `/api/v1/screens/${SCREEN}`, { headers: staff("reader") })).status).toBe(403);
    expect((await callApi(testEnv, `/api/v1/events/${EVENT.slug}/screens`, { headers: staff("reader") })).status).toBe(
      403,
    );
  });

  it("lets a room operator read status but not pair, change or revoke", async () => {
    await pair(assignment);
    const read = await callApi(
      testEnv,
      `/api/v1/screens/${SCREEN}`,
      { headers: staff("moderator") },
      { maxRoundTrips: 1 },
    );
    expect(read.status).toBe(200);
    const body = screenReadResponseSchema.parse(await read.json());
    expect(body.viewer).toBe("staff");
    expect(JSON.stringify(body)).not.toContain("token");

    const challenge = await startPairing();
    expect((await approve("moderator", { pairingCode: challenge.code })).status).toBe(403);
    expect((await patch("moderator", { expectedRevision: 0, name: "Moved" })).status).toBe(403);
    expect(
      (await callApi(testEnv, `/api/v1/screens/${SCREEN}/session`, { method: "DELETE", headers: staff("moderator") }))
        .status,
    ).toBe(403);
  });

  it("does not let a screen manager steer the program", async () => {
    const response = await callApi(testEnv, `/api/v1/events/${EVENT.slug}/agenda/rooms/${EVENT.roomId}/live/program`, {
      method: "POST",
      headers: staff("manager"),
      body: JSON.stringify({ occurrenceId: null, expectedRevision: 0 }),
    });
    expect(response.status).toBe(403);
  });

  it("lets a screen manager list room names to assign, and nothing else of the agenda", async () => {
    await env.DB.prepare("UPDATE event_agenda_rooms SET virtual_room_url='https://meet.example.test/hall' WHERE id=?")
      .bind(EVENT.roomId)
      .run();
    const rooms = await callApi(testEnv, `/api/v1/events/${EVENT.slug}/agenda/rooms`, { headers: staff("manager") });
    expect(rooms.status, await rooms.clone().text()).toBe(200);
    const listed = agendaRoomsListSchema.parse(await rooms.json()).rooms;
    expect(listed.map((room) => room.name)).toEqual(["Main hall"]);
    expect(listed[0]).not.toHaveProperty("virtualRoomUrl");
    const readerRooms = await callApi(testEnv, `/api/v1/events/${EVENT.slug}/agenda/rooms`, {
      headers: staff("reader"),
    });
    expect(agendaRoomsListSchema.parse(await readerRooms.json()).rooms[0]?.virtualRoomUrl).toBe(
      "https://meet.example.test/hall",
    );

    const elsewhere = await callApi(testEnv, `/api/v1/events/${OTHER_EVENT.slug}/agenda/rooms`, {
      headers: staff("manager"),
    });
    expect(elsewhere.status).toBe(403);
    expect((await callApi(testEnv, `/api/v1/events/${EVENT.slug}/agenda`, { headers: staff("manager") })).status).toBe(
      403,
    );
    const rename = await callApi(testEnv, `/api/v1/events/${EVENT.slug}/agenda/rooms/${EVENT.roomId}`, {
      method: "PUT",
      headers: staff("manager"),
      body: JSON.stringify(agendaRoomCreateSchema.parse({ name: "Renamed", capacity: null, expectedRevision: 0 })),
    });
    expect(rename.status, await rename.clone().text()).toBe(403);
    expect(
      await env.DB.prepare("SELECT name FROM event_agenda_rooms WHERE id=?").bind(EVENT.roomId).first("name"),
    ).toBe("Main hall");
  });

  it("renames and reassigns from the current revision only", async () => {
    await pair();
    const renamed = await patch("manager", { expectedRevision: 0, name: "Foyer, by registration", assignment });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(screenRecordSchema.parse(await renamed.json())).toMatchObject({
      name: "Foyer, by registration",
      revision: 1,
      assignment: { roomId: EVENT.roomId, output: "projector" },
    });
    const stale = await patch("manager", { expectedRevision: 0, name: "Stale" });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("SCREEN_REVISION_CONFLICT");
    expect(await auditCount("screen.updated")).toBe(1);

    const otherRoom = await patch("manager", {
      expectedRevision: 1,
      assignment: { roomId: OTHER_EVENT.roomId, output: "program" },
    });
    expect(otherRoom.status).toBe(422);
    expect(
      apiValidationErrorDetailsSchema.parse(((await otherRoom.json()) as { error: { details: unknown } }).error.details)
        .fieldErrors,
    ).toHaveProperty(["assignment.roomId"]);
    const livestreamLayout = await patch("manager", {
      expectedRevision: 1,
      assignment: { roomId: EVENT.roomId, output: "livestream", layout: "lower-third" },
    });
    expect(livestreamLayout.status).toBe(400);
  });

  it("rolls back a revision change that lands between the read and the write", async () => {
    await pair();
    // A concurrent rename commits after this request's snapshot; the guarded update then changes nothing.
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE screens SET name="),
      () => env.DB.prepare("UPDATE screens SET revision=revision+1 WHERE id=?").bind(SCREEN).run(),
    );
    const response = await callApi({ ...testEnv, DB: db } as Env, `/api/v1/screens/${SCREEN}`, {
      method: "PATCH",
      headers: staff("manager"),
      body: JSON.stringify({ expectedRevision: 0, name: "Lost" }),
    });
    expect(response.status).toBe(409);
    expect(await env.DB.prepare("SELECT name FROM screens WHERE id=?").bind(SCREEN).first("name")).toBe("Foyer");
    expect(await auditCount("screen.updated")).toBe(0);
  });

  it("lists only the event's own screens", async () => {
    await pair(assignment);
    await env.DB.prepare(
      "INSERT INTO screens(id,name,event_id,revision,created_by,created_at) VALUES ('QRS567','Elsewhere',?,0,?,?)",
    )
      .bind(OTHER_EVENT.id, users.otherManager, new Date().toISOString())
      .run();
    const list = await callApi(
      testEnv,
      `/api/v1/events/${EVENT.slug}/screens?sort=name`,
      { headers: staff("moderator") },
      { maxRoundTrips: 1 },
    );
    expect(list.status, await list.clone().text()).toBe(200);
    const page = eventScreensListSchema.parse(await list.json());
    expect(page.screens.map((screen) => screen.id)).toEqual([SCREEN]);
    expect(page.screens[0].session.state).toBe("active");
    expect(page.page.total).toBe(1);
    expect(
      (await callApi(testEnv, `/api/v1/events/${EVENT.slug}/screens`, { headers: staff("otherManager") })).status,
    ).toBe(403);
    expect((await callApi(testEnv, `/api/v1/screens/QRS567`, { headers: staff("manager") })).status).toBe(403);
    const searched = eventScreensListSchema.parse(
      await (
        await callApi(testEnv, `/api/v1/events/${EVENT.slug}/screens?q=nothing`, { headers: staff("manager") })
      ).json(),
    );
    expect(searched.screens).toEqual([]);
  });
});

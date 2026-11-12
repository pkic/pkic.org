import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { dateTimeLocalToIso, instantToCalendarDate } from "../assets/shared/timezone";
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
async function pair(assignment?: unknown, screenId = SCREEN, extra: Record<string, unknown> = {}) {
  const challenge = await startPairing(screenId);
  const approved = await approve("manager", {
    screenId,
    pairingCode: challenge.code,
    ...(assignment !== undefined ? { assignment } : {}),
    ...extra,
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
    const approved = await approve("manager", {
      pairingCode: challenge.code === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA",
      replace: true,
    });
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

  it("refuses to pair over a signed-in screen until staff confirm, then revokes its older sign-ins", async () => {
    const first = await pair();
    // Another screen, a mistyped ID or a browser's colliding one, would sign the first out.
    const refused = await approve("manager", { pairingCode: (await startPairing()).code });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe("SCREEN_ID_IN_USE");
    expect(apiValidationErrorDetailsSchema.parse(body.error.details).fieldErrors?.screenId?.[0]).toContain("Foyer");
    expect((await readAsScreen(first.cookie)).status).toBe(200);

    const second = await pair(undefined, SCREEN, { replace: true });
    expect((await readAsScreen(second.cookie)).status).toBe(200);
    const old = await readAsScreen(first.cookie);
    expect(old.status).toBe(401);
    expect(((await old.json()) as { error: { code: string } }).error.code).toBe("SCREEN_SESSION_REVOKED");
  });

  it("refuses a pairing over a sign-in that lands between the read and the write, and rolls it back", async () => {
    const first = await startPairing();
    expect((await approve("manager", { pairingCode: first.code })).status).toBe(201);
    // The first approval is collected while the second one is being written.
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("INSERT INTO screens("),
      () =>
        env.DB.prepare(
          "UPDATE screen_sessions SET activated_at=?,expires_at=? WHERE screen_id=? AND activated_at IS NULL",
        )
          .bind(new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString(), SCREEN)
          .run(),
    );
    const second = await startPairing();
    const refused = await callApi({ ...testEnv, DB: db } as Env, `/api/v1/events/${EVENT.slug}/screens`, {
      method: "POST",
      headers: staff("manager"),
      body: JSON.stringify({ screenId: SCREEN, name: "Foyer", pairingCode: second.code }),
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("SCREEN_ID_IN_USE");
    expect(await auditCount("screen.paired")).toBe(1);
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS total FROM screen_sessions WHERE screen_id=?")
      .bind(SCREEN)
      .first<number>("total");
    expect(sessions).toBe(1);
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

  it("receives its own room's stream for the event's day, only while assigned the livestream", async () => {
    const zone = "Europe/Amsterdam";
    const firstDay = instantToCalendarDate(new Date(Date.now() + 2 * 86_400_000), zone);
    const secondDay = instantToCalendarDate(new Date(Date.now() + 3 * 86_400_000), zone);
    const sideRoom = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name) VALUES (?,?,'Side room')")
      .bind(sideRoom, EVENT.id)
      .run();
    const stream = (eventId: string, roomId: string, dayDate: string | null, videoId: string) =>
      env.DB.prepare(
        "INSERT INTO event_agenda_room_streams(id,event_id,room_id,day_date,provider,stream_ref,updated_by,updated_at) VALUES(?,?,?,?,'youtube',?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, roomId, dayDate, videoId, users.manager, new Date().toISOString())
        .run();
    await stream(EVENT.id, EVENT.roomId, null, "usualStream");
    await stream(EVENT.id, EVENT.roomId, secondDay, "secondDayVd");
    await stream(EVENT.id, sideRoom, null, "sideRoomVid");
    await stream(OTHER_EVENT.id, OTHER_EVENT.roomId, null, "foreignVide");

    const { cookie } = await pair({ roomId: EVENT.roomId, output: "livestream", layout: null });
    const readAt = async (localTime: string) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(dateTimeLocalToIso(localTime, zone)));
        return (screenReadResponseSchema.parse(await (await readAsScreen(cookie)).json()) as ScreenOwnView).livestream;
      } finally {
        vi.useRealTimers();
      }
    };
    expect(await readAt(`${firstDay}T23:30`)).toEqual({ provider: "youtube", videoId: "usualStream" });
    // Half past midnight in the event's zone is still the first day in UTC; the event's day decides.
    expect(await readAt(`${secondDay}T00:30`)).toEqual({ provider: "youtube", videoId: "secondDayVd" });

    const reassigned = await callApi(
      testEnv,
      `/api/v1/screens/${SCREEN}`,
      { method: "PATCH", headers: staff("manager"), body: JSON.stringify({ expectedRevision: 0, assignment }) },
      { maxRoundTrips: 2 },
    );
    expect(reassigned.status, await reassigned.clone().text()).toBe(200);
    expect(await readAt(`${secondDay}T00:30`)).toBeNull();
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

  it("moves a screen from another event only for someone who manages that event too", async () => {
    const { cookie } = await pair(assignment);
    // Anyone can show a code for a known screen ID; a manager of another event approves it there
    const challenge = await startPairing();
    const refused = await approve("otherManager", { pairingCode: challenge.code }, OTHER_EVENT.slug);
    expect(refused.status, await refused.clone().text()).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "SCREEN_BELONGS_TO_ANOTHER_EVENT" } });
    expect((await poll(challenge.cookie)).status).toBe(202);
    expect((await readAsScreen(cookie)).status).toBe(200);
    const row = await env.DB.prepare("SELECT event_id FROM screens WHERE id=?")
      .bind(SCREEN)
      .first<{ event_id: string }>();
    expect(row?.event_id).toBe(EVENT.id);

    await env.DB.prepare(
      "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,'agenda:screens_manage','event',?,?)",
    )
      .bind(crypto.randomUUID(), users.otherManager, EVENT.id, new Date().toISOString())
      .run();
    const moved = await approve("otherManager", { pairingCode: challenge.code, replace: true }, OTHER_EVENT.slug);
    expect(moved.status, await moved.clone().text()).toBe(201);
    expect((await poll(challenge.cookie)).status).toBe(201);
    expect((await readAsScreen(cookie)).status).toBe(401);
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

  it("lists only the screens asked for by ID, in one D1 call, and refuses a malformed list", async () => {
    await pair(assignment);
    for (const [id, name] of [
      ["GHJ234", "Second"],
      ["DEF567", "Third"],
    ])
      await env.DB.prepare("INSERT INTO screens(id,name,event_id,revision,created_by,created_at) VALUES (?,?,?,0,?,?)")
        .bind(id, name, EVENT.id, users.manager, new Date().toISOString())
        .run();
    const list = await callApi(
      testEnv,
      `/api/v1/events/${EVENT.slug}/screens?sort=name&screenIds=DEF567,${SCREEN},QRS567`,
      { headers: staff("moderator") },
      { maxRoundTrips: 1 },
    );
    expect(list.status, await list.clone().text()).toBe(200);
    const page = eventScreensListSchema.parse(await list.json());
    expect(page.screens.map((screen) => screen.id).sort()).toEqual(["DEF567", SCREEN].sort());
    expect(page.page.total).toBe(2);
    const malformed = await callApi(testEnv, `/api/v1/events/${EVENT.slug}/screens?screenIds=not-an-id`, {
      headers: staff("moderator"),
    });
    expect(malformed.status).toBe(400);
  });
});

describe("replacing a screen's device", () => {
  beforeEach(seed);

  const NEW_SCREEN = "NEW234";
  const replace = (person: Staff, body: Record<string, unknown>, roundTrips = 2) =>
    callApi(
      testEnv,
      `/api/v1/screens/${SCREEN}/device`,
      { method: "PUT", headers: staff(person), body: JSON.stringify({ expectedRevision: 0, ...body }) },
      { maxRoundTrips: roundTrips },
    );
  const remove = (person: Staff, screenId = SCREEN) =>
    callApi(testEnv, `/api/v1/screens/${screenId}`, { method: "DELETE", headers: staff(person) }, { maxRoundTrips: 2 });
  const audits = async (action: string, screenId: string) =>
    (await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action=? AND entity_id=?")
      .bind(action, screenId)
      .first<number>("total"))!;
  const rows = async (table: "screens" | "screen_sessions", screenId: string) =>
    (await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${table === "screens" ? "id" : "screen_id"}=?`)
      .bind(screenId)
      .first<number>("total"))!;
  async function addScreen(id: string, name: string, eventId = EVENT.id) {
    await env.DB.prepare("INSERT INTO screens(id,name,event_id,revision,created_by,created_at) VALUES (?,?,?,0,?,?)")
      .bind(id, name, eventId, users.manager, new Date().toISOString())
      .run();
  }

  it("moves the name and assignment to the new device, signs the old one out and records both", async () => {
    const old = await pair(assignment);
    const challenge = await startPairing(NEW_SCREEN);
    const replaced = await replace("manager", { newScreenId: NEW_SCREEN.toLowerCase(), pairingCode: challenge.code });
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    expect(screenRecordSchema.parse(await replaced.json())).toMatchObject({
      id: NEW_SCREEN,
      name: "Foyer",
      eventId: EVENT.id,
      assignment: { roomId: EVENT.roomId, output: "projector", layout: "lower-third" },
      revision: 1,
      session: { state: "pending" },
    });
    const signedOut = await readAsScreen(old.cookie);
    expect(signedOut.status).toBe(401);
    expect(((await signedOut.json()) as { error: { code: string } }).error.code).toBe("SCREEN_SESSION_MISSING");
    expect([await rows("screens", SCREEN), await rows("screen_sessions", SCREEN)]).toEqual([0, 0]);
    expect([await audits("screen.replaced", SCREEN), await audits("screen.paired", NEW_SCREEN)]).toEqual([1, 1]);

    const activated = await poll(challenge.cookie, NEW_SCREEN);
    expect(activated.status, await activated.clone().text()).toBe(201);
    const shown = await readAsScreen(
      `pkic_screen_session=${cookieValue(activated, "pkic_screen_session")}`,
      NEW_SCREEN,
    );
    expect(shown.status).toBe(200);
    expect(((await shown.json()) as ScreenOwnView).screen).toMatchObject({
      id: NEW_SCREEN,
      name: "Foyer",
      assignment: { roomId: EVENT.roomId, output: "projector" },
    });
  });

  it("refuses a stale revision, the screen's own ID and an ID another screen has, changing nothing", async () => {
    const old = await pair(assignment);
    const { code } = await startPairing(NEW_SCREEN);
    const stale = await replace("manager", { expectedRevision: 3, newScreenId: NEW_SCREEN, pairingCode: code });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("SCREEN_REVISION_CONFLICT");
    const fieldError = async (response: Response) =>
      apiValidationErrorDetailsSchema.parse(((await response.json()) as { error: { details: unknown } }).error.details)
        .fieldErrors?.newScreenId?.[0];
    const same = await replace("manager", { newScreenId: SCREEN, pairingCode: code }, 0);
    expect(same.status).toBe(422);
    expect(await fieldError(same)).toBeTruthy();

    await addScreen("QRS567", "Spare by the door");
    const takenHere = await replace("manager", { newScreenId: "QRS567", pairingCode: code });
    expect(takenHere.status).toBe(409);
    expect(await fieldError(takenHere)).toContain("Spare by the door");
    await addScreen("DEF567", "Elsewhere", OTHER_EVENT.id);
    const takenElsewhere = await replace("manager", { newScreenId: "DEF567", pairingCode: code });
    expect(takenElsewhere.status).toBe(409);
    expect(await fieldError(takenElsewhere)).not.toContain("Elsewhere");

    expect((await replace("moderator", { newScreenId: NEW_SCREEN, pairingCode: code })).status).toBe(403);
    expect((await readAsScreen(old.cookie)).status).toBe(200);
    expect(await rows("screens", NEW_SCREEN)).toBe(0);
    expect(await audits("screen.replaced", SCREEN)).toBe(0);
  });

  it("rolls back when the screen changes between the read and the write", async () => {
    const old = await pair(assignment);
    const { code } = await startPairing(NEW_SCREEN);
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("SELECT ?,name,event_id"),
      () => env.DB.prepare("UPDATE screens SET revision=revision+1 WHERE id=?").bind(SCREEN).run(),
    );
    const response = await callApi({ ...testEnv, DB: db } as Env, `/api/v1/screens/${SCREEN}/device`, {
      method: "PUT",
      headers: staff("manager"),
      body: JSON.stringify({ expectedRevision: 0, newScreenId: NEW_SCREEN, pairingCode: code }),
    });
    expect(response.status).toBe(409);
    expect((await readAsScreen(old.cookie)).status).toBe(200);
    expect([await rows("screens", NEW_SCREEN), await rows("screen_sessions", NEW_SCREEN)]).toEqual([0, 0]);
    expect([await audits("screen.paired", NEW_SCREEN), await audits("screen.replaced", SCREEN)]).toEqual([0, 0]);
  });

  it("removes a screen only once it is not signed in, with its approvals", async () => {
    await pair(assignment);
    const signedIn = await remove("manager");
    expect(signedIn.status).toBe(409);
    expect(((await signedIn.json()) as { error: { code: string } }).error.code).toBe("SCREEN_SIGNED_IN");
    expect(
      (await callApi(testEnv, `/api/v1/screens/${SCREEN}/session`, { method: "DELETE", headers: staff("manager") }))
        .status,
    ).toBe(204);
    expect((await remove("moderator")).status).toBe(403);
    expect((await remove("manager")).status).toBe(204);
    expect([await rows("screens", SCREEN), await rows("screen_sessions", SCREEN)]).toEqual([0, 0]);
    expect(await audits("screen.removed", SCREEN)).toBe(1);
    expect((await remove("manager")).status).toBe(404);

    // Approved but never collected: nothing ever signed in.
    expect(
      (await approve("manager", { screenId: NEW_SCREEN, pairingCode: (await startPairing(NEW_SCREEN)).code })).status,
    ).toBe(201);
    expect((await remove("manager", NEW_SCREEN)).status).toBe(204);
  });

  it("removes nothing when the screen moved or changed after the read", async () => {
    await pair();
    await callApi(testEnv, `/api/v1/screens/${SCREEN}/session`, { method: "DELETE", headers: staff("manager") });
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("DELETE FROM screens"),
      () =>
        env.DB.prepare("UPDATE screens SET event_id=?,revision=revision+1 WHERE id=?")
          .bind(OTHER_EVENT.id, SCREEN)
          .run(),
    );
    const response = await callApi({ ...testEnv, DB: db } as Env, `/api/v1/screens/${SCREEN}`, {
      method: "DELETE",
      headers: staff("manager"),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("SCREEN_REVISION_CONFLICT");
    expect([await rows("screens", SCREEN), await audits("screen.removed", SCREEN)]).toEqual([1, 0]);
  });
});

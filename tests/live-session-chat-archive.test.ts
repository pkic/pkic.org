import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LIVE_CHAT_ARCHIVE_MAX_CHATS,
  liveChatEraseResponseSchema,
} from "../assets/shared/schemas/event-live-chat-archive";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
const DAY = 24 * 60 * 60 * 1000;
// Due later than the test runs it by hand, so workerd never fires the same alarm on its own as well.
const MINUTE = 60 * 1000;

/** A location's chat with one shown and one hidden attendee message and operator chat, copied to D1. */
async function chatInRoom() {
  const attendee = await f.connectChat("attendee");
  const operator = await f.connectChat("operator");
  attendee.send({ type: "chat.send", text: "Hello, everyone" });
  await attendee.next("chat.message", (message) => message.message.text === "Hello, everyone");
  attendee.send({ type: "chat.send", text: "Buy cheap tokens" });
  const spam = await operator.next("chat.message", (message) => message.message.text === "Buy cheap tokens");
  operator.send({ type: "chat.moderate", messageId: spam.message.id, decision: "remove", reason: "spam" });
  await operator.next(
    "chat.message",
    (message) => message.message.id === spam.message.id && message.message.moderation?.hidden != null,
  );
  operator.send({ type: "chat.send", text: "Staff only", channel: "operator" });
  await operator.next("chat.message", (message) => message.message.text === "Staff only");
  expect(await runDurableObjectAlarm(f.chatRoom())).toBe(true);
}

/** Moves the location's day into the past, as if its last session ended `daysAgo` days ago. */
async function sessionEnded(daysAgo: number) {
  const endAt = new Date(Date.now() - daysAgo * DAY).toISOString();
  const startAt = new Date(Date.parse(endAt) - 60 * 60 * 1000).toISOString();
  await runInDurableObject(f.chatRoom(), (_room, state) => {
    const { record_json } = state.storage.sql
      .exec<{ record_json: string }>("SELECT record_json FROM location_chat")
      .one();
    const record = JSON.parse(record_json) as { scope: { sessions: { startAt: string; endAt: string }[] } };
    record.scope.sessions = record.scope.sessions.map((session) => ({ ...session, startAt, endAt }));
    state.storage.sql.exec("UPDATE location_chat SET record_json = ?", JSON.stringify(record));
  });
  // The room caches its day; a fresh instance reads the moved one.
  await runInDurableObject(f.chatRoom(), (room, state) => {
    Reflect.get(Reflect.get(room as object, "location") as object, "erased").call(
      Reflect.get(room as object, "location"),
    );
    return state.storage.setAlarm(Date.now() + MINUTE);
  });
}

async function keepChatFor(days: number) {
  await env.DB.prepare("UPDATE events SET settings_json=json_set(settings_json,'$.liveChat.keepDays',?) WHERE id=?")
    .bind(days, f.eventId)
    .run();
}

function rowCount(table: string) {
  return runInDurableObject(
    f.chatRoom(),
    (_room, state) => state.storage.sql.exec(`SELECT COUNT(*) AS total FROM ${table}`).one().total,
  );
}

function holdsRoom() {
  return runInDurableObject(
    f.chatRoom(),
    (_room, state) =>
      state.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='location_chat'").toArray()
        .length > 0,
  );
}

function request(method: "GET" | "DELETE", token = f.tokens.operator) {
  return callApi(env, `/api/v1/events/${f.eventSlug}/agenda/chat${method === "GET" ? "/exports" : ""}`, {
    method,
    headers: { authorization: `Bearer ${token}`, origin: "https://app.test" },
  });
}

describe("live chat retention", () => {
  beforeEach(() => f.setup());

  it("lets organizers keep the chat for a week or 90 days, nothing else", async () => {
    const headers = { authorization: `Bearer ${f.tokens.operator}`, origin: "https://app.test" };
    const event = (await (await callApi(env, `/api/v1/events/${f.eventSlug}`, { headers })).json()) as {
      event: { updatedAt: string };
    };
    const save = (keepDays: number) =>
      callApi(env, `/api/v1/events/${f.eventSlug}/settings`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ liveChat: { keepDays }, expectedUpdatedAt: event.event.updatedAt }),
      });
    expect((await save(30)).status).toBe(400);
    expect((await save(90)).status).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT json_extract(settings_json,'$.liveChat.keepDays') AS keepDays FROM events WHERE id=?",
        [f.eventId],
      ),
    ).toEqual([{ keepDays: 90 }]);
  });

  it("erases the whole chat a week after the day's last session by default", async () => {
    await chatInRoom();
    await sessionEnded(8);
    await runDurableObjectAlarm(f.chatRoom());
    expect(await holdsRoom()).toBe(false);
    expect(
      await queryAll(env.DB, "SELECT messages,people FROM event_session_chat_totals WHERE occurrence_id=?", [
        f.occurrenceId,
      ]),
    ).toEqual([{ messages: 2, people: 1 }]);
  });

  it("keeps only the attendee chat after the week when the event keeps it for 90 days", async () => {
    await chatInRoom();
    await keepChatFor(90);
    await sessionEnded(8);
    await runDurableObjectAlarm(f.chatRoom());
    expect(await rowCount("room_chat")).toBe(2);
    expect(await rowCount("room_operator_chat")).toBe(0);
    const archive = await runInDurableObject(f.chatRoom(), (room) => room.chatArchive());
    expect(archive.map(({ author_name, body, status }) => ({ author_name, body, status }))).toEqual([
      { author_name: "Ada Attendee", body: "Hello, everyone", status: "shown" },
      { author_name: "Ada Attendee", body: "Buy cheap tokens", status: "hidden" },
    ]);
    // A shorter choice applies at the next daily check.
    await keepChatFor(7);
    await runInDurableObject(f.chatRoom(), (_room, state) => state.storage.setAlarm(Date.now() + MINUTE));
    await runDurableObjectAlarm(f.chatRoom());
    expect(await holdsRoom()).toBe(false);
  });

  it("goes entirely once the 90 days are over", async () => {
    await chatInRoom();
    await keepChatFor(90);
    await sessionEnded(91);
    await runDurableObjectAlarm(f.chatRoom());
    expect(await holdsRoom()).toBe(false);
  });
});

describe("event chat download and erasure", () => {
  beforeEach(() => f.setup());

  it("downloads every kept attendee message and erases closed chats only", async () => {
    await chatInRoom();
    const download = await request("GET");
    expect(download.status, await download.clone().text()).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("live-chat.csv");
    const lines = (await download.text()).split("\r\n");
    expect(lines[0]).toBe("Room,Day,Session,Sent (UTC),Edited (UTC),Author,Message,Status");
    // Each message is dated by the session on when it was sent; neither was edited.
    const dated = lines.slice(1).map((line) => {
      const [room, , session, , edited, ...rest] = line.split(",");
      return [room, session, edited, ...rest].join(",");
    });
    expect(dated).toEqual([
      'Physical room,Post-quantum migration,,Ada Attendee,"Hello, everyone",Shown',
      "Physical room,Post-quantum migration,,Ada Attendee,Buy cheap tokens,Hidden by a moderator",
    ]);
    expect(lines.join("\n")).not.toContain("Staff only");

    const open = await request("DELETE");
    expect(open.status).toBe(200);
    expect(liveChatEraseResponseSchema.parse(await open.json())).toEqual({ erasedChats: 0, openChats: 1 });
    expect(await rowCount("room_chat")).toBe(2);

    await sessionEnded(1);
    const erased = await request("DELETE");
    expect(liveChatEraseResponseSchema.parse(await erased.json())).toEqual({ erasedChats: 1, openChats: 0 });
    expect(await rowCount("room_chat")).toBe(0);
    expect(await rowCount("room_operator_chat")).toBe(0);
    expect((await (await request("GET")).text()).split("\r\n")).toHaveLength(1);
    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE scope_id=? AND action LIKE 'live_session.chat.%' AND entity_type='event' ORDER BY rowid",
      [f.eventId],
    );
    expect(audit.map((row) => row.action)).toEqual([
      "live_session.chat.exported",
      "live_session.chat.erase_requested",
      "live_session.chat.erased",
      "live_session.chat.erase_requested",
      "live_session.chat.erased",
      "live_session.chat.exported",
    ]);
  });

  it("refuses an event with more chats than one request covers, rather than skip any", async () => {
    const publication = await env.DB.prepare("SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?")
      .bind(f.eventId)
      .first<{ snapshot_json: string }>();
    const snapshot = JSON.parse(publication!.snapshot_json) as { occurrences: Record<string, unknown>[] };
    const [session] = snapshot.occurrences;
    // One session a day in the same room: each day is a chat of its own.
    snapshot.occurrences = Array.from({ length: LIVE_CHAT_ARCHIVE_MAX_CHATS + 1 }, (_, day) => {
      const startAt = new Date(Date.UTC(2027, 0, 1 + day, 9)).toISOString();
      return { ...session, id: crypto.randomUUID(), startAt, endAt: startAt.replace("T09", "T10") };
    });
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=?")
      .bind(JSON.stringify(snapshot), f.eventId)
      .run();
    for (const method of ["GET", "DELETE"] as const) {
      const response = await request(method);
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: "LIVE_CHAT_TOO_MANY_CHATS" } });
    }
  });

  it("is for the event's organizers: neither an attendee nor a room operator downloads or erases the chat", async () => {
    expect((await request("GET", f.tokens.attendee)).status).toBe(403);
    expect((await request("DELETE", f.tokens.attendee)).status).toBe(403);

    await chatInRoom();
    await sessionEnded(1);
    // The second operator keeps running rooms, without the event's settings.
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(now, f.users.secondOperator),
      env.DB.prepare(
        "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,granted_by_user_id,created_at) VALUES (?,?,'agenda:live_moderate','event',?,?,?)",
      ).bind(crypto.randomUUID(), f.users.secondOperator, f.eventId, f.users.operator, now),
    ]);
    const roomOperator = await createAdminSession(env.DB, f.users.secondOperator, crypto.randomUUID());
    expect((await request("GET", roomOperator)).status).toBe(403);
    expect((await request("DELETE", roomOperator)).status).toBe(403);
    expect(await rowCount("room_chat")).toBe(2);

    // An organizer holds the event's settings, and needs no room permission for the chat.
    await env.DB.prepare(
      "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,granted_by_user_id,created_at) VALUES (?,?,'events:write','event',?,?,?)",
    )
      .bind(crypto.randomUUID(), f.users.outsider, f.eventId, f.users.operator, now)
      .run();
    const organizer = await createAdminSession(env.DB, f.users.outsider, crypto.randomUUID());
    expect((await request("GET", organizer)).status).toBe(200);
    expect((await request("DELETE", organizer)).status).toBe(200);
    expect(await rowCount("room_chat")).toBe(0);
  });
});

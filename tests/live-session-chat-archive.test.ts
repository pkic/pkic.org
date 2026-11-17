import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { liveChatEraseResponseSchema } from "../assets/shared/schemas/event-live-chat-archive";
import { callApi } from "./helpers/app";
import { queryAll } from "./helpers/context";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
const DAY = 24 * 60 * 60 * 1000;
// Due later than the test runs it by hand, so workerd never fires the same alarm on its own as well.
const MINUTE = 60 * 1000;

/** A chat with one shown and one hidden attendee message, operator chat and a question, copied to D1. */
async function chatInRoom() {
  const attendee = await f.connect({ person: "attendee" });
  const operator = await f.connect({ person: "operator" });
  attendee.send({ type: "chat.send", text: "Hello, everyone" });
  await attendee.next("chat.message", (message) => message.message.text === "Hello, everyone");
  attendee.send({ type: "chat.send", text: "Buy cheap tokens" });
  const spam = await operator.next("chat.message", (message) => message.message.text === "Buy cheap tokens");
  operator.send({ type: "chat.moderate", messageId: spam.message.id, decision: "hide" });
  await attendee.next("chat.removed");
  operator.send({ type: "chat.send", text: "Staff only", channel: "operator" });
  await operator.next("chat.message", (message) => message.message.text === "Staff only");
  attendee.send({ type: "question.ask", text: "What comes next?", anonymous: false });
  await attendee.next("question.changed");
  expect(await runDurableObjectAlarm(f.room())).toBe(true);
}

/** Moves the room's session into the past, as if it ended `daysAgo` days ago. */
async function sessionEnded(daysAgo: number) {
  const endAt = new Date(Date.now() - daysAgo * DAY).toISOString();
  const startAt = new Date(Date.parse(endAt) - 60 * 60 * 1000).toISOString();
  await runInDurableObject(f.room(), (_room, state) => {
    state.storage.sql.exec(
      "UPDATE room_session SET session_json = json_set(session_json, '$.startAt', ?, '$.endAt', ?)",
      startAt,
      endAt,
    );
  });
  await runInDurableObject(f.room(), (_room, state) => state.storage.setAlarm(Date.now() + MINUTE));
}

async function keepChatFor(days: number) {
  await env.DB.prepare("UPDATE events SET settings_json=json_set(settings_json,'$.liveChat.keepDays',?) WHERE id=?")
    .bind(days, f.eventId)
    .run();
}

function rowCount(table: string) {
  return runInDurableObject(
    f.room(),
    (_room, state) => state.storage.sql.exec(`SELECT COUNT(*) AS total FROM ${table}`).one().total,
  );
}

function holdsRoom() {
  return runInDurableObject(
    f.room(),
    (_room, state) =>
      state.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='room_session'").toArray()
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

  it("erases the whole room a week after the session by default", async () => {
    await chatInRoom();
    await sessionEnded(8);
    await runDurableObjectAlarm(f.room());
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
    await runDurableObjectAlarm(f.room());
    expect(await rowCount("room_chat")).toBe(2);
    expect(await rowCount("room_operator_chat")).toBe(0);
    expect(await rowCount("questions")).toBe(0);
    const archive = await runInDurableObject(f.room(), (room) => room.chatArchive());
    expect(archive.map(({ author_name, body, status }) => ({ author_name, body, status }))).toEqual([
      { author_name: "Ada Attendee", body: "Hello, everyone", status: "shown" },
      { author_name: "Ada Attendee", body: "Buy cheap tokens", status: "hidden" },
    ]);
    // A shorter choice applies at the next daily check.
    await keepChatFor(7);
    await runInDurableObject(f.room(), (_room, state) => state.storage.setAlarm(Date.now() + MINUTE));
    await runDurableObjectAlarm(f.room());
    expect(await holdsRoom()).toBe(false);
  });

  it("goes entirely once the 90 days are over", async () => {
    await chatInRoom();
    await keepChatFor(90);
    await sessionEnded(91);
    await runDurableObjectAlarm(f.room());
    expect(await holdsRoom()).toBe(false);
  });
});

describe("event chat download and erasure", () => {
  beforeEach(() => f.setup());

  it("downloads every kept attendee message and erases closed rooms' chat only", async () => {
    await chatInRoom();
    const download = await request("GET");
    expect(download.status, await download.clone().text()).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("live-chat.csv");
    const lines = (await download.text()).split("\r\n");
    expect(lines[0]).toBe("Session,Session start (UTC),Sent (UTC),Author,Message,Status");
    expect(lines.slice(1).map((line) => line.split(",").slice(3).join(","))).toEqual([
      'Ada Attendee,"Hello, everyone",Shown',
      "Ada Attendee,Buy cheap tokens,Hidden by a moderator",
    ]);
    expect(lines.join("\n")).not.toContain("Staff only");

    const open = await request("DELETE");
    expect(open.status).toBe(200);
    expect(liveChatEraseResponseSchema.parse(await open.json())).toEqual({ erasedSessions: 0, openSessions: 1 });
    expect(await rowCount("room_chat")).toBe(2);

    await sessionEnded(1);
    const erased = await request("DELETE");
    expect(liveChatEraseResponseSchema.parse(await erased.json())).toEqual({ erasedSessions: 1, openSessions: 0 });
    expect(await rowCount("room_chat")).toBe(0);
    expect(await rowCount("room_operator_chat")).toBe(0);
    expect((await (await request("GET")).text()).split("\r\n")).toHaveLength(1);
    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE scope_id=? AND action LIKE 'live_session.chat.%ed' AND entity_type='event' ORDER BY created_at,action",
      [f.eventId],
    );
    expect(audit.map((row) => row.action)).toEqual([
      "live_session.chat.exported",
      "live_session.chat.erased",
      "live_session.chat.erased",
      "live_session.chat.exported",
    ]);
  });

  it("requires live moderation permission", async () => {
    expect((await request("GET", f.tokens.attendee)).status).toBe(403);
    expect((await request("DELETE", f.tokens.attendee)).status).toBe(403);
  });
});

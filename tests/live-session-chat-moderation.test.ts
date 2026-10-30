import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_CHAT_POLICY } from "../assets/shared/live-chat-policy";
import type { LiveRoomServerMessage } from "../assets/shared/schemas/live-session-room";
import { LiveRoomChat } from "../functions/_lib/services/live-session/room-chat";
import type { LiveRoomChatActions } from "../functions/_lib/services/live-session/room-chat-actions";
import { LiveRoomSql } from "../functions/_lib/services/live-session/room-sql";
import { createAdminSession } from "./helpers/auth";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;

async function say(author: Client, text: string, reader: Client = author) {
  author.send({ type: "chat.send", text });
  return (await reader.next("chat.message", (message) => message.message.text === text)).message;
}

/** Every chat payload a viewer received carried no moderation data. */
function expectNoModerationData(viewer: Client) {
  for (const message of viewer.received as LiveRoomServerMessage[]) {
    if (message.type === "chat.message") expect(message.message.moderation ?? null).toBeNull();
    if (message.type === "room.snapshot") {
      expect(message.chatReports ?? []).toEqual([]);
      for (const chat of message.chat) expect(chat.moderation ?? null).toBeNull();
    }
  }
}

/** Turns the second operator into a moderator who may run the room but not organize the event. */
async function demoteSecondOperator() {
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(now, f.users.secondOperator).run();
  await env.DB.prepare(
    `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, 'agenda:live_moderate', 'event', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), f.users.secondOperator, f.eventId, f.users.operator, now)
    .run();
  f.tokens.secondOperator = await createAdminSession(env.DB, f.users.secondOperator, crypto.randomUUID());
}

/** More registered attendees, connected one by one under the fixture's spare credential. */
async function extraAttendees(count: number): Promise<Client[]> {
  const clients: Client[] = [];
  const now = new Date().toISOString();
  for (let index = 0; index < count; index++) {
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id,email,normalized_email,first_name,last_name,active) VALUES (?,?,?,?,?,1)",
    )
      .bind(userId, `extra-${index}@example.test`, `extra-${index}@example.test`, `Extra${index}`, "Attendee")
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES (?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), f.eventId, userId, crypto.randomUUID(), now, now)
      .run();
    f.tokens.outsider = await createAdminSession(env.DB, userId, crypto.randomUUID());
    clients.push(await f.connect({ person: "outsider" }));
  }
  return clients;
}

/** The room's chat use cases, reached the way the sibling room tests reach its parts. */
function chatActions(instance: unknown): LiveRoomChatActions {
  return Reflect.get(instance as object, "chatActions");
}

/**
 * Holds the reaction window open, then flushes it once the room handled each person's
 * requests. A window that closes on its own timer would make batching depend on scheduling.
 */
async function inOneReactionWindow(handled: Record<string, number>, send: () => void) {
  await runInDurableObject(f.room(), (instance) => {
    Reflect.set(chatActions(instance), "reactionTimer", "held by the test");
  });
  send();
  await vi.waitFor(() =>
    runInDurableObject(f.room(), (instance) => {
      const allowances: Map<string, number[]> = Reflect.get(chatActions(instance), "allowances");
      for (const [userId, count] of Object.entries(handled))
        expect(allowances.get(`reaction:${userId}`)?.length ?? 0).toBe(count);
    }),
  );
  await runInDurableObject(f.room(), (instance) => chatActions(instance).flushReactions());
}

describe("live chat reactions, reports and moderation", () => {
  beforeEach(() => f.setup());

  it("counts one reaction of a kind per person and broadcasts counts together", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const message = await say(author, "Reactions please", reader);
    await inOneReactionWindow({ [f.users.secondAttendee]: 2, [f.users.attendee]: 1 }, () => {
      reader.send({ type: "chat.react", messageId: message.id, reaction: "thumbs_up", on: true });
      reader.send({ type: "chat.react", messageId: message.id, reaction: "thumbs_up", on: true });
      author.send({ type: "chat.react", messageId: message.id, reaction: "love", on: true });
    });
    const own = await reader.next("chat.reactions");
    expect(own).toMatchObject({ reactions: { thumbs_up: 1, love: 1 }, myReactions: ["thumbs_up"] });
    const shared = await author.next("chat.reactions");
    expect(shared).toMatchObject({ reactions: { thumbs_up: 1, love: 1 }, myReactions: ["love"] });
    // Three requests within the window arrive as one update per viewer.
    expect(reader.received.filter((update) => update.type === "chat.reactions")).toHaveLength(1);
    const joined = await f.connect({ person: "secondAttendee" });
    expect((await joined.next("room.snapshot")).chat[0]).toMatchObject({
      reactions: { thumbs_up: 1, love: 1 },
      myReactions: ["thumbs_up"],
    });
    const seen = author.received.length;
    reader.send({ type: "chat.react", messageId: message.id, reaction: "thumbs_up", on: false });
    expect((await author.next("chat.reactions", () => true, { after: seen })).reactions).toEqual({ love: 1 });
  });

  it("leaves a viewer's own reactions out of a later update only someone else changed", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const message = await say(author, "Separate windows", reader);
    reader.send({ type: "chat.react", messageId: message.id, reaction: "thumbs_up", on: true });
    expect((await reader.next("chat.reactions")).myReactions).toEqual(["thumbs_up"]);
    const seen = reader.received.length;
    author.send({ type: "chat.react", messageId: message.id, reaction: "love", on: true });
    // Null tells the reader their own reactions did not change; they keep the ones they had.
    expect(await reader.next("chat.reactions", () => true, { after: seen })).toMatchObject({
      reactions: { thumbs_up: 1, love: 1 },
      myReactions: null,
    });
  });

  it("limits reactions and reports per person", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const message = await say(author, "Rate limits", reader);
    for (let index = 0; index <= LIVE_CHAT_POLICY.reactionsPerPerson.limit; index++)
      reader.send({ type: "chat.react", messageId: message.id, reaction: "wow", on: index % 2 === 0 });
    expect((await reader.next("room.refused")).code).toBe("LIVE_CHAT_RATE_LIMITED");
    for (let index = 0; index <= LIVE_CHAT_POLICY.reportsPerPerson.limit; index++)
      author.send({ type: "chat.report", messageId: (await say(reader, `Report me ${index}`)).id, reason: "spam" });
    expect((await author.next("room.refused")).code).toBe("LIVE_CHAT_RATE_LIMITED");
  });

  it("sends reports to moderators only and holds a message reported by enough people", async () => {
    const author = await f.connect({ person: "attendee" });
    const reporter = await f.connect({ person: "secondAttendee" });
    const operator = await f.connect({ person: "operator" });
    const message = await say(author, "Buy cheap certificates at example.test", reporter);
    author.send({ type: "chat.report", messageId: message.id, reason: "spam" });
    expect((await author.next("room.refused")).code).toBe("LIVE_CHAT_NOT_ALLOWED");
    reporter.send({ type: "chat.report", messageId: message.id, reason: "spam" });
    const reported = await operator.next("chat.message", (update) => update.message.moderation?.reports === 1);
    expect(reported.message.moderation).toMatchObject({ reportReasons: { spam: 1 }, held: false, hidden: null });
    expect(
      (await reporter.next("chat.message", (update) => update.message.reportedByMe === true)).message.moderation,
    ).toBeNull();
    expect((await f.connect({ person: "operator" })).received[0]).toMatchObject({
      chatReports: [expect.objectContaining({ id: message.id })],
    });

    const crowd = await extraAttendees(LIVE_CHAT_POLICY.reportHoldThreshold - 1);
    for (const person of crowd) person.send({ type: "chat.report", messageId: message.id, reason: "spam" });
    await author.next("chat.removed", (update) => update.messageId === message.id);
    const held = await operator.next("chat.message", (update) => update.message.moderation?.held === true);
    expect(held.message.moderation?.hidden?.operatorName).toBe("Held after reports");
    const fresh = await f.connect({ person: "secondAttendee" });
    expect((fresh.received[0] as Extract<LiveRoomServerMessage, { type: "room.snapshot" }>).chat).toEqual([]);

    const beforeKeep = operator.received.length;
    operator.send({ type: "chat.moderate", messageId: message.id, decision: "keep" });
    await operator.next(
      "chat.message",
      (update) => update.message.id === message.id && update.message.moderation?.reports === 0,
      { after: beforeKeep },
    );
    // The author saw it held away, then back.
    await vi.waitFor(() =>
      expect(
        author.received.filter((update) => update.type === "chat.message" && update.message.id === message.id),
      ).toHaveLength(2),
    );
    for (const viewer of [author, reporter, fresh, ...crowd]) expectNoModerationData(viewer);
    await runInDurableObject(f.room(), (_room, state) => {
      const actions = state.storage.sql
        .exec("SELECT action FROM staff_actions ORDER BY seq")
        .toArray()
        .map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["live_session.chat.held", "live_session.chat.kept"]));
    });
  });

  it("lets authors delete only their own messages and moderators hide any", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const first = await say(author, "Delete me", reader);
    reader.send({ type: "chat.delete", messageId: first.id });
    expect((await reader.next("room.refused")).code).toBe("LIVE_CHAT_NOT_ALLOWED");
    author.send({ type: "chat.delete", messageId: first.id });
    await reader.next("chat.removed", (update) => update.messageId === first.id);
    await demoteSecondOperator();
    const moderator = await f.connect({ person: "secondOperator" });
    const second = await say(author, "Hide me", reader);
    moderator.send({ type: "chat.moderate", messageId: second.id, decision: "hide" });
    await reader.next("chat.removed", (update) => update.messageId === second.id);
    const update = await moderator.next("chat.message", (message) => message.message.moderation?.hidden !== null);
    expect(update.message.moderation?.hidden?.operatorName).toBe("Remote Rita");
    expectNoModerationData(reader);
  });

  it("lets organizers, and not moderators, mute and ban a participant for the session", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const message = await say(author, "Before the mute", reader);
    await demoteSecondOperator();
    const moderator = await f.connect({ person: "secondOperator" });
    expect((moderator.received[0] as Extract<LiveRoomServerMessage, { type: "room.snapshot" }>).viewer.organizer).toBe(
      false,
    );
    moderator.send({ type: "chat.restrict", messageId: message.id, restriction: "muted" });
    expect((await moderator.next("room.refused")).code).toBe("LIVE_CHAT_NOT_ALLOWED");

    const organizer = await f.connect({ person: "operator" });
    organizer.send({ type: "chat.restrict", messageId: message.id, restriction: "muted" });
    expect((await author.next("chat.access")).restriction).toBe("muted");
    author.send({ type: "chat.send", text: "Muted words" });
    expect((await author.next("room.refused")).code).toBe("LIVE_CHAT_MUTED");
    const beforeReact = author.received.length;
    author.send({ type: "chat.react", messageId: message.id, reaction: "love", on: true });
    expect((await author.next("room.refused", () => true, { after: beforeReact })).code).toBe("LIVE_CHAT_MUTED");

    organizer.send({ type: "chat.restrict", messageId: message.id, restriction: "banned" });
    expect((await author.next("chat.access", (update) => update.restriction === "banned")).restriction).toBe("banned");
    await reader.next("chat.removed", (update) => update.messageId === message.id);
    const banned = await f.connect({ person: "attendee" });
    const snapshot = banned.received[0] as Extract<LiveRoomServerMessage, { type: "room.snapshot" }>;
    expect(snapshot.chat).toEqual([]);
    expect(snapshot.viewer.chatRestriction).toBe("banned");
    await say(reader, "Not for banned eyes");
    expect(
      banned.received.some((update) => update.type === "chat.message" && update.message.text === "Not for banned eyes"),
    ).toBe(false);

    const beforeLift = reader.received.length;
    organizer.send({ type: "chat.restrict", messageId: message.id, restriction: null });
    expect((await author.next("chat.access", (update) => update.restriction === null)).restriction).toBeNull();
    await reader.next("chat.message", (update) => update.message.id === message.id, { after: beforeLift });
    expectNoModerationData(reader);
  });

  it("turns a chat message into an approved question by the same author, once", async () => {
    await env.DB.prepare("UPDATE users SET headshot_r2_key=? WHERE id=?")
      .bind(`headshots/${f.users.attendee}/portrait.jpg`, f.users.attendee)
      .run();
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const operator = await f.connect({ person: "operator" });
    const message = await say(author, "How do we **rotate** roots without downtime?", reader);
    expect(message.authorPhotoUrl).toBe(`/api/v1/users/${f.users.attendee}/headshots/portrait.jpg`);
    reader.send({ type: "chat.convert", messageId: message.id });
    expect((await reader.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
    operator.send({ type: "chat.convert", messageId: message.id });
    const question = (await reader.next("question.changed")).question;
    expect(question).toMatchObject({
      text: "How do we rotate roots without downtime?",
      status: "approved",
      authorName: "Ada Attendee",
      authorPhotoUrl: message.authorPhotoUrl,
    });
    const linked = await operator.next("chat.message", (update) => update.message.moderation?.questionId !== null);
    expect(linked.message.moderation?.questionId).toBe(question.id);
    operator.send({ type: "chat.convert", messageId: message.id });
    expect((await operator.next("room.refused")).code).toBe("LIVE_CHAT_NOT_ALLOWED");
    expectNoModerationData(reader);
  });

  it("sends the latest page on joining and earlier pages on request", async () => {
    await f.connect({ person: "operator" });
    const total = LIVE_CHAT_POLICY.snapshotMessages + 10;
    await runInDurableObject(f.room(), (_room, state) => {
      const chat = new LiveRoomChat(new LiveRoomSql(state.storage.sql));
      const now = Date.now();
      for (let index = 0; index < total; index++)
        chat.send({ userId: crypto.randomUUID(), name: "Synthetic author" }, `History ${index}`, now + index);
    });
    const viewer = await f.connect({ person: "attendee" });
    const snapshot = viewer.received[0] as Extract<LiveRoomServerMessage, { type: "room.snapshot" }>;
    expect(snapshot.chat).toHaveLength(LIVE_CHAT_POLICY.snapshotMessages);
    expect(snapshot.chatEarlier?.attendee).toBe(true);
    viewer.send({ type: "chat.history", channel: "attendee", before: snapshot.chat[0].id });
    const page = await viewer.next("chat.history");
    expect(page.messages.map((message) => message.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `History ${index}`),
    );
    expect(page.hasEarlier).toBe(false);
    viewer.send({ type: "chat.history", channel: "operator", before: null });
    expect((await viewer.next("room.refused")).code).toBe("LIVE_CHAT_NOT_ALLOWED");
  });

  it("puts the latest shown, unreported chat on a chat ticker", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const operator = await f.connect({ person: "operator" });
    await say(author, "Great *talk*", reader);
    const reported = await say(author, "Visit spam.example", reader);
    reader.send({ type: "chat.report", messageId: reported.id, reason: "spam" });
    await operator.next("chat.message", (update) => update.message.moderation?.reports === 1);
    operator.send({
      type: "stage.ticker",
      ticker: {
        style: "neutral",
        messages: [{ id: "chat", prefix: "Chat", template: "{{chat.latest}}", condition: "always" }],
      },
    });
    const stage = await vi.waitFor(async () => (await reader.next("stage.changed")).stage, { timeout: 5000 });
    expect(stage.ticker?.segments[0].markdown).toContain("Ada Attendee: Great talk");
    expect(stage.ticker?.segments[0].markdown).not.toContain("spam");
  });
});

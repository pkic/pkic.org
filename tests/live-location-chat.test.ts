import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const fixture = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof fixture.connectChat>>;
let clients: Client[] = [];
afterEach(() => {
  for (const client of clients) client.socket.close();
  clients = [];
});

/** The location's session starts in ten minutes: its chat is already open, and no session is on. */
beforeEach(() => fixture.setup({ startOffsetMinutes: 10, durationMinutes: 60 }));

async function join(person: Parameters<typeof fixture.connectChat>[0]) {
  const client = await fixture.connectChat(person);
  clients.push(client);
  return client;
}

/** The error code a person's join closes with, when the chat does not admit them. */
async function refused(person: Parameters<typeof fixture.connectChat>[0]) {
  const response = await fixture.upgrade({ person }, {}, fixture.chatPath());
  const socket = response.webSocket!;
  const closed = new Promise<string>((resolve) => socket.addEventListener("close", (event) => resolve(event.reason)));
  socket.accept();
  return closed;
}

async function load(occurrenceId: string | null, expectedRevision: number) {
  const response = await callApi(env, fixture.programPath("/program"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${fixture.tokens.operator}`,
      origin: "https://app.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ occurrenceId, expectedRevision }),
  });
  expect(response.status).toBe(200);
}

it("admits the day's attendees and speakers, and dates each message by the session on", async () => {
  const attendee = await join("attendee");
  const speaker = await join("speaker");
  const snapshot = attendee.received[0]!;
  if (snapshot.type !== "location.chat.snapshot") throw new Error("Expected the chat's snapshot");
  expect(snapshot.scope.sessions.map((session) => session.occurrenceId)).toEqual([fixture.occurrenceId]);
  expect(snapshot.viewer.role).toBe("attendee");
  expect((speaker.received[0] as typeof snapshot).viewer.role).toBe("speaker");
  expect(await refused("outsider")).toBe("LIVE_SESSION_ACCESS_REQUIRED");

  attendee.send({ type: "chat.send", text: "Who else is here early?" });
  const before = await speaker.next("chat.message", (message) => message.message.text === "Who else is here early?");
  expect(before.message.occurrenceId).toBeUndefined();

  // The studio loads the session early: from then on, messages belong to it.
  await load(fixture.occurrenceId, 0);
  speaker.send({ type: "chat.send", text: "Starting soon" });
  const during = await attendee.next("chat.message", (message) => message.message.text === "Starting soon");
  expect(during.message.occurrenceId).toBe(fixture.occurrenceId);

  // Unloading it hands the stamp back to the agenda, which has nothing on yet.
  await load(null, 1);
  attendee.send({ type: "chat.send", text: "Back to the break" });
  const after = await speaker.next("chat.message", (message) => message.message.text === "Back to the break");
  expect(after.message.occurrenceId).toBeUndefined();

  await runDurableObjectAlarm(fixture.chatRoom());
  const totals = await env.DB.prepare(
    "SELECT messages, people FROM event_session_chat_totals WHERE event_id=? AND occurrence_id=?",
  )
    .bind(fixture.eventId, fixture.occurrenceId)
    .first<{ messages: number; people: number }>();
  expect(totals).toEqual({ messages: 1, people: 1 });
});

it("keeps running without an operator, and stops only when an operator ends it", async () => {
  const attendee = await join("attendee");
  attendee.send({ type: "chat.send", text: "Nobody is in the studio" });
  await attendee.next("chat.message", (message) => message.message.text === "Nobody is in the studio");

  attendee.send({ type: "room.opening", opening: "closed" });
  expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");

  const operator = await join("operator");
  operator.send({ type: "room.opening", opening: "closed" });
  await attendee.next("room.opening.changed", (message) => message.opening === "closed");
  const after = attendee.received.length;
  attendee.send({ type: "chat.send", text: "Still there?" });
  expect((await attendee.next("room.refused", () => true, { after })).message).toBe("The organizers ended this chat.");

  // Questions stay with each session's room.
  attendee.send({ type: "question.ask", text: "Will the slides be shared afterwards?", anonymous: false });
  expect((await attendee.next("room.refused", (message) => message.code === "LIVE_ROOM_INVALID_MESSAGE")).code).toBe(
    "LIVE_ROOM_INVALID_MESSAGE",
  );

  await runDurableObjectAlarm(fixture.chatRoom());
  const audit = await env.DB.prepare(
    "SELECT entity_type, entity_id FROM audit_log WHERE action='live_session.location_chat.opening'",
  ).first<{ entity_type: string; entity_id: string }>();
  expect(audit).toEqual({ entity_type: "event_agenda_room", entity_id: fixture.roomId });
});

it("keeps the conversation while the studio closes and reopens the active session", async () => {
  await load(fixture.occurrenceId, 0);
  const attendee = await join("attendee");
  const studio = await fixture.connect({ person: "operator" });
  clients.push(studio);

  attendee.send({ type: "chat.send", text: "Notes from this session" });
  await attendee.next("chat.message");
  studio.send({ type: "room.opening", opening: "closed" });
  await attendee.next("location.chat.access", (update) => update.sessionClosed);
  const rejoined = await join("attendee");
  const snapshot = await rejoined.next("location.chat.snapshot");
  expect(snapshot.sessionClosed).toBe(true);
  expect(snapshot.chat.map((entry) => entry.text)).toContain("Notes from this session");

  studio.send({ type: "room.opening", opening: "open" });
  await rejoined.next("location.chat.access", (update) => !update.sessionClosed);
  rejoined.send({ type: "chat.send", text: "The session has reopened" });
  expect(
    (await attendee.next("chat.message", (update) => update.message.text === "The session has reopened")).message
      .occurrenceId,
  ).toBe(fixture.occurrenceId);
});

it("turns a chat message into a question in the session the studio has loaded, and none between sessions", async () => {
  const attendee = await join("attendee");
  const operator = await join("operator");
  attendee.send({ type: "chat.send", text: "Will the slides be shared afterwards?" });
  const sent = await operator.next("chat.message", (message) => message.message.text.startsWith("Will the slides"));

  // Nothing is loaded and nothing is on: the question has no session to go to.
  operator.send({ type: "chat.convert", messageId: sent.message.id });
  expect((await operator.next("room.refused")).code).toBe("LIVE_CHAT_NO_SESSION");

  await load(fixture.occurrenceId, 0);
  const studio = await fixture.connect({ person: "operator" });
  operator.send({ type: "chat.convert", messageId: sent.message.id });
  const asked = await studio.next("question.changed", (message) => message.question.text.startsWith("Will the slides"));
  expect(asked.question).toMatchObject({ status: "approved", authorName: "Ada Attendee" });
  studio.socket.close();
});

it("asks an earlier session's chat message in the session on now, never in the session that is over", async () => {
  const next = await fixture.addSession(undefined, { sameDay: true });
  await load(fixture.occurrenceId, 0);
  const attendee = await join("attendee");
  const operator = await join("operator");
  attendee.send({ type: "chat.send", text: "Will the slides be shared afterwards?" });
  const earlier = await operator.next("chat.message", (message) => message.message.text.startsWith("Will the slides"));
  expect(earlier.message.occurrenceId).toBe(fixture.occurrenceId);

  // The studio moves on: a question the earlier session had no time for goes to the session on now.
  await load(next, 1);
  const studio = await fixture.connect({ person: "operator" }, next);
  clients.push(studio);
  operator.send({ type: "chat.convert", messageId: earlier.message.id });
  await studio.next("question.changed", (message) => message.question.text.startsWith("Will the slides"));

  attendee.send({ type: "chat.send", text: "Is this talk recorded for later?" });
  const current = await operator.next("chat.message", (message) => message.message.text.startsWith("Is this talk"));
  expect(current.message.occurrenceId).toBe(next);
  operator.send({ type: "chat.convert", messageId: current.message.id });
  await studio.next("question.changed", (message) => message.question.text.startsWith("Is this talk"));
});

it("quotes the message a reply answers, and lets its author edit it until someone reports it", async () => {
  const attendee = await join("attendee");
  const speaker = await join("speaker");
  attendee.send({ type: "chat.send", text: "Will the **slides** be shared?" });
  const asked = await speaker.next("chat.message", (message) => message.message.text.startsWith("Will the"));

  speaker.send({ type: "chat.send", text: "Yes, tonight", replyTo: asked.message.id });
  const reply = await attendee.next("chat.message", (message) => message.message.text === "Yes, tonight");
  expect(reply.message.replyTo).toEqual({
    messageId: asked.message.id,
    authorName: asked.message.authorName,
    excerpt: "Will the slides be shared?",
    mine: true,
  });

  speaker.send({ type: "chat.edit", messageId: reply.message.id, text: "Yes, tomorrow" });
  const edited = await attendee.next("chat.message", (message) => message.message.text === "Yes, tomorrow");
  expect(edited.message.id).toBe(reply.message.id);
  expect(edited.message.editedAt).toEqual(expect.any(String));

  // Someone else's message is not theirs to edit.
  const before = attendee.received.length;
  attendee.send({ type: "chat.edit", messageId: reply.message.id, text: "Never" });
  expect((await attendee.next("room.refused", () => true, { after: before })).code).toBe("LIVE_CHAT_NOT_ALLOWED");

  // Once reported, its words stay as they are.
  attendee.send({ type: "chat.report", messageId: reply.message.id, reason: "spam" });
  await attendee.next("chat.message", (message) => message.message.reportedByMe === true);
  speaker.send({ type: "chat.edit", messageId: reply.message.id, text: "Changed again" });
  expect((await speaker.next("room.refused")).code).toBe("LIVE_CHAT_EDIT_CLOSED");
});

it("removes a blocked person's posts from the whole chat for the event, and the reported break post for a session", async () => {
  const author = await join("attendee");
  const reader = await join("secondAttendee");
  const operator = await join("operator");
  const say = async (text: string) => {
    author.send({ type: "chat.send", text });
    return (await reader.next("chat.message", (message) => message.message.text === text)).message;
  };
  const block = (messageId: string, scope: "session" | "event") =>
    operator.send({
      type: "participation.block",
      item: { kind: "chat", messageId },
      block: scope,
      reason: "spam",
      removePosts: true,
    });
  const inBreak = await say("Said in the break");
  await load(fixture.occurrenceId, 0);
  const during = await say("Said during the session");

  // A session block from a break post removes that post too.
  block(inBreak.id, "session");
  await reader.next("chat.removed", (update) => update.messageId === during.id);
  await reader.next("chat.removed", (update) => update.messageId === inBreak.id);
  operator.send({ type: "participation.lift", item: { kind: "chat", messageId: during.id } });
  await author.next("participation.access", (update) => update.restriction === null);
  // Once lifted, they take part again in the session and in the chat around it.
  await say("Back after the lift");

  // An event block removes everything the person said in this chat, in or between sessions.
  await load(null, 1);
  const nextBreak = await say("Said in the next break");
  await load(fixture.occurrenceId, 2);
  const later = await say("Said later");
  block(later.id, "event");
  await reader.next("chat.removed", (update) => update.messageId === later.id);
  await reader.next("chat.removed", (update) => update.messageId === nextBreak.id);
});

it("lets a person post again as soon as a pause, a session block or an event block is lifted", async () => {
  await load(fixture.occurrenceId, 0);
  const author = await join("attendee");
  const reader = await join("secondAttendee");
  const operator = await join("operator");
  const say = async (text: string) => {
    const after = author.received.length;
    author.send({ type: "chat.send", text });
    const outcome = await Promise.race([
      Promise.all([
        reader.next("chat.message", (message) => message.message.text === text),
        author.next("chat.message", (message) => message.message.text === text && message.message.mine, { after }),
      ]).then(() => "shown"),
      author.next("room.refused", () => true, { after }).then((refusal) => refusal.code),
    ]);
    return outcome;
  };
  const sent = await say("Before any block");
  expect(sent).toBe("shown");
  const message = [...reader.received].reverse().find((update) => update.type === "chat.message");
  if (message?.type !== "chat.message") throw new Error("Expected a message");
  const item = { kind: "chat" as const, messageId: message.message.id };
  for (const block of ["paused", "session", "event"] as const) {
    const blocked = author.received.length;
    operator.send({ type: "participation.block", item, block, reason: "spam", removePosts: true });
    await author.next("participation.access", (update) => update.restriction?.block === block, { after: blocked });
    expect(await say(`While ${block}`)).toBe("LIVE_PARTICIPATION_BLOCKED");
    const lifted = author.received.length;
    operator.send({ type: "participation.lift", item });
    await author.next("participation.access", (update) => update.restriction === null, { after: lifted });
    expect(await say(`After ${block}`)).toBe("shown");
  }
});

it("tells a person who stays in the chat at once when the studio blocks them over a question, and lets them post when it lifts", async () => {
  await load(fixture.occurrenceId, 0);
  const author = await join("attendee");
  const reader = await join("secondAttendee");
  const asker = await fixture.connect({ person: "attendee" });
  const studio = await fixture.connect({ person: "operator" });
  clients.push(asker, studio);
  const say = async (text: string) => {
    const after = author.received.length;
    author.send({ type: "chat.send", text });
    return Promise.race([
      reader.next("chat.message", (message) => message.message.text === text).then(() => "shown"),
      author.next("room.refused", () => true, { after }).then((refusal) => refusal.code),
    ]);
  };
  expect(await say("Hello from the chat")).toBe("shown");
  asker.send({ type: "question.ask", text: "Is this on topic?", anonymous: false });
  const question = await studio.next("question.changed", (message) => message.question.text === "Is this on topic?");
  const item = { kind: "question" as const, questionId: question.question.id };
  for (const block of ["session", "event"] as const) {
    const after = author.received.length;
    studio.send({ type: "participation.block", item, block, reason: "spam", removePosts: false });
    // The chat the person never left learns it from the studio, without a reconnect.
    await author.next("location.chat.access", (update) => update.restriction?.block === block, { after });
    expect(await say(`While ${block}`)).toBe("LIVE_PARTICIPATION_BLOCKED");
    const lifted = author.received.length;
    studio.send({ type: "participation.lift", item });
    await author.next("location.chat.access", (update) => update.restriction === null, { after: lifted });
    expect(await say(`After ${block}`)).toBe("shown");
  }
});

it("lets a person post as soon as an event block is lifted, even after the session's room read the block", async () => {
  await load(fixture.occurrenceId, 0);
  const author = await join("attendee");
  const reader = await join("secondAttendee");
  const operator = await join("operator");
  const say = async (text: string) => {
    const after = author.received.length;
    author.send({ type: "chat.send", text });
    return Promise.race([
      reader.next("chat.message", (message) => message.message.text === text).then(() => "shown"),
      author.next("room.refused", () => true, { after }).then((refusal) => refusal.code),
    ]);
  };
  expect(await say("Before the block")).toBe("shown");
  const sent = [...reader.received].reverse().find((update) => update.type === "chat.message");
  if (sent?.type !== "chat.message") throw new Error("Expected a message");
  const item = { kind: "chat" as const, messageId: sent.message.id };
  operator.send({ type: "participation.block", item, block: "event", reason: "spam", removePosts: false });
  await author.next("participation.access", (update) => update.restriction?.block === "event");
  // The session's own room refreshes its access from D1 and finds the event block there.
  const userId = fixture.users.attendee;
  await runInDurableObject(fixture.room(), async (instance) => {
    const participation = Reflect.get(instance as object, "participation") as {
      eventBlocksRead(checked: string[], blocked: Set<string>, readAt: number): Promise<void>;
    };
    await participation.eventBlocksRead([userId], new Set([userId]), Date.now());
  });
  expect(await say("While blocked")).toBe("LIVE_PARTICIPATION_BLOCKED");
  const lifted = author.received.length;
  operator.send({ type: "participation.lift", item });
  await author.next("participation.access", (update) => update.restriction === null, { after: lifted });
  expect(await say("After the lift")).toBe("shown");
  // The chat reads D1 again and finds the lift; then the block's notice, older than both, arrives late.
  await runInDurableObject(fixture.chatRoom(), async (instance) => {
    const participation = Reflect.get(instance as object, "participation") as {
      eventBlocksRead(checked: string[], blocked: Set<string>, readAt: number): Promise<void>;
    };
    await participation.eventBlocksRead([userId], new Set(), Date.now());
  });
  const stale = { blocked: true, at: Date.now() - 60_000 };
  await fixture.chatRoom().locationChatAccessChanged(fixture.occurrenceId, userId, stale);
  expect(await say("After a late notice")).toBe("shown");
});

it("lets a person post as soon as an event block is lifted while no session is on air", async () => {
  await load(fixture.occurrenceId, 0);
  const author = await join("attendee");
  const operator = await join("operator");
  author.send({ type: "chat.send", text: "Before the block" });
  const sent = await author.next("chat.message", (message) => message.message.text === "Before the block");
  operator.send({
    type: "participation.block",
    item: { kind: "chat", messageId: sent.message.id },
    block: "event",
    reason: "spam",
    removePosts: false,
  });
  await author.next("location.chat.access", (update) => update.restriction?.block === "event");
  await load(null, 1);
  // The lift reaches the chat after the studio unloaded the session.
  const lifted = author.received.length;
  await fixture
    .chatRoom()
    .locationChatAccessChanged(fixture.occurrenceId, fixture.users.attendee, { blocked: false, at: Date.now() });
  await author.next("location.chat.access", (update) => update.restriction === null, { after: lifted });
});

import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
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

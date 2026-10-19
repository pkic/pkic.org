import { runInDurableObject } from "cloudflare:test";
import { LiveRoomChat } from "../functions/_lib/services/live-session/room-chat";
import { LiveRoomSql } from "../functions/_lib/services/live-session/room-sql";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { LIVE_ROOM_POLICY } from "../assets/shared/live-session-policy";
import { LIVE_CHAT_POLICY } from "../assets/shared/live-chat-policy";
import { liveOverlayAccessResponseSchema } from "../assets/shared/schemas/live-session-room";
import { individualAppearanceFixture } from "./helpers/agenda-appearances";
import { callApi } from "./helpers/app";
import { createLiveRoomFixture } from "./helpers/live-session-room";
const f = createLiveRoomFixture();

async function overlay() {
  const selected = await callApi(env, f.programPath("/program"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${f.tokens.operator}`,
      origin: "https://app.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ occurrenceId: f.occurrenceId, expectedRevision: 0 }),
  });
  expect(selected.status, await selected.clone().text()).toBe(200);
  const response = await callApi(env, f.programPath("/overlays"), {
    method: "POST",
    headers: { authorization: `Bearer ${f.tokens.operator}`, origin: "https://app.test" },
  });
  expect(response.status).toBe(201);
  return f.connect({ overlay: liveOverlayAccessResponseSchema.parse(await response.json()).token });
}

describe("live room configured controls and participant chat", () => {
  beforeEach(() => f.setup());

  it("projects the approved appearance headshot without substituting the current profile", async () => {
    const row = await env.DB.prepare(
      "SELECT payload_json FROM event_agenda_published_occurrences WHERE event_id=? AND occurrence_id=?",
    )
      .bind(f.eventId, f.occurrenceId)
      .first<{ payload_json: string }>();
    const occurrence = JSON.parse(row!.payload_json);
    const approved = {
      ...individualAppearanceFixture({
        userId: f.users.speaker,
        displayName: "Frozen speaker",
        approvedAt: new Date().toISOString(),
      }),
      photoUrl: "/images/approved-speaker.svg",
    };
    occurrence.history = { ...occurrence.history, appearances: [approved] };
    await env.DB.prepare(
      "UPDATE event_agenda_published_occurrences SET payload_json=? WHERE event_id=? AND occurrence_id=?",
    )
      .bind(JSON.stringify(occurrence), f.eventId, f.occurrenceId)
      .run();
    const viewer = await f.connect({ person: "attendee" });
    expect((await viewer.next("room.snapshot")).session.credits[0]).toMatchObject({
      name: "Frozen speaker",
      photoUrl: approved.photoUrl,
    });
  });

  it("broadcasts real chat with per-viewer ownership, excludes overlays and lets moderators hide it", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    const operator = await f.connect({ person: "operator" });
    const screen = await overlay();
    author.send({ type: "chat.send", text: "Welcome to the session" });
    const own = await author.next("chat.message");
    const other = await reader.next("chat.message");
    expect(own.message).toMatchObject({ text: "Welcome to the session", authorName: "Ada Attendee", mine: true });
    expect(other.message.mine).toBe(false);
    expect(Object.keys(other.message)).not.toContain("userId");
    const joined = await f.connect({ person: "secondAttendee" });
    expect((await joined.next("room.snapshot")).chat).toHaveLength(1);
    expect((await screen.next("room.snapshot")).chat).toEqual([]);
    expect(screen.received.some((message) => message.type === "chat.message")).toBe(false);
    reader.send({ type: "chat.moderate", messageId: own.message.id, decision: "hide" });
    expect((await reader.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
    operator.send({ type: "chat.moderate", messageId: own.message.id, decision: "hide" });
    await author.next("chat.removed");
    const restored = await f.connect({ person: "attendee" });
    expect((await restored.next("room.snapshot")).chat).toEqual([]);
    const moderator = await f.connect({ person: "operator" });
    expect((await moderator.next("room.snapshot")).chat[0].moderation?.hidden?.operatorName).toBe("Olga Operator");
  });

  it("keeps operator chat and removal identifiers private while refusing crafted attendee commands", async () => {
    const operator = await f.connect({ person: "operator" });
    const second = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    const speaker = await f.connect({ person: "speaker" });
    const screen = await overlay();
    attendee.send({ type: "chat.send", channel: "operator", text: "Crafted private command" });
    await attendee.next("room.refused");
    operator.send({ type: "chat.send", channel: "operator", text: "Private production cue" });
    const privateMessage = await second.next("chat.message");
    expect(privateMessage.message).toMatchObject({ channel: "operator", text: "Private production cue" });
    for (const viewer of [attendee, speaker, screen])
      expect(viewer.received.some((message) => message.type === "chat.message")).toBe(false);
    const privateJoined = await f.connect({ person: "operator" });
    expect((await privateJoined.next("room.snapshot")).chat).toEqual([
      expect.objectContaining({ channel: "operator" }),
    ]);
    const publicJoined = await f.connect({ person: "attendee" });
    expect((await publicJoined.next("room.snapshot")).chat).toEqual([]);
    operator.send({ type: "chat.delete", messageId: privateMessage.message.id });
    expect((await second.next("chat.removed")).channel).toBe("operator");
    for (const viewer of [attendee, speaker, screen, publicJoined])
      expect(viewer.received.some((message) => message.type === "chat.removed")).toBe(false);
  });

  it("forgets both chat channels without exposing private removal IDs", async () => {
    const author = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    author.send({ type: "chat.send", channel: "operator", text: "Private cue to erase" });
    const privateMessage = await author.next("chat.message");
    author.send({ type: "chat.send", text: "Public note to erase" });
    const publicMessage = await attendee.next("chat.message");
    await f.room().forgetParticipant(f.users.operator);
    await attendee.next("chat.removed", (message) => message.messageId === publicMessage.message.id);
    expect(
      attendee.received.some(
        (message) => message.type === "chat.removed" && message.messageId === privateMessage.message.id,
      ),
    ).toBe(false);
    const joined = await f.connect({ person: "attendee" });
    expect((await joined.next("room.snapshot")).chat).toEqual([]);
    await runInDurableObject(f.room(), (_room, state) => {
      const chat = new LiveRoomChat(new LiveRoomSql(state.storage.sql));
      for (const channel of ["attendee", "operator"] as const)
        expect(chat.page(channel, { before: null, limit: 10, shownOnly: false }).rows).toEqual([]);
    });
  });

  it("closes a revoked operator before a private snapshot is disclosed", async () => {
    const removed = await f.connect({ person: "operator" });
    removed.send({ type: "chat.send", channel: "operator", text: "Authorized before revocation" });
    await removed.next("chat.message");
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    const publicJoined = await f.connect({ person: "attendee" });
    expect((await publicJoined.next("room.snapshot")).chat).toEqual([]);
    expect(removed.received.filter((message) => message.type === "chat.message")).toHaveLength(1);
    expect((await f.refusal({ person: "operator" })).code).toBeGreaterThanOrEqual(4401);
  });

  it("retains the chat rate allowance across reconnects and removes authors' messages on erasure", async () => {
    const author = await f.connect({ person: "attendee" });
    for (let i = 0; i < LIVE_ROOM_POLICY.chatPerPerson.limit; i++) {
      author.send({ type: "chat.send", text: `Message ${i}` });
      await author.next("chat.message", (message) => message.message.text === `Message ${i}`);
    }
    const rejoined = await f.connect({ person: "attendee" });
    rejoined.send({ type: "chat.send", text: "Too soon after reconnect" });
    expect((await rejoined.next("room.refused")).code).toBe("LIVE_CHAT_RATE_LIMITED");
    const reader = await f.connect({ person: "secondAttendee" });
    await f.room().forgetParticipant(f.users.attendee);
    const cleared = await f.connect({ person: "secondAttendee" });
    expect((await cleared.next("room.snapshot")).chat).toEqual([]);
    expect(reader.received.filter((message) => message.type === "chat.removed")).toHaveLength(
      LIVE_ROOM_POLICY.chatPerPerson.limit,
    );
  });

  it("forgets an anonymized chat-only author before a new snapshot or fanout", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    author.send({ type: "chat.send", text: "Room-local words from a chat-only author" });
    const sent = await reader.next("chat.message");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_session_questions WHERE author_user_id=?")
        .bind(f.users.attendee)
        .first("count"),
    ).toBe(0);
    await env.DB.prepare("UPDATE users SET active=0,pii_redacted_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.users.attendee)
      .run();
    const joined = await f.connect({ person: "secondAttendee" });
    expect((await joined.next("room.snapshot")).chat).toEqual([]);
    await reader.next("chat.removed", (message) => message.messageId === sent.message.id);
    const reconnect = await f.connect({ person: "secondAttendee" });
    expect((await reconnect.next("room.snapshot")).chat).toEqual([]);
  });

  it("bounds the stored feed independently of the number of authors", async () => {
    await f.connect({ person: "operator" });
    await runInDurableObject(f.room(), (_room, state) => {
      const chat = new LiveRoomChat(new LiveRoomSql(state.storage.sql));
      const now = Date.now();
      for (let index = 0; index < LIVE_CHAT_POLICY.storedMessages + 1; index++)
        chat.send({ userId: crypto.randomUUID(), name: "Synthetic author" }, `Stored ${index}`, now + index);
      const history = chat.page("attendee", {
        before: null,
        limit: LIVE_CHAT_POLICY.storedMessages + 10,
        shownOnly: false,
      });
      expect(history.rows).toHaveLength(LIVE_CHAT_POLICY.storedMessages);
      expect(history.hasEarlier).toBe(false);
      expect(history.rows[0].body).toBe("Stored 1");
    });
  });

  it("closes a revoked attendee before accepting or delivering chat", async () => {
    const removed = await f.connect({ person: "attendee" });
    const remaining = await f.connect({ person: "secondAttendee" });
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
      .bind(f.eventId, f.users.attendee)
      .run();
    remaining.send({ type: "chat.send", text: "Visible only to current participants" });
    await remaining.next("chat.message");
    expect(removed.received.some((message) => message.type === "chat.message")).toBe(false);
    const joined = await f.connect({ person: "secondAttendee" });
    expect((await joined.next("room.snapshot")).chat).toHaveLength(1);
  });
});

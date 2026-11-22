import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { LiveRoomServerMessage } from "../assets/shared/schemas/live-session-room";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connectChat>>;
type Snapshot = Extract<LiveRoomServerMessage, { type: "location.chat.snapshot" }>;

async function say(author: Client, text: string, reader: Client = author) {
  author.send({ type: "chat.send", text });
  return (await reader.next("chat.message", (message) => message.message.text === text)).message;
}

async function joined(person: Parameters<typeof f.connectChat>[0]) {
  return ((await f.connectChat(person)).received[0] as Snapshot).chatPinned ?? null;
}

describe("a pinned chat message", () => {
  beforeEach(() => f.setup());

  it("lets a moderator pin one message for everyone, replace it and unpin it", async () => {
    const operator = await f.connectChat("operator");
    const attendee = await f.connectChat("attendee");
    const first = await say(operator, "We are aware of the audio problem.", attendee);
    const second = await say(operator, "Send your questions in the Questions tab.", attendee);

    attendee.send({ type: "chat.pin", messageId: first.id });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");

    operator.send({ type: "chat.pin", messageId: first.id });
    expect((await attendee.next("chat.pinned")).message).toMatchObject({ id: first.id, moderation: null });
    expect(await joined("secondAttendee")).toMatchObject({ id: first.id });

    // One pin per chat: a second replaces the first.
    let seen = attendee.received.length;
    operator.send({ type: "chat.pin", messageId: second.id });
    expect((await attendee.next("chat.pinned", () => true, { after: seen })).message?.id).toBe(second.id);

    seen = attendee.received.length;
    operator.send({ type: "chat.unpin" });
    expect((await attendee.next("chat.pinned", () => true, { after: seen })).message).toBeNull();
    expect(await joined("secondAttendee")).toBeNull();

    await runDurableObjectAlarm(f.chatRoom());
    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE scope_type='event' AND scope_id=? AND action LIKE 'live_session.chat.%pinned' ORDER BY created_at, action",
    )
      .bind(f.eventId)
      .all<{ action: string }>();
    expect(results.map((row) => row.action).sort()).toEqual([
      "live_session.chat.pinned",
      "live_session.chat.pinned",
      "live_session.chat.unpinned",
    ]);
  });

  it("leaves the top of the chat once its message is removed", async () => {
    const operator = await f.connectChat("operator");
    const attendee = await f.connectChat("attendee");
    const message = await say(attendee, "Slides are on the event page.", operator);
    operator.send({ type: "chat.pin", messageId: message.id });
    await attendee.next("chat.pinned");
    operator.send({ type: "chat.moderate", messageId: message.id, decision: "remove", reason: "off_topic" });
    await operator.next("chat.message", (update) => update.message.moderation?.hidden != null);
    expect(await joined("secondAttendee")).toBeNull();
    // Shown again, it stays off the top until a moderator pins it again.
    operator.send({ type: "chat.moderate", messageId: message.id, decision: "keep" });
    await operator.next(
      "chat.message",
      (update) => update.message.id === message.id && !update.message.moderation?.hidden,
    );
    expect(await joined("secondAttendee")).toBeNull();
  });

  it("refuses to pin an operator chat message", async () => {
    const operator = await f.connectChat("operator");
    operator.send({ type: "chat.send", text: "Operators only", channel: "operator" });
    const message = (await operator.next("chat.message", (update) => update.message.channel === "operator")).message;
    operator.send({ type: "chat.pin", messageId: message.id });
    expect((await operator.next("room.refused")).code).toBe("LIVE_CHAT_NOT_ALLOWED");
  });
});

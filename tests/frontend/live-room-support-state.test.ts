import { describe, expect, it } from "vitest";
import { LIVE_TIMER_MAX_MS } from "../../assets/shared/schemas/live-session-timer";
import { liveRoomClientMessageSchema } from "../../assets/shared/schemas/live-session-room";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { applyLocationChatMessage } from "../../assets/ts/live-session/location-chat-state";
import { LIVE_ROOM_POLICY } from "../../assets/shared/live-session-policy";
import { LIVE_CHAT_POLICY } from "../../assets/shared/live-chat-policy";
import { liveLocationChatSnapshot, liveSnapshot } from "./helpers/live-room-socket";

describe("canonical live room supporting controls", () => {
  it("validates a timer to add by its kind and refuses invalid lengths", () => {
    const pitch = { name: "Sponsor pitch", kind: "duration", targetAt: null, durationSeconds: 60 };
    expect(liveRoomClientMessageSchema.parse({ type: "timer.add", timer: pitch })).toMatchObject({ timer: pitch });
    expect(
      liveRoomClientMessageSchema.parse({
        type: "timer.add",
        timer: { ...pitch, durationSeconds: LIVE_TIMER_MAX_MS / 1000 },
      }),
    ).toMatchObject({ timer: { durationSeconds: LIVE_TIMER_MAX_MS / 1000 } });
    for (const durationSeconds of [0, -1, 1.5, LIVE_TIMER_MAX_MS / 1000 + 1, null])
      expect(
        liveRoomClientMessageSchema.safeParse({ type: "timer.add", timer: { ...pitch, durationSeconds } }).success,
      ).toBe(false);
    expect(
      liveRoomClientMessageSchema.safeParse({
        type: "timer.add",
        timer: { ...pitch, kind: "until", durationSeconds: null },
      }).success,
    ).toBe(false);
    expect(liveRoomClientMessageSchema.safeParse({ type: "chat.send", text: " " }).success).toBe(false);
    expect(
      liveRoomClientMessageSchema.safeParse({ type: "chat.send", text: "x".repeat(LIVE_ROOM_POLICY.chatMaxLength + 1) })
        .success,
    ).toBe(false);
  });
  it("shares preparation mode without changing any prepared overlay data", () => {
    const initial = applyLiveRoomMessage(null, liveSnapshot())!;
    const next = applyLiveRoomMessage(initial, { type: "overlay.mode.changed", mode: "switcher" })!;
    expect(next.overlayMode).toBe("switcher");
    expect(next.stage).toEqual(initial.stage);
    expect(next.timers).toEqual(initial.timers);
  });
  it("keeps real chat history bounded and removes only the requested message", () => {
    let state = applyLocationChatMessage(null, liveLocationChatSnapshot())!;
    for (let index = 0; index < LIVE_CHAT_POLICY.clientWindow + 1; index++) {
      state = applyLocationChatMessage(state, {
        type: "chat.message",
        message: {
          channel: "attendee",
          id: crypto.randomUUID(),
          text: `Message ${index}`,
          authorName: "Synthetic attendee",
          mine: false,
          sentAt: new Date().toISOString(),
        },
      })!;
    }
    expect(state.chat).toHaveLength(LIVE_CHAT_POLICY.clientWindow);
    expect(state.chat[0].text).toBe("Message 1");
    const removed = state.chat[0].id;
    state = applyLocationChatMessage(state, { type: "chat.removed", messageId: removed, channel: "attendee" })!;
    expect(state.chat.some((message) => message.id === removed)).toBe(false);
    expect(state.chat).toHaveLength(LIVE_CHAT_POLICY.clientWindow - 1);
  });
  it("keeps each chat channel independently bounded and removes only matching-channel evidence", () => {
    let state = applyLocationChatMessage(null, liveLocationChatSnapshot())!;
    const publicId = crypto.randomUUID();
    state = applyLocationChatMessage(state, {
      type: "chat.message",
      message: {
        channel: "attendee",
        id: publicId,
        text: "Attendee question",
        authorName: "Attendee",
        mine: false,
        sentAt: new Date().toISOString(),
      },
    })!;
    for (let index = 0; index < LIVE_CHAT_POLICY.clientWindow + 1; index++)
      state = applyLocationChatMessage(state, {
        type: "chat.message",
        message: {
          channel: "operator",
          id: crypto.randomUUID(),
          text: `Private cue ${index}`,
          authorName: "Operator",
          mine: false,
          sentAt: new Date().toISOString(),
        },
      })!;
    expect(state.chat.filter((row) => row.channel === "operator")).toHaveLength(LIVE_CHAT_POLICY.clientWindow);
    expect(state.chat.filter((row) => row.channel === "attendee")).toHaveLength(1);
    state = applyLocationChatMessage(state, { type: "chat.removed", messageId: publicId, channel: "operator" })!;
    expect(state.chat.some((row) => row.id === publicId)).toBe(true);
  });
  it("keeps a nameless trace of a message moderation took, and gives it back when the room does", () => {
    const id = crypto.randomUUID();
    const message = {
      channel: "attendee" as const,
      id,
      text: "Buy now at example.test",
      authorName: "Synthetic attendee",
      mine: false,
      sentAt: new Date().toISOString(),
    };
    let state = applyLocationChatMessage(null, liveLocationChatSnapshot())!;
    state = applyLocationChatMessage(state, { type: "chat.message", message })!;
    state = applyLocationChatMessage(state, {
      type: "chat.removed",
      messageId: id,
      channel: "attendee",
      moderated: true,
    })!;
    expect(state.chatRemoved).toEqual([id]);
    expect(state.chat.find((row) => row.id === id)).toMatchObject({ authorName: "", text: "", mine: false });
    state = applyLocationChatMessage(state, { type: "chat.message", message })!;
    expect(state.chatRemoved).toEqual([]);
    expect(state.chat.find((row) => row.id === id)).toMatchObject({ text: message.text });
    state = applyLocationChatMessage(state, { type: "chat.removed", messageId: id, channel: "attendee" })!;
    expect(state.chat.some((row) => row.id === id)).toBe(false);
    state = applyLocationChatMessage(state, {
      type: "chat.removed",
      messageId: id,
      channel: "attendee",
      moderated: true,
    })!;
    expect(state.chatRemoved).toEqual([]);
  });
});

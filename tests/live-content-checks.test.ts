import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRoomServerMessage } from "../assets/shared/schemas/live-session-room";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connectChat>>;

/** A stand-in check model: words name the flag it raises, everything else passes. */
const model = {
  run: vi.fn(async (_model: string, input: { state: Record<string, string>; questions: Record<string, unknown> }) => {
    const text = Object.values(input.state).join(" ");
    const probability = (id: string) =>
      id === "spam" && text.includes("cheap certificates")
        ? 0.99
        : id === "conduct" && text.includes("idiots")
          ? 0.75
          : 0.02;
    return { answers: Object.fromEntries(Object.keys(input.questions).map((id) => [id, { noul: probability(id) }])) };
  }),
};

/** The room objects read their model from the environment they were given; the test hands them the stand-in. */
async function giveRoomsTheModel() {
  for (const room of [f.chatRoom(), f.room()])
    await runInDurableObject(room, (instance) => {
      Reflect.get(instance as object, "sessionEnv").AI = model;
    });
}

async function say(author: Client, text: string, reader: Client) {
  author.send({ type: "chat.send", text });
  return (await reader.next("chat.message", (message) => message.message.text === text)).message;
}

describe("automatic checks of live chat and questions", () => {
  beforeEach(async () => {
    await f.setup();
    model.run.mockClear();
    await giveRoomsTheModel();
  });

  it("holds chat the check blocks and flags chat it advises against for moderators", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");

    const spam = await say(author, "Buy cheap certificates at example.test", reader);
    const held = await operator.next(
      "chat.message",
      (update) => update.message.id === spam.id && update.message.moderation?.held === true,
    );
    expect(held.message.moderation?.automaticCheck).toEqual({
      outcome: "blocked",
      notes: [expect.any(String)],
    });
    await reader.next("chat.removed", (update) => update.messageId === spam.id);

    const rude = await say(author, "The organizers are idiots", reader);
    const flagged = await operator.next(
      "chat.message",
      (update) => update.message.id === rude.id && update.message.moderation?.automaticCheck !== undefined,
    );
    expect(flagged.message.moderation).toMatchObject({
      held: false,
      hidden: null,
      automaticCheck: { outcome: "advised" },
    });
    const fresh = await f.connectChat("operator");
    const snapshot = fresh.received[0] as Extract<LiveRoomServerMessage, { type: "location.chat.snapshot" }>;
    expect((snapshot.chatReports ?? []).map((message) => message.id).sort()).toEqual([spam.id, rude.id].sort());
    // Attendees still read an advised message; nothing about the check reaches them.
    const later = await f.connectChat("secondAttendee");
    const seen = (later.received[0] as Extract<LiveRoomServerMessage, { type: "location.chat.snapshot" }>).chat;
    expect(seen.map((message) => message.id)).toEqual([rude.id]);
    expect(seen[0].moderation ?? null).toBeNull();

    operator.send({ type: "chat.moderate", messageId: rude.id, decision: "keep" });
    const kept = await operator.next(
      "chat.message",
      (update) => update.message.id === rude.id && update.message.moderation?.automaticCheck === undefined,
    );
    expect(kept.message.moderation?.reports).toBe(0);
    expect(model.run).toHaveBeenCalledTimes(2);
  });

  it("refuses a question the check blocks and flags one it advises against", async () => {
    const author = await f.connect({ person: "attendee" });
    const operator = await f.connect({ person: "operator" });

    author.send({ type: "question.ask", text: "Where can I buy cheap certificates?", anonymous: false });
    const refused = await author.next("room.refused");
    expect(refused.code).toBe("LIVE_QUESTION_REFUSED_BY_CHECK");
    expect(refused.message.length).toBeGreaterThan(0);

    const text = "Why are the organizers such idiots about timing?";
    author.send({ type: "question.ask", text, anonymous: false });
    const asked = await operator.next("question.changed", (message) => message.question.text === text);
    expect(asked.question).toMatchObject({ status: "pending", automaticCheck: { outcome: "advised" } });
    const mine = await author.next("question.changed", (message) => message.question.text === text);
    expect(mine.question.automaticCheck).toBeUndefined();

    const snapshot = await f.connect({ person: "operator" });
    const questions = (await snapshot.next("room.snapshot")).questions;
    expect(questions.map((question) => question.text)).toEqual([text]);
  });

  it("lets chat and questions through unflagged when the model fails", async () => {
    model.run.mockRejectedValueOnce(new Error("model unavailable"));
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");
    const message = await say(author, "Buy cheap certificates at example.test", reader);
    await vi.waitFor(() => expect(model.run).toHaveBeenCalled());
    const fresh = await f.connectChat("operator");
    const snapshot = fresh.received[0] as Extract<LiveRoomServerMessage, { type: "location.chat.snapshot" }>;
    expect(snapshot.chatReports).toEqual([]);
    expect(snapshot.chat.find((entry) => entry.id === message.id)?.moderation?.automaticCheck).toBeUndefined();
    expect(operator.received.some((update) => update.type === "chat.removed")).toBe(false);
  });
});

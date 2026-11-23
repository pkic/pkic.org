import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRoomServerMessage } from "../assets/shared/schemas/live-session-room";
import { saveCheckSettings, sampleFlag } from "./helpers/content-check-settings";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connectChat>>;

/** A stand-in check model: words name the flag it raises, everything else passes. */
let gate: Promise<void> | null = null;
const model = {
  run: vi.fn(async (_model: string, input: { state: Record<string, string>; questions: Record<string, unknown> }) => {
    const text = Object.values(input.state).join(" ");
    // Words marked "slow" wait for the test to let the check finish.
    if (text.includes("slow") && gate) await gate;
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

/** Makes the next "slow" checks wait; the returned function lets them finish. */
function holdChecks(): () => void {
  let release = () => {};
  gate = new Promise<void>((resolve) => (release = resolve));
  return release;
}

describe("automatic checks of live chat and questions", () => {
  beforeEach(async () => {
    await f.setup();
    // Spam blocks from 90%; conduct at 75% only advises.
    const flags = [sampleFlag("spam", "Looks like spam."), sampleFlag("conduct", "May break the code of conduct.")];
    await saveCheckSettings("chat_message", flags);
    await saveCheckSettings("audience_question", flags);
    model.run.mockClear();
    gate = null;
    await giveRoomsTheModel();
  });

  it("holds chat the check blocks and flags chat it advises against for moderators", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");

    author.send({ type: "chat.send", text: "Buy cheap certificates at example.test" });
    const held = await operator.next("chat.message", (update) => update.message.moderation?.held === true);
    const spam = held.message;
    expect(held.message.moderation?.automaticCheck).toEqual({
      outcome: "blocked",
      notes: [expect.any(String)],
    });
    await reader.next("chat.removed", (update) => update.messageId === spam.id);
    expect(reader.received.some((update) => update.type === "chat.message" && update.message.id === spam.id)).toBe(
      false,
    );

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

  it("keeps chat from other attendees until the check passes, then delivers it", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");
    const release = holdChecks();
    const text = "A slow but friendly question about renewals";
    author.send({ type: "chat.send", text });
    const mine = await author.next("chat.message", (update) => update.message.text === text);
    await operator.next("chat.message", (update) => update.message.text === text);
    await vi.waitFor(() => expect(model.run).toHaveBeenCalled());
    expect(reader.received.some((update) => update.type === "chat.message" && update.message.text === text)).toBe(
      false,
    );
    const joining = await f.connectChat("secondAttendee");
    const waiting = (joining.received[0] as Extract<LiveRoomServerMessage, { type: "location.chat.snapshot" }>).chat;
    expect(waiting.map((message) => message.id)).not.toContain(mine.message.id);
    release();
    const delivered = await reader.next("chat.message", (update) => update.message.id === mine.message.id);
    expect(delivered.message.text).toBe(text);
  });

  it("delivers a message whose check does not answer in time, and still removes it when the check blocks it", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    // The room waits briefly here, so the test need not sit out the real wait limit.
    await runInDurableObject(f.chatRoom(), (instance) => {
      Reflect.set(Reflect.get(instance as object, "chatActions") as object, "checkWaitMs", 50);
    });
    const release = holdChecks();
    const text = "A slow offer of cheap certificates";
    author.send({ type: "chat.send", text });
    const late = await reader.next("chat.message", (update) => update.message.text === text);
    release();
    await reader.next("chat.removed", (update) => update.messageId === late.message.id);
  });

  it("keeps an edit that is still being checked out of the replies other attendees read", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const parent = await say(author, "Renewals take a week", reader);
    reader.send({ type: "chat.send", text: "Thanks", replyTo: parent.id });
    const reply = await author.next("chat.message", (update) => update.message.text === "Thanks");
    const release = holdChecks();
    const edited = "A slow edit with unchecked words";
    author.send({ type: "chat.edit", messageId: parent.id, text: edited });
    await author.next("chat.message", (update) => update.message.id === parent.id && update.message.text === edited);
    await vi.waitFor(() => expect(model.run).toHaveBeenCalledTimes(3));
    const joining = await f.connectChat("secondAttendee");
    const seen = (joining.received[0] as Extract<LiveRoomServerMessage, { type: "location.chat.snapshot" }>).chat;
    const quoted = seen.find((message) => message.id === reply.message.id)?.replyTo;
    expect(quoted).toMatchObject({ messageId: parent.id, excerpt: null });
    release();
  });

  it("keeps an advised verdict for moderators when delivering the checked message fails once", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const release = holdChecks();
    const text = "A slow remark: the organizers are idiots";
    author.send({ type: "chat.send", text });
    const mine = await author.next("chat.message", (update) => update.message.text === text);
    await runInDurableObject(f.chatRoom(), (instance) => {
      const actions = Reflect.get(instance as object, "chatActions") as object;
      const deliver = Reflect.get(actions, "deliver") as (...args: unknown[]) => Promise<void>;
      let failed = false;
      Reflect.set(actions, "deliver", function (this: unknown, ...args: unknown[]) {
        if (failed) return deliver.apply(this, args);
        failed = true;
        return Promise.reject(new Error("delivery failed"));
      });
    });
    release();
    await reader.next("chat.message", (update) => update.message.id === mine.message.id);
    const fresh = await f.connectChat("operator");
    const snapshot = fresh.received[0] as Extract<LiveRoomServerMessage, { type: "location.chat.snapshot" }>;
    expect(snapshot.chatReports?.find((message) => message.id === mine.message.id)?.moderation?.automaticCheck).toEqual(
      { outcome: "advised", notes: [expect.any(String)] },
    );
  });

  it("lets a moderator keep a message the check only advised against", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");
    const rude = await say(author, "The organizers are idiots", reader);
    await operator.next("chat.message", (update) => update.message.moderation?.automaticCheck !== undefined);
    operator.send({ type: "chat.moderate", messageId: rude.id, decision: "keep" });
    const kept = await operator.next(
      "chat.message",
      (update) => update.message.id === rude.id && update.message.moderation?.automaticCheck === undefined,
    );
    expect(kept.message.moderation?.reports).toBe(0);
  });

  it("refuses an edit of a question a moderator approved while it was being checked", async () => {
    const owner = await f.connect({ person: "attendee" });
    const moderator = await f.connect({ person: "operator" });
    owner.send({ type: "question.ask", text: "Which certificates first?", anonymous: false });
    const { questionId } = await owner.next("question.accepted");
    const release = holdChecks();
    const edit = {
      type: "question.edit" as const,
      questionId,
      text: "A slow rewrite nobody approved",
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    };
    owner.send(edit);
    await vi.waitFor(() => expect(model.run).toHaveBeenCalledTimes(2));
    moderator.send({ type: "question.moderate", questionId, status: "approved", expectedRevision: 0 });
    await moderator.next(
      "question.changed",
      (message) => message.question.id === questionId && message.question.status === "approved",
    );
    release();
    const refused = await owner.next("room.refused", (message) => message.operationId === edit.operationId);
    expect(refused.code).toBe("LIVE_QUESTION_EDIT_CLOSED");
    const snapshot = await (await f.connect({ person: "operator" })).next("room.snapshot");
    expect(snapshot.questions.map((question) => question.text)).toEqual(["Which certificates first?"]);
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

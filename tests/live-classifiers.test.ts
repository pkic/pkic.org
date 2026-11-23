import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_CHAT_POLICY } from "../assets/shared/live-chat-policy";
import type { LiveRoomServerMessage } from "../assets/shared/schemas/live-session-room";
import type { LiveRoomOnScreenLists } from "../functions/_lib/services/live-session/room-on-screen-lists";
import { saveCheckSettings, sampleFlag } from "./helpers/classifier-settings";
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

/** The ids the session room's on-air chat list shows now, with no delay of its own. */
async function onAir(): Promise<string[]> {
  const feed = await runInDurableObject(f.room(), (instance) => {
    const graphics = Reflect.get(instance as object, "graphics") as object;
    return (Reflect.get(graphics, "lists") as LiveRoomOnScreenLists).chatFeed({ count: 6, delaySeconds: 0 });
  });
  return feed.messages.map((message) => message.id);
}

/** What the location's room recorded about one message's check, for tuning. */
async function checkResult(messageId: string) {
  const row = await runInDurableObject(f.chatRoom(), (_room, state) =>
    state.storage.sql
      .exec<{ outcome: string; model: string | null; raised_json: string; scores_json: string }>(
        "SELECT outcome, model, raised_json, scores_json FROM room_chat_check_results WHERE message_id = ?",
        messageId,
      )
      .toArray(),
  );
  return row.map((result) => ({
    outcome: result.outcome,
    model: result.model,
    raised: JSON.parse(result.raised_json) as unknown,
    scores: JSON.parse(result.scores_json) as unknown,
  }))[0];
}

/** Makes the next "slow" checks wait; the returned function lets them finish. */
function holdChecks(): () => void {
  let release = () => {};
  gate = new Promise<void>((resolve) => (release = resolve));
  return release;
}

describe("classifiers of live chat and questions", () => {
  beforeEach(async () => {
    await f.setup();
    // Spam blocks from 90%; conduct at 75% only advises.
    const flags = [sampleFlag("spam", "Looks like spam."), sampleFlag("conduct", "May break the code of conduct.")];
    await saveCheckSettings("chat", flags);
    await saveCheckSettings("question", flags);
    model.run.mockClear();
    gate = null;
    await giveRoomsTheModel();
  });

  it("removes chat the check blocks from attendees and flags chat it advises against for moderators", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");

    // Attendees read the message at once; the check takes it away when it blocks it.
    const spam = await say(author, "Buy cheap certificates at example.test", reader);
    const held = await operator.next(
      "chat.message",
      (update) => update.message.id === spam.id && update.message.moderation?.held === true,
    );
    expect(held.message.moderation?.classifier).toEqual({
      outcome: "blocked",
      notes: [expect.any(String)],
      flags: [{ id: "spam", percent: 99 }],
    });
    expect(await reader.next("chat.removed", (update) => update.messageId === spam.id)).toMatchObject({
      moderated: true,
    });

    const rude = await say(author, "The organizers are idiots", reader);
    const flagged = await operator.next(
      "chat.message",
      (update) => update.message.id === rude.id && update.message.moderation?.classifier !== undefined,
    );
    expect(flagged.message.moderation).toMatchObject({
      held: false,
      hidden: null,
      classifier: { outcome: "advised" },
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
      (update) => update.message.id === rude.id && update.message.moderation?.classifier === undefined,
    );
    expect(kept.message.moderation?.reports).toBe(0);
    expect(model.run).toHaveBeenCalledTimes(2);
  });

  it("delivers chat to attendees at once and keeps it off air until the check passes", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    // The session's room reads the location's chat for its graphics.
    await f.connect({ person: "operator" });
    const release = holdChecks();
    const text = "A slow but friendly question about renewals";
    const sent = await say(author, text, reader);
    await vi.waitFor(() => expect(model.run).toHaveBeenCalled());
    expect(await onAir()).not.toContain(sent.id);
    release();
    await vi.waitFor(async () => expect(await onAir()).toContain(sent.id));
    // A passed check stays on record with every answer, so what the check missed can be found later.
    expect(await checkResult(sent.id)).toEqual({
      outcome: "passed",
      model: expect.any(String),
      raised: [],
      scores: [
        { id: "spam", percent: 2 },
        { id: "conduct", percent: 2 },
      ],
    });
  });

  it("keeps a flagged message off air, and puts it on once a moderator keeps it", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");
    await f.connect({ person: "operator" });
    const fine = await say(author, "Renewals take a week", reader);
    const rude = await say(author, "The organizers are idiots", reader);
    await operator.next(
      "chat.message",
      (update) => update.message.id === rude.id && update.message.moderation?.classifier !== undefined,
    );
    await vi.waitFor(async () => expect(await onAir()).toEqual([fine.id]));
    operator.send({ type: "chat.moderate", messageId: rude.id, decision: "keep" });
    await vi.waitFor(async () => expect(await onAir()).toEqual([fine.id, rude.id]));
  });

  it("pauses an attendee after repeated blocked messages, and never after one", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");
    const { blocks } = LIVE_CHAT_POLICY.checkPause;
    for (let count = 1; count <= blocks; count += 1) {
      const spam = await say(author, `Buy cheap certificates, offer ${count}`, reader);
      await reader.next("chat.removed", (update) => update.messageId === spam.id);
      if (count < blocks) expect(author.received.some((update) => update.type === "participation.access")).toBe(false);
    }
    const access = await author.next("participation.access");
    expect(access.restriction).toMatchObject({ block: "paused", until: expect.any(String) });
    await operator.next("chat.message", (update) => update.message.moderation?.authorRestriction?.block === "paused");
    author.send({ type: "chat.send", text: "Am I still here?" });
    expect((await author.next("room.refused")).code).toBe("LIVE_PARTICIPATION_BLOCKED");
  });

  it("counts a blocked verdict towards a pause even when a moderator already hid the message", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");
    const { blocks } = LIVE_CHAT_POLICY.checkPause;
    for (let count = 1; count < blocks; count += 1) {
      const spam = await say(author, `Buy cheap certificates, offer ${count}`, reader);
      await reader.next("chat.removed", (update) => update.messageId === spam.id);
    }
    const release = holdChecks();
    const last = await say(author, "A slow one: buy cheap certificates", reader);
    operator.send({ type: "chat.moderate", messageId: last.id, decision: "remove", reason: "spam" });
    await reader.next("chat.removed", (update) => update.messageId === last.id);
    release();
    expect((await author.next("participation.access")).restriction).toMatchObject({ block: "paused" });
  });

  it("keeps an advised verdict for moderators when delivering the checked message fails once", async () => {
    const author = await f.connectChat("attendee");
    const operator = await f.connectChat("operator");
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
    await operator.next(
      "chat.message",
      (update) => update.message.id === mine.message.id && update.message.moderation?.classifier !== undefined,
    );
    const fresh = await f.connectChat("operator");
    const snapshot = fresh.received[0] as Extract<LiveRoomServerMessage, { type: "location.chat.snapshot" }>;
    expect(snapshot.chatReports?.find((message) => message.id === mine.message.id)?.moderation?.classifier).toEqual(
      // Read back from the room's store, with the question it raised.
      { outcome: "advised", notes: [expect.any(String)], flags: [{ id: "conduct", percent: 75 }] },
    );
  });

  it("lets a moderator keep a message the check only advised against", async () => {
    const author = await f.connectChat("attendee");
    const reader = await f.connectChat("secondAttendee");
    const operator = await f.connectChat("operator");
    const rude = await say(author, "The organizers are idiots", reader);
    await operator.next("chat.message", (update) => update.message.moderation?.classifier !== undefined);
    operator.send({ type: "chat.moderate", messageId: rude.id, decision: "keep" });
    const kept = await operator.next(
      "chat.message",
      (update) => update.message.id === rude.id && update.message.moderation?.classifier === undefined,
    );
    expect(kept.message.moderation?.reports).toBe(0);
    // The keep settles the verdict for the chat, but what the check found stays on record.
    expect(await checkResult(rude.id)).toMatchObject({ outcome: "advised", raised: [{ id: "conduct", percent: 75 }] });
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
    expect(asked.question).toMatchObject({ status: "pending", classifier: { outcome: "advised" } });
    const mine = await author.next("question.changed", (message) => message.question.text === text);
    expect(mine.question.classifier).toBeUndefined();

    const snapshot = await f.connect({ person: "operator" });
    const questions = (await snapshot.next("room.snapshot")).questions;
    expect(questions.map((question) => question.text)).toEqual([text]);

    // What the check found reaches D1 with the question, every answer included, so it outlives the room.
    await runDurableObjectAlarm(f.room());
    const stored = await env.DB.prepare(
      "SELECT outcome, verdict_json FROM classifier_results WHERE kind = 'question' AND subject_id = ?",
    )
      .bind(asked.question.id)
      .first<{ outcome: string; verdict_json: string }>();
    expect(stored?.outcome).toBe("advised");
    expect(JSON.parse(stored!.verdict_json)).toMatchObject({
      flags: [{ id: "conduct", probabilityPercent: 75 }],
      answers: { conduct: { kind: "flag", probability: 0.75 }, spam: { kind: "flag", probability: 0.02 } },
    });
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
    expect(snapshot.chat.find((entry) => entry.id === message.id)?.moderation?.classifier).toBeUndefined();
    expect(operator.received.some((update) => update.type === "chat.removed")).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { liveRoomClientMessageSchema, type LiveRoomServerMessage } from "../assets/shared/schemas/live-session-room";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;
type AuxChanged = Extract<LiveRoomServerMessage, { type: "aux.changed" }>;

/** The projector's composition with one audience list, or reactions, on it, as the studio sends it. */
const projectorWith = (list: { topQuestions?: { count: number }; chatFeed?: { count: number }; reactions?: boolean }) =>
  liveRoomClientMessageSchema.parse({
    type: "aux.set",
    output: "projector",
    composition: {
      questionId: null,
      creditKey: null,
      pollId: null,
      pollPresentation: { chart: "bar" },
      ticker: null,
      panelists: null,
      ...list,
    },
  });

/** The projector as a source drawing it last received it, once it matches. */
async function projector(source: Client, where: (composition: AuxChanged["composition"]) => boolean) {
  return (await source.next("aux.changed", (message) => message.output === "projector" && where(message.composition)))
    .composition;
}

async function ask(author: Client, operator: Client, text: string, anonymous = false) {
  author.send({ type: "question.ask", text, anonymous });
  return (await operator.next("question.changed", (message) => message.question.text === text)).question;
}

async function say(author: Client, reader: Client, text: string, channel: "attendee" | "operator" = "attendee") {
  author.send({ type: "chat.send", text, channel });
  return (await reader.next("chat.message", (message) => message.message.text === text)).message;
}

describe("audience lists on an output", () => {
  beforeEach(() => f.setup());

  it("lists the open questions with the most votes, and follows votes and moderation live", async () => {
    const attendee = await f.connect({ person: "attendee" });
    const second = await f.connect({ person: "secondAttendee" });
    const speaker = await f.connect({ person: "speaker" });
    const operator = await f.connect({ person: "operator" });
    const source = await f.connectSource("projector");

    const early = await ask(attendee, operator, "Which algorithms should we pilot first?");
    const popular = await ask(attendee, operator, "How do we find every certificate we depend on?");
    const anonymous = await ask(attendee, operator, "Is hybrid signing worth it?", true);
    const pending = await ask(second, operator, "Still waiting for a moderator");
    const hidden = await ask(second, operator, "Off topic");
    for (const question of [early, popular, anonymous, hidden]) {
      operator.send({ type: "question.moderate", questionId: question.id, status: "approved" });
      await operator.next("question.changed", (m) => m.question.id === question.id && m.question.status === "approved");
    }
    operator.send({ type: "question.moderate", questionId: hidden.id, status: "hidden", expectedRevision: 0 });
    for (const voter of [second, speaker]) voter.send({ type: "question.vote", questionId: popular.id, voted: true });
    await operator.next("question.changed", (m) => m.question.id === popular.id && m.question.votes === 2);
    second.send({ type: "question.vote", questionId: early.id, voted: true });
    await operator.next("question.changed", (m) => m.question.id === early.id && m.question.votes === 1);

    operator.send(projectorWith({ topQuestions: { count: 3 } }));
    const listed = await projector(source, (composition) => composition.topQuestions !== null);
    // Most votes first, then the newer question; pending and hidden questions are not public, so never listed.
    expect(listed.topQuestions).toEqual({
      config: { count: 3 },
      questions: [
        { id: popular.id, text: popular.text, authorName: "Ada Attendee", votes: 2 },
        { id: early.id, text: early.text, authorName: "Ada Attendee", votes: 1 },
        { id: anonymous.id, text: anonymous.text, authorName: null, votes: 0 },
      ],
    });
    expect(listed.topQuestions?.questions.map((question) => question.id)).not.toContain(pending.id);

    // A vote reorders the list on the output without anyone touching the studio.
    for (const voter of [attendee, speaker]) voter.send({ type: "question.vote", questionId: early.id, voted: true });
    const reordered = await projector(source, (c) => c.topQuestions?.questions[0]?.id === early.id);
    expect(reordered.topQuestions?.questions.map((question) => question.votes)).toEqual([3, 2, 0]);

    // Answered and hidden questions leave the list; the count stays the operator's.
    operator.send({ type: "question.moderate", questionId: early.id, status: "answered", expectedRevision: 0 });
    operator.send({ type: "question.moderate", questionId: anonymous.id, status: "hidden", expectedRevision: 0 });
    const moderated = await projector(source, (c) => c.topQuestions?.questions.length === 1);
    expect(moderated.topQuestions).toMatchObject({ config: { count: 3 }, questions: [{ id: popular.id }] });

    // Withdrawn by its author, a question comes off as well.
    attendee.send({
      type: "question.withdraw",
      questionId: popular.id,
      expectedRevision: 0,
      operationId: crypto.randomUUID(),
    });
    expect((await projector(source, (c) => c.topQuestions?.questions.length === 0)).topQuestions?.config.count).toBe(3);
  });

  it("shows only attendee chat the broadcast may show, and takes moderated messages off at once", async () => {
    const attendee = await f.connect({ person: "attendee" });
    const second = await f.connect({ person: "secondAttendee" });
    const operator = await f.connect({ person: "operator" });
    const source = await f.connectSource("projector");

    const kept = await say(attendee, operator, "Great overview of the inventory step");
    await say(operator, operator, "Crew only: camera two is late", "operator");
    const reported = await say(second, operator, "Buy cheap certificates");
    const toHide = await say(second, operator, "Something rude");
    const toDelete = await say(attendee, operator, "Typo in my message");

    attendee.send({ type: "chat.report", messageId: reported.id, reason: "spam" });
    await operator.next("chat.message", (m) => m.message.id === reported.id && m.message.moderation?.reports === 1);
    operator.send({ type: "chat.moderate", messageId: toHide.id, decision: "hide" });
    await operator.next("chat.message", (m) => m.message.id === toHide.id && m.message.moderation?.hidden !== null);

    operator.send(projectorWith({ chatFeed: { count: 6 } }));
    const listed = await projector(source, (composition) => composition.chatFeed !== null);
    // Oldest first; the operators' channel, hidden and reported messages never reach an output.
    expect(listed.chatFeed?.messages).toEqual([
      { id: kept.id, authorName: "Ada Attendee", text: kept.text },
      { id: toDelete.id, authorName: "Ada Attendee", text: toDelete.text },
    ]);

    attendee.send({ type: "chat.delete", messageId: toDelete.id });
    await projector(source, (c) => c.chatFeed?.messages.length === 1);
    const fresh = await say(second, operator, "When are the slides shared?");
    await projector(source, (c) => c.chatFeed?.messages.at(-1)?.id === fresh.id);

    // A banned person's messages leave the output with them.
    operator.send({ type: "chat.restrict", messageId: fresh.id, restriction: "banned" });
    const afterBan = await projector(source, (c) => c.chatFeed?.messages.every((m) => m.id !== fresh.id) ?? false);
    expect(afterBan.chatFeed?.messages.map((message) => message.id)).toEqual([kept.id]);
    for (const message of source.received)
      if (message.type === "aux.changed")
        expect(JSON.stringify(message.composition.chatFeed)).not.toContain("Crew only");
  });

  it("turns floating reactions on for one output only", async () => {
    const attendee = await f.connect({ person: "attendee" });
    const operator = await f.connect({ person: "operator" });
    const source = await f.connectSource("projector");
    operator.send(projectorWith({ reactions: true }));
    expect((await projector(source, (composition) => composition.reactions)).reactions).toBe(true);
    // Program is its own composition: reactions stay off there until an operator turns them on.
    const snapshot = (await f.connect({ person: "operator" })).received[0] as Extract<
      LiveRoomServerMessage,
      { type: "room.snapshot" }
    >;
    expect(snapshot.stage.reactions).toBe(false);
    expect(snapshot.outputs.projector.reactions).toBe(true);
    // A source that draws reactions receives the bursts viewers send.
    attendee.send({ type: "reaction.send", reaction: "applause" });
    expect((await source.next("reaction.burst")).counts).toEqual({ applause: 1 });
  });
});

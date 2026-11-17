import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { LiveRoomServerMessage } from "../assets/shared/schemas/live-session-room";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;
beforeEach(() => f.setup());

async function question() {
  const owner = await f.connect({ person: "attendee" });
  const moderator = await f.connect({ person: "operator" });
  owner.send({ type: "question.ask", text: "How should we plan the certificate migration?", anonymous: false });
  const created = await owner.next("question.accepted");
  moderator.send({ type: "question.moderate", questionId: created.questionId, status: "approved" });
  await owner.next("question.changed", (message) => message.question.status === "approved");
  return { owner, moderator, questionId: created.questionId };
}
async function watch(client: Client, questionId: string) {
  client.send({ type: "question.answers.watch", questionId });
  return client.next("question.answers", (message) => message.questionId === questionId);
}
async function reply(client: Client, questionId: string, text: string) {
  const operationId = crypto.randomUUID();
  client.send({ type: "question.answer", questionId, operationId, text });
  return (await client.next("question.answer.result", (message) => message.operationId === operationId)).answerId;
}
function texts(thread: Extract<LiveRoomServerMessage, { type: "question.answers" }>) {
  return thread.answers.map((answer) => answer.text);
}

describe("answer votes, acceptance and removal", () => {
  it("orders by acceptance, then votes, then age, and keeps one accepted answer", async () => {
    const { owner, questionId } = await question();
    const attendee = await f.connect({ person: "secondAttendee" });
    const speaker = await f.connect({ person: "speaker" });
    await watch(owner, questionId);
    const older = await reply(attendee, questionId, "Inventory every certificate first.");
    const newer = await reply(speaker, questionId, "Automate renewal before shortening lifetimes.");

    attendee.send({ type: "question.answer.vote", questionId, answerId: older, voted: true });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ANSWER_OWN_VOTE");
    owner.send({ type: "question.answer.vote", questionId, answerId: newer, voted: true });
    const voted = await owner.next("question.answers", (message) => message.answers[0]?.id === newer);
    expect(voted.answers[0]).toMatchObject({ votes: 1, votedByMe: true });
    expect(voted).toMatchObject({ canVote: true, canModerate: false });

    const accept = (answerId: string, revision: number) => ({
      type: "question.answer.accept" as const,
      questionId,
      answerId,
      operationId: crypto.randomUUID(),
      expectedRevision: revision,
      accepted: true,
    });
    owner.send(accept(older, 0));
    const first = await owner.next("question.answers", (message) => Boolean(message.answers[0]?.acceptance));
    expect(texts(first)).toEqual([
      "Inventory every certificate first.",
      "Automate renewal before shortening lifetimes.",
    ]);
    const asked = await owner.next("question.changed", (message) => message.question.acceptedAnswer);
    expect(asked.question).toMatchObject({ answerCount: 2, acceptedAnswer: true });

    const revision = first.answers.find((answer) => answer.id === newer)!.revision;
    owner.send(accept(newer, revision));
    const replaced = await owner.next("question.answers", (message) =>
      message.answers.some((answer) => answer.id === newer && Boolean(answer.acceptance)),
    );
    expect(replaced.answers.filter((answer) => answer.acceptance !== null).map((answer) => answer.id)).toEqual([newer]);
  });

  it("removes an answer with a reason only its author and moderators still see", async () => {
    const { owner, moderator, questionId } = await question();
    const attendee = await f.connect({ person: "secondAttendee" });
    await watch(owner, questionId);
    await watch(attendee, questionId);
    const answerId = await reply(attendee, questionId, "Buy our product, link in bio.");
    const shown = await watch(moderator, questionId);
    expect(shown.canModerate).toBe(true);
    const revision = shown.answers[0].revision;

    owner.send({
      type: "question.answer.hide",
      questionId,
      answerId,
      hidden: true,
      reason: "spam",
      expectedRevision: revision,
    });
    expect((await owner.next("room.refused")).code).toBe("LIVE_ANSWER_MODERATORS_ONLY");
    moderator.send({
      type: "question.answer.hide",
      questionId,
      answerId,
      hidden: true,
      reason: "spam",
      expectedRevision: revision,
    });
    expect(texts(await owner.next("question.answers", (message) => message.answers.length === 0))).toEqual([]);
    const own = await attendee.next("question.answers", (message) => Boolean(message.answers[0]?.removal));
    expect(own.answers[0].removal).toMatchObject({ reason: "spam", byName: null });
    const staff = await moderator.next("question.answers", (message) => Boolean(message.answers[0]?.removal));
    expect(staff.answers[0].removal?.byName).toBe("Olga Operator");
    expect(
      (await owner.next("question.changed", (message) => message.question.answerCount === 0)).question.answerCount,
    ).toBe(0);
  });

  it("blocks a person for the whole event in D1 only when an organizer asks", async () => {
    const { moderator, questionId } = await question();
    const attendee = await f.connect({ person: "secondAttendee" });
    const answerId = await reply(attendee, questionId, "First, the inventory.");
    const item = { kind: "answer", questionId, answerId } as const;
    moderator.send({ type: "participation.block", item, block: "event", reason: "abuse", removePosts: false });
    const access = await attendee.next("participation.access");
    expect(access.restriction).toEqual({ block: "event", until: null });
    const row = await env.DB.prepare("SELECT reason, lifted_at FROM event_participation_blocks WHERE user_id=?")
      .bind(f.users.secondAttendee)
      .first();
    expect(row).toEqual({ reason: "abuse", lifted_at: null });
    attendee.send({ type: "question.ask", text: "Can I still ask?", anonymous: false });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_PARTICIPATION_BLOCKED");

    moderator.send({ type: "participation.lift", item });
    expect(
      (await attendee.next("participation.access", (message) => message.restriction === null)).restriction,
    ).toBeNull();
    const lifted = await env.DB.prepare("SELECT lifted_at FROM event_participation_blocks WHERE user_id=?")
      .bind(f.users.secondAttendee)
      .first<{ lifted_at: string | null }>();
    expect(lifted?.lifted_at).toMatch(/Z$/);
  });
});

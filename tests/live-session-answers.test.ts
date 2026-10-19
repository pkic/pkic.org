import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_QUESTION_ANSWER_POLICY } from "../assets/shared/live-session-policy";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;
beforeEach(() => f.setup());

async function question(anonymous = false, person: "attendee" | "secondAttendee" = "attendee") {
  const owner = await f.connect({ person });
  const moderator = await f.connect({ person: "operator" });
  owner.send({ type: "question.ask", text: "How should we plan the certificate migration?", anonymous });
  const created = await owner.next("question.accepted");
  moderator.send({ type: "question.moderate", questionId: created.questionId, status: "approved" });
  await owner.next("question.changed", (message) => message.question.status === "approved");
  return { owner, moderator, questionId: created.questionId };
}
async function watch(client: Client, questionId: string) {
  client.send({ type: "question.answers.watch", questionId });
  return client.next("question.answers", (message) => message.questionId === questionId);
}
async function reply(client: Client, questionId: string, text = "Start with the external certificate inventory.") {
  const operationId = crypto.randomUUID();
  client.send({ type: "question.answer", questionId, operationId, text });
  return client.next("question.answer.result", (message) => message.operationId === operationId);
}

describe("attendee answer threads", () => {
  it("accepts eligible attendee and speaker replies without duplicating retries or leaking contacts", async () => {
    const { owner, questionId } = await question();
    const attendee = await f.connect({ person: "secondAttendee" });
    const speaker = await f.connect({ person: "speaker" });
    expect(await watch(owner, questionId)).toMatchObject({ canAnswer: true, canAccept: true, answers: [] });
    expect(await watch(attendee, questionId)).toMatchObject({ canAnswer: true, canAccept: false });
    expect(await watch(speaker, questionId)).toMatchObject({ canAnswer: true, canAccept: false });
    const request = {
      type: "question.answer",
      operationId: crypto.randomUUID(),
      questionId,
      text: "Use the shared certificate inventory first.",
    } as const;
    attendee.send(request);
    const first = await attendee.next("question.answer.result");
    attendee.send(request);
    await vi.waitFor(() =>
      expect(attendee.received.filter((message) => message.type === "question.answer.result")).toHaveLength(2),
    );
    expect(attendee.received.filter((message) => message.type === "question.answer.result")).toEqual([first, first]);
    await reply(speaker, questionId, "Then prioritize the public-facing endpoints.");
    const thread = await owner.next("question.answers", (message) => message.answers.length === 2);
    expect(thread.answers.map((answer) => answer.authorName)).toEqual(["Bea Attendee", "Sam Speaker"]);
    expect(JSON.stringify(thread)).not.toContain("@example.test");
    expect(JSON.stringify(thread)).not.toContain(f.users.secondAttendee);
    attendee.send({ ...request, text: "Changed content for the same request" });
    expect(await attendee.next("room.refused", (message) => message.operationId === request.operationId)).toMatchObject(
      { code: "LIVE_ANSWER_REQUEST_CONFLICT" },
    );
  });

  it("reserves acceptance for the asker and authorized moderators, never speaker duties", async () => {
    const { owner, moderator, questionId } = await question();
    const attendee = await f.connect({ person: "secondAttendee" });
    const speaker = await f.connect({ person: "speaker" });
    const answer = await reply(attendee, questionId);
    const decision = {
      type: "question.answer.accept",
      questionId,
      answerId: answer.answerId,
      expectedRevision: 0,
      accepted: true,
      operationId: crypto.randomUUID(),
    } as const;
    for (const client of [attendee, speaker]) {
      client.send(decision);
      expect(await client.next("room.refused")).toMatchObject({ code: "LIVE_ANSWER_ACCEPT_FORBIDDEN" });
    }
    await watch(owner, questionId);
    owner.send(decision);
    await owner.next("question.answer.result", (message) => message.operationId === decision.operationId);
    const accepted = await owner.next("question.answers", (message) => message.answers[0]?.acceptance !== null);
    expect(accepted.answers[0]).toMatchObject({ revision: 1, acceptance: { byName: "Ada Attendee" } });
    moderator.send({ ...decision, operationId: crypto.randomUUID(), expectedRevision: 1, accepted: false });
    await moderator.next("question.answer.result");
    expect(
      (await owner.next("question.answers", (message) => message.answers[0]?.revision === 2)).answers[0].acceptance,
    ).toBeNull();
  });

  it("preserves anonymous question ownership when the asker accepts a reply", async () => {
    const { owner, questionId } = await question(true);
    const other = await f.connect({ person: "secondAttendee" });
    const answer = await reply(other, questionId);
    await watch(other, questionId);
    owner.send({
      type: "question.answer.accept",
      questionId,
      answerId: answer.answerId,
      expectedRevision: 0,
      accepted: true,
      operationId: crypto.randomUUID(),
    });
    await owner.next("question.answer.result");
    const thread = await other.next("question.answers", (message) => message.answers[0]?.acceptance !== null);
    expect(thread.answers[0].acceptance?.byName).toBeNull();
    expect(JSON.stringify(thread)).not.toContain("Ada Attendee");
    expect(JSON.stringify(thread)).not.toContain(f.users.attendee);
  });

  it("does not replay a stale acceptance decision over a later decision", async () => {
    const { owner, moderator, questionId } = await question();
    const answer = await reply(owner, questionId);
    const first = {
      type: "question.answer.accept",
      questionId,
      answerId: answer.answerId,
      expectedRevision: 0,
      accepted: true,
      operationId: crypto.randomUUID(),
    } as const;
    owner.send(first);
    await owner.next("question.answer.result", (message) => message.operationId === first.operationId);
    owner.send(first);
    await vi.waitFor(() =>
      expect(
        owner.received.filter(
          (message) => message.type === "question.answer.result" && message.operationId === first.operationId,
        ),
      ).toHaveLength(2),
    );
    moderator.send({ ...first, expectedRevision: 1, accepted: false, operationId: crypto.randomUUID() });
    await moderator.next("question.answer.result");
    owner.send(first);
    expect(await owner.next("room.refused")).toMatchObject({ code: "LIVE_ANSWER_CHANGED" });
  });

  it("clears subscribed threads when moderation hides their question", async () => {
    const { owner, moderator, questionId } = await question();
    const other = await f.connect({ person: "secondAttendee" });
    await reply(owner, questionId);
    await watch(other, questionId);
    moderator.send({ type: "question.moderate", questionId, status: "hidden" });
    expect(await other.next("question.answers", (message) => message.answers.length === 0)).toMatchObject({
      canAnswer: false,
      canAccept: false,
    });
    other.send({ type: "question.answer", questionId, text: "A reply after hiding", operationId: crypto.randomUUID() });
    expect(await other.next("room.refused")).toMatchObject({ code: "LIVE_ANSWER_NOT_FOUND" });
  });

  it("keeps reply rate limits after reconnect and refuses revoked attendance before writing", async () => {
    const { owner, questionId } = await question();
    const other = await f.connect({ person: "secondAttendee" });
    for (let index = 0; index < LIVE_QUESTION_ANSWER_POLICY.perPerson.limit; index += 1)
      await reply(other, questionId, `Useful reply number ${index}.`);
    const reconnected = await f.connect({ person: "secondAttendee" });
    reconnected.send({
      type: "question.answer",
      questionId,
      text: "One reply beyond the allowance.",
      operationId: crypto.randomUUID(),
    });
    expect(await reconnected.next("room.refused")).toMatchObject({ code: "LIVE_ROOM_RATE_LIMITED" });
    const closed = new Promise<number>((resolve) =>
      reconnected.socket.addEventListener("close", (event) => resolve(event.code)),
    );
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE user_id=?")
      .bind(f.users.secondAttendee)
      .run();
    reconnected.send({
      type: "question.answer",
      questionId,
      text: "Must not be accepted after revocation.",
      operationId: crypto.randomUUID(),
    });
    expect(await closed).toBe(4403);
    expect((await watch(owner, questionId)).answers).toHaveLength(LIVE_QUESTION_ANSWER_POLICY.perPerson.limit);
  });

  it("removes an anonymized reply-only participant before delivering thread history", async () => {
    const { owner, questionId } = await question();
    const other = await f.connect({ person: "secondAttendee" });
    await reply(other, questionId);
    expect((await watch(owner, questionId)).answers).toHaveLength(1);
    await env.DB.prepare("UPDATE users SET active=0,pii_redacted_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.users.secondAttendee)
      .run();
    const reconnected = await f.connect({ person: "attendee" });
    expect((await watch(reconnected, questionId)).answers).toEqual([]);
  });

  it("removes an anonymized moderator's attribution without removing another attendee's answer", async () => {
    const { moderator, questionId } = await question();
    const other = await f.connect({ person: "secondAttendee" });
    const answer = await reply(other, questionId);
    moderator.send({
      type: "question.answer.accept",
      questionId,
      answerId: answer.answerId,
      expectedRevision: 0,
      accepted: true,
      operationId: crypto.randomUUID(),
    });
    await moderator.next("question.answer.result");
    await env.DB.prepare("UPDATE users SET active=0,pii_redacted_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    const reconnected = await f.connect({ person: "attendee" });
    const thread = await watch(reconnected, questionId);
    expect(thread.answers).toHaveLength(1);
    expect(thread.answers[0]).toMatchObject({ revision: 2, acceptance: { byName: "Former participant" } });
    expect(JSON.stringify(thread)).not.toContain("Olga Operator");
  });

  it("cannot accept another question's answer by substituting a question id", async () => {
    const first = await question();
    const second = await question(false, "secondAttendee");
    const replyOwner = await f.connect({ person: "speaker" });
    const answer = await reply(replyOwner, second.questionId);
    first.owner.send({
      type: "question.answer.accept",
      questionId: first.questionId,
      answerId: answer.answerId,
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      accepted: true,
    });
    expect(await first.owner.next("room.refused")).toMatchObject({ code: "LIVE_ANSWER_NOT_FOUND" });
    expect((await watch(second.owner, second.questionId)).answers[0].acceptance).toBeNull();
  });

  it("delivers replies only for the viewer's latest expanded question", async () => {
    const first = await question();
    const second = await question(false, "secondAttendee");
    const viewer = await f.connect({ person: "speaker" });
    viewer.send({ type: "question.answers.watch", questionId: first.questionId });
    viewer.send({ type: "question.answers.watch", questionId: second.questionId });
    await viewer.next("question.answers", (message) => message.questionId === second.questionId);
    await reply(first.owner, first.questionId);
    await reply(second.owner, second.questionId);
    const latest = await viewer.next(
      "question.answers",
      (message) => message.questionId === second.questionId && message.answers.length === 1,
    );
    expect(latest.answers[0].authorName).toBe("Bea Attendee");
    expect(
      viewer.received.filter(
        (message) =>
          message.type === "question.answers" && message.questionId === first.questionId && message.answers.length > 0,
      ),
    ).toEqual([]);
  });

  it("erases a participant's replies and replies on their erased question", async () => {
    const { owner, questionId } = await question();
    const other = await f.connect({ person: "secondAttendee" });
    await reply(other, questionId);
    await watch(owner, questionId);
    await env.DB.prepare("UPDATE users SET active=0,pii_redacted_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.users.secondAttendee)
      .run();
    await f.room().forgetParticipant(f.users.secondAttendee);
    expect((await owner.next("question.answers", (message) => message.answers.length === 0)).answers).toEqual([]);
    await reply(owner, questionId, "A useful follow-up answer.");
    await env.DB.prepare("UPDATE users SET active=0,pii_redacted_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.users.attendee)
      .run();
    await f.room().forgetParticipant(f.users.attendee);
    const moderator = await f.connect({ person: "operator" });
    moderator.send({ type: "question.answers.watch", questionId });
    expect(await moderator.next("room.refused")).toMatchObject({ code: "LIVE_ANSWER_NOT_FOUND" });
  });
});

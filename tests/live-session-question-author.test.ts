import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRoomClientMessage } from "../assets/shared/schemas/live-session-room";
import { processLiveSessionErasures } from "../functions/_lib/services/live-session/room-erasure";
import { callApi } from "./helpers/app";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;
type Change = Extract<LiveRoomClientMessage, { type: "question.edit" | "question.withdraw" }>;
beforeEach(() => f.setup());
async function asked() {
  const owner = await f.connect({ person: "attendee" });
  const moderator = await f.connect({ person: "operator" });
  const request = {
    type: "question.ask",
    text: "Which certificates should we inventory first?",
    anonymous: true,
    operationId: crypto.randomUUID(),
  } as const;
  owner.send(request);
  const { questionId } = await owner.next("question.accepted");
  return { owner, moderator, questionId, request };
}
function edit(
  questionId: string,
  text = "Should we inventory external certificates first?",
  expectedRevision = 0,
): Change {
  return { type: "question.edit", questionId, text, expectedRevision, operationId: crypto.randomUUID() };
}
function withdraw(questionId: string, expectedRevision = 0): Change {
  return { type: "question.withdraw", questionId, expectedRevision, operationId: crypto.randomUUID() };
}
async function change(client: Client, input: Change) {
  client.send(input);
  return client.next("question.updated", (message) => message.operationId === input.operationId);
}
async function approve(client: Client, questionId: string, expectedRevision = 0) {
  client.send({ type: "question.moderate", questionId, status: "approved", expectedRevision });
  return client.next(
    "question.changed",
    (message) => message.question.id === questionId && message.question.status === "approved",
  );
}

describe("question author controls", () => {
  it("edits pending wording privately and replays edits and the original creation receipt after reconnect", async () => {
    const { owner, moderator, questionId, request } = await asked();
    const other = await f.connect({ person: "secondAttendee" });
    expect((await owner.next("question.changed")).question).toMatchObject({
      revision: 0,
      canEdit: true,
      withdrawn: false,
    });
    const input = edit(questionId);
    expect(await change(owner, input)).toMatchObject({ questionId, revision: 1 });
    expect(
      (await moderator.next("question.changed", (message) => message.question.revision === 1)).question,
    ).toMatchObject({ text: input.type === "question.edit" ? input.text : "", anonymous: true, canEdit: false });
    const reconnected = await f.connect({ person: "attendee" });
    expect(await change(reconnected, input)).toMatchObject({ revision: 1 });
    reconnected.send(request);
    expect((await reconnected.next("question.accepted")).questionId).toBe(questionId);
    // A repeated edit consumes no second write allowance (ask + first edit + second edit).
    await change(reconnected, edit(questionId, "Should inventory include the internal endpoints too?", 1));
    expect((await other.next("room.snapshot")).questions).toEqual([]);
    expect(other.received.filter((message) => message.type === "question.changed")).toEqual([]);
    const snapshot = await (await f.connect({ person: "attendee" })).next("room.snapshot");
    expect(snapshot.questions).toHaveLength(1);
    expect(snapshot.questions[0]).toMatchObject({ revision: 2, status: "pending", anonymous: true });
  });

  it("refuses conflicting and stale edits without overwriting a newer question", async () => {
    const { owner, questionId } = await asked();
    const input = edit(questionId);
    await change(owner, input);
    owner.send({ ...input, type: "question.edit", text: "Different wording for the same operation" });
    expect(await owner.next("room.refused", (message) => message.operationId === input.operationId)).toMatchObject({
      code: "LIVE_QUESTION_REQUEST_CONFLICT",
    });
    const stale = edit(questionId, "An old draft that must not overwrite the new one.");
    owner.send(stale);
    expect(await owner.next("room.refused", (message) => message.operationId === stale.operationId)).toMatchObject({
      code: "LIVE_QUESTION_CHANGED",
    });
    expect((await (await f.connect({ person: "attendee" })).next("room.snapshot")).questions[0].revision).toBe(1);
  });

  it("requires approval of the reviewed author version and keeps approved wording stable", async () => {
    const { owner, moderator, questionId } = await asked();
    await change(owner, edit(questionId));
    moderator.send({ type: "question.moderate", questionId, status: "approved", expectedRevision: 0 });
    expect(await moderator.next("room.refused")).toMatchObject({ code: "LIVE_QUESTION_CHANGED" });
    expect((await approve(moderator, questionId, 1)).question.canEdit).toBe(false);
    const afterReview = edit(questionId, "Changed after others may already have voted.", 1);
    owner.send(afterReview);
    expect(
      await owner.next("room.refused", (message) => message.operationId === afterReview.operationId),
    ).toMatchObject({ code: "LIVE_QUESTION_EDIT_CLOSED" });
  });

  it("allows only the asker to edit or withdraw, even when another caller is a moderator", async () => {
    const { owner, moderator, questionId } = await asked();
    const other = await f.connect({ person: "secondAttendee" });
    for (const caller of [other, moderator])
      for (const input of [edit(questionId), withdraw(questionId)]) {
        caller.send(input);
        expect(await caller.next("room.refused", (message) => message.operationId === input.operationId)).toMatchObject(
          { code: "LIVE_QUESTION_AUTHOR_REQUIRED" },
        );
      }
    expect((await owner.next("question.changed")).question.revision).toBe(0);
    const missing = edit(crypto.randomUUID());
    owner.send(missing);
    expect(await owner.next("room.refused", (message) => message.operationId === missing.operationId)).toMatchObject({
      code: "LIVE_QUESTION_NOT_FOUND",
    });
  });

  it("withdraws a question permanently from every output and lineup and safely retries after reconnect", async () => {
    const { owner, moderator, questionId, request } = await asked();
    await approve(moderator, questionId);
    moderator.send({ type: "stage.question", questionId });
    await moderator.next("stage.changed", (message) => message.stage.question?.id === questionId);
    moderator.send({
      type: "aux.set",
      output: "stage-display",
      composition: {
        questionId,
        creditKey: null,
        pollId: null,
        pollPresentation: { chart: "bar" },
        ticker: null,
        panelists: null,
      },
    });
    await moderator.next("aux.changed", (message) => message.composition.question?.id === questionId);
    moderator.send({ type: "preview.set", composition: { questionId } });
    await moderator.next("preview.changed", (message) => message.composition.question?.id === questionId);
    moderator.send({ type: "queue.add", view: "question", itemId: questionId });
    await moderator.next("queue.changed", (message) => message.queue.question.includes(questionId));
    const input = withdraw(questionId);
    expect(await change(owner, input)).toMatchObject({ revision: 1 });
    const snapshot = await (await f.connect({ person: "operator" })).next("room.snapshot");
    expect(snapshot.stage.question).toBeNull();
    expect(snapshot.preview.question).toBeNull();
    expect(snapshot.outputs["stage-display"].question).toBeNull();
    expect(snapshot.queue.question).toEqual([]);
    expect(snapshot.questions[0]).toMatchObject({ withdrawn: true, status: "hidden", canEdit: false, moderated: null });
    const publicSnapshot = await (await f.connect({ person: "secondAttendee" })).next("room.snapshot");
    expect(publicSnapshot.questions).toEqual([]);
    expect(publicSnapshot.stage.questionChange?.operatorName).toBe("Anonymous");
    expect(snapshot.preview.questionChange?.operatorName).toBe("Anonymous");
    expect(snapshot.outputs["stage-display"].questionChange?.operatorName).toBe("Anonymous");
    expect(snapshot.queue.change?.operatorName).toBe("Anonymous");
    await runDurableObjectAlarm(f.room());
    expect(
      await env.DB.prepare("SELECT status,moderated_by FROM event_session_questions WHERE id=?")
        .bind(questionId)
        .first(),
    ).toEqual({ status: "hidden", moderated_by: null });
    const reconnected = await f.connect({ person: "attendee" });
    expect(await change(reconnected, input)).toMatchObject({ revision: 1 });
    reconnected.send(request);
    await reconnected.next("question.accepted");
    moderator.send({ type: "question.moderate", questionId, status: "approved", expectedRevision: 1 });
    expect(await moderator.next("room.refused")).toMatchObject({ code: "LIVE_QUESTION_WITHDRAWN" });
  });

  it("cannot restore withdrawn question text from a cached Program undo", async () => {
    const { owner, moderator, questionId } = await asked();
    await approve(moderator, questionId);
    moderator.send({ type: "stage.question", questionId });
    await moderator.next("stage.changed", (message) => message.stage.question?.id === questionId);
    moderator.send({ type: "program.clear" });
    const cleared = await moderator.next("program.cleared");
    await change(owner, withdraw(questionId));
    const before = moderator.received.filter((message) => message.type === "stage.changed").length;
    moderator.send({ type: "program.restore", snapshotId: cleared.snapshotId });
    await vi.waitFor(() =>
      expect(moderator.received.filter((message) => message.type === "stage.changed")).toHaveLength(before + 1),
    );
    const restored = moderator.received.filter((message) => message.type === "stage.changed").at(-1)!;
    expect(restored.stage.question).toBeNull();
  });

  it("closes answer threads and acceptance when their question is withdrawn", async () => {
    const { owner, moderator, questionId } = await asked();
    await approve(moderator, questionId);
    const other = await f.connect({ person: "secondAttendee" });
    other.send({ type: "question.answers.watch", questionId });
    await other.next("question.answers");
    const operationId = crypto.randomUUID();
    other.send({
      type: "question.answer",
      questionId,
      operationId,
      text: "Start with the external service endpoints.",
    });
    const answer = await other.next("question.answer.result");
    await change(owner, withdraw(questionId));
    expect(await other.next("question.answers", (message) => !message.canAnswer)).toMatchObject({
      answers: [],
      canAccept: false,
    });
    const acceptId = crypto.randomUUID();
    owner.send({
      type: "question.answer.accept",
      questionId,
      answerId: answer.answerId,
      operationId: acceptId,
      expectedRevision: 0,
      accepted: true,
    });
    expect(await owner.next("room.refused", (message) => message.operationId === acceptId)).toMatchObject({
      code: "LIVE_ANSWERS_CLOSED",
    });
  });

  it("updates copied author wording but never restores redacted text, then erases the local edit receipt", async () => {
    const { owner, questionId } = await asked();
    await runDurableObjectAlarm(f.room());
    const firstEdit = edit(questionId, "Inventory public endpoints before internal endpoints.");
    await change(owner, firstEdit);
    await runDurableObjectAlarm(f.room());
    expect(
      await env.DB.prepare("SELECT body FROM event_session_questions WHERE id=?").bind(questionId).first(),
    ).toEqual({ body: "Inventory public endpoints before internal endpoints." });
    await change(owner, edit(questionId, "A last pending update before erasure.", 1));
    const erased = await callApi(env, `/api/v1/users/${f.users.attendee}/anonymize`, {
      method: "POST",
      headers: { authorization: `Bearer ${f.tokens.operator}`, origin: "https://app.test" },
    });
    expect(erased.status).toBe(200);
    await runDurableObjectAlarm(f.room());
    expect(
      await env.DB.prepare("SELECT body FROM event_session_questions WHERE id=?").bind(questionId).first(),
    ).toEqual({ body: "" });
    expect(await processLiveSessionErasures(env.DB, env.LIVE_SESSION_ROOMS, 10)).toMatchObject({
      completed: 1,
      failed: 0,
    });
    expect(
      await runInDurableObject(f.room(), (_room, state) =>
        state.storage.sql
          .exec(
            "SELECT (SELECT COUNT(*) FROM question_author_changes) AS edits,(SELECT COUNT(*) FROM question_write_times) AS writes",
          )
          .toArray(),
      ),
    ).toEqual([{ edits: 0, writes: 0 }]);
  });

  it("honors a recovered durable write allowance and expires old timestamps", async () => {
    const { questionId } = await asked();
    const userId = f.users.attendee;
    await runInDurableObject(f.room(), (_room, state) => {
      for (let index = 0; index < 2; index++)
        state.storage.sql.exec(
          "INSERT INTO question_write_times(id,user_id,accepted_at) VALUES(?,?,?)",
          crypto.randomUUID(),
          userId,
          new Date().toISOString(),
        );
    });
    const reconnected = await f.connect({ person: "attendee" });
    const blocked = edit(questionId);
    reconnected.send(blocked);
    expect(
      await reconnected.next("room.refused", (message) => message.operationId === blocked.operationId),
    ).toMatchObject({ code: "LIVE_ROOM_RATE_LIMITED" });
    await runInDurableObject(f.room(), (_room, state) => {
      state.storage.sql.exec("UPDATE question_write_times SET accepted_at='2000-01-01T00:00:00.000Z'");
    });
    expect(await change(reconnected, edit(questionId))).toMatchObject({ revision: 1 });
    expect(
      await runInDurableObject(f.room(), (_room, state) =>
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM question_write_times").toArray(),
      ),
    ).toEqual([{ count: 1 }]);
  });

  it("allows withdrawal even when the author's question-write allowance is exhausted", async () => {
    const { owner, questionId } = await asked();
    await change(owner, edit(questionId));
    await change(owner, edit(questionId, "Include renewal ownership in the inventory.", 1));
    const blocked = edit(questionId, "One change beyond this minute's allowance.", 2);
    owner.send(blocked);
    expect(await owner.next("room.refused", (message) => message.operationId === blocked.operationId)).toMatchObject({
      code: "LIVE_ROOM_RATE_LIMITED",
    });
    expect(await change(owner, withdraw(questionId, 2))).toMatchObject({ revision: 3 });
  });

  it("rechecks current attendance before accepting an author edit", async () => {
    const { owner, moderator, questionId } = await asked();
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE user_id=?").bind(f.users.attendee).run();
    const closed = new Promise<number>((resolve) =>
      owner.socket.addEventListener("close", (event) => resolve(event.code)),
    );
    owner.send(edit(questionId));
    expect(await closed).toBe(4403);
    expect((await moderator.next("question.changed")).question.revision).toBe(0);
  });
});

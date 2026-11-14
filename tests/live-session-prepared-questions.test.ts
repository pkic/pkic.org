import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { queryAll } from "./helpers/context";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;
beforeEach(() => f.setup());

const speakerKey = () => `user:${f.users.speaker}`;

async function prepare(operator: Client, text: string, addressedTo: string | null = null) {
  const after = operator.received.length;
  operator.send({ type: "question.prepare", preparedId: null, text, addressedTo });
  const changed = await operator.next(
    "question.prepared.changed",
    (message) => message.preparedQuestions.some((question) => question.text === text),
    { after },
  );
  return changed.preparedQuestions.find((question) => question.text === text)!;
}

describe("who a question is for", () => {
  it("records a credited addressee for everyone and puts it on air with the question", async () => {
    const attendee = await f.connect({ person: "attendee" });
    const operator = await f.connect({ person: "operator" });
    attendee.send({
      type: "question.ask",
      text: "How do you rotate roots?",
      anonymous: false,
      addressedTo: speakerKey(),
    });
    const { questionId } = await attendee.next("question.accepted");
    expect((await attendee.next("question.changed")).question).toMatchObject({
      addressedTo: speakerKey(),
      prepared: false,
    });
    operator.send({ type: "question.moderate", questionId, status: "approved" });
    await operator.next("question.changed", (message) => message.question.status === "approved");
    const other = await f.connect({ person: "secondAttendee" });
    expect((await other.next("room.snapshot")).questions[0]).toMatchObject({
      id: questionId,
      addressedTo: speakerKey(),
    });
    operator.send({ type: "stage.question", questionId });
    expect((await operator.next("stage.changed")).stage.question).toMatchObject({ addressedTo: speakerKey() });
  });

  it("refuses a person the session does not credit", async () => {
    const attendee = await f.connect({ person: "attendee" });
    attendee.send({
      type: "question.ask",
      text: "Who is this for?",
      anonymous: false,
      addressedTo: `user:${f.users.outsider}`,
    });
    expect(await attendee.next("room.refused")).toMatchObject({ code: "LIVE_QUESTION_ADDRESSEE_NOT_FOUND" });
    const operator = await f.connect({ person: "operator" });
    expect((await operator.next("room.snapshot")).questions).toEqual([]);
  });
});

describe("prepared questions", () => {
  it("shows waiting questions to operators only, within the default release window", async () => {
    const operator = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    const prepared = await prepare(operator, "What breaks first after a root expires?", speakerKey());
    const { session, preparedQuestionWindow } = await operator.next("room.snapshot");
    expect(preparedQuestionWindow).toEqual({
      from: new Date(Date.parse(session.startAt) + 5 * 60_000).toISOString(),
      until: new Date(Date.parse(session.endAt) - 15 * 60_000).toISOString(),
    });
    expect(prepared).toMatchObject({ addressedTo: speakerKey(), revision: 0 });
    expect(Date.parse(prepared.releaseAt)).toBeLessThanOrEqual(Date.parse(preparedQuestionWindow!.until));
    // The room's alarm is due by the release moment.
    const alarm = await runInDurableObject(f.room(), (_instance, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(Date.parse(prepared.releaseAt));
    const fresh = await (await f.connect({ person: "operator" })).next("room.snapshot");
    expect(fresh.preparedQuestions.map((question) => question.id)).toEqual([prepared.id]);
    const audience = await (await f.connect({ person: "secondAttendee" })).next("room.snapshot");
    expect(audience).toMatchObject({ preparedQuestions: [], preparedQuestionWindow: null });
    expect(attendee.received.some((message) => message.type === "question.prepared.changed")).toBe(false);
    attendee.send({ type: "question.prepared.release", preparedId: prepared.id });
    expect(await attendee.next("room.refused")).toMatchObject({ code: "LIVE_ROOM_OPERATOR_REQUIRED" });
  });

  it("releases now as an approved anonymous question that only operators can tell was prepared", async () => {
    const operator = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    const prepared = await prepare(operator, "Which inventory tool do you trust?", speakerKey());
    operator.send({ type: "question.prepared.release", preparedId: prepared.id });
    const seen = (await attendee.next("question.changed", (message) => message.question.id === prepared.id)).question;
    expect(seen).toMatchObject({
      text: "Which inventory tool do you trust?",
      status: "approved",
      votes: 0,
      anonymous: true,
      authorName: null,
      mine: false,
      prepared: false,
      addressedTo: speakerKey(),
    });
    expect(
      (await operator.next("question.changed", (message) => message.question.id === prepared.id)).question,
    ).toMatchObject({ prepared: true, status: "approved" });
    expect((await operator.next("question.prepared.changed")).preparedQuestions).toEqual([]);
    attendee.send({ type: "question.vote", questionId: prepared.id, voted: true });
    await attendee.next("question.changed", (message) => message.question.votes === 1);
    const snapshot = await (await f.connect({ person: "secondAttendee" })).next("room.snapshot");
    expect(snapshot.questions[0]).toMatchObject({ id: prepared.id, prepared: false, authorName: null });
  });

  it("releases a due question on the room's alarm with nobody connected, and copies it for reporting", async () => {
    const operator = await f.connect({ person: "operator" });
    const prepared = await prepare(operator, "What did your first audit miss?", speakerKey());
    operator.socket.close(1000, "Done preparing");
    const past = new Date(Date.now() - 1000).toISOString();
    await runInDurableObject(f.room(), (_instance, state) => {
      state.storage.sql.exec("UPDATE prepared_questions SET release_at = ?", past);
    });
    expect(await runDurableObjectAlarm(f.room())).toBe(true);
    const attendee = await f.connect({ person: "attendee" });
    const question = (await attendee.next("room.snapshot")).questions.find((entry) => entry.id === prepared.id);
    expect(question).toMatchObject({ status: "approved", anonymous: true, votes: 0, prepared: false });
    expect(Date.parse(question!.askedAt)).toBeGreaterThan(Date.parse(past));
    expect(await runDurableObjectAlarm(f.room())).toBe(true);
    expect(
      await queryAll(
        env.DB,
        "SELECT id,anonymous,status,vote_count,prepared,addressed_to_user_id FROM event_session_questions WHERE occurrence_id=?",
        [f.occurrenceId],
      ),
    ).toEqual([
      {
        id: prepared.id,
        anonymous: 1,
        status: "approved",
        vote_count: 0,
        prepared: 1,
        addressed_to_user_id: f.users.speaker,
      },
    ]);
  });

  it("copies an asked question's addressee and never copies a question still waiting", async () => {
    const attendee = await f.connect({ person: "attendee" });
    const operator = await f.connect({ person: "operator" });
    // A window well ahead keeps the prepared question waiting through this alarm.
    operator.send({
      type: "question.prepared.window",
      from: new Date(Date.now() + 20 * 60_000).toISOString(),
      until: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    await operator.next("question.prepared.changed");
    await prepare(operator, "This one stays in the room for now.");
    attendee.send({
      type: "question.ask",
      text: "For the speaker, please",
      anonymous: true,
      addressedTo: speakerKey(),
    });
    const { questionId } = await attendee.next("question.accepted");
    expect(await runDurableObjectAlarm(f.room())).toBe(true);
    expect(
      await queryAll(
        env.DB,
        "SELECT id,prepared,addressed_to_user_id FROM event_session_questions WHERE occurrence_id=?",
        [f.occurrenceId],
      ),
    ).toEqual([{ id: questionId, prepared: 0, addressed_to_user_id: f.users.speaker }]);
  });

  it("redraws every waiting question within a changed window and refuses a reversed one", async () => {
    const operator = await f.connect({ person: "operator" });
    for (const text of ["First prepared question", "Second prepared question", "Third prepared question"])
      await prepare(operator, text);
    const from = new Date(Date.now() + 10 * 60_000).toISOString();
    const until = new Date(Date.now() + 12 * 60_000).toISOString();
    const after = operator.received.length;
    operator.send({ type: "question.prepared.window", from, until });
    const changed = await operator.next("question.prepared.changed", (message) => message.window.from === from, {
      after,
    });
    expect(changed.window).toEqual({ from, until });
    expect(changed.preparedQuestions).toHaveLength(3);
    for (const question of changed.preparedQuestions) {
      expect(Date.parse(question.releaseAt)).toBeGreaterThanOrEqual(Date.parse(from));
      expect(Date.parse(question.releaseAt)).toBeLessThanOrEqual(Date.parse(until));
    }
    operator.socket.send(JSON.stringify({ type: "question.prepared.window", from: until, until: from }));
    expect(await operator.next("room.refused")).toMatchObject({ code: "LIVE_ROOM_INVALID_MESSAGE" });
  });

  it("edits a waiting question against its revision and deletes it", async () => {
    const operator = await f.connect({ person: "operator" });
    const prepared = await prepare(operator, "A first wording");
    operator.send({
      type: "question.prepare",
      preparedId: prepared.id,
      text: "A better wording",
      addressedTo: speakerKey(),
      expectedRevision: 0,
    });
    const edited = await operator.next("question.prepared.changed", (message) =>
      message.preparedQuestions.some((question) => question.text === "A better wording"),
    );
    expect(edited.preparedQuestions[0]).toMatchObject({
      revision: 1,
      addressedTo: speakerKey(),
      releaseAt: prepared.releaseAt,
    });
    operator.send({
      type: "question.prepare",
      preparedId: prepared.id,
      text: "A stale wording",
      addressedTo: null,
      expectedRevision: 0,
    });
    expect(await operator.next("room.refused")).toMatchObject({ code: "LIVE_PREPARED_QUESTION_CHANGED" });
    operator.send({ type: "question.prepared.delete", preparedId: prepared.id });
    expect(
      (await operator.next("question.prepared.changed", (message) => message.preparedQuestions.length === 0))
        .preparedQuestions,
    ).toEqual([]);
  });
});

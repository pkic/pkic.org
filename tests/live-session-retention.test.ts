import { livePollDraftSchema } from "../assets/shared/schemas/live-session-poll";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { LIVE_ROOM_POLICY } from "../assets/shared/live-session-policy";
import { processLiveSessionErasures } from "../functions/_lib/services/live-session/room-erasure";
import { callApi } from "./helpers/app";
import { queryAll } from "./helpers/context";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;

async function askApproved(author: Client, operator: Client, text: string) {
  author.send({ type: "question.ask", text, anonymous: false });
  const asked = await operator.next("question.changed", (message) => message.question.text === text);
  operator.send({ type: "question.moderate", questionId: asked.question.id, status: "approved" });
  await operator.next("question.changed", (message) => message.question.status === "approved");
  return asked.question.id;
}

async function anonymize(person: "attendee") {
  const response = await callApi(env, `/api/v1/users/${f.users[person]}/anonymize`, {
    method: "POST",
    headers: { authorization: `Bearer ${f.tokens.operator}`, origin: "https://app.test" },
  });
  expect(response.status).toBe(200);
}

describe("live session room retention", () => {
  it("erases the room's storage after the session, once its durable copy reached D1", async () => {
    await f.setup();
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "question.ask", text: "Asked long ago", anonymous: false });
    await operator.next("question.changed");

    // Capture while the room is live, then age its stored and approved schedule beyond retention.
    // Opening an already-expired room correctly schedules immediate erasure, not new writes.
    const days = LIVE_ROOM_POLICY.storagePurgeAfterEndDays + 1;
    const endAt = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    const startAt = new Date(Date.parse(endAt) - 60 * 60_000).toISOString();
    await env.DB.prepare(
      "UPDATE event_agenda_published_occurrences SET payload_json=json_set(payload_json,'$.startAt',?,'$.endAt',?) WHERE event_id=? AND occurrence_id=?",
    )
      .bind(startAt, endAt, f.eventId, f.occurrenceId)
      .run();
    await runInDurableObject(f.room(), (_room, state) => {
      state.storage.sql.exec(
        "UPDATE room_session SET session_json=json_set(session_json,'$.startAt',?,'$.endAt',?) WHERE id=1",
        startAt,
        endAt,
      );
    });
    const expired = new Promise<{ code: number; reason: string }>((resolve) =>
      operator.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await runDurableObjectAlarm(f.room());
    expect(await expired).toEqual({ code: 1001, reason: "This session's room has closed" });
    // The client side waits for its close acknowledgement; it must no longer be open.
    expect(operator.socket.readyState).not.toBe(WebSocket.OPEN);
    expect(
      await queryAll(env.DB, "SELECT body FROM event_session_questions WHERE occurrence_id=?", [f.occurrenceId]),
    ).toEqual([{ body: "Asked long ago" }]);
    // A late erasure request finds nothing and leaves the erased room empty.
    await f.room().forgetParticipant(f.users.operator);
    expect(
      await runInDurableObject(f.room(), (_room, state) =>
        state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='questions'").toArray(),
      ),
    ).toEqual([]);
    const again = await f.connect({ person: "operator" });
    expect((await again.next("room.snapshot")).questions).toEqual([]);
  });

  it("keeps a running room's storage until the purge is due", async () => {
    await f.setup();
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "question.ask", text: "Still here", anonymous: false });
    await operator.next("question.changed");
    await runDurableObjectAlarm(f.room());
    await runDurableObjectAlarm(f.room());
    const again = await f.connect({ person: "operator" });
    expect((await again.next("room.snapshot")).questions.map((question) => question.text)).toEqual(["Still here"]);
  });
});

describe("live session anonymization", () => {
  beforeEach(() => f.setup());

  it("redacts the person's copied questions and has each room forget their questions, votes and ballots", async () => {
    const operator = await f.connect({ person: "operator" });
    const author = await f.connect({ person: "attendee" });
    const other = await f.connect({ person: "secondAttendee" });
    const copied = await askApproved(author, operator, "Will my name stay here?");
    const kept = await askApproved(other, operator, "A question that stays");
    author.send({ type: "question.vote", questionId: kept, voted: true });
    operator.send({
      type: "poll.save",
      pollId: null,
      draft: livePollDraftSchema.parse({
        field: { key: "ready", label: "Ready?", fieldType: "select", options: ["Yes", "No"] },
        showResults: true,
      }),
    });
    const poll = (await operator.next("poll.changed")).poll;
    operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
    await author.next("poll.changed", (message) => message.poll.status === "open");
    author.send({ type: "poll.vote", pollId: poll.id, answer: "Yes" });
    await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 1);
    await operator.next("question.changed", (message) => message.question.id === kept && message.question.votes === 1);
    await runDurableObjectAlarm(f.room());
    // Asked after the last copy: the next copy must not write it back unredacted.
    author.send({ type: "question.ask", text: "Asked just before erasure", anonymous: false });
    await operator.next("question.changed", (message) => message.question.text === "Asked just before erasure");

    await anonymize("attendee");
    expect(
      await queryAll(
        env.DB,
        "SELECT body,redacted_at IS NOT NULL AS redacted FROM event_session_questions WHERE id=?",
        [copied],
      ),
    ).toEqual([{ body: "", redacted: 1 }]);
    await runDurableObjectAlarm(f.room());
    expect(
      await queryAll(env.DB, "SELECT body FROM event_session_questions WHERE author_user_id=? ORDER BY asked_at", [
        f.users.attendee,
      ]),
    ).toEqual([{ body: "" }, { body: "" }]);

    expect(await processLiveSessionErasures(env.DB, env.LIVE_SESSION_ROOMS, 10)).toEqual({
      selected: 1,
      completed: 1,
      failed: 0,
    });
    await operator.next("question.removed", (message) => message.questionId === copied);
    await operator.next("question.changed", (message) => message.question.id === kept && message.question.votes === 0);
    await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 0);
    const snapshot = await (await f.connect({ person: "operator" })).next("room.snapshot");
    expect(snapshot.questions.map((question) => question.text)).toEqual(["A question that stays"]);
    expect(
      await queryAll(
        env.DB,
        "SELECT completed_at IS NOT NULL AS done FROM event_session_room_erasures WHERE user_id=?",
        [f.users.attendee],
      ),
    ).toEqual([{ done: 1 }]);
    expect(await processLiveSessionErasures(env.DB, env.LIVE_SESSION_ROOMS, 10)).toMatchObject({ selected: 0 });
  });
});

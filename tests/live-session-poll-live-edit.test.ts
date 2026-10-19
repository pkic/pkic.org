import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { LIVE_POLL_POLICY } from "../assets/shared/live-session-policy";
import { livePollDraftSchema, type LivePoll } from "../assets/shared/schemas/live-session-poll";
import { queryAll } from "./helpers/context";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;

function field(label: string, choices: Array<[value: string, label: string]>, fieldType = "select") {
  return {
    key: "answer",
    label,
    fieldType,
    options: choices.map(([value, text]) => ({ value, label: text, active: true })),
    validation: { uiWidget: fieldType === "select" ? "radios" : "checkboxes" },
  };
}

const START: Array<[string, string]> = [
  ["root", "Root CA"],
  ["tls", "TLS endpionts"],
  ["code", "Code signing"],
];

async function openPoll(operator: Client, fieldType = "select") {
  operator.send({
    type: "poll.save",
    pollId: null,
    draft: livePollDraftSchema.parse({ field: field("Which comes first?", START, fieldType), showResults: true }),
  });
  const poll = (await operator.next("poll.changed")).poll;
  operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
  await operator.next("poll.changed", (message) => message.poll.status === "open");
  return poll;
}

function counts(poll: LivePoll) {
  return Object.fromEntries((poll.results?.entries ?? []).map((entry) => [entry.label, entry.count]));
}

describe("live poll corrections and live results", () => {
  beforeEach(() => f.setup());

  it("rewords an open poll for everyone and keeps every answer with its choice", async () => {
    const operator = await f.connect({ person: "operator" });
    const poll = await openPoll(operator);
    const voter = await f.connect({ person: "attendee" });
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "tls" });
    await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 1);
    const corrected: Array<[string, string]> = [
      ["root", "Root CA"],
      ["tls", "TLS endpoints"],
      ["code", "Code signing"],
      ["mail", "S/MIME"],
    ];
    operator.send({
      type: "poll.save",
      pollId: poll.id,
      draft: livePollDraftSchema.parse({ field: field("Which comes first in 2027?", corrected), showResults: true }),
    });
    const changed = await voter.next("poll.changed", (message) => message.poll.field.label.endsWith("2027?"));
    expect(changed.poll.status).toBe("open");
    expect(changed.poll.myAnswer).toBe("tls");
    const desk = await operator.next("poll.changed", (message) => message.poll.field.label.endsWith("2027?"));
    expect(counts(desk.poll)).toEqual({ "Root CA": 0, "TLS endpoints": 1, "Code signing": 0, "S/MIME": 0 });
  });

  it("drops a removed choice's answers only once the operator confirms, and keeps the answer type", async () => {
    const operator = await f.connect({ person: "operator" });
    const poll = await openPoll(operator, "multi_select");
    const voter = await f.connect({ person: "attendee" });
    const other = await f.connect({ person: "secondAttendee" });
    voter.send({ type: "poll.vote", pollId: poll.id, answer: ["root", "code"] });
    other.send({ type: "poll.vote", pollId: poll.id, answer: ["code"] });
    await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 2);
    const without = livePollDraftSchema.parse({
      field: field("Which comes first?", START.slice(0, 2), "multi_select"),
      showResults: true,
    });
    operator.send({ type: "poll.save", pollId: poll.id, draft: without });
    expect((await operator.next("room.refused")).code).toBe("LIVE_POLL_ANSWERS_REMOVED");
    operator.send({
      type: "poll.save",
      pollId: poll.id,
      draft: livePollDraftSchema.parse({
        field: { ...field("Which comes first?", START), key: "answer" },
        showResults: true,
      }),
    });
    expect((await operator.next("room.refused", (message) => message.code !== "LIVE_POLL_ANSWERS_REMOVED")).code).toBe(
      "LIVE_POLL_ANSWER_TYPE_FIXED",
    );
    operator.send({ type: "poll.save", pollId: poll.id, draft: without, discardRemovedAnswers: true });
    const trimmed = await operator.next("poll.changed", (message) => message.poll.results?.entries.length === 2);
    // The first voter keeps the choice that remains; the second had only the removed one.
    expect(counts(trimmed.poll)).toEqual({ "Root CA": 1, "TLS endpionts": 0 });
    expect(trimmed.poll.results?.totalAnswers).toBe(1);
    expect((await other.next("poll.changed", (message) => message.poll.myAnswer === null)).poll.results).toBeNull();
    await runDurableObjectAlarm(f.room());
    const copied = await queryAll<{ value: string; vote_count: number }>(
      env.DB,
      "SELECT value, vote_count FROM event_session_poll_tallies WHERE poll_id=? ORDER BY value",
      [poll.id],
    );
    expect(copied).toEqual([{ value: "root", vote_count: 1 }]);
    const audit = await queryAll(env.DB, "SELECT action FROM audit_log WHERE action='live_session.poll.edited'");
    expect(audit).toHaveLength(1);
  });

  it("gathers the votes of one tally window into one results update for the stage", async () => {
    const operator = await f.connect({ person: "operator" });
    const poll = await openPoll(operator);
    operator.send({ type: "stage.poll", pollId: poll.id });
    await operator.next("stage.changed", (message) => message.stage.poll?.id === poll.id);
    const before = operator.received.filter((message) => message.type === "poll.changed").length;
    const voter = await f.connect({ person: "attendee" });
    const other = await f.connect({ person: "secondAttendee" });
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "root" });
    other.send({ type: "poll.vote", pollId: poll.id, answer: "code" });
    const tallied = await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 2);
    expect(counts(tallied.poll)).toMatchObject({ "Root CA": 1, "Code signing": 1 });
    await new Promise((resolve) => setTimeout(resolve, LIVE_POLL_POLICY.tallyBroadcastMilliseconds + 200));
    // Two ballots within one window reach the desk as one update, not one each.
    expect(operator.received.filter((message) => message.type === "poll.changed").length - before).toBe(1);
  });
});

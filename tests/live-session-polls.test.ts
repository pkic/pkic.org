import { storedAgendaSnapshotSchema } from "../assets/shared/schemas/event-agenda-stored";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { liveOverlayAccessResponseSchema } from "../assets/shared/schemas/live-session-room";
import { livePollResultsResponseSchema } from "../assets/shared/schemas/live-session-poll-results";
import { livePollDraftSchema, livePollFieldSchema, type LivePoll } from "../assets/shared/schemas/live-session-poll";
import { callApi } from "./helpers/app";
import { queryAll } from "./helpers/context";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
type Client = Awaited<ReturnType<typeof f.connect>>;

const CHOICES = ["Root CA", "TLS endpoints", "Code signing"];

/** A poll's question as the forms editor sends it. */
function choiceField(label: string, fieldType: "select" | "multi_select" = "select") {
  return { key: "answer", label, fieldType, options: CHOICES, validation: { uiWidget: "radios" as const } };
}

async function preparePoll(
  operator: Client,
  label = "Which migration comes first?",
  showResults = true,
  field: Record<string, unknown> = choiceField(label),
) {
  operator.send({
    type: "poll.save",
    pollId: null,
    draft: livePollDraftSchema.parse({ field: { ...field, label }, showResults }),
  });
  return (await operator.next("poll.changed", (message) => message.poll.field.label === label)).poll;
}

/** Each answer's count as the results chart draws it, or null while hidden. */
function counts(poll: LivePoll) {
  return poll.results ? Object.fromEntries(poll.results.entries.map((entry) => [entry.label, entry.count])) : null;
}

describe("live session polls", () => {
  beforeEach(() => f.setup());
  afterEach(() => vi.useRealTimers());

  it("keeps drafts to operators, opens one poll at a time and reopens voting with retained answers", async () => {
    const operator = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    const first = await preparePoll(operator);
    const second = await preparePoll(operator, "Which algorithm do you trust?");
    expect(first).toMatchObject({ status: "draft", showResults: true, field: { required: true } });
    expect(counts(first)).toEqual({ "Root CA": 0, "TLS endpoints": 0, "Code signing": 0 });
    expect(first.change?.operatorName).toBe("Olga Operator");
    expect(attendee.received.some((message) => message.type === "poll.changed")).toBe(false);

    operator.send({ type: "poll.status", pollId: first.id, status: "open" });
    const opened = await attendee.next("poll.changed");
    expect(opened.poll).toMatchObject({ id: first.id, status: "open", results: null, change: null });
    operator.send({ type: "poll.status", pollId: second.id, status: "open" });
    expect((await operator.next("room.refused")).code).toBe("LIVE_POLL_ALREADY_OPEN");

    operator.send({ type: "poll.status", pollId: first.id, status: "closed" });
    await attendee.next("poll.changed", (message) => message.poll.status === "closed");
    operator.send({ type: "poll.status", pollId: first.id, status: "open" });
    expect(
      (await operator.next("poll.changed", (message) => message.poll.id === first.id && message.poll.status === "open"))
        .poll.status,
    ).toBe("open");
    operator.send({ type: "poll.delete", pollId: first.id });
    expect((await operator.next("room.refused", (message) => message.code === "LIVE_POLL_NOT_DRAFT")).code).toBe(
      "LIVE_POLL_NOT_DRAFT",
    );
    operator.send({ type: "poll.delete", pollId: second.id });
    expect((await operator.next("poll.removed")).pollId).toBe(second.id);

    attendee.send({ type: "poll.status", pollId: second.id, status: "open" });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
  });

  it("counts one answer per person, lets them change it while open and refuses votes once closed", async () => {
    const operator = await f.connect({ person: "operator" });
    const poll = await preparePoll(operator);
    operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
    const voter = await f.connect({ person: "attendee" });
    const other = await f.connect({ person: "secondAttendee" });
    const speaker = await f.connect({ person: "speaker" });

    voter.send({ type: "poll.vote", pollId: poll.id, answer: "Root CA" });
    const mine = await voter.next("poll.changed", (message) => message.poll.myAnswer !== null);
    // Results shown to attendees reach a voter once they voted.
    expect(mine.poll.myAnswer).toBe("Root CA");
    expect(mine.poll.results?.totalAnswers).toBe(1);
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "Code signing" });
    other.send({ type: "poll.vote", pollId: poll.id, answer: "Code signing" });
    const tallied = await operator.next("poll.changed", (message) => counts(message.poll)?.["Code signing"] === 2);
    expect(counts(tallied.poll)).toEqual({ "Root CA": 0, "TLS endpoints": 0, "Code signing": 2 });
    // Someone who has not voted does not see the running count.
    expect((await speaker.next("poll.changed")).poll.results).toBeNull();
    // The forms answer rules judge the answer: a value the question does not offer is refused.
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "Quantum" });
    expect((await voter.next("room.refused")).code).toBe("LIVE_POLL_ANSWER");

    operator.send({ type: "poll.status", pollId: poll.id, status: "closed" });
    const closed = await speaker.next("poll.changed", (message) => message.poll.status === "closed");
    expect(counts(closed.poll)).toEqual({ "Root CA": 0, "TLS endpoints": 0, "Code signing": 2 });
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "Root CA" });
    expect((await voter.next("room.refused", (message) => message.code !== "LIVE_POLL_ANSWER")).code).toBe(
      "LIVE_POLL_CLOSED",
    );
  });

  it("counts each choice of a multiple choice and each score of a rating", async () => {
    const operator = await f.connect({ person: "operator" });
    const many = await preparePoll(operator, "Which do you run?", true, choiceField("", "multi_select"));
    operator.send({ type: "poll.status", pollId: many.id, status: "open" });
    const voter = await f.connect({ person: "attendee" });
    const other = await f.connect({ person: "secondAttendee" });
    voter.send({ type: "poll.vote", pollId: many.id, answer: ["Root CA", "Code signing"] });
    other.send({ type: "poll.vote", pollId: many.id, answer: ["Code signing"] });
    const tallied = await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 2);
    expect(counts(tallied.poll)).toEqual({ "Root CA": 1, "TLS endpoints": 0, "Code signing": 2 });

    operator.send({ type: "poll.status", pollId: many.id, status: "closed" });
    const rating = { key: "score", label: "", fieldType: "number", validation: { uiWidget: "rating_stars" } };
    const rated = await preparePoll(operator, "How was the session?", true, rating);
    expect(counts(rated)).toEqual({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 });
    operator.send({ type: "poll.status", pollId: rated.id, status: "open" });
    voter.send({ type: "poll.vote", pollId: rated.id, answer: 4 });
    other.send({ type: "poll.vote", pollId: rated.id, answer: 9 });
    expect((await other.next("room.refused")).code).toBe("LIVE_POLL_ANSWER");
    const scored = await operator.next("poll.changed", (message) => counts(message.poll)?.["4"] === 1);
    expect(scored.poll.results?.totalAnswers).toBe(1);
  });

  it("keeps tallies at the desk when the operator does not show results", async () => {
    const operator = await f.connect({ person: "operator" });
    const poll = await preparePoll(operator, "Keep it quiet?", false);
    operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
    const voter = await f.connect({ person: "attendee" });
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "Root CA" });
    expect((await voter.next("poll.changed", (message) => message.poll.myAnswer !== null)).poll.results).toBeNull();
    const desk = await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 1);
    expect(counts(desk.poll)?.["Root CA"]).toBe(1);
  });

  it("preserves one answer per person across close/reopen and atomically refuses an invalid composed shot", async () => {
    const operator = await f.connect({ person: "operator" }),
      voter = await f.connect({ person: "attendee" });
    const poll = await preparePoll(operator);
    operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
    await operator.next("poll.changed", (m) => m.poll.status === "open");
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "Root CA" });
    await operator.next("poll.changed", (m) => m.poll.results?.totalAnswers === 1);
    operator.send({ type: "poll.status", pollId: poll.id, status: "closed" });
    await operator.next("poll.changed", (m) => m.poll.status === "closed");
    operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
    const reopened = await operator.next(
      "poll.changed",
      (m) => m.poll.status === "open" && m.poll.results?.totalAnswers === 1,
    );
    expect(counts(reopened.poll)?.["Root CA"]).toBe(1);
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "TLS endpoints" });
    const changed = await operator.next("poll.changed", (m) => counts(m.poll)?.["TLS endpoints"] === 1);
    expect(changed.poll.results?.totalAnswers).toBe(1);
    expect(counts(changed.poll)?.["Root CA"]).toBe(0);
    operator.send({
      type: "stage.set",
      schedule: null,
      checkIn: null,
      timerGraphics: [],
      ticker: null,
      panelists: null,
      questionId: null,
      creditKey: null,
      pollId: poll.id,
      pollPresentation: { chart: "donut" },
    });
    const staged = await operator.next("stage.changed");
    expect(staged.stage.poll?.presentation.chart).toBe("donut");
    operator.send({
      type: "stage.set",
      schedule: null,
      checkIn: null,
      timerGraphics: [],
      ticker: null,
      panelists: null,
      questionId: crypto.randomUUID(),
      creditKey: null,
      pollId: null,
      pollPresentation: { chart: "bar" },
    });
    expect((await operator.next("room.refused")).code).toBe("LIVE_QUESTION_NOT_FOUND");
    const reconnect = await f.connect({ person: "operator" });
    expect((await reconnect.next("room.snapshot")).stage.poll?.id).toBe(poll.id);
  });

  it("counts bounded written answers with the canonical forms statistics and refuses attendee stage composition", async () => {
    const operator = await f.connect({ person: "operator" }),
      voter = await f.connect({ person: "attendee" });
    const poll = await preparePoll(operator, "What matters?", true, { key: "answer", fieldType: "text" });
    operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
    await operator.next("poll.changed", (m) => m.poll.status === "open");
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "Trust" });
    const counted = await operator.next("poll.changed", (m) => m.poll.results?.totalAnswers === 1);
    expect(counts(counted.poll)).toEqual({ Trust: 1 });
    operator.send({
      type: "stage.set",
      schedule: null,
      checkIn: null,
      timerGraphics: [],
      ticker: null,
      panelists: null,
      questionId: null,
      creditKey: null,
      pollId: poll.id,
      pollPresentation: { chart: "wordcloud" },
    });
    expect((await operator.next("stage.changed")).stage.poll?.presentation.chart).toBe("wordcloud");
    voter.send({
      type: "stage.set",
      schedule: null,
      checkIn: null,
      timerGraphics: [],
      ticker: null,
      panelists: null,
      questionId: null,
      creditKey: null,
      pollId: null,
      pollPresentation: { chart: "bar" },
    });
    expect((await voter.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
  });

  it("publishes and clears plain ticker text only through operator commands and includes it in atomic shots", async () => {
    const operator = await f.connect({ person: "operator" }),
      voter = await f.connect({ person: "attendee" });
    operator.send({
      type: "stage.ticker",
      ticker: {
        style: "gradient",
        messages: [{ id: "custom", prefix: "", template: "Next session: Trust & <questions>", condition: "always" }],
      },
    });
    const updated = await voter.next("stage.changed");
    expect(updated.stage.ticker?.segments[0]?.markdown).toBe("Next session: Trust & <questions>");
    voter.send({ type: "stage.ticker", ticker: null });
    expect((await voter.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
    operator.send({
      type: "stage.set",
      schedule: null,
      checkIn: null,
      timerGraphics: [],
      questionId: null,
      creditKey: null,
      pollId: null,
      pollPresentation: { chart: "bar" },
      ticker: {
        style: "gradient",
        messages: [{ id: "custom", prefix: "", template: "Raise your questions", condition: "always" }],
      },
      panelists: null,
    });
    expect(
      (await operator.next("stage.changed", (m) => m.stage.ticker?.segments[0]?.markdown === "Raise your questions"))
        .stage.ticker?.segments[0]?.markdown,
    ).toBe("Raise your questions");
    operator.send({ type: "stage.ticker", ticker: null });
    expect((await operator.next("stage.changed", (m) => m.stage.ticker === null)).stage.ticker).toBeNull();
  });

  it("refreshes a dynamic next-session ticker after the approved publication changes without another operator command", async () => {
    const row = await env.DB.prepare(
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=1",
    )
      .bind(f.eventId)
      .first<{ snapshot_json: string }>();
    if (!row) throw new Error("Missing approved fixture");
    const agenda = storedAgendaSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
      current = agenda.occurrences.find((item) => item.id === f.occurrenceId);
    if (!current?.endAt) throw new Error("Missing approved session");
    agenda.occurrences.push({
      ...current,
      id: crypto.randomUUID(),
      title: "Next approved session",
      startAt: current.endAt,
      endAt: new Date(Date.parse(current.endAt) + 1800000).toISOString(),
    });
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=1")
      .bind(JSON.stringify(agenda), f.eventId)
      .run();
    const operator = await f.connect({ person: "operator" });
    operator.send({
      type: "stage.ticker",
      ticker: {
        style: "gradient",
        messages: [{ id: "next", prefix: "Next", template: "{{next.title}}", condition: "always" }],
      },
    });
    expect(
      (await operator.next("stage.changed", (m) => m.stage.ticker?.segments[0]?.markdown === "Next approved session"))
        .stage.ticker?.messages[0].template,
    ).toBe("{{next.title}}");
    agenda.occurrences[agenda.occurrences.length - 1].title = "Revised approved title";
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=1")
      .bind(JSON.stringify(agenda), f.eventId)
      .run();
    const stub = f.room();
    await runDurableObjectAlarm(stub);
    await runDurableObjectAlarm(stub);
    expect(
      (await operator.next("stage.changed", (m) => m.stage.ticker?.segments[0]?.markdown === "Revised approved title"))
        .stage.ticker?.messages[0].id,
    ).toBe("next");
  });

  it("copies opened polls with their question and tallies to D1, never drafts or ballots, with audited staff actions", async () => {
    const operator = await f.connect({ person: "operator" });
    const poll = await preparePoll(operator);
    await preparePoll(operator, "Still a draft?");
    operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
    const voter = await f.connect({ person: "attendee" });
    voter.send({ type: "poll.vote", pollId: poll.id, answer: "TLS endpoints" });
    await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 1);
    operator.send({ type: "poll.status", pollId: poll.id, status: "closed" });
    await operator.next("poll.changed", (message) => message.poll.status === "closed");

    await runDurableObjectAlarm(f.room());
    const copied = await queryAll<{ id: string; field_json: string; status: string; respondents: number }>(
      env.DB,
      "SELECT id,field_json,status,respondents,show_results,created_by FROM event_session_polls",
      [],
    );
    expect(copied).toMatchObject([
      { id: poll.id, status: "closed", respondents: 1, show_results: 1, created_by: f.users.operator },
    ]);
    // The copy is the forms field contract, so reporting reads it with the forms results views.
    expect(livePollFieldSchema.parse(JSON.parse(copied[0].field_json))).toEqual(poll.field);
    expect(
      await queryAll(env.DB, "SELECT value,vote_count FROM event_session_poll_tallies WHERE poll_id=?", [poll.id]),
    ).toEqual([{ value: "TLS endpoints", vote_count: 1 }]);
    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE scope_id=? AND entity_id=? AND action LIKE 'live_session.poll.%' ORDER BY action",
      [f.eventId, f.occurrenceId],
    );
    expect(audit.map((row) => row.action)).toEqual([
      "live_session.poll.closed",
      "live_session.poll.created",
      "live_session.poll.created",
      "live_session.poll.opened",
    ]);

    // Reporting reads the copy back as the forms results views draw it, for operators only.
    const results = (query = "") =>
      callApi(env, f.path(`/polls${query}`), {
        headers: { authorization: `Bearer ${f.tokens.operator}`, origin: "https://app.test" },
      });
    const listed = livePollResultsResponseSchema.parse(await (await results()).json());
    expect(listed.page.total).toBe(1);
    expect(listed.polls[0]).toMatchObject({ id: poll.id, status: "closed", field: { label: poll.field.label } });
    expect(listed.polls[0].results.entries.map((entry) => [entry.label, entry.count])).toEqual([
      ["Root CA", 0],
      ["TLS endpoints", 1],
      ["Code signing", 0],
    ]);
    const searched = livePollResultsResponseSchema.parse(await (await results("?q=nothing-like-it")).json());
    expect(searched.polls).toEqual([]);
    const attendee = await callApi(env, f.path("/polls"), {
      headers: { authorization: `Bearer ${f.tokens.attendee}`, origin: "https://app.test" },
    });
    expect(attendee.status).toBe(403);
  });
});

describe("live session control desk lineup", () => {
  beforeEach(() => f.setup());
  afterEach(() => vi.useRealTimers());

  it("lines up questions, lower thirds and polls and puts the next one on air", async () => {
    const operator = await f.connect({ person: "operator" });
    const author = await f.connect({ person: "attendee" });
    author.send({ type: "question.ask", text: "When does SHA-1 finally go?", anonymous: false });
    const asked = await operator.next("question.changed");
    operator.send({ type: "question.moderate", questionId: asked.question.id, status: "approved" });
    await operator.next("question.changed", (message) => message.question.status === "approved");

    const credit = `user:${f.users.speaker}`;
    operator.send({ type: "queue.add", view: "question", itemId: asked.question.id });
    operator.send({ type: "queue.add", view: "lower-third", itemId: credit });
    const queued = await operator.next("queue.changed", (message) => message.queue["lower-third"].length === 1);
    expect(queued.queue).toMatchObject({ question: [asked.question.id], "lower-third": [credit], poll: [] });
    expect(author.received.some((message) => message.type === "queue.changed")).toBe(false);

    operator.send({ type: "stage.next", view: "question" });
    expect((await author.next("stage.changed")).stage.question?.id).toBe(asked.question.id);
    operator.send({ type: "stage.next", view: "question" });
    expect((await operator.next("room.refused")).code).toBe("LIVE_QUEUE_EMPTY");
    operator.send({ type: "stage.next", view: "lower-third" });
    expect(
      (await author.next("stage.changed", (message) => message.stage.lowerThird !== null)).stage.lowerThird?.key,
    ).toBe(credit);

    const first = await preparePoll(operator, "First poll?");
    const second = await preparePoll(operator, "Second poll?");
    operator.send({ type: "queue.add", view: "poll", itemId: first.id });
    operator.send({ type: "queue.add", view: "poll", itemId: second.id });
    operator.send({ type: "queue.move", view: "poll", itemId: second.id, direction: "up" });
    await operator.next("queue.changed", (message) => message.queue.poll[0] === second.id);
    operator.send({ type: "stage.next", view: "poll" });
    await operator.next("poll.changed", (message) => message.poll.id === second.id && message.poll.status === "open");
    operator.send({ type: "stage.next", view: "poll" });
    const advanced = await operator.next("stage.changed", (message) => message.stage.poll?.id === first.id);
    expect(advanced.stage.pollChange?.operatorName).toBe("Olga Operator");
    await operator.next("poll.changed", (message) => message.poll.id === second.id && message.poll.status === "closed");
    await operator.next("poll.changed", (message) => message.poll.id === first.id && message.poll.status === "open");

    author.send({ type: "queue.add", view: "question", itemId: asked.question.id });
    expect((await author.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
  });

  it("shows only the poll on air to a broadcast overlay, with its tallies", async () => {
    const operator = await f.connect({ person: "operator" });
    await callApi(env, f.programPath("/program"), {
      method: "POST",
      headers: { authorization: `Bearer ${f.tokens.operator}`, "content-type": "application/json" },
      body: JSON.stringify({ occurrenceId: f.occurrenceId, expectedRevision: 0 }),
    });
    const issued = await callApi(env, f.programPath("/overlays"), {
      method: "POST",
      headers: { authorization: `Bearer ${f.tokens.operator}`, origin: "https://app.test" },
    });
    const access = liveOverlayAccessResponseSchema.parse(await issued.json());
    const poll = await preparePoll(operator, "On air?", false);
    operator.send({ type: "poll.status", pollId: poll.id, status: "open" });
    const overlay = await f.connect({ overlay: access.token });
    expect((await overlay.next("room.snapshot")).polls).toEqual([]);
    operator.send({ type: "stage.poll", pollId: poll.id });
    const shown = await overlay.next("poll.changed");
    expect(shown.poll).toMatchObject({ id: poll.id, results: { totalAnswers: 0 } });
    operator.send({ type: "stage.poll", pollId: null });
    expect((await overlay.next("poll.removed")).pollId).toBe(poll.id);
  });

  it("shows every operator who else is at the desk", async () => {
    const first = await f.connect({ person: "operator" });
    expect((await first.next("room.snapshot")).operators).toEqual([{ name: "Olga Operator", connections: 1 }]);
    const second = await f.connect({ person: "operator" });
    expect((await first.next("operators.changed")).operators).toEqual([{ name: "Olga Operator", connections: 2 }]);
    const attendee = await f.connect({ person: "attendee" });
    expect((await attendee.next("room.snapshot")).operators).toEqual([]);
    second.socket.close(1000, "done");
    await first.next("operators.changed", (message) => message.operators[0]?.connections === 1);
  });
});

describe("live session question rewrite", () => {
  beforeEach(() => f.setup());
  afterEach(() => vi.useRealTimers());

  it("shows the operator's rewrite everywhere and keeps the author's words for the record", async () => {
    const operator = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "secondAttendee" });
    const author = await f.connect({ person: "attendee" });
    author.send({ type: "question.ask", text: "so like what about hybrid certs??", anonymous: false });
    const asked = await operator.next("question.changed");
    const questionId = asked.question.id;
    operator.send({ type: "question.moderate", questionId, status: "approved" });
    operator.send({ type: "stage.question", questionId });
    await attendee.next("stage.changed");

    operator.send({ type: "question.rewrite", questionId, text: "What about hybrid certificates?" });
    const rewritten = await operator.next("question.changed", (message) => message.question.rewritten !== null);
    expect(rewritten.question).toMatchObject({
      text: "What about hybrid certificates?",
      originalText: "so like what about hybrid certs??",
      rewritten: { operatorName: "Olga Operator" },
    });
    const seen = await attendee.next("question.changed", (message) => message.question.text.startsWith("What"));
    expect(seen.question).toMatchObject({ originalText: null, rewritten: null });
    expect(
      (await attendee.next("stage.changed", (message) => message.stage.question?.text.startsWith("What") ?? false))
        .stage.question?.text,
    ).toBe("What about hybrid certificates?");

    attendee.send({ type: "question.rewrite", questionId, text: "Mine now" });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");

    await runDurableObjectAlarm(f.room());
    expect(
      await queryAll(env.DB, "SELECT body,display_text,rewritten_by FROM event_session_questions WHERE id=?", [
        questionId,
      ]),
    ).toEqual([
      {
        body: "so like what about hybrid certs??",
        display_text: "What about hybrid certificates?",
        rewritten_by: f.users.operator,
      },
    ]);
    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE entity_id=? AND action='live_session.question.rewritten'",
      [f.occurrenceId],
    );
    expect(audit).toHaveLength(1);
  });
});

import { grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_ROOM_POLICY } from "../assets/shared/live-session-policy";
import { LIVE_ROOM_PROTOCOL, liveOverlayAccessResponseSchema } from "../assets/shared/schemas/live-session-room";
import { signLiveOverlayToken } from "../functions/_lib/auth/live-session-overlay-token";
import { callApi } from "./helpers/app";
import { queryAll } from "./helpers/context";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();

async function issueOverlay(person: "operator" | "attendee" = "operator") {
  if (person === "operator") {
    const selected = await callApi(env, f.programPath("/program"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${f.tokens.operator}`,
        origin: "https://app.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ occurrenceId: f.occurrenceId, expectedRevision: 0 }),
    });
    expect(selected.status).toBe(200);
  }
  return callApi(env, f.programPath("/overlays"), {
    method: "POST",
    headers: { authorization: `Bearer ${f.tokens[person]}`, origin: "https://app.test" },
  });
}

async function askApproved(text = "How do we inventory our certificates?") {
  const author = await f.connect({ person: "attendee" });
  const operator = await f.connect({ person: "operator" });
  author.send({ type: "question.ask", text, anonymous: true });
  const asked = await operator.next("question.changed", (message) => message.question.text === text);
  operator.send({ type: "question.moderate", questionId: asked.question.id, status: "approved" });
  await operator.next("question.changed", (message) => message.question.status === "approved");
  return { author, operator, questionId: asked.question.id };
}

describe("live session room admission", () => {
  beforeEach(() => f.setup());

  it("admits registered attendees, credited speakers and operators with their room role", async () => {
    for (const [person, role] of [
      ["attendee", "attendee"],
      ["speaker", "speaker"],
      ["operator", "operator"],
    ] as const) {
      const client = await f.connect({ person });
      expect(client.protocol).toBe(LIVE_ROOM_PROTOCOL);
      const snapshot = await client.next("room.snapshot");
      expect(snapshot.viewer.role).toBe(role);
      expect(snapshot.session).toMatchObject({ occurrenceId: f.occurrenceId, title: "Post-quantum migration" });
      expect(snapshot.session.credits).toEqual([
        {
          key: `user:${f.users.speaker}`,
          name: "Sam Speaker",
          moderator: false,
          roleLabel: null,
          photoUrl: null,
          identity: null,
        },
      ]);
      client.socket.close(1000, "done");
    }
  });

  it("refuses plain requests, anonymous and unregistered callers, and cross-site pages", async () => {
    expect((await callApi(env, f.path(), { headers: { authorization: `Bearer ${f.tokens.attendee}` } })).status).toBe(
      426,
    );
    // A handshake that is not a live room handshake, or comes from another site, is refused over HTTP.
    expect((await f.upgrade({ person: "attendee" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await f.upgrade({ person: "attendee" }, { "sec-websocket-protocol": "other" })).status).toBe(400);
    // A browser cannot read a refused handshake's status, so an admission refusal closes the socket with its code.
    expect(await f.refusal(null)).toEqual({ protocol: LIVE_ROOM_PROTOCOL, code: 4401, reason: "AUTH_REQUIRED" });
    expect(await f.refusal({ person: "outsider" })).toEqual({
      protocol: LIVE_ROOM_PROTOCOL,
      code: 4403,
      reason: "LIVE_SESSION_ACCESS_REQUIRED",
    });
  });

  it.each([
    ["revoked session", "UPDATE sessions SET revoked_at=? WHERE user_id=?", "AUTH_REVOKED"],
    ["expired session", "UPDATE sessions SET expires_at=? WHERE user_id=?", "AUTH_EXPIRED"],
    [
      "cancelled registration",
      "UPDATE registrations SET status='cancelled' WHERE updated_at>=? AND user_id=?",
      "LIVE_SESSION_ACCESS_REQUIRED",
    ],
  ])("ends an already connected attendee after %s before accepting another question", async (_case, sql, reason) => {
    const attendee = await f.connect({ person: "attendee" });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      attendee.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await env.DB.prepare(sql).bind("2000-01-01T00:00:00.000Z", f.users.attendee).run();
    await runDurableObjectAlarm(f.room());
    attendee.send({ type: "question.ask", text: "This must never be recorded", anonymous: false });
    expect(await closed).toEqual({ code: reason === "LIVE_SESSION_ACCESS_REQUIRED" ? 4403 : 4401, reason });
    const operator = await f.connect({ person: "operator" });
    expect((await operator.next("room.snapshot")).questions).toEqual([]);
  });

  it("removes a connected operator's authority when its live role is revoked", async () => {
    const operator = await f.connect({ person: "operator" });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      operator.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    await runDurableObjectAlarm(f.room());
    // Revoking room authority does not invalidate the person's otherwise active sign-in.
    expect(
      (
        await callApi(env, "/api/v1/auth/session", {
          headers: { authorization: `Bearer ${f.tokens.operator}` },
        })
      ).status,
    ).toBe(200);
    operator.send({ type: "question.ask", text: "No longer authorized", anonymous: false });
    expect(await closed).toEqual({ code: 4403, reason: "LIVE_SESSION_ACCESS_REQUIRED" });
    const current = await f.connect({ person: "secondOperator" });
    expect((await current.next("room.snapshot")).questions).toEqual([]);
  });

  it("has no room for a session that is not on the approved agenda, and says so", async () => {
    expect(await f.refusal({ person: "operator" }, crypto.randomUUID())).toEqual({
      protocol: LIVE_ROOM_PROTOCOL,
      code: 4404,
      reason: "LIVE_SESSION_NOT_FOUND",
    });
  });
});

describe("live session questions", () => {
  beforeEach(() => f.setup());

  it("replays one accepted question after reconnect without consuming another question allowance", async () => {
    const author = await f.connect({ person: "attendee" });
    const request = {
      type: "question.ask",
      operationId: crypto.randomUUID(),
      text: "Which algorithms should come first?",
      anonymous: true,
    } as const;
    author.send(request);
    const accepted = await author.next("question.accepted");
    const reconnected = await f.connect({ person: "attendee" });
    for (let attempt = 0; attempt < LIVE_ROOM_POLICY.questionsPerPerson.limit + 1; attempt += 1)
      reconnected.send(request);
    await vi.waitFor(() =>
      expect(reconnected.received.filter((message) => message.type === "question.accepted")).toHaveLength(
        LIVE_ROOM_POLICY.questionsPerPerson.limit + 1,
      ),
    );
    expect(reconnected.received.filter((message) => message.type === "question.accepted")).toEqual(
      Array.from({ length: LIVE_ROOM_POLICY.questionsPerPerson.limit + 1 }, () => accepted),
    );
    expect((await reconnected.next("room.snapshot")).questions).toHaveLength(1);
    reconnected.send({
      ...request,
      operationId: crypto.randomUUID(),
      text: "A different question within the allowance?",
    });
    expect(
      (await reconnected.next("question.accepted", (message) => message.operationId !== request.operationId))
        .questionId,
    ).not.toBe(accepted.questionId);
  });

  it("refuses reuse for different text or anonymity and scopes the request to its actor", async () => {
    const author = await f.connect({ person: "attendee" });
    const other = await f.connect({ person: "secondAttendee" });
    const request = {
      type: "question.ask",
      operationId: crypto.randomUUID(),
      text: "Which deployment comes first?",
      anonymous: false,
    } as const;
    author.send(request);
    const accepted = await author.next("question.accepted");
    author.send({ ...request, text: "Changed question content" });
    expect(await author.next("room.refused")).toMatchObject({
      operationId: request.operationId,
      code: "LIVE_QUESTION_REQUEST_CONFLICT",
    });
    author.send({ ...request, anonymous: true });
    await vi.waitFor(() =>
      expect(author.received.filter((message) => message.type === "room.refused")).toHaveLength(2),
    );
    other.send(request);
    expect((await other.next("question.accepted")).questionId).not.toBe(accepted.questionId);
    expect((await (await f.connect({ person: "operator" })).next("room.snapshot")).questions).toHaveLength(2);
  });

  it("holds a new question for moderation and keeps an anonymous author hidden from other attendees only", async () => {
    const author = await f.connect({ person: "attendee" });
    const operator = await f.connect({ person: "operator" });
    const other = await f.connect({ person: "secondAttendee" });
    author.send({ type: "question.ask", text: "Which algorithms first?", anonymous: true });
    const pending = await operator.next("question.changed");
    expect(pending.question).toMatchObject({ status: "pending", authorName: "Ada Attendee", anonymous: true });
    expect((await author.next("question.changed")).question).toMatchObject({ mine: true, authorName: "Ada Attendee" });
    expect(other.received.some((message) => message.type === "question.changed")).toBe(false);

    operator.send({ type: "question.moderate", questionId: pending.question.id, status: "approved" });
    const approved = await other.next("question.changed");
    expect(approved.question).toMatchObject({ status: "approved", authorName: null, mine: false });
    expect(
      (await operator.next("question.changed", (message) => message.question.status === "approved")).question.moderated
        ?.operatorName,
    ).toBe("Olga Operator");
  });

  it("counts one vote per person and lets them withdraw it", async () => {
    const { questionId } = await askApproved();
    const voter = await f.connect({ person: "secondAttendee" });
    voter.send({ type: "question.vote", questionId, voted: true });
    voter.send({ type: "question.vote", questionId, voted: true });
    expect((await voter.next("question.changed", (message) => message.question.votes === 1)).question.votedByMe).toBe(
      true,
    );
    voter.send({ type: "question.vote", questionId, voted: false });
    expect((await voter.next("question.changed", (message) => message.question.votes === 0)).question.votedByMe).toBe(
      false,
    );
    const snapshot = await (await f.connect({ person: "secondAttendee" })).next("room.snapshot");
    expect(snapshot.questions.map((question) => question.votes)).toEqual([0]);
  });

  it("lets a credited speaker mark a question answered but never moderate the queue", async () => {
    const { questionId } = await askApproved();
    const speaker = await f.connect({ person: "speaker" });
    speaker.send({ type: "question.moderate", questionId, status: "hidden" });
    expect((await speaker.next("room.refused")).code).toBe("LIVE_QUESTION_TRANSITION");
    speaker.send({ type: "question.moderate", questionId, status: "answered" });
    expect(
      (await speaker.next("question.changed", (message) => message.question.status === "answered")).question.answeredAt,
    ).not.toBeNull();
    const attendee = await f.connect({ person: "secondAttendee" });
    attendee.send({ type: "question.moderate", questionId, status: "hidden" });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
  });

  it("removes a hidden question from attendees and from the stage", async () => {
    const { operator, questionId } = await askApproved();
    const attendee = await f.connect({ person: "secondAttendee" });
    expect((await attendee.next("room.snapshot")).questions).toHaveLength(1);
    operator.send({ type: "stage.question", questionId });
    expect((await attendee.next("stage.changed")).stage.question).toMatchObject({ id: questionId, authorName: null });
    operator.send({ type: "question.moderate", questionId, status: "hidden" });
    expect((await attendee.next("question.removed")).questionId).toBe(questionId);
    expect(
      (await attendee.next("stage.changed", (message) => message.stage.question === null)).stage.questionChange
        ?.operatorName,
    ).toBe("Olga Operator");
  });

  it("limits how fast one person asks", async () => {
    const author = await f.connect({ person: "attendee" });
    for (let index = 0; index <= LIVE_ROOM_POLICY.questionsPerPerson.limit; index += 1)
      author.send({ type: "question.ask", text: `Question number ${index}`, anonymous: false });
    expect((await author.next("room.refused")).code).toBe("LIVE_ROOM_RATE_LIMITED");
  });

  it("refuses attendee questions outside the session window but lets operators prepare", async () => {
    await f.setup({ startOffsetMinutes: 24 * 60, durationMinutes: 30 });
    const attendee = await f.connect({ person: "attendee" });
    attendee.send({ type: "question.ask", text: "Too early?", anonymous: false });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_CLOSED");
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "question.ask", text: "Seed question", anonymous: false });
    expect((await operator.next("question.changed")).question.text).toBe("Seed question");
  });
});

describe("live session reactions", () => {
  beforeEach(() => f.setup());

  it("broadcasts exact reaction totals across scheduled bursts and limits each person", async () => {
    const watcher = await f.connect({ person: "secondAttendee" });
    const reactor = await f.connect({ person: "attendee" });
    reactor.send({ type: "reaction.send", reaction: "applause" });
    expect((await watcher.next("reaction.burst")).counts).toEqual({ applause: 1 });
    reactor.send({ type: "reaction.send", reaction: "applause" });
    reactor.send({ type: "reaction.send", reaction: "love" });
    // Worker scheduling can put these messages in different broadcast windows.
    // The delivered total must still contain every reaction exactly once.
    await vi.waitFor(
      () => {
        const totals: Record<string, number> = {};
        for (const message of watcher.received) {
          if (message.type !== "reaction.burst") continue;
          for (const [reaction, count] of Object.entries(message.counts))
            totals[reaction] = (totals[reaction] ?? 0) + count;
        }
        expect(totals).toEqual({ applause: 2, love: 1 });
      },
      { timeout: 3000 },
    );
    for (let index = 0; index < LIVE_ROOM_POLICY.reactionsPerPerson.limit; index += 1)
      reactor.send({ type: "reaction.send", reaction: "laugh" });
    expect((await reactor.next("room.refused")).code).toBe("LIVE_ROOM_RATE_LIMITED");
  });
});

describe("live session control room", () => {
  beforeEach(() => f.setup());

  it("shows every operator the latest stage and timer change with who made it", async () => {
    const first = await f.connect({ person: "operator" });
    const second = await f.connect({ person: "operator" });
    first.send({ type: "stage.lowerThird", creditKey: `user:${f.users.speaker}` });
    const lowerThird = await second.next("stage.changed");
    expect(lowerThird.stage.lowerThird).toEqual({
      key: `user:${f.users.speaker}`,
      name: "Sam Speaker",
      moderator: false,
      roleLabel: null,
      photoUrl: null,
      identity: null,
    });
    expect(lowerThird.stage.lowerThirdChange?.operatorName).toBe("Olga Operator");

    second.send({ type: "timer.control", timerId: "session", action: "pause" });
    const paused = await first.next("timers.changed", (message) => !message.timers[0]!.running);
    expect(paused.timers[0]!.heldMs).toBeGreaterThan(0);
    first.send({ type: "timer.control", timerId: "session", action: "start" });
    const started = await second.next("timers.changed", (message) => message.timers[0]!.running);
    expect(Date.parse(started.timers[0]!.anchorAt!)).toBeGreaterThan(Date.now());

    first.send({ type: "stage.lowerThird", creditKey: "user:someone-else" });
    expect((await first.next("room.refused")).code).toBe("LIVE_CREDIT_NOT_FOUND");
    const attendee = await f.connect({ person: "attendee" });
    attendee.send({ type: "timer.control", timerId: "session", action: "reset" });
    expect((await attendee.next("room.refused")).code).toBe("LIVE_ROOM_OPERATOR_REQUIRED");
  });

  it("issues overlays read-only access to this room only", async () => {
    expect((await issueOverlay("attendee")).status).toBe(403);
    const issued = await issueOverlay();
    expect(issued.status).toBe(201);
    const access = liveOverlayAccessResponseSchema.parse(await issued.json());
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "question.ask", text: "Visible only to moderators", anonymous: false });
    await operator.next("question.changed");

    const overlay = await f.connect({ overlay: access.token });
    const snapshot = await overlay.next("room.snapshot");
    expect(snapshot.viewer).toEqual({ role: "overlay", name: null, organizer: false, chatRestriction: null });
    expect(snapshot.questions).toEqual([]);
    overlay.send({ type: "reaction.send", reaction: "applause" });
    expect((await overlay.next("room.refused")).code).toBe("LIVE_ROOM_READ_ONLY");
    operator.send({ type: "timer.control", timerId: "session", action: "pause" });
    expect((await overlay.next("timers.changed")).timers[0]!.running).toBe(false);

    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE scope_type='event' AND scope_id=? AND entity_id=?",
      [f.eventId, f.roomId],
    );
    expect(audit.map((row) => row.action)).toContain("live_session.overlay_access.issued");

    expect((await f.refusal({ overlay: `${access.token}x` })).reason).toBe("LIVE_OVERLAY_ACCESS_INVALID");
    const anotherRoom = await signLiveOverlayToken(env.INTERNAL_SIGNING_SECRET, {
      eventId: f.eventId,
      roomId: crypto.randomUUID(),
      issuedBy: f.users.operator,
      expiresAt: access.expiresAt,
    });
    expect((await f.refusal({ overlay: anotherRoom })).code).toBe(4401);
  });
});

describe("live session durable copy", () => {
  beforeEach(() => f.setup());

  it("copies questions, reaction totals and staff audit rows to D1 idempotently", async () => {
    const { operator, questionId } = await askApproved("What about hybrid certificates?");
    const voter = await f.connect({ person: "secondAttendee" });
    voter.send({ type: "question.vote", questionId, voted: true });
    voter.send({ type: "reaction.send", reaction: "mind_blown" });
    await voter.next("question.changed", (message) => message.question.votes === 1);
    await voter.next("reaction.burst");
    operator.send({ type: "stage.question", questionId });
    await operator.next("stage.changed");

    expect(await runDurableObjectAlarm(f.room())).toBe(true);
    const questions = await queryAll(
      env.DB,
      "SELECT author_user_id,anonymous,body,status,vote_count,moderated_by FROM event_session_questions WHERE event_id=? AND occurrence_id=?",
      [f.eventId, f.occurrenceId],
    );
    expect(questions).toEqual([
      {
        author_user_id: f.users.attendee,
        anonymous: 1,
        body: "What about hybrid certificates?",
        status: "approved",
        vote_count: 1,
        moderated_by: f.users.operator,
      },
    ]);
    expect(
      await queryAll(env.DB, "SELECT reaction,total FROM event_session_reaction_totals WHERE occurrence_id=?", [
        f.occurrenceId,
      ]),
    ).toEqual([{ reaction: "mind_blown", total: 1 }]);
    const auditActions = async () =>
      (
        await queryAll<{ action: string; actor_id: string }>(
          env.DB,
          "SELECT action,actor_id FROM audit_log WHERE scope_id=? AND entity_id=? ORDER BY created_at,action",
          [f.eventId, f.occurrenceId],
        )
      ).map((row) => `${row.action}:${row.actor_id === f.users.operator}`);
    expect(await auditActions()).toEqual(["live_session.question.moderated:true", "live_session.stage.question:true"]);
    // Nothing left to copy, and a later change copies only itself.
    await runDurableObjectAlarm(f.room());
    expect(await auditActions()).toHaveLength(2);
    operator.send({ type: "question.moderate", questionId, status: "answered" });
    await operator.next("question.changed", (message) => message.question.status === "answered");
    await runDurableObjectAlarm(f.room());
    expect(await queryAll(env.DB, "SELECT status FROM event_session_questions WHERE id=?", [questionId])).toEqual([
      { status: "answered" },
    ]);
    expect(await auditActions()).toHaveLength(3);
  });
});

/** Passive readers must lose protected projections even if they never send another command. */
describe("live room passive access revocation", () => {
  beforeEach(() => f.setup());
  it("stops a silent revoked operator receiving pending anonymous question authors", async () => {
    const operator = await f.connect({ person: "operator" });
    const attendee = await f.connect({ person: "attendee" });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      operator.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    await runDurableObjectAlarm(f.room());
    attendee.send({ type: "question.ask", text: "Pending private question", anonymous: true });
    await attendee.next("question.changed");
    expect(await closed).toEqual({ code: 4403, reason: "LIVE_SESSION_ACCESS_REQUIRED" });
    expect(operator.received.filter((message) => message.type === "question.changed")).toEqual([]);
  });
  it.each([
    [
      "revoked session",
      "UPDATE sessions SET revoked_at='2000-01-01T00:00:00.000Z' WHERE user_id=?",
      "AUTH_REVOKED",
      4401,
    ],
    [
      "expired session",
      "UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?",
      "AUTH_EXPIRED",
      4401,
    ],
    [
      "cancelled registration",
      "UPDATE registrations SET status='cancelled' WHERE user_id=?",
      "LIVE_SESSION_ACCESS_REQUIRED",
      4403,
    ],
  ])("stops silent attendee after %s before another viewer's question arrives", async (_case, sql, reason, code) => {
    const reader = await f.connect({ person: "attendee" });
    const author = await f.connect({ person: "secondAttendee" });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      reader.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await env.DB.prepare(sql).bind(f.users.attendee).run();
    await runDurableObjectAlarm(f.room());
    author.send({ type: "question.ask", text: "Fresh question after revocation", anonymous: false });
    await author.next("question.changed");
    expect(await closed).toEqual({ code, reason });
    expect(reader.received.filter((message) => message.type === "question.changed")).toEqual([]);
  });
  it("requires reconnect when operator access becomes attendee access instead of using stale audience tags", async () => {
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) SELECT ?,event_id,?,'registered',attendance_type,source_type,?,created_at,updated_at FROM registrations WHERE user_id=?",
    )
      .bind(crypto.randomUUID(), f.users.operator, crypto.randomUUID(), f.users.attendee)
      .run();
    const operator = await f.connect({ person: "operator" });
    const author = await f.connect({ person: "attendee" });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      operator.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    await runDurableObjectAlarm(f.room());
    author.send({ type: "question.ask", text: "Anonymous author remains private", anonymous: true });
    await author.next("question.changed");
    expect(await closed).toEqual({ code: 4403, reason: "LIVE_SESSION_ACCESS_CHANGED" });
    expect(operator.received.filter((message) => message.type === "question.changed")).toEqual([]);
  });
});

describe("passive private poll and queue fanout", () => {
  beforeEach(() => f.setup());
  it("removes an idle revoked operator before another operator publishes a draft poll", async () => {
    await grantAdministrator(env.DB, f.users.secondAttendee);
    const reader = await f.connect({ person: "operator" });
    const author = await f.connect({ person: "secondAttendee" });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      reader.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    await runDurableObjectAlarm(f.room());
    author.send({
      type: "poll.save",
      pollId: null,
      draft: {
        field: {
          key: "answer",
          label: "Operator draft",
          fieldType: "select",
          sortOrder: 0,
          required: true,
          options: [
            { value: "A", label: "A", active: true },
            { value: "B", label: "B", active: true },
          ],
          validation: { uiWidget: "radios" },
        },
        showResults: true,
      },
    });
    await author.next("poll.changed");
    expect(await closed).toEqual({ code: 4403, reason: "LIVE_SESSION_ACCESS_REQUIRED" });
    expect(reader.received.filter((message) => message.type === "poll.changed")).toEqual([]);
  });
  it("does not deliver stage or queue changes to a cancelled silent attendee", async () => {
    const reader = await f.connect({ person: "attendee" });
    const author = await f.connect({ person: "operator" });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      reader.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE user_id=?").bind(f.users.attendee).run();
    await runDurableObjectAlarm(f.room());
    author.send({ type: "stage.lowerThird", creditKey: `user:${f.users.speaker}` });
    await author.next("stage.changed");
    expect(await closed).toEqual({ code: 4403, reason: "LIVE_SESSION_ACCESS_REQUIRED" });
    expect(
      reader.received.filter((message) => message.type === "stage.changed" || message.type === "queue.changed"),
    ).toEqual([]);
  });
});

describe("live initial snapshot operator roster authorization", () => {
  beforeEach(() => f.setup());
  it("excludes a silently revoked operator from another operator's first snapshot", async () => {
    await grantAdministrator(env.DB, f.users.secondAttendee);
    const removed = await f.connect({ person: "operator" });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      removed.socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    await runDurableObjectAlarm(f.room());
    const joining = await f.connect({ person: "secondAttendee" });
    const snapshot = await joining.next("room.snapshot");
    expect(await closed).toEqual({ code: 4403, reason: "LIVE_SESSION_ACCESS_REQUIRED" });
    expect(snapshot.operators).toEqual([{ name: "Bea Attendee", connections: 1 }]);
    expect(removed.received.filter((message) => message.type === "room.snapshot")).toHaveLength(1);
  });
});

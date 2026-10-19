import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_PROGRAM_PROTOCOL,
  liveProgramMessageSchema,
  liveProgramSelectionSchema,
} from "../assets/shared/schemas/live-room-program";
import {
  LIVE_OVERLAY_PROTOCOL_PREFIX,
  liveOverlayAccessResponseSchema,
} from "../assets/shared/schemas/live-session-room";
import { signLiveOverlayToken } from "../functions/_lib/auth/live-session-overlay-token";
import { verifyUserSessionToken } from "../functions/_lib/auth/user-session-token";
import { liveProgramName } from "../functions/_lib/services/live-session/room-program";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { createLiveRoomFixture } from "./helpers/live-session-room";
import { callApi } from "./helpers/app";
const f = createLiveRoomFixture();
const headers = (token = f.tokens.operator) => ({
  authorization: `Bearer ${token}`,
  origin: "https://app.test",
  "content-type": "application/json",
});
const select = (occurrenceId: string | null, expectedRevision: number, token = f.tokens.operator) =>
  callApi(env, f.programPath("/program"), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ occurrenceId, expectedRevision }),
  });
async function token() {
  const response = await callApi(env, f.programPath("/overlays"), { method: "POST", headers: headers() });
  expect(response.status).toBe(201);
  return liveOverlayAccessResponseSchema.parse(await response.json()).token;
}
async function secondSession(roomId = f.roomId) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString(),
    start = new Date(Date.now() + 70 * 60000).toISOString(),
    end = new Date(Date.now() + 130 * 60000).toISOString();
  if (roomId !== f.roomId)
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name) VALUES (?,?,'Other physical room')")
      .bind(roomId, f.eventId)
      .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,room_id,title,start_at,end_at) VALUES (?,?,?,'Next session',?,?)",
  )
    .bind(id, f.eventId, roomId, start, end)
    .run();
  await env.DB.prepare("UPDATE events SET ends_at=? WHERE id=?").bind(end, f.eventId).run();
  const snapshot = await getAgenda(env.DB, f.eventId, f.eventSlug);
  snapshot.revision = 2;
  snapshot.publishedRevision = 2;
  const json = JSON.stringify(snapshot);
  await env.DB.prepare("UPDATE event_agenda_state SET revision=2,published_revision=2 WHERE event_id=?")
    .bind(f.eventId)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,2,?,?,?)",
  )
    .bind(crypto.randomUUID(), f.eventId, json, f.users.operator, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_published_occurrences(event_id,revision,occurrence_id,payload_json) SELECT ?,2,json_extract(entry.value,'$.id'),entry.value FROM json_each(?,'$.occurrences') entry",
  )
    .bind(f.eventId, json)
    .run();
  return id;
}
async function programSocket(access: string) {
  const response = await callApi(env, f.programPath("/program"), {
    headers: {
      upgrade: "websocket",
      origin: "https://app.test",
      "sec-websocket-protocol": `${LIVE_PROGRAM_PROTOCOL}, ${LIVE_OVERLAY_PROTOCOL_PREFIX}${access}`,
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!,
    messages: Array<ReturnType<typeof liveProgramMessageSchema.parse>> = [];
  socket.addEventListener("message", (event) =>
    messages.push(liveProgramMessageSchema.parse(JSON.parse(String(event.data)))),
  );
  socket.accept();
  return {
    socket,
    messages,
    next: (revision: number) =>
      vi.waitFor(() => {
        const found = messages.find((message) => message.selection.revision === revision);
        if (!found) throw new Error("No program selection yet");
        return found;
      }),
  };
}
const closed = (socket: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) =>
    socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
  );
describe("stable physical room broadcast sources", () => {
  beforeEach(() => f.setup());
  afterEach(() => vi.useRealTimers());
  it("keeps the lower third but clears the previous session's question", async () => {
    const next = await secondSession();
    expect((await select(f.occurrenceId, 0)).status).toBe(200);
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "stage.lowerThird", creditKey: `user:${f.users.speaker}` });
    await operator.next("stage.changed", (m) => m.stage.lowerThird !== null);
    operator.send({
      type: "question.ask",
      operationId: crypto.randomUUID(),
      text: "Will the question stay scoped to this session?",
      anonymous: true,
    });
    const { questionId } = await operator.next("question.accepted");
    operator.send({ type: "question.moderate", questionId, status: "approved", expectedRevision: 0 });
    await operator.next("question.changed", (message) => message.question.status === "approved");
    operator.send({ type: "stage.question", questionId });
    await operator.next("stage.changed", (message) => message.stage.question?.id === questionId);
    expect((await select(next, 1)).status).toBe(200);
    const stage = await f.room().programStage();
    const adopted = await env.LIVE_SESSION_ROOMS!.getByName(`${f.eventId}:${next}`).programStage();
    expect(adopted.lowerThird).toEqual(stage.lowerThird);
    expect(adopted.lowerThird?.name).toBe("Sam Speaker");
    expect(stage.question?.id).toBe(questionId);
    expect(adopted.question).toBeNull();
    expect(adopted.questionChange).toBeNull();
    operator.send({ type: "question.withdraw", questionId, operationId: crypto.randomUUID(), expectedRevision: 0 });
    await operator.next("question.updated");
    expect((await env.LIVE_SESSION_ROOMS!.getByName(`${f.eventId}:${next}`).programStage()).question).toBeNull();
  });

  it("keeps the same signed source across sessions and stops old-session fanout after switching or clearing", async () => {
    const next = await secondSession();
    expect((await select(f.occurrenceId, 0)).status).toBe(200);
    const access = await token();
    const program = await programSocket(access);
    expect((await program.next(1)).selection.occurrenceId).toBe(f.occurrenceId);
    const old = await f.connect({ overlay: access }),
      operator = await f.connect({ person: "operator" });
    const original = old.received.length,
      oldClosed = closed(old.socket);
    const selected = await select(next, 1);
    expect(selected.status).toBe(200);
    expect((await program.next(2)).selection.occurrenceId).toBe(next);
    operator.send({ type: "timer.control", timerId: "session", action: "pause" });
    expect(await oldClosed).toEqual({ code: 4403, reason: "LIVE_PROGRAM_SELECTION_CHANGED" });
    expect(old.received.slice(original).some((message) => message.type === "timers.changed")).toBe(false);
    const response = await callApi(env, `/api/v1/events/${f.eventSlug}/agenda/occurrences/${next}/live`, {
      headers: {
        upgrade: "websocket",
        origin: "https://app.test",
        "sec-websocket-protocol": `pkic-live.v1, ${LIVE_OVERLAY_PROTOCOL_PREFIX}${access}`,
      },
    });
    expect(response.status).toBe(101);
    const active = response.webSocket!,
      activeClosed = closed(active);
    active.accept();
    expect((await select(null, 2)).status).toBe(200);
    expect((await program.next(3)).selection.occurrenceId).toBeNull();
    // A new snapshot/fanout for the no-longer-selected session must fail fresh authorization.
    const nextOperator = await callApi(env, `/api/v1/events/${f.eventSlug}/agenda/occurrences/${next}/live`, {
      headers: {
        upgrade: "websocket",
        origin: "https://app.test",
        authorization: `Bearer ${f.tokens.operator}`,
        "sec-websocket-protocol": "pkic-live.v1",
      },
    });
    expect(nextOperator.status).toBe(101);
    nextOperator.webSocket!.accept();
    expect(await activeClosed).toEqual({ code: 4403, reason: "LIVE_PROGRAM_SELECTION_CHANGED" });
    program.socket.close();
    operator.socket.close();
    nextOperator.webSocket!.close();
  });
  it("rejects a session in another physical room and concurrent stale revision overwrites", async () => {
    const other = await secondSession(crypto.randomUUID());
    expect((await select(other, 0)).status).toBe(409);
    const unknown = await select(crypto.randomUUID(), 0);
    expect(unknown.status).toBe(404);
    const next = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_agenda_published_occurrences(event_id,revision,occurrence_id,payload_json) SELECT event_id,revision,?,json_set(payload_json,'$.id',?,'$.title','Parallel selector target') FROM event_agenda_published_occurrences WHERE event_id=? AND revision=2 AND occurrence_id=?",
    )
      .bind(next, next, f.eventId, f.occurrenceId)
      .run();
    const responses = await Promise.all([select(f.occurrenceId, 0), select(next, 0)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const selection = liveProgramSelectionSchema.parse(
      await (await callApi(env, f.programPath("/program"), { headers: headers() })).json(),
    );
    expect(selection.revision).toBe(1);
    expect([f.occurrenceId, next]).toContain(selection.occurrenceId);
  });
  it("does not let read-only source access or a revoked operator mutate the pointer, including direct RPC", async () => {
    const access = await token();
    expect((await select(f.occurrenceId, 0, access)).status).toBe(401);
    expect((await select(f.occurrenceId, 0, f.tokens.attendee)).status).toBe(403);
    if (!env.INTERNAL_SIGNING_SECRET) throw new Error("Synthetic signing secret unavailable");
    const claims = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET, f.tokens.operator);
    if (!claims.ok) throw new Error("Synthetic operator token invalid");
    const registrationId = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO registrations (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES (?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(registrationId, f.eventId, f.users.operator, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    await expect(
      env
        .LIVE_SESSION_ROOMS!.getByName(liveProgramName(f.eventId, f.roomId))
        .selectProgram(f.eventId, f.roomId, { occurrenceId: f.occurrenceId, expectedRevision: 0 }, claims.claims),
    ).resolves.toMatchObject({ ok: false, status: 403, code: "LIVE_ROOM_OPERATOR_REQUIRED" });
    await env.DB.prepare("DELETE FROM registrations WHERE id=?").bind(registrationId).run();
    await expect(
      env
        .LIVE_SESSION_ROOMS!.getByName(liveProgramName(f.eventId, f.roomId))
        .selectProgram(f.eventId, f.roomId, { occurrenceId: f.occurrenceId, expectedRevision: 0 }, claims.claims),
    ).resolves.toMatchObject({ ok: false, status: 403, code: "LIVE_ROOM_OPERATOR_REQUIRED" });
    expect(
      (await env.LIVE_SESSION_ROOMS!.getByName(liveProgramName(f.eventId, f.roomId)).readProgram(f.eventId, f.roomId))
        .occurrenceId,
    ).toBeNull();
  });
  it("checks publication within thirty seconds and clears an unpublished physical-room source", async () => {
    expect((await select(f.occurrenceId, 0)).status).toBe(200);
    const source = await programSocket(await token());
    await source.next(1);
    const ended = closed(source.socket);
    const stub = env.LIVE_SESSION_ROOMS!.getByName(liveProgramName(f.eventId, f.roomId));
    await runInDurableObject(stub, async (_instance, state) => {
      const alarm = await state.storage.getAlarm();
      expect(alarm).not.toBeNull();
      expect(alarm!).toBeLessThanOrEqual(Date.now() + 30000);
    });
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?")
      .bind(f.eventId)
      .run();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await ended).toEqual({ code: 4404, reason: "LIVE_PROGRAM_ROOM_NOT_FOUND" });
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get("physical-room-program")).toBeUndefined();
    });
  });
  it("expires already-connected read-only program observers without another operator action", async () => {
    const expiresAt = new Date(Date.now() + 2000).toISOString();
    const access = await signLiveOverlayToken(env.INTERNAL_SIGNING_SECRET, {
      eventId: f.eventId,
      roomId: f.roomId,
      issuedBy: f.users.operator,
      expiresAt,
    });
    const source = await programSocket(access);
    await source.next(0);
    const ended = closed(source.socket);
    vi.setSystemTime(Date.now() + 4000);
    expect(await runDurableObjectAlarm(env.LIVE_SESSION_ROOMS!.getByName(liveProgramName(f.eventId, f.roomId)))).toBe(
      true,
    );
    expect(await ended).toEqual({ code: 4403, reason: "LIVE_PROGRAM_ACCESS_EXPIRED" });
  });
});

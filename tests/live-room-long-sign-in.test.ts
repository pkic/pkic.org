import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAFF_CAPACITY_TTL_HOURS, STAFF_SESSION_IDLE_TTL_HOURS } from "../functions/_lib/auth/session-policy";
import { LIVE_PROGRAM_PROTOCOL, liveProgramMessageSchema } from "../assets/shared/schemas/live-room-program";
import { connectedSessionClaims } from "../functions/_lib/auth/user-session-activity";
import { USER_SESSION_TOKEN_HEADER, verifyUserSessionToken } from "../functions/_lib/auth/user-session-token";
import { callApi } from "./helpers/app";
import { createLiveRoomFixture } from "./helpers/live-session-room";

const f = createLiveRoomFixture();
const HOUR_MS = 60 * 60 * 1000;

function ending(socket: WebSocket) {
  let close: { code: number; reason: string } | null = null;
  socket.addEventListener("close", (event) => (close = { code: event.code, reason: event.reason }));
  return () => close;
}

/** A session can run past the hour, and the studio stays open across a day. */
describe("a live room over a long day", () => {
  beforeEach(() => f.setup());
  afterEach(() => vi.useRealTimers());

  it("keeps an operator who stays connected past the hour their sign-in may sit idle", async () => {
    const operator = await f.connect({ person: "operator" });
    const ended = ending(operator.socket);
    vi.setSystemTime(Date.now() + STAFF_SESSION_IDLE_TTL_HOURS * HOUR_MS + 60_000);
    await runDurableObjectAlarm(f.room());
    const attendee = await f.connect({ person: "attendee" });
    attendee.send({ type: "question.ask", text: "Still there after the first hour?", anonymous: false });
    // Pending questions go to operators only: the room still takes this one for an operator.
    expect((await operator.next("question.changed")).question.status).toBe("pending");
    expect(ended()).toBeNull();
  });

  it("ends an operator's connection when the elevation itself runs out", async () => {
    const operator = await f.connect({ person: "operator" });
    const ended = ending(operator.socket);
    vi.setSystemTime(Date.now() + STAFF_CAPACITY_TTL_HOURS * HOUR_MS + 60_000);
    await runDurableObjectAlarm(f.room());
    await vi.waitFor(() => expect(ended()).toEqual({ code: 4401, reason: "AUTH_EXPIRED" }));
  });

  it("keeps an operator's program connection through a change made after that hour", async () => {
    const origin = "https://app.test";
    const opened = await callApi(env, f.programPath("/program"), {
      headers: {
        upgrade: "websocket",
        origin,
        authorization: `Bearer ${f.tokens.operator}`,
        "sec-websocket-protocol": LIVE_PROGRAM_PROTOCOL,
      },
    });
    expect(opened.status).toBe(101);
    const program = opened.webSocket!;
    const revisions: number[] = [];
    program.addEventListener("message", (event) =>
      revisions.push(liveProgramMessageSchema.parse(JSON.parse(String(event.data))).selection.revision),
    );
    const ended = ending(program);
    program.accept();
    await vi.waitFor(() => expect(revisions).toContain(0));
    // Half an hour in, the browser renews its token as it does while the operator works; the socket keeps its own.
    vi.setSystemTime(Date.now() + HOUR_MS / 2);
    const renewed = await callApi(env, "/api/v1/auth/session", {
      headers: { authorization: `Bearer ${f.tokens.operator}`, origin },
    });
    const token = renewed.headers.get(USER_SESSION_TOKEN_HEADER);
    expect(token).toBeTruthy();
    vi.setSystemTime(Date.now() + HOUR_MS / 2 + 60_000);
    const selected = await callApi(env, f.programPath("/program"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, origin, "content-type": "application/json" },
      body: JSON.stringify({ occurrenceId: f.occurrenceId, expectedRevision: 0 }),
    });
    expect(selected.status).toBe(200);
    await vi.waitFor(() => expect(revisions).toContain(1));
    expect(ended()).toBeNull();
  });

  it("moves an elevation's activity only for a token issued while it was active", async () => {
    const verified = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET!, f.tokens.operator);
    if (!verified.ok) throw new Error("The fixture's operator token did not verify");
    vi.setSystemTime(Date.now() + 2 * HOUR_MS);
    const now = Math.floor(Date.now() / 1000);
    expect(connectedSessionClaims(verified.claims)).toMatchObject({ lastActivityAt: now, staffLastActivityAt: now });
    // Renewed while the holder had no role: a role granted since still asks for a new sign-in.
    const plain = { ...verified.claims, lastActivityAt: now - 60, staffLastActivityAt: 0 };
    expect(connectedSessionClaims(plain)).toMatchObject({ lastActivityAt: now, staffLastActivityAt: 0 });
  });
});

import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { SCREEN_POLICY } from "../assets/shared/event-screen-policy";
import {
  SCREEN_MONITOR_LIMITS,
  SCREEN_MONITOR_PROTOCOL,
  screenMonitorCommandSchema,
  screenMonitorServerMessageSchema,
  type ScreenHealth,
  type ScreenMonitorCommand,
  type ScreenMonitorServerMessage,
} from "../assets/shared/schemas/event-screen-monitor";
import { signScreenSessionToken } from "../functions/_lib/auth/screen-session";
import { screenMonitorName } from "../functions/_lib/services/event-screens/screen-monitor-access";
import type { Env } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";

const SECRET = env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret";
const ORIGIN = "https://app.test";
const EVENT = { id: crypto.randomUUID(), slug: "monitor-a" };
const OTHER_EVENT = { id: crypto.randomUUID(), slug: "monitor-b" };
type Staff = "manager" | "moderator" | "reader";
const users: Record<Staff, string> = {
  manager: crypto.randomUUID(),
  moderator: crypto.randomUUID(),
  reader: crypto.randomUUID(),
};
const tokens = {} as Record<Staff, string>;
const testEnv = env as Env;

const HEALTH: ScreenHealth = {
  pageVersion: "screen-page-test.js",
  kind: "device",
  browser: null,
  display: "output",
  output: "stage-display",
  mode: "live",
  studioRefusal: null,
  player: null,
  clockOffsetMs: 40,
  metrics: { uptime: 3600, temps: { cpu: 51 } },
};

async function seed() {
  await resetDb();
  const now = new Date().toISOString();
  for (const event of [EVENT, OTHER_EVENT])
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES (?,?,'Monitor test','Europe/Amsterdam','invite_or_open','{}',?,?)",
    )
      .bind(event.id, event.slug, now, now)
      .run();
  const grants: Record<Staff, string> = {
    manager: "agenda:screens_manage",
    moderator: "agenda:live_moderate",
    reader: "agenda:read",
  };
  for (const person of Object.keys(users) as Staff[]) {
    await env.DB.prepare("INSERT INTO users (id,email,normalized_email,active) VALUES (?,?,?,1)")
      .bind(users[person], `${person}@example.test`, `${person}@example.test`)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,?,'event',?,?)",
    )
      .bind(crypto.randomUUID(), users[person], grants[person], EVENT.id, now)
      .run();
    tokens[person] = await createAdminSession(env.DB, users[person], crypto.randomUUID());
  }
  for (const event of [EVENT, OTHER_EVENT])
    onTestFinished(() =>
      runInDurableObject(testEnv.EVENT_SCREEN_MONITORS!.getByName(screenMonitorName(event.id)), async (_, state) => {
        for (const socket of state.getWebSockets()) socket.close(1000, "Fixture complete");
        await state.storage.deleteAll();
      }),
    );
}

/** A screen paired for `event`, signed in with an active session. */
async function pairedScreen(screenId: string, event = EVENT) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO screens (id,name,event_id,created_by,created_at) VALUES (?,?,?,?,?)")
    .bind(screenId, `Screen ${screenId}`, event.id, users.manager, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO screen_sessions (id,screen_id,token_hash,approved_by,created_at,activated_at,expires_at) VALUES (?,?,'x',?,?,?,?)",
  )
    .bind(sessionId, screenId, users.manager, now, now, expiresAt)
    .run();
  const token = await signScreenSessionToken(SECRET, { screenId, sessionId, expiresAt });
  return { screenId, sessionId, cookie: `pkic_screen_session=${token}` };
}

function upgrade(path: string, headers: Record<string, string>) {
  return callApi(
    testEnv,
    path,
    {
      headers: { upgrade: "websocket", origin: ORIGIN, "sec-websocket-protocol": SCREEN_MONITOR_PROTOCOL, ...headers },
    },
    { maxRoundTrips: 1 },
  );
}

async function accepted<T>(response: Response, parse: (data: unknown) => T) {
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  const received: T[] = [];
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
  );
  socket.addEventListener("message", (event) => {
    received.push(parse(JSON.parse(String(event.data))));
  });
  socket.accept();
  return { socket, received, closed };
}

const monitorDb = (instance: unknown) => (instance as { env: Env }).env.DB;
/** Counts the monitor's D1 calls while `work` runs over its sockets. */
async function monitorD1Calls(eventId: string, work: () => Promise<void>) {
  const stub = testEnv.EVENT_SCREEN_MONITORS!.getByName(screenMonitorName(eventId));
  await runInDurableObject(stub, (instance) => {
    vi.spyOn(monitorDb(instance), "batch");
    vi.spyOn(monitorDb(instance), "prepare");
  });
  await work();
  return runInDurableObject(stub, (instance) => {
    const db = monitorDb(instance);
    const count = vi.mocked(db.batch).mock.calls.length + vi.mocked(db.prepare).mock.calls.length;
    vi.mocked(db.batch).mockRestore();
    vi.mocked(db.prepare).mockRestore();
    return count;
  });
}

const connectScreen = async (cookie: string, screenId: string) =>
  accepted(await upgrade(`/api/v1/screens/${screenId}/live`, { cookie }), (data) =>
    screenMonitorCommandSchema.parse(data),
  );
const connectStaff = async (person: Staff, slug = EVENT.slug) =>
  accepted(
    await upgrade(`/api/v1/events/${slug}/screens/live`, { authorization: `Bearer ${tokens[person]}` }),
    (data) => screenMonitorServerMessageSchema.parse(data),
  );

function next<T extends { type: string }, K extends T["type"]>(received: T[], type: K, after = 0) {
  return vi.waitFor(
    () => {
      const found = received.slice(after).find((message): message is Extract<T, { type: K }> => message.type === type);
      if (!found) throw new Error(`No ${type} yet`);
      return found;
    },
    { timeout: 3000 },
  );
}

describe("event screen monitor", () => {
  beforeEach(seed);

  it("relays a screen's health to staff, each admission in one D1 call", async () => {
    const paired = await pairedScreen("MON234");
    const watcher = await connectStaff("moderator");
    const first = await next(watcher.received, "screens.snapshot");
    expect(first).toMatchObject({ control: false, screens: [] });

    const screen = await connectScreen(paired.cookie, paired.screenId);
    const online = await next(watcher.received, "screens.changed");
    expect(online.screen).toMatchObject({ screenId: "MON234", online: true, health: null });

    const before = watcher.received.length;
    screen.socket.send(JSON.stringify({ type: "screen.health", health: HEALTH }));
    const reported = await next(watcher.received, "screens.changed", before);
    expect(reported.screen.health).toEqual(HEALTH);
    expect(reported.screen.reportedAt).toMatch(/Z$/);

    const later = await connectStaff("manager");
    const snapshot = await next(later.received, "screens.snapshot");
    expect(snapshot.control).toBe(true);
    expect(Math.abs(snapshot.serverNow - Date.now())).toBeLessThan(5_000);
    expect(snapshot.screens).toEqual([expect.objectContaining({ screenId: "MON234", online: true, health: HEALTH })]);

    const after = watcher.received.length;
    screen.socket.close(1000, "Done");
    const offline = await next(watcher.received, "screens.changed", after);
    expect(offline.screen).toMatchObject({ online: false, health: HEALTH });
    expect(offline.screen.disconnectedAt).toMatch(/Z$/);
  });

  it("drops a report the contract refuses, secrets included, without closing the screen", async () => {
    const paired = await pairedScreen("MON235");
    const watcher = await connectStaff("manager");
    const screen = await connectScreen(paired.cookie, paired.screenId);
    await next(watcher.received, "screens.changed");
    const before = watcher.received.length;
    screen.socket.send(
      JSON.stringify({
        type: "screen.health",
        health: { ...HEALTH, metrics: { network: { management: { secret_sha256: "a".repeat(64) } } } },
      }),
    );
    screen.socket.send(JSON.stringify({ type: "screen.health", health: { ...HEALTH, mode: "auto" } }));
    const reported = await next(watcher.received, "screens.changed", before);
    expect(reported.screen.health?.mode).toBe("auto");
    expect(watcher.received.slice(before)).toHaveLength(1);
  });

  it("lets screen managers identify and reload a connected screen, and room operators only watch", async () => {
    const paired = await pairedScreen("MON236");
    const screen = await connectScreen(paired.cookie, paired.screenId);
    const manager = await connectStaff("manager");
    const moderator = await connectStaff("moderator");
    await next(manager.received, "screens.snapshot");
    await next(moderator.received, "screens.snapshot");

    const refusedId = crypto.randomUUID();
    moderator.socket.send(JSON.stringify({ type: "screen.reload", screenId: "MON236", operationId: refusedId }));
    expect(await next(moderator.received, "screens.refused")).toMatchObject({
      code: "SCREEN_MONITOR_READ_ONLY",
      operationId: refusedId,
    });

    const operationId = crypto.randomUUID();
    const calls = await monitorD1Calls(EVENT.id, async () => {
      screen.socket.send(JSON.stringify({ type: "screen.health", health: HEALTH }));
      await next(manager.received, "screens.changed");
      manager.socket.send(JSON.stringify({ type: "screen.identify", screenId: "MON236", operationId }));
      expect(await next(manager.received, "screens.sent")).toMatchObject({ operationId, command: "screen.identify" });
    });
    expect(calls).toBe(0);
    const identify = (await next(screen.received, "screen.identify")) as Extract<
      ScreenMonitorCommand,
      { type: "screen.identify" }
    >;
    expect(Date.parse(identify.until) - Date.now()).toBeLessThanOrEqual(SCREEN_POLICY.identifySeconds * 1000);
    expect(screen.received.some((command) => command.type === "screen.reload")).toBe(false);

    manager.socket.send(
      JSON.stringify({ type: "screen.reload", screenId: "ZZZ234", operationId: crypto.randomUUID() }),
    );
    expect(await next(manager.received, "screens.refused")).toMatchObject({ code: "SCREEN_NOT_CONNECTED" });
  });

  it("refuses staff without screen status access, a screen without its sign-in, and keeps events apart", async () => {
    expect(await (await connectStaff("reader")).closed).toEqual({ code: 4403, reason: "SCREEN_STATUS_FORBIDDEN" });
    const paired = await pairedScreen("MON237");
    const wrong = await connectScreen("pkic_screen_session=invalid", paired.screenId);
    expect((await wrong.closed).code).toBe(4401);
    const borrowed = await connectScreen(paired.cookie, "MONABC");
    expect((await borrowed.closed).code).toBe(4401);

    const elsewhere = await pairedScreen("MONOTH", OTHER_EVENT);
    const watcher = await connectStaff("manager");
    await next(watcher.received, "screens.snapshot");
    const other = await connectScreen(elsewhere.cookie, elsewhere.screenId);
    other.socket.send(JSON.stringify({ type: "screen.health", health: HEALTH }));
    const own = await connectScreen(paired.cookie, paired.screenId);
    own.socket.send(JSON.stringify({ type: "screen.health", health: HEALTH }));
    await vi.waitFor(() => expect(watcher.received.filter((m) => m.type === "screens.changed")).toHaveLength(2));
    const changed = watcher.received.filter(
      (message): message is Extract<ScreenMonitorServerMessage, { type: "screens.changed" }> =>
        message.type === "screens.changed",
    );
    expect(changed.every((message) => message.screen.screenId === "MON237")).toBe(true);
    const otherMonitor = testEnv.EVENT_SCREEN_MONITORS!.getByName(screenMonitorName(OTHER_EVENT.id));
    await vi.waitFor(async () =>
      expect(await runInDurableObject(otherMonitor, (_, state) => state.storage.get("status:MONOTH"))).toMatchObject({
        online: true,
        health: HEALTH,
      }),
    );
  });

  it("closes and forgets a revoked screen at its next access recheck, in one batch for every socket", async () => {
    const paired = await pairedScreen("MONREV");
    const screen = await connectScreen(paired.cookie, paired.screenId);
    const watcher = await connectStaff("manager");
    await next(watcher.received, "screens.snapshot");
    await env.DB.prepare("UPDATE screen_sessions SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), paired.sessionId)
      .run();
    const stub = testEnv.EVENT_SCREEN_MONITORS!.getByName(screenMonitorName(EVENT.id));
    // One batch, prepared as one staff-session read plus one screen read: one D1 call.
    await runInDurableObject(stub, (instance) => void vi.spyOn(monitorDb(instance), "batch"));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const calls = await runInDurableObject(stub, (instance) => {
      const spy = vi.mocked(monitorDb(instance).batch);
      const count = spy.mock.calls.length;
      spy.mockRestore();
      return count;
    });
    expect(calls).toBe(1);
    expect(await screen.closed).toEqual({ code: 4403, reason: "SCREEN_MONITOR_ACCESS_ENDED" });
    const snapshot = await vi.waitFor(() => {
      const found = watcher.received.filter((message) => message.type === "screens.snapshot").at(-1);
      if (!found || found.type !== "screens.snapshot" || found.screens.length) throw new Error("Not forgotten yet");
      return found;
    });
    expect(snapshot.screens).toEqual([]);
    expect(watcher.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("forgets a screen kept without a socket once it leaves the event, in the same batch", async () => {
    const paired = await pairedScreen("MONSTA");
    const watcher = await connectStaff("manager");
    await next(watcher.received, "screens.snapshot");
    const stub = testEnv.EVENT_SCREEN_MONITORS!.getByName(screenMonitorName(EVENT.id));
    const recent = new Date(Date.now() - 60_000).toISOString();
    // Two screens went offline a minute ago; one of them was then replaced by a new device.
    await pairedScreen("MONGON");
    await runInDurableObject(stub, async (instance, state) => {
      for (const screenId of [paired.screenId, "MONGON"])
        await state.storage.put(`status:${screenId}`, {
          screenId,
          online: false,
          connectedAt: recent,
          disconnectedAt: recent,
          reportedAt: recent,
          stateSince: recent,
          health: null,
        });
      vi.spyOn(monitorDb(instance), "batch");
    });
    await env.DB.prepare("DELETE FROM screens WHERE id='MONGON'").run();
    const before = watcher.received.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const snapshot = await next(watcher.received, "screens.snapshot", before);
    expect(snapshot.screens.map((status) => status.screenId)).toEqual([paired.screenId]);
    const calls = await runInDurableObject(stub, (monitor) => {
      const spy = vi.mocked(monitorDb(monitor).batch);
      const count = spy.mock.calls.length;
      spy.mockRestore();
      return count;
    });
    expect(calls).toBe(1);
  });

  it("paces screenshots by whether staff watch, keeps the latest and drops anything but a small WebP or JPEG", async () => {
    const paired = await pairedScreen("MONSHT");
    const screen = await connectScreen(paired.cookie, paired.screenId);
    expect(await next(screen.received, "screen.capture")).toEqual({
      type: "screen.capture",
      everySeconds: SCREEN_POLICY.screenshotSeconds,
    });
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    screen.socket.send(webp);

    const paces = screen.received.length;
    const watcher = await connectStaff("moderator");
    expect(await next(screen.received, "screen.capture", paces)).toMatchObject({
      everySeconds: SCREEN_POLICY.screenshotWatchedSeconds,
    });
    // The stored screenshot follows the snapshot, to read-only staff too.
    await next(watcher.received, "screens.snapshot");
    const stored = await next(watcher.received, "screens.screenshot");
    // Kept and relayed as sent: no conversion on the server.
    expect(stored).toMatchObject({ screenId: "MONSHT", format: "webp" });
    expect(Uint8Array.from(atob(stored.image), (char) => char.charCodeAt(0))).toEqual(webp);

    const calls = await monitorD1Calls(EVENT.id, async () => {
      const before = watcher.received.length;
      screen.socket.send(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
      // RIFF without WEBP is not a WebP.
      screen.socket.send(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1]));
      const large = new Uint8Array(SCREEN_MONITOR_LIMITS.screenshotBytes + 1);
      large.set(webp);
      screen.socket.send(large);
      // Sooner than the device takes a new one.
      screen.socket.send(jpeg);
      screen.socket.send(JSON.stringify({ type: "screen.health", health: HEALTH }));
      await next(watcher.received, "screens.changed", before);
      expect(watcher.received.slice(before).some((message) => message.type === "screens.screenshot")).toBe(false);
      expect(screen.socket.readyState).toBe(WebSocket.OPEN);
    });
    expect(calls).toBe(0);

    // Another screen's JPEG is relayed as JPEG.
    const other = await pairedScreen("MONJPG");
    const jpegScreen = await connectScreen(other.cookie, other.screenId);
    const sent = watcher.received.length;
    jpegScreen.socket.send(jpeg);
    expect(await next(watcher.received, "screens.screenshot", sent)).toMatchObject({
      screenId: "MONJPG",
      format: "jpeg",
      image: btoa(String.fromCharCode(...jpeg)),
    });

    const left = screen.received.length;
    watcher.socket.close(1000, "Done");
    expect(await next(screen.received, "screen.capture", left)).toMatchObject({
      everySeconds: SCREEN_POLICY.screenshotSeconds,
    });
  });

  it("keeps one quality sample a minute and hands staff the last hour with the snapshot", async () => {
    const paired = await pairedScreen("MONQLT");
    const screen = await connectScreen(paired.cookie, paired.screenId);
    const watcher = await connectStaff("manager");
    await next(watcher.received, "screens.snapshot");
    const network = (internet: number, signal: number) => ({
      internet: { avg_ms: internet, loss_pct: 0, samples: 60 },
      gateway: { avg_ms: 2.5, loss_pct: 0, samples: 60 },
      wifi: { ssid: "Venue", signal },
      rx_bps: 4_500_000,
    });
    const playback = {
      state: "playing" as const,
      stalls: { lastMinute: { count: 2, seconds: 3.5 }, lastHour: { count: 4, seconds: 9 }, started: 2 },
      errorCode: null,
      loadedFraction: 0.4,
      reportedQuality: "hd720",
      liveLagSeconds: 12.5,
    };
    const livestream: ScreenHealth = {
      ...HEALTH,
      display: "livestream",
      output: "livestream",
      player: { status: "playing", muted: false, changedAt: new Date().toISOString(), playback },
    };
    const before = watcher.received.length;
    screen.socket.send(
      JSON.stringify({ type: "screen.health", health: { ...livestream, metrics: { network: network(18, 70) } } }),
    );
    await next(watcher.received, "screens.changed", before);
    const second = watcher.received.length;
    screen.socket.send(
      JSON.stringify({ type: "screen.health", health: { ...livestream, metrics: { network: network(9, 55) } } }),
    );
    const changed = await next(watcher.received, "screens.changed", second);
    expect(changed.screen.health?.player?.playback).toEqual(playback);
    // The worst of the minute, unless both reports straddled a minute boundary.
    const expected = {
      routerLatencyMs: 2.5,
      internetLossPercent: 0,
      rxBitsPerSecond: 4_500_000,
      livestreamStalls: 2,
    };
    expect(changed.sample).toMatchObject(expected);
    expect(changed.sample?.minute).toMatch(/:00\.000Z$/);

    const later = await connectStaff("moderator");
    const snapshot = await next(later.received, "screens.snapshot");
    expect(snapshot.quality).toEqual([
      { screenId: "MONQLT", samples: expect.arrayContaining([expect.objectContaining(expected)]) },
    ]);
    expect(snapshot.quality[0]!.samples.length).toBeLessThanOrEqual(2);
  });

  it("keeps when a screen's state began across reports that change nothing it draws", async () => {
    const paired = await pairedScreen("MONSTA");
    const screen = await connectScreen(paired.cookie, paired.screenId);
    const watcher = await connectStaff("manager");
    await next(watcher.received, "screens.snapshot");
    const report = async (health: ScreenHealth) => {
      const before = watcher.received.length;
      screen.socket.send(JSON.stringify({ type: "screen.health", health }));
      return (await next(watcher.received, "screens.changed", before)).screen;
    };
    const first = await report(HEALTH);
    expect(first.stateSince).toBe(first.reportedAt);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const same = await report({ ...HEALTH, clockOffsetMs: 90, metrics: { uptime: 3700 } });
    expect(same.stateSince).toBe(first.stateSince);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const changed = await report({ ...HEALTH, mode: "auto" });
    expect(changed.stateSince).toBe(changed.reportedAt);
    expect(changed.stateSince).not.toBe(first.stateSince);
  });

  it("forgets a screen gone past the keep window while other sockets stay open", async () => {
    const paired = await pairedScreen("MONKEP");
    const screen = await connectScreen(paired.cookie, paired.screenId);
    const watcher = await connectStaff("manager");
    await next(watcher.received, "screens.snapshot");
    const stub = testEnv.EVENT_SCREEN_MONITORS!.getByName(screenMonitorName(EVENT.id));
    const gone = new Date(Date.now() - (SCREEN_POLICY.monitorKeepDays * 24 + 1) * 3_600_000).toISOString();
    await runInDurableObject(stub, async (_, state) => {
      await state.storage.put("status:OLD234", {
        screenId: "OLD234",
        online: false,
        connectedAt: gone,
        disconnectedAt: gone,
        reportedAt: gone,
        stateSince: gone,
        health: null,
      });
      await state.storage.put("quality:OLD234", []);
    });
    const before = watcher.received.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const snapshot = await next(watcher.received, "screens.snapshot", before);
    expect(snapshot.screens.map((status) => status.screenId)).toEqual(["MONKEP"]);
    expect(
      await runInDurableObject(stub, async (_, state) => [
        await state.storage.get("status:OLD234"),
        await state.storage.get("quality:OLD234"),
      ]),
    ).toEqual([undefined, undefined]);
    expect(screen.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("sends a pruning snapshot only to staff whose lease is current", async () => {
    const expired = await connectStaff("manager");
    await next(expired.received, "screens.snapshot");
    const stub = testEnv.EVENT_SCREEN_MONITORS!.getByName(screenMonitorName(EVENT.id));
    const gone = new Date(Date.now() - (SCREEN_POLICY.monitorKeepDays * 24 + 1) * 3_600_000).toISOString();
    await runInDurableObject(stub, async (_, state) => {
      // The lease ran out between alarms; the socket is still open.
      for (const socket of state.getWebSockets("staff"))
        socket.serializeAttachment({ ...(socket.deserializeAttachment() as object), checkedAt: 0 });
      await state.storage.put("status:OLD235", {
        screenId: "OLD235",
        online: false,
        connectedAt: gone,
        disconnectedAt: gone,
        reportedAt: gone,
        stateSince: gone,
        health: null,
      });
    });
    const before = expired.received.length;
    // A new connection prunes the forgotten screen and tells current staff.
    const current = await connectStaff("moderator");
    // Its own snapshot is sent before the prune; the prune's follows, without the forgotten screen.
    await next(current.received, "screens.snapshot");
    const pruned = await vi.waitFor(() => {
      const snapshots = current.received.filter((message) => message.type === "screens.snapshot");
      if (snapshots.length < 2) throw new Error("No pruning snapshot yet");
      return snapshots.at(-1)!;
    });
    expect(pruned.type === "screens.snapshot" && pruned.screens).toEqual([]);
    expect(await runInDurableObject(stub, (_, state) => state.storage.get("status:OLD235"))).toBeUndefined();
    expect(expired.received.slice(before)).toEqual([]);
  });

  it("withholds a pruning snapshot when the lease runs out while the snapshot is read", async () => {
    const watcher = await connectStaff("manager");
    await next(watcher.received, "screens.snapshot");
    const stub = testEnv.EVENT_SCREEN_MONITORS!.getByName(screenMonitorName(EVENT.id));
    const gone = new Date(Date.now() - (SCREEN_POLICY.monitorKeepDays * 24 + 1) * 3_600_000).toISOString();
    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put("status:OLD236", {
        screenId: "OLD236",
        online: false,
        connectedAt: gone,
        disconnectedAt: gone,
        reportedAt: gone,
        stateSince: gone,
        health: null,
      });
      // Only a snapshot reads the quality history: the clock passes the lease while it does.
      const store = (instance as unknown as { store: { quality: () => Promise<unknown> } }).store;
      const quality = store.quality.bind(store);
      const real = Date.now;
      vi.spyOn(store, "quality").mockImplementation(async () => {
        const histories = await quality();
        const later = real() + (SCREEN_POLICY.monitorAccessLeaseSeconds + 1) * 1000;
        vi.spyOn(Date, "now").mockReturnValue(later);
        return histories;
      });
    });
    const before = watcher.received.length;
    // A screen connecting prunes the forgotten one; the upgrade answers once the broadcast is done.
    const paired = await pairedScreen("MONLSE");
    await connectScreen(paired.cookie, paired.screenId);
    await runInDurableObject(stub, () => vi.restoreAllMocks());
    expect(await runInDurableObject(stub, (_, state) => state.storage.get("status:OLD236"))).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(watcher.received.slice(before).some((message) => message.type === "screens.snapshot")).toBe(false);
  });
});

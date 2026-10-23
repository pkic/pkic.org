import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseLike } from "../functions/_lib/types";
import { livePollDraftSchema } from "../assets/shared/schemas/live-session-poll";
import { LIVE_ROOM_ACCESS_POLICY } from "../assets/shared/live-session-policy";
import { LiveRoomGraphicBasis } from "../functions/_lib/services/live-session/room-graphic-basis";
import { LiveRoomAccessLease } from "../functions/_lib/services/live-session/room-access-lease";
import { currentLiveRoomCommandRead } from "../functions/_lib/services/live-session/room-command-read-scope";
import { createLiveRoomFixture } from "./helpers/live-session-room";
import { installLiveRoomD1Profile, liveRoomD1Profile } from "./helpers/live-room-d1-profile";

const f = createLiveRoomFixture();
beforeEach(() => f.setup());

describe("live interaction stays local to its Durable Object", () => {
  it("persists and delivers chat without a D1 call even when D1 calls would take a second", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    await installLiveRoomD1Profile(f.room(), 1000);
    author.send({ type: "chat.send", text: "Persisted without D1" });
    const delivered = await reader.next("chat.message");
    expect(delivered.message.text).toBe("Persisted without D1");
    const stored = await runInDurableObject(f.room(), (_room, state) =>
      state.storage.sql.exec("SELECT body FROM room_chat").toArray(),
    );
    expect(stored).toEqual([{ body: "Persisted without D1" }]);
    expect((await liveRoomD1Profile(f.room())).roundTrips).toBe(0);
  });

  it("a background refresh coalesces room access reads and removes revoked authority", async () => {
    const operator = await f.connect({ person: "operator" });
    await f.connect({ person: "attendee" });
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.users.operator)
      .run();
    await installLiveRoomD1Profile(f.room());
    const closed = new Promise<string>((resolve) =>
      operator.socket.addEventListener("close", (event) => resolve(event.reason)),
    );
    await runDurableObjectAlarm(f.room());
    expect(await closed).toBe("LIVE_SESSION_ACCESS_REQUIRED");
    expect(
      (await liveRoomD1Profile(f.room())).queries.filter(({ sql }) =>
        sql.includes("FROM json_each(?) requested JOIN sessions"),
      ),
    ).toHaveLength(1);
  });

  it("restores leases after hibernation without a D1 read or a longer authority lifetime", async () => {
    await f.connect({ person: "attendee" });
    await installLiveRoomD1Profile(f.room(), 1000);
    await runInDurableObject(f.room(), async (instance, state) => {
      const sql = Reflect.get(instance, "sql"),
        store = Reflect.get(instance, "store");
      const restored = new LiveRoomAccessLease(
        state,
        Reflect.get(instance, "sessionEnv"),
        sql,
        () => store.session(),
        () => [],
        async () => {},
      );
      await restored.run(async () => {
        expect([...currentLiveRoomCommandRead()!.participants.values()].every((result) => result.ok)).toBe(true);
      });
      const socket = state.getWebSockets()[0];
      const participant = socket.deserializeAttachment();
      socket.serializeAttachment({
        ...participant,
        accessGrant: {
          ...participant.accessGrant,
          checkedAt: new Date(Date.now() - LIVE_ROOM_ACCESS_POLICY.leaseMilliseconds).toISOString(),
        },
      });
      await restored.run(async () => {
        expect([...currentLiveRoomCommandRead()!.participants.values()]).toMatchObject([
          { ok: false, error: { code: "LIVE_ROOM_ACCESS_EXPIRED" } },
        ]);
      });
    });
    expect((await liveRoomD1Profile(f.room())).roundTrips).toBe(0);
  });

  it.each(["credential", "lease"] as const)("%s expiry refuses immediately without querying D1", async (expired) => {
    const author = await f.connect({ person: "attendee" });
    await installLiveRoomD1Profile(f.room(), 1000);
    await runInDurableObject(f.room(), (_instance, state) => {
      const socket = state.getWebSockets()[0];
      const participant = socket.deserializeAttachment();
      socket.serializeAttachment({
        ...participant,
        accessGrant: {
          ...participant.accessGrant,
          ...(expired === "credential"
            ? { credentialExpiresAt: new Date(Date.now() - 1).toISOString() }
            : { checkedAt: new Date(Date.now() - LIVE_ROOM_ACCESS_POLICY.leaseMilliseconds).toISOString() }),
        },
      });
    });
    const closed = new Promise<string>((resolve) =>
      author.socket.addEventListener("close", (event) => resolve(event.reason)),
    );
    author.send({ type: "chat.send", text: "Must not be persisted" });
    expect(await closed).toBe(expired === "credential" ? "AUTH_EXPIRED" : "LIVE_ROOM_ACCESS_EXPIRED");
    expect((await liveRoomD1Profile(f.room())).roundTrips).toBe(0);
    expect(
      await runInDurableObject(f.room(), (_instance, state) =>
        state.storage.sql.exec("SELECT id FROM room_chat").toArray(),
      ),
    ).toEqual([]);
  });
  it("delivers chat and saves polls while background access and graphics reads are stalled", async () => {
    const operator = await f.connect({ person: "operator" });
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    await runInDurableObject(f.room(), (instance, state) => {
      const session = Reflect.get(instance, "databaseSession");
      const original: DatabaseLike = Reflect.get(session, "sourceDb");
      session.reset();
      Reflect.set(session, "sourceDb", {
        prepare: (sql: string) => original.prepare(sql),
        batch: async (statements: Parameters<DatabaseLike["batch"]>[0]) => {
          calls++;
          started();
          await gate;
          return original.batch(statements);
        },
      });
      const refreshing = Promise.all([
        Reflect.get(instance, "access").refresh(),
        Reflect.get(instance, "graphics").refresh(),
      ]);
      Reflect.set(instance, "testRefresh", refreshing);
      state.waitUntil(refreshing);
    });
    try {
      await reading;
      const backgroundCalls = calls;
      author.send({ type: "chat.send", text: "Delivered while the database is stalled" });
      expect((await reader.next("chat.message")).message.text).toBe("Delivered while the database is stalled");
      operator.send({
        type: "poll.save",
        pollId: null,
        draft: livePollDraftSchema.parse({
          field: {
            key: "stalled",
            label: "Saved during background refresh",
            fieldType: "select",
            options: ["Yes", "No"],
          },
          showResults: true,
        }),
      });
      expect((await operator.next("poll.changed")).poll.field.label).toBe("Saved during background refresh");
      expect(calls).toBe(backgroundCalls);
    } finally {
      release();
      await runInDurableObject(f.room(), async (instance) => {
        await Reflect.get(instance, "testRefresh");
      });
    }
  });

  it("poll creation, opening, questions, ballots and reaction updates do not wait for D1", async () => {
    const operator = await f.connect({ person: "operator" });
    const author = await f.connect({ person: "attendee" });
    await installLiveRoomD1Profile(f.room(), 1000);
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
    author.send({ type: "question.ask", text: "A local question", anonymous: true });
    expect((await operator.next("question.changed")).question.text).toBe("A local question");
    author.send({ type: "poll.vote", pollId: poll.id, answer: "Yes" });
    expect(
      (await operator.next("poll.changed", (message) => message.poll.results?.totalAnswers === 1)).poll.results
        ?.totalAnswers,
    ).toBe(1);
    author.send({ type: "reaction.send", reaction: "love" });
    expect((await operator.next("reaction.burst")).counts.love).toBe(1);
    expect((await liveRoomD1Profile(f.room())).roundTrips).toBe(0);
  });
  it("timers, speaker messages, ticker/schedule composition and Preview transitions stay local", async () => {
    const operator = await f.connect({ person: "operator" });
    await installLiveRoomD1Profile(f.room(), 1000);
    operator.send({
      type: "timer.add",
      timer: { name: "Local timer", kind: "duration", targetAt: null, durationSeconds: 90 },
    });
    const timer = (await operator.next("timers.changed", (message) => message.timers.length === 2)).timers[1]!;
    operator.send({ type: "timer.control", timerId: timer.id, action: "start" });
    const started = (await operator.next("timers.changed", (message) => message.timers[1]!.running)).timers[1]!;
    operator.send({ type: "timer.adjust", timerId: timer.id, deltaSeconds: 30 });
    await operator.next(
      "timers.changed",
      (message) => Date.parse(message.timers[1]!.anchorAt!) >= Date.parse(started.anchorAt!) + 29999,
    );
    operator.send({ type: "speaker.message", text: "Wrap up", tone: "warning", flash: false });
    await operator.next("speaker.message.changed");
    operator.send({
      type: "stage.ticker",
      ticker: {
        style: "gradient",
        messages: [{ id: "local", prefix: "", template: "Local ticker", condition: "always" }],
      },
    });
    await operator.next("stage.changed", (message) => message.stage.ticker !== null);
    operator.send({ type: "stage.schedule", schedule: { scope: "all-rooms", layout: "list" } });
    await operator.next("stage.changed", (message) => message.stage.schedule !== null);
    operator.send({
      type: "preview.set",
      composition: {
        ticker: {
          style: "gradient",
          messages: [{ id: "preview", prefix: "", template: "Local preview", condition: "always" }],
        },
      },
    });
    await operator.next("preview.changed", (message) => message.composition.ticker !== null);
    operator.send({ type: "preview.take" });
    await operator.next("stage.changed", (message) => message.stage.ticker?.segments[0]?.markdown === "Local preview");
    expect((await liveRoomD1Profile(f.room())).roundTrips).toBe(0);
    // The same public basis reconstructs locally after eviction, without parsing or fetching on each control.
    await runInDurableObject(f.room(), (instance) => {
      const restored = new LiveRoomGraphicBasis(Reflect.get(instance, "sql")).read();
      expect(restored.agenda?.eventSlug).toBe(f.eventSlug);
      expect(restored.layouts.length).toBeGreaterThan(0);
    });
  });

  it("a prepared check-in composition transitions without another D1 lookup", async () => {
    const operator = await f.connect({ person: "operator" });
    operator.send({ type: "preview.set", composition: { checkIn: { kind: "session", occurrenceId: f.occurrenceId } } });
    const prepared = await operator.next("preview.changed", (message) => message.composition.checkIn !== null);
    await installLiveRoomD1Profile(f.room(), 1000);
    operator.send({ type: "preview.take" });
    const taken = await operator.next("stage.changed", (message) => message.stage.checkIn !== null);
    expect(taken.stage.checkIn?.path).toBe(prepared.composition.checkIn?.path);
    expect((await liveRoomD1Profile(f.room())).roundTrips).toBe(0);
  });

  it("an explicit erasure fences a message already waiting for its author stamp", async () => {
    const author = await f.connect({ person: "attendee" });
    const reader = await f.connect({ person: "secondAttendee" });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await runInDurableObject(f.room(), (instance, state) => {
      const authors = Reflect.get(instance, "authors");
      const handle = authors.handle.bind(authors) as (userId: string) => Promise<string | null>;
      authors.handle = async (userId: string) => {
        entered();
        await gate;
        return handle(userId);
      };
      const socket = state
        .getWebSockets()
        .find((socket) => socket.deserializeAttachment().userId === f.users.attendee)!;
      const pending = Reflect.get(instance, "webSocketMessage").call(
        instance,
        socket,
        JSON.stringify({ type: "chat.send", text: "Erased before persistence" }),
      );
      Reflect.set(instance, "testPendingMessage", pending);
      state.waitUntil(pending);
    });
    try {
      await writing;
      await f.room().forgetParticipant(f.users.attendee);
    } finally {
      release();
      await runInDurableObject(f.room(), async (instance) => {
        await Reflect.get(instance, "testPendingMessage");
      });
    }
    expect(reader.received.filter((message) => message.type === "chat.message")).toEqual([]);
    expect(
      await runInDurableObject(f.room(), (_instance, state) =>
        state.storage.sql.exec("SELECT id FROM room_chat").toArray(),
      ),
    ).toEqual([]);
    expect(author.socket.readyState).not.toBe(WebSocket.OPEN);
  });
});

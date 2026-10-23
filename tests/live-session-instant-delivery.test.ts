import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseLike } from "../functions/_lib/types";
import { livePollDraftSchema } from "../assets/shared/schemas/live-session-poll";
import { LIVE_ROOM_ACCESS_POLICY } from "../assets/shared/live-session-policy";
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
  it("delivers during a stalled background D1 refresh instead of queueing behind it", async () => {
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
      const refreshing = Reflect.get(instance, "access").refresh() as Promise<void>;
      Reflect.set(instance, "testRefresh", refreshing);
      state.waitUntil(refreshing);
    });
    try {
      await reading;
      author.send({ type: "chat.send", text: "Delivered while the database is stalled" });
      expect((await reader.next("chat.message")).message.text).toBe("Delivered while the database is stalled");
      expect(calls).toBe(1);
    } finally {
      release();
      await runInDurableObject(f.room(), async (instance) => {
        await Reflect.get(instance, "testRefresh");
      });
    }
  });

  it("questions, ballots, reactions and deferred tally updates do not wait for D1", async () => {
    const operator = await f.connect({ person: "operator" });
    const author = await f.connect({ person: "attendee" });
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
    await installLiveRoomD1Profile(f.room(), 1000);
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

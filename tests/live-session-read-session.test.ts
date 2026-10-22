import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { DatabaseLike } from "../functions/_lib/types";
import { LiveRoomDatabaseSession } from "../functions/_lib/services/live-session/room-database-session";
import { LiveRoomSql } from "../functions/_lib/services/live-session/room-sql";
import { LiveRoomStore } from "../functions/_lib/services/live-session/room-store";
import { createLiveRoomFixture } from "./helpers/live-session-room";

it("opts into replicas and resumes the room cursor after hibernation without copying a domain mutation", async () => {
  const f = createLiveRoomFixture();
  await f.setup();
  await runInDurableObject(f.room(), async (_room, state) => {
    const store = new LiveRoomStore(new LiveRoomSql(state.storage.sql));
    const constraints: string[] = [];
    let batches = 0;
    // Local D1 has no replicas; simulate bookmark transport while executing
    // every statement against the real migrated D1 database.
    const source: DatabaseLike = {
      prepare: (query) => env.DB.prepare(query),
      batch: (statements) => env.DB.batch(statements),
      withSession: (constraint) => {
        constraints.push(constraint!);
        let bookmark = constraint!;
        return {
          prepare: (query) => env.DB.prepare(query),
          async batch(statements) {
            const results = await env.DB.batch(statements);
            bookmark = `opaque-cursor-${++batches}`;
            return results;
          },
          getBookmark: () => bookmark,
        };
      },
    };
    const first = new LiveRoomDatabaseSession(source, store);
    first.seedBookmark("admitted-cursor");
    expect(await first.prepare("SELECT COUNT(*) AS total FROM users").first<number>("total")).toBeGreaterThan(0);
    first.seedBookmark("unrelated-later-client");
    await first.batch([first.prepare("SELECT 1"), first.prepare("SELECT 2")]);
    expect(constraints).toEqual(["admitted-cursor"]);
    expect(batches).toBe(2);
    expect(store.d1ReadBookmark()).toBe("opaque-cursor-2");
    const restarted = new LiveRoomDatabaseSession(source, store);
    restarted.seedBookmark("older-client-cursor");
    await restarted.prepare("SELECT 3").all();
    expect(constraints).toEqual(["admitted-cursor", "opaque-cursor-2"]);
    expect(store.d1ReadBookmark()).toBe("opaque-cursor-3");
    expect(new LiveRoomSql(state.storage.sql).rows("SELECT change_seq,copied_seq FROM copy_state")).toEqual([
      { change_seq: 0, copied_seq: 0 },
    ]);
  });
});

it("starts unconstrained and retains a first-use write bookmark for the next read", async () => {
  const f = createLiveRoomFixture();
  await f.setup();
  await runInDurableObject(f.room(), async (_room, state) => {
    const store = new LiveRoomStore(new LiveRoomSql(state.storage.sql));
    const constraints: string[] = [];
    let batches = 0;
    const source: DatabaseLike = {
      prepare: (query) => env.DB.prepare(query),
      batch: (statements) => env.DB.batch(statements),
      withSession: (constraint) => {
        constraints.push(constraint!);
        return {
          prepare: (query) => env.DB.prepare(query),
          batch: (statements) => {
            batches++;
            return env.DB.batch(statements);
          },
          getBookmark: () => `version-${batches}`,
        };
      },
    };
    const read = new LiveRoomDatabaseSession(source, store);
    await read.prepare("SELECT 1").all();
    expect(constraints).toEqual(["first-unconstrained"]);
    await read
      .prepare("INSERT INTO event_attendance_point_keys(event_id,link_secret,generation,issued_at) VALUES(?,?,1,?)")
      .bind(f.eventId, "synthetic-key", new Date().toISOString())
      .run();
    expect(store.d1ReadBookmark()).toBe("version-2");
    expect(
      await read
        .prepare("SELECT generation FROM event_attendance_point_keys WHERE event_id=?")
        .bind(f.eventId)
        .first<number>("generation"),
    ).toBe(1);
    expect(store.d1ReadBookmark()).toBe("version-3");
    expect(constraints).toEqual(["first-unconstrained"]);
    expect(batches).toBe(3);
  });
});

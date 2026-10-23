import { runInDurableObject } from "cloudflare:test";
import { profileD1Flow } from "./d1-flow-profile";
import type { createLiveRoomFixture } from "./live-session-room";

type Room = ReturnType<ReturnType<typeof createLiveRoomFixture>["room"]>;

/** Instrument the real D1 session owned by a native room; never changes authorization results. */
export async function installLiveRoomD1Profile(room: Room, latencyMs = 0): Promise<void> {
  await runInDurableObject(room, (instance) => {
    const session = Reflect.get(instance, "databaseSession");
    const profile = profileD1Flow(Reflect.get(session, "sourceDb"), { latencyMs });
    session.reset();
    Reflect.set(session, "sourceDb", profile.db);
    Reflect.set(instance, "testD1Profile", profile);
  });
}

export async function liveRoomD1Profile(room: Room) {
  return runInDurableObject(
    room,
    (instance) =>
      Reflect.get(instance, "testD1Profile").report() as ReturnType<ReturnType<typeof profileD1Flow>["report"]>,
  );
}

import { describe, expect, it, vi } from "vitest";
import { tellLiveRoomsScenesChanged } from "../functions/_lib/services/live-session/scenes-changed";
import type { Env } from "../functions/_lib/types";

/** The event's rooms and the session each has loaded, as the program objects answer. */
function event(loaded: Record<string, string | null>) {
  const told: string[] = [];
  const bind = vi.fn(() => ({ all: async () => ({ results: Object.keys(loaded).map((id) => ({ id })) }) }));
  const env = {
    DB: { prepare: vi.fn(() => ({ bind })) },
    LIVE_SESSION_ROOMS: {
      getByName: (name: string) => ({
        loadedProgram: async (_event: string, room: string) => loaded[room] ?? null,
        scenesChanged: async () => void told.push(name),
      }),
    },
  } as unknown as Pick<Env, "DB" | "LIVE_SESSION_ROOMS">;
  return { env, told, bind };
}

describe("telling the rooms that the event's scenes changed", () => {
  it("tells the session loaded in each of the event's rooms, and leaves a room with nothing loaded alone", async () => {
    const { env, told, bind } = event({ main: "keynote", side: null, hall: "panel" });
    await tellLiveRoomsScenesChanged(env, "event-1");
    expect(bind).toHaveBeenCalledWith("event-1");
    expect(told.sort()).toEqual(["event-1:keynote", "event-1:panel"]);
  });

  it("never fails the save when a room cannot be told", async () => {
    const { env } = event({ main: "keynote" });
    const failing = {
      ...env,
      LIVE_SESSION_ROOMS: { getByName: () => ({ loadedProgram: async () => Promise.reject(new Error("gone")) }) },
    } as unknown as Pick<Env, "DB" | "LIVE_SESSION_ROOMS">;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(tellLiveRoomsScenesChanged(failing, "event-1")).resolves.toBeUndefined();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

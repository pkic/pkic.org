import type { Env } from "../../types";
import { liveRoomName } from "./room-admission";
import { liveProgramName } from "./room-program";

/**
 * Tells the session loaded in each of the event's rooms that its scenes
 * changed, so a saved or copied scene is on every studio and screen before
 * the save answers. Best effort: a room that misses it still reads the
 * scenes on its next refresh. One bounded read lists the rooms; a room with
 * nothing loaded is left alone.
 */
export async function tellLiveRoomsScenesChanged(
  env: Pick<Env, "DB" | "LIVE_SESSION_ROOMS">,
  eventId: string,
): Promise<void> {
  const rooms = env.LIVE_SESSION_ROOMS;
  if (!rooms) return;
  try {
    const { results } = await env.DB.prepare("SELECT id FROM event_agenda_rooms WHERE event_id=?")
      .bind(eventId)
      .all<{ id: string }>();
    await Promise.all(
      results.map(async ({ id }) => {
        const loaded = await rooms.getByName(liveProgramName(eventId, id)).loadedProgram(eventId, id);
        if (loaded) await rooms.getByName(liveRoomName(eventId, loaded)).scenesChanged();
      }),
    );
  } catch (error) {
    console.error("Live rooms missed a scene change", error);
  }
}

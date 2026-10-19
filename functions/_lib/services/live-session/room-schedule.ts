import { resolveUpcomingRooms } from "../../../../assets/shared/live-session-schedule";
import type { LiveScheduleConfig } from "../../../../assets/shared/schemas/live-session-schedule";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";
import { readPublishedLiveAgenda } from "./approved-agenda";
export async function resolveLiveSchedule(
  db: DatabaseLike,
  eventId: string,
  currentOccurrenceId: string | null,
  config: LiveScheduleConfig | null,
  now = Date.now(),
  currentRoomId?: string,
  approved?: AgendaSnapshot | null,
) {
  if (!config) return null;
  return resolveUpcomingRooms(
    approved === undefined ? await readPublishedLiveAgenda(db, eventId) : approved,
    currentOccurrenceId,
    now,
    config,
    currentRoomId,
  );
}

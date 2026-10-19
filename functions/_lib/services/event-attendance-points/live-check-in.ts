/**
 * The check-in code a live output shows: the room names a point with the
 * shared selection, and this resolves it to the point's name and its signed
 * link under the event's current key.
 *
 * Every session has its own code. A room point on screen shows the code of
 * the session running in that room (or the next one starting soon), so the
 * code on screen changes when the session changes and a photo of it stops
 * working when its session ends. The room calls this again on every graphics
 * refresh. Null when the point does not exist (a removed day, room or
 * session), so the room can refuse the shot.
 */
import type { AttendancePointSelection } from "../../../../assets/shared/attendance-points";
import type { LiveCheckInGraphic } from "../../../../assets/shared/schemas/event-attendance-points";
import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { getEventById } from "../events";
import type { EventRecord } from "../event-types";
import { listAttendancePoints } from "./point-catalog";
import { attendancePointPath, ensureAttendancePointKey, signAttendancePoint } from "./point-keys";
import { resolveAttendancePoint } from "./point-resolution";

function selectionQuery(selection: AttendancePointSelection): Record<string, string> {
  switch (selection.kind) {
    case "venue_check_in":
    case "venue_check_out":
      return { kind: selection.kind, dayDate: selection.dayDate };
    case "room":
      return { kind: selection.kind, roomId: selection.roomId };
    case "session":
      return { kind: selection.kind, occurrenceId: selection.occurrenceId };
  }
}

/** The point whose code goes on screen: a room's current session, else the selection itself. */
async function shownPoint(
  db: DatabaseLike,
  event: EventRecord,
  selection: AttendancePointSelection,
  now: string,
): Promise<AttendancePointSelection> {
  if (selection.kind !== "room") return selection;
  const resolution = await resolveAttendancePoint(db, event, selection, {
    now,
    today: instantToCalendarDate(now, event.timezone),
    timeZone: event.timezone,
  });
  return resolution.kind === "session" ? { kind: "session", occurrenceId: resolution.session.id } : selection;
}

export async function resolveLiveCheckIn(
  db: DatabaseLike,
  signingSecret: string,
  eventId: string,
  selection: AttendancePointSelection,
  now: string = nowIso(),
): Promise<LiveCheckInGraphic | null> {
  const event = await getEventById(db, eventId);
  const listing = await listAttendancePoints(
    db,
    signingSecret,
    event,
    { ...selectionQuery(selection), limit: "1" },
    false,
  );
  const point = listing.points[0];
  if (!point) return null;
  const key = await ensureAttendancePointKey(db, event.id);
  const token = await signAttendancePoint(signingSecret, key, event.id, await shownPoint(db, event, selection, now));
  return { selection, label: point.label, path: attendancePointPath(event.slug, token) };
}

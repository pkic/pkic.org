/**
 * Organizers' live stream configuration for one agenda location: its usual stream and per-day replacements.
 * Streams are operational, not part of an agenda revision, so a replacement applies without a new publication.
 */
import {
  locationLiveStreamResponseSchema,
  type LiveStream,
  type LocationLiveStreamUpdate,
} from "../../../../assets/shared/schemas/event-live-stream";
import { calendarDatesBetween } from "../../../../assets/shared/timezone";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import type { EventRecord } from "../event-types";

export interface LiveStreamRow {
  day_date: string | null;
  provider: string;
  stream_ref: string;
}

/** A stored row as the shared stream contract; null for a provider this code does not know. */
export function liveStreamFromRow(row: Pick<LiveStreamRow, "provider" | "stream_ref">): LiveStream | null {
  return row.provider === "youtube" ? { provider: "youtube", videoId: row.stream_ref } : null;
}

/** The usual stream and the per-day replacements stored for one location. */
export function locationStreams(rows: readonly LiveStreamRow[]) {
  let stream: LiveStream | null = null;
  const days: Array<{ dayDate: string; stream: LiveStream }> = [];
  for (const row of rows) {
    const value = liveStreamFromRow(row);
    if (!value) continue;
    if (row.day_date === null) stream = value;
    else days.push({ dayDate: row.day_date, stream: value });
  }
  return { stream, days: days.sort((a, b) => a.dayDate.localeCompare(b.dayDate)) };
}

function eventDays(event: Pick<EventRecord, "starts_at" | "ends_at" | "timezone">) {
  return event.starts_at ? calendarDatesBetween(event.starts_at, event.ends_at ?? event.starts_at, event.timezone) : [];
}

async function locationName(db: DatabaseLike, eventId: string, roomId: string) {
  const room = await first<{ name: string }>(db, "SELECT name FROM event_agenda_rooms WHERE id=? AND event_id=?", [
    roomId,
    eventId,
  ]);
  if (!room) throw new AppError(404, "AGENDA_ROOM_NOT_FOUND", "Location not found");
  return room.name;
}

export async function readLocationLiveStream(
  db: DatabaseLike,
  event: Pick<EventRecord, "id" | "starts_at" | "ends_at" | "timezone">,
  roomId: string,
) {
  const roomName = await locationName(db, event.id, roomId);
  const rows = await all<LiveStreamRow>(
    db,
    "SELECT day_date,provider,stream_ref FROM event_agenda_room_streams WHERE room_id=? AND event_id=? ORDER BY day_date IS NOT NULL,day_date",
    [roomId, event.id],
  );
  return locationLiveStreamResponseSchema.parse({
    roomId,
    roomName,
    ...locationStreams(rows),
    eventDays: eventDays(event),
    timeZone: event.timezone,
  });
}

/** Replaces the location's whole configuration in one batch, with one audit row naming what it now streams. */
export async function replaceLocationLiveStream(
  db: DatabaseLike,
  event: Pick<EventRecord, "id" | "starts_at" | "ends_at" | "timezone">,
  roomId: string,
  input: LocationLiveStreamUpdate,
  actorUserId: string,
) {
  await locationName(db, event.id, roomId);
  const days = new Set(eventDays(event));
  const outside = input.days.find((day) => !days.has(day.dayDate));
  if (outside)
    throw new AppError(400, "VALIDATION_ERROR", `${outside.dayDate} is not a day of this event.`, {
      fieldErrors: { [`days.${input.days.indexOf(outside)}.dayDate`]: ["Choose a day of this event."] },
    });
  const now = nowIso();
  const insert = (dayDate: string | null, videoId: string) =>
    db
      .prepare(
        "INSERT INTO event_agenda_room_streams(id,event_id,room_id,day_date,provider,stream_ref,updated_by,updated_at) VALUES(?,?,?,?,'youtube',?,?,?)",
      )
      .bind(crypto.randomUUID(), event.id, roomId, dayDate, videoId, actorUserId, now);
  await db.batch([
    db.prepare("DELETE FROM event_agenda_room_streams WHERE room_id=? AND event_id=?").bind(roomId, event.id),
    ...(input.videoId ? [insert(null, input.videoId)] : []),
    ...input.days.map((day) => insert(day.dayDate, day.videoId)),
    prepareScopedAuditLog(
      db,
      { type: "event", id: event.id },
      "admin",
      actorUserId,
      "agenda_location_stream_replaced",
      "event_agenda_room",
      roomId,
      { provider: "youtube", videoId: input.videoId, days: input.days },
      now,
    ),
  ]);
  return readLocationLiveStream(db, event, roomId);
}

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
import { first } from "../../db/queries";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import type { EventRecord } from "../event-types";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { readEventAdminResource } from "../events/authorized-context";

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

function prepareLocationLiveStream(db: DatabaseLike, eventId: EventReadSelection, roomId: string) {
  const scope = eventReadIdSql(eventId);
  return {
    statements: [
      db
        .prepare(`SELECT name FROM event_agenda_rooms WHERE id=? AND event_id=${scope.sql}`)
        .bind(roomId, ...scope.bindings),
      db
        .prepare(
          `SELECT day_date,provider,stream_ref FROM event_agenda_room_streams WHERE room_id=? AND event_id=${scope.sql} ORDER BY day_date IS NOT NULL,day_date`,
        )
        .bind(roomId, ...scope.bindings),
    ],
    decode(results: D1StatementResult[], event: Pick<EventRecord, "starts_at" | "ends_at" | "timezone">) {
      const room = batchFirst<{ name: string }>(results[0]);
      if (!room) throw new AppError(404, "AGENDA_ROOM_NOT_FOUND", "Location not found");
      return locationLiveStreamResponseSchema.parse({
        roomId,
        roomName: room.name,
        ...locationStreams(batchRows<LiveStreamRow>(results[1])),
        eventDays: eventDays(event),
        timeZone: event.timezone,
      });
    },
  };
}

export async function readLocationLiveStreamRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  roomId: string,
) {
  return readEventAdminResource(db, request, env, eventSlug, "agenda:read", (event) =>
    prepareLocationLiveStream(db, event, roomId),
  );
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
  const read = prepareLocationLiveStream(db, event.id, roomId);
  const writes = [
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
  ];
  const results = await db.batch([...writes, ...read.statements]);
  return read.decode(results.slice(writes.length), event);
}

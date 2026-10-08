import type { z } from "zod";
import { scannerTargetQuerySchema } from "../../../../assets/shared/schemas/event-participation-scanning";
import { dateTimeLocalToIso } from "../../../../assets/shared/timezone";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { publishedRoomsSql } from "./published-schedule";

/** Bounded metadata shared by scanner and delegated session selectors. */
export async function scannerTargetCatalog(db: DatabaseLike, eventId: string) {
  const event = await first<{ timeZone: string }>(
    db,
    `SELECT COALESCE(json_extract(publication.snapshot_json,'$.timeZone'),event.timezone) AS timeZone
     FROM events event LEFT JOIN event_agenda_state state ON state.event_id=event.id
     LEFT JOIN event_agenda_publications publication ON publication.event_id=event.id AND publication.revision=state.published_revision
     WHERE event.id=?`,
    [eventId],
  );
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
  const rooms = await all<{ id: string; name: string }>(
    db,
    `SELECT id,name FROM (${publishedRoomsSql}) WHERE event_id=? ORDER BY name,id LIMIT 201`,
    [eventId],
  );
  return {
    timeZone: event.timeZone,
    serverNow: nowIso(),
    rooms: rooms.slice(0, 200),
    roomsTruncated: rooms.length > 200,
  };
}

export function scannerTargetFilter(
  eventId: string,
  query: z.infer<typeof scannerTargetQuerySchema>,
  catalog: { timeZone: string; serverNow: string },
) {
  const clauses = ["s.event_id=?", "INSTR(LOWER(s.title),LOWER(?))>0"],
    bindings: unknown[] = [eventId, query.q ?? ""];
  if (query.occurrenceId) {
    clauses.push("s.id=?");
    bindings.push(query.occurrenceId);
  }
  if (query.roomId) {
    clauses.push(
      "(s.room_id=? OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) placement WHERE placement.value=?))",
    );
    bindings.push(query.roomId, query.roomId);
  }
  if (query.dayDate) {
    try {
      const tomorrow = new Date(`${query.dayDate}T12:00:00.000Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      clauses.push("s.start_at>=? AND s.start_at<?");
      bindings.push(
        dateTimeLocalToIso(`${query.dayDate}T00:00`, catalog.timeZone),
        dateTimeLocalToIso(`${tomorrow.toISOString().slice(0, 10)}T00:00`, catalog.timeZone),
      );
    } catch {
      throw new AppError(400, "SCANNER_DAY_INVALID", "Choose a valid day in the event time zone.");
    }
  }
  if (query.timeWindow === "now") {
    clauses.push("s.start_at<=? AND s.end_at>?");
    bindings.push(catalog.serverNow, catalog.serverNow);
  }
  if (query.timeWindow === "next") {
    clauses.push("s.start_at>? AND s.end_at>s.start_at");
    bindings.push(catalog.serverNow);
  }
  const order =
    query.sort === "startAt"
      ? "s.start_at ASC,s.title ASC"
      : query.sort === "-startAt"
        ? "s.start_at DESC,s.title ASC"
        : query.sort === "-title"
          ? "s.title DESC"
          : "s.title ASC";
  return { where: clauses.join(" AND "), bindings, order: `${order},s.id` };
}

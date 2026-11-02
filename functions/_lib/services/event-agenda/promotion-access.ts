import { promotionSessionsQuerySchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { D1StatementResult } from "../../types";
import { z } from "zod";
import { agendaOccurrenceSchema } from "../../../../assets/shared/schemas/event-agenda";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { zonedDateTimeToDate } from "../../../../assets/shared/timezone";
import type { DatabaseLike } from "../../types";
import { batchFirst, batchRows } from "../../db/pagination";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { getPromotionKit } from "./promotion-source";
export async function assignedPromotionKit(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  canManage: boolean,
  origin: string,
) {
  if (!canManage) {
    const assigned = await first<{ user_id: string }>(
      db,
      "SELECT s.user_id FROM event_agenda_occurrence_speakers s JOIN event_agenda_occurrences o ON o.id=s.occurrence_id WHERE o.id=? AND o.event_id=? AND s.user_id=?",
      [occurrenceId, eventId, userId],
    );
    if (!assigned)
      throw new AppError(
        403,
        "PROMOTION_SESSION_SCOPE",
        "Promotion materials are available only for your assigned sessions.",
      );
  }
  return getPromotionKit(db, eventId, occurrenceId, userId, origin);
}
export function preparePublishedPromotionSessions(
  db: DatabaseLike,
  eventId: EventReadSelection,
  userId: string | null,
  query: z.infer<typeof promotionSessionsQuerySchema>,
) {
  const scope = eventReadIdSql(eventId);
  const conditions = [
    `publication.event_id=${scope.sql}`,
    "json_extract(entry.value,'$.visibility')='public'",
    "json_extract(entry.value,'$.kind') <> 'break'",
    "EXISTS (SELECT 1 FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=publication.event_id AND speaker.user_id=? AND speaker.occurrence_id=json_extract(entry.value,'$.id'))",
  ];
  if (userId === null) conditions.pop();
  const values: unknown[] = userId === null ? [...scope.bindings] : [...scope.bindings, userId];
  if (query.q) {
    conditions.push(
      "INSTR(LOWER(json_extract(entry.value,'$.title') || ' ' || json_extract(entry.value,'$.description')),LOWER(?)) > 0",
    );
    values.push(query.q);
  }
  for (const [field, value] of [
    ["roomId", query.roomId],
    ["admissionPolicy", query.admissionPolicy],
    ["kind", query.kind],
    ["visibility", query.visibility],
  ] as const)
    if (value) {
      conditions.push(`json_extract(entry.value,'$.${field}')=?`);
      values.push(value);
    }
  if (query.day) {
    if (!query.timeZone)
      throw new AppError(422, "PROMOTION_TIME_ZONE_REQUIRED", "Include the event time zone when choosing a day.");
    const [year, month, day] = query.day.split("-").map(Number);
    const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
    const begin = zonedDateTimeToDate(
      { year: year!, month: month!, day: day!, hour: 0, minute: 0, second: 0 },
      query.timeZone,
    ).toISOString();
    const end = zonedDateTimeToDate(
      {
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      },
      query.timeZone,
    ).toISOString();
    conditions.push("json_extract(entry.value,'$.startAt')>=? AND json_extract(entry.value,'$.startAt')<?");
    values.push(begin, end);
  }
  const source = `FROM event_agenda_publications publication JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision, json_each(publication.snapshot_json,'$.occurrences') entry WHERE ${conditions.join(" AND ")}`;
  const key = query.sort?.replace(/^-/u, "") ?? "title";
  const sort = key === "startAt" ? "startAt" : key === "endAt" ? "endAt" : "title";
  const direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
  return {
    statements: [
      db.prepare(`SELECT COUNT(*) AS total ${source}`).bind(...values),
      db
        .prepare(
          `SELECT entry.value ${source} ORDER BY json_extract(entry.value,'$.${sort}') ${direction}, json_extract(entry.value,'$.id') ASC LIMIT ? OFFSET ?`,
        )
        .bind(...values, query.limit, query.offset),
    ],
    decode(results: D1StatementResult[]) {
      const total = batchFirst<{ total: number }>(results[0]);
      const rows = batchRows<{ value: string }>(results[1]);
      const occurrences = rows.map((row) => agendaOccurrenceSchema.parse(JSON.parse(row.value)));
      return { occurrences, page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, occurrences.length) };
    },
  };
}
/** Standalone service callers may resolve an omitted clock first; HTTP callers compose the prepared read. */
export async function listPublishedPromotionSessions(
  db: DatabaseLike,
  eventId: string,
  userId: string | null,
  query: z.infer<typeof promotionSessionsQuerySchema>,
) {
  const clock =
    query.day && !query.timeZone
      ? await first<{ timezone: string }>(db, "SELECT timezone FROM events WHERE id=?", [eventId])
      : null;
  const read = preparePublishedPromotionSessions(db, eventId, userId, {
    ...query,
    ...(clock ? { timeZone: clock.timezone } : {}),
  });
  return read.decode(await db.batch(read.statements));
}

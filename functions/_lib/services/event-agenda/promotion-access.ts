import { z } from "zod";
import { agendaOccurrenceQuerySchema, agendaOccurrenceSchema } from "../../../../assets/shared/schemas/event-agenda";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { zonedDateTimeToDate } from "../../../../assets/shared/timezone";
import type { DatabaseLike } from "../../types";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import { getPromotionKit } from "./promotion-kit";
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
export async function listAssignedPromotionSessions(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  query: z.infer<typeof agendaOccurrenceQuerySchema>,
) {
  const conditions = [
    "publication.event_id=?",
    "json_extract(entry.value,'$.visibility')='public'",
    "json_extract(entry.value,'$.kind') <> 'break'",
    "EXISTS (SELECT 1 FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=publication.event_id AND speaker.user_id=? AND speaker.occurrence_id=json_extract(entry.value,'$.id'))",
  ];
  const values: unknown[] = [eventId, userId];
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
    const event = await first<{ timezone: string }>(db, "SELECT timezone FROM events WHERE id=?", [eventId]);
    const [year, month, day] = query.day.split("-").map(Number);
    const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
    const begin = zonedDateTimeToDate(
      { year: year!, month: month!, day: day!, hour: 0, minute: 0, second: 0 },
      event?.timezone ?? "UTC",
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
      event?.timezone ?? "UTC",
    ).toISOString();
    conditions.push("json_extract(entry.value,'$.startAt')>=? AND json_extract(entry.value,'$.startAt')<?");
    values.push(begin, end);
  }
  const source = `FROM event_agenda_publications publication JOIN event_agenda_state state ON state.event_id=publication.event_id AND state.published_revision=publication.revision, json_each(publication.snapshot_json,'$.occurrences') entry WHERE ${conditions.join(" AND ")}`;
  const total = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${source}`, values);
  const key = query.sort?.replace(/^-/u, "") ?? "title";
  const sort = key === "startAt" ? "startAt" : key === "endAt" ? "endAt" : "title";
  const direction = query.sort?.startsWith("-") ? "DESC" : "ASC";
  const rows = await all<{ value: string }>(
    db,
    `SELECT entry.value ${source} ORDER BY json_extract(entry.value,'$.${sort}') ${direction}, json_extract(entry.value,'$.id') ASC LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  const occurrences = rows.map((row) => agendaOccurrenceSchema.parse(JSON.parse(row.value)));
  return { occurrences, page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, occurrences.length) };
}
export async function recordPromotionDownload(db: DatabaseLike, occurrenceId: string, userId: string, format: string) {
  await db
    .prepare(
      "INSERT INTO event_agenda_promotion_downloads(occurrence_id,user_id,format,download_count) VALUES(?,?,?,1) ON CONFLICT(occurrence_id,user_id,format) DO UPDATE SET download_count=download_count+1",
    )
    .bind(occurrenceId, userId, format)
    .run();
}

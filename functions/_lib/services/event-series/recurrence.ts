import { expandStarts } from "./recurrence-expansion";
import { prepareCalendarRevision } from "./calendar-schedule";
import type { z } from "zod";
import { eventSeriesMaterializeSchema } from "../../../../assets/shared/schemas/event-series";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { commitEventResourceManagementBatch } from "./management";
import { getManagedGroupEventSeries } from "./series";

type MaterializeInput = z.infer<typeof eventSeriesMaterializeSchema>;

export async function materializeSeriesOccurrences(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  input: MaterializeInput,
) {
  const { series, context } = await getManagedGroupEventSeries(db, actor, groupIdOrSlug, seriesId);
  if (!series.active) throw new AppError(409, "EVENT_SERIES_INACTIVE", "Inactive meeting series cannot be expanded");
  const starts = expandStarts(
    series.startsAt,
    series.timezone,
    series.recurrenceRule,
    input.through,
    input.maxOccurrences,
  );
  const now = nowIso();
  const requested = starts.map((start) => ({
    id: uuid(),
    startsAt: start,
    endsAt: new Date(Date.parse(start) + series.durationMinutes * 60_000).toISOString(),
  }));
  const results = await commitEventResourceManagementBatch(db, actor, context, "manage", [
    db
      .prepare(
        `INSERT OR IGNORE INTO event_occurrences
           (id, series_id, starts_at, recurrence_id, ends_at, status, location_override,
            provider_join_url_ciphertext, created_at, updated_at)
         SELECT json_extract(requested.value, '$.id'), ?,
                json_extract(requested.value, '$.startsAt'), json_extract(requested.value, '$.startsAt'),
                json_extract(requested.value, '$.endsAt'),
                'scheduled', NULL, NULL, ?, ?
           FROM json_each(?) requested
          WHERE NOT EXISTS (SELECT 1 FROM event_occurrences old
            WHERE old.series_id = ? AND COALESCE(old.recurrence_id, old.starts_at) = json_extract(requested.value, '$.startsAt'))`,
      )
      .bind(seriesId, now, now, JSON.stringify(requested), seriesId),
    db
      .prepare(
        `UPDATE events SET
           starts_at = (SELECT MIN(starts_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
           ends_at = (SELECT MAX(ends_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
           updated_at = ? WHERE id = ?`,
      )
      .bind(seriesId, seriesId, now, series.eventId),
    ...prepareCalendarRevision(db, seriesId),
    prepareScopedAuditLog(
      db,
      { type: "group", id: context.groupId },
      "admin",
      actor.id,
      "event_series_materialized",
      "event_series",
      seriesId,
      {
        through: input.through,
        requested: starts.length,
      },
    ),
  ]);
  const created = Number(results[1]?.meta?.changes ?? 0);
  return { created, existing: starts.length - created, through: input.through };
}

import type { z } from "zod";
import ICAL from "ical.js";
import { eventSeriesMaterializeSchema } from "../../../../assets/shared/schemas/event-series";
import { zonedDateTimeParts, zonedDateTimeToDate, type ZonedDateTimeParts } from "../../../../assets/shared/timezone";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { commitEventResourceManagementBatch } from "./management";
import { getManagedGroupEventSeries } from "./series";

type MaterializeInput = z.infer<typeof eventSeriesMaterializeSchema>;

/** Converts a floating recurrence value to UTC while preserving local wall-clock time across DST. */
function localDateTimeToUtc(value: ZonedDateTimeParts, timeZone: string): Date {
  try {
    return zonedDateTimeToDate(value, timeZone);
  } catch {
    throw new AppError(
      422,
      "EVENT_RECURRENCE_LOCAL_TIME_INVALID",
      "The recurrence contains a local time that does not exist in the configured timezone",
    );
  }
}

function expandStarts(
  startsAt: string,
  timeZone: string,
  recurrenceRule: string,
  through: string,
  maximum: number,
): string[] {
  const anchor = new Date(startsAt);
  const horizon = new Date(through);
  if (horizon <= anchor) {
    throw new AppError(
      422,
      "EVENT_RECURRENCE_HORIZON_INVALID",
      "The materialization horizon must follow the series start",
    );
  }
  try {
    const localAnchor = zonedDateTimeParts(anchor, timeZone);
    const iterator = ICAL.Recur.fromString(recurrenceRule).iterator(
      ICAL.Time.fromData({ ...localAnchor, isDate: false }),
    );
    const starts: string[] = [];
    for (let next = iterator.next(); next; next = iterator.next()) {
      const instant = localDateTimeToUtc(
        {
          year: next.year,
          month: next.month,
          day: next.day,
          hour: next.hour,
          minute: next.minute,
          second: next.second,
        },
        timeZone,
      );
      if (instant > horizon) break;
      starts.push(instant.toISOString());
      if (starts.length > maximum) {
        throw new AppError(
          422,
          "EVENT_RECURRENCE_LIMIT_EXCEEDED",
          "The requested horizon exceeds the bounded occurrence limit",
        );
      }
    }
    return starts;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "EVENT_RECURRENCE_INVALID", "The recurrence rule could not be expanded");
  }
}

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
           (id, series_id, starts_at, ends_at, status, location_override,
            provider_join_url_ciphertext, created_at, updated_at)
         SELECT json_extract(requested.value, '$.id'), ?,
                json_extract(requested.value, '$.startsAt'),
                json_extract(requested.value, '$.endsAt'),
                'scheduled', NULL, NULL, ?, ?
           FROM json_each(?) requested`,
      )
      .bind(seriesId, now, now, JSON.stringify(requested)),
    db
      .prepare(
        `UPDATE events SET
           starts_at = (SELECT MIN(starts_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
           ends_at = (SELECT MAX(ends_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
           updated_at = ? WHERE id = ?`,
      )
      .bind(seriesId, seriesId, now, series.eventId),
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

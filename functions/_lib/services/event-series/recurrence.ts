import type { z } from "zod";
import ICAL from "ical.js";
import { eventSeriesMaterializeSchema } from "../../../../assets/shared/schemas/event-series";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { requireGroupManagement } from "../groups/governance";
import { getGroupEventSeries } from "./series";

type MaterializeInput = z.infer<typeof eventSeriesMaterializeSchema>;

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localDateTimeAt(date: Date, timeZone: string): LocalDateTime {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function localEpoch(value: LocalDateTime): number {
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
}

function sameLocalDateTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

/** Converts a floating recurrence value to UTC while preserving local wall-clock time across DST. */
function localDateTimeToUtc(value: LocalDateTime, timeZone: string): Date {
  const requestedEpoch = localEpoch(value);
  let candidateEpoch = requestedEpoch;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localDateTimeAt(new Date(candidateEpoch), timeZone);
    const adjustment = requestedEpoch - localEpoch(observed);
    if (adjustment === 0 && sameLocalDateTime(observed, value)) return new Date(candidateEpoch);
    candidateEpoch += adjustment;
  }
  const observed = localDateTimeAt(new Date(candidateEpoch), timeZone);
  if (!sameLocalDateTime(observed, value)) {
    throw new AppError(
      422,
      "EVENT_RECURRENCE_LOCAL_TIME_INVALID",
      "The recurrence contains a local time that does not exist in the configured timezone",
    );
  }
  return new Date(candidateEpoch);
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
    const localAnchor = localDateTimeAt(anchor, timeZone);
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

async function executeBatches(db: DatabaseLike, statements: StatementLike[]): Promise<number> {
  let changes = 0;
  for (let index = 0; index < statements.length; index += 50) {
    const results = await db.batch(statements.slice(index, index + 50));
    changes += results.reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
  }
  return changes;
}

export async function materializeSeriesOccurrences(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  input: MaterializeInput,
) {
  const series = await getGroupEventSeries(db, groupIdOrSlug, seriesId);
  await requireGroupManagement(db, actor, series.ownerGroupId);
  if (!series.active) throw new AppError(409, "EVENT_SERIES_INACTIVE", "Inactive meeting series cannot be expanded");
  const starts = expandStarts(
    series.startsAt,
    series.timezone,
    series.recurrenceRule,
    input.through,
    input.maxOccurrences,
  );
  const now = nowIso();
  const statements = starts.map((start) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO event_occurrences
           (id, series_id, starts_at, ends_at, status, location_override,
            provider_join_url_ciphertext, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'scheduled', NULL, NULL, ?, ?)`,
      )
      .bind(
        uuid(),
        seriesId,
        start,
        new Date(Date.parse(start) + series.durationMinutes * 60_000).toISOString(),
        now,
        now,
      ),
  );
  const created = await executeBatches(db, statements);
  await db.batch([
    db
      .prepare(
        `UPDATE events SET
           starts_at = (SELECT MIN(starts_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
           ends_at = (SELECT MAX(ends_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
           updated_at = ? WHERE id = ?`,
      )
      .bind(seriesId, seriesId, now, series.eventId),
    prepareAuditLog(db, "admin", actor.id, "event_series_materialized", "event_series", seriesId, {
      through: input.through,
      created,
      existing: starts.length - created,
    }),
  ]);
  return { created, existing: starts.length - created, through: input.through };
}

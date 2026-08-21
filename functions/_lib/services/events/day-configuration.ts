import type { z } from "zod";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { prepareAuditLog } from "../audit";
import { listEventDays } from "../event-days";
import { stringifyJson } from "../../utils/json";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { localDateTimeInTimeZoneToIso } from "../../utils/timezone";
import type { DatabaseLike, StatementLike } from "../../types";
import type { adminEventDaysReplaceSchema } from "../../../../assets/shared/schemas/api";

type EventDaysInput = z.infer<typeof adminEventDaysReplaceSchema>;

interface ReferencedDayRow {
  event_day_id: string;
}

interface PreparedDay {
  date: string;
  label: string | null;
  startsAt: string | null;
  endsAt: string | null;
  inPersonCapacity: number | null;
  attendanceOptionsJson: string;
  sortOrder: number;
}

function prepareDays(input: EventDaysInput, timezone: string): PreparedDay[] {
  return input.days.map((day) => {
    const startsAt = day.startTime ? localDateTimeInTimeZoneToIso(day.date, day.startTime, timezone) : null;
    const endsAt = day.endTime ? localDateTimeInTimeZoneToIso(day.date, day.endTime, timezone) : null;
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new AppError(
        400,
        "INVALID_EVENT_DAY_RANGE",
        `End time must be after start time for ${day.date} in ${timezone}`,
      );
    }

    return {
      date: day.date,
      label: day.label ?? null,
      startsAt,
      endsAt,
      inPersonCapacity: day.attendanceOptions.find((option) => option.value === "in_person")?.capacity ?? null,
      attendanceOptionsJson: stringifyJson(day.attendanceOptions),
      sortOrder: day.sortOrder ?? 0,
    };
  });
}

function upsertDayStatement(db: DatabaseLike, eventId: string, day: PreparedDay, now: string): StatementLike {
  return db
    .prepare(
      `INSERT INTO event_days
         (id, event_id, day_date, label, starts_at, ends_at, in_person_capacity,
          attendance_options_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, day_date)
       DO UPDATE SET
         label = excluded.label,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         in_person_capacity = excluded.in_person_capacity,
         attendance_options_json = excluded.attendance_options_json,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`,
    )
    .bind(
      uuid(),
      eventId,
      day.date,
      day.label,
      day.startsAt,
      day.endsAt,
      day.inPersonCapacity,
      day.attendanceOptionsJson,
      day.sortOrder,
      now,
      now,
    );
}

/**
 * Atomically replaces configurable event days and records the audit event.
 * Referenced removed days are retained and reported rather than deleted.
 */
export async function replaceConfiguredEventDays(
  db: DatabaseLike,
  actorId: string,
  event: { id: string; timezone: string },
  input: EventDaysInput,
): Promise<{ skipped: string[] }> {
  // Resolve and validate every time range before preparing any mutation.
  const preparedDays = prepareDays(input, event.timezone);
  const existingDays = await listEventDays(db, event.id);
  const incomingDates = new Set(preparedDays.map((day) => day.date));
  const removedDays = existingDays.filter((day) => !incomingDates.has(day.day_date));
  const referencedRows =
    removedDays.length === 0
      ? []
      : await all<ReferencedDayRow>(
          db,
          `SELECT DISTINCT event_day_id
           FROM registration_day_attendance
           WHERE event_day_id IN (SELECT value FROM json_each(?))`,
          [stringifyJson(removedDays.map((day) => day.id))],
        );
  const referencedIds = new Set(referencedRows.map((row) => row.event_day_id));
  const skipped = removedDays.filter((day) => referencedIds.has(day.id)).map((day) => day.day_date);
  const deletable = removedDays.filter((day) => !referencedIds.has(day.id));
  const now = nowIso();

  await db.batch([
    ...deletable.map((day) => db.prepare("DELETE FROM event_days WHERE id = ?").bind(day.id)),
    ...preparedDays.map((day) => upsertDayStatement(db, event.id, day, now)),
    prepareAuditLog(
      db,
      "admin",
      actorId,
      "event_days_updated",
      "event",
      event.id,
      { dayCount: preparedDays.length, skipped },
      now,
    ),
  ]);

  return { skipped };
}

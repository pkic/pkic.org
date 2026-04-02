/**
 * GET /api/v1/admin/events/:eventSlug/days
 *   Returns all event days with attendance options and registration counts
 *   per day per attendance type.
 *
 * PUT /api/v1/admin/events/:eventSlug/days
 *   Replaces event days. Existing days matched by date are updated in-place.
 *   Days removed from the list are deleted only if they have no registered
 *   attendees; otherwise they are skipped and reported in the response.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, first, run } from "../../../../../_lib/db/queries";
import { listEventDays, resolveAttendanceOptions } from "../../../../../_lib/services/event-days";
import { nowIso } from "../../../../../_lib/utils/time";
import { uuid } from "../../../../../_lib/utils/ids";
import { stringifyJson } from "../../../../../_lib/utils/json";
import { localDateTimeInTimeZoneToIso } from "../../../../../_lib/utils/timezone";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import type { DatabaseLike } from "../../../../../_lib/types";
import { adminEventDaysReplaceSchema } from "../../../../../../assets/shared/schemas/api";

interface DayCountRow {
  event_day_id: string;
  attendance_type: string;
  count: number;
}

async function getDaysWithCounts(db: DatabaseLike, eventId: string) {
  const days = await listEventDays(db, eventId);

  // Count registered attendees per day per attendance type
  const counts = await all<DayCountRow>(
    db,
    `SELECT rda.event_day_id, rda.attendance_type, COUNT(*) AS count
     FROM registration_day_attendance rda
     JOIN registrations r ON r.id = rda.registration_id
     WHERE r.event_id = ? AND r.status = 'registered'
     GROUP BY rda.event_day_id, rda.attendance_type`,
    [eventId],
  );

  const countMap = new Map<string, Record<string, number>>();
  for (const c of counts) {
    const existing = countMap.get(c.event_day_id) ?? {};
    existing[c.attendance_type] = c.count;
    countMap.set(c.event_day_id, existing);
  }

  return days.map((day) => ({
    id: day.id,
    date: day.day_date,
    label: day.label,
    startsAt: day.starts_at,
    endsAt: day.ends_at,
    sortOrder: day.sort_order,
    attendanceOptions: resolveAttendanceOptions(day),
    attendanceCounts: countMap.get(day.id) ?? {},
  }));
}

export async function onRequestGet(
  c: any,
): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const days = await getDaysWithCounts(c.env.DB, event.id);
  return json({ days });
}

export async function onRequestPut(
  c: any,
): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventDaysReplaceSchema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));

  const existing = await listEventDays(c.env.DB, event.id);
  const existingByDate = new Map(existing.map((d) => [d.day_date, d]));
  const incomingDates = new Set(body.days.map((d) => d.date));

  const now = nowIso();
  const skipped: string[] = [];

  // Delete days removed from the list (only if no registrations exist for them)
  for (const day of existing) {
    if (!incomingDates.has(day.day_date)) {
      const reg = await first<{ n: number }>(
        c.env.DB,
        "SELECT COUNT(*) AS n FROM registration_day_attendance WHERE event_day_id = ?",
        [day.id],
      );
      if ((reg?.n ?? 0) > 0) {
        skipped.push(day.day_date);
      } else {
        await run(c.env.DB, "DELETE FROM event_days WHERE id = ?", [day.id]);
      }
    }
  }

  // Upsert incoming days
  for (const day of body.days) {
    const inPersonCap =
      day.attendanceOptions.find((o) => o.value === "in_person")?.capacity ?? null;
    const optionsJson = stringifyJson(day.attendanceOptions);
    const label = day.label ?? null;
    const startsAt = day.startTime ? localDateTimeInTimeZoneToIso(day.date, day.startTime, event.timezone) : null;
    const endsAt = day.endTime ? localDateTimeInTimeZoneToIso(day.date, day.endTime, event.timezone) : null;
    const sortOrder = day.sortOrder ?? 0;

    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      return json({
        error: {
          code: "INVALID_EVENT_DAY_RANGE",
          message: `End time must be after start time for ${day.date} in ${event.timezone}`,
        },
      }, 400);
    }

    const existing_day = existingByDate.get(day.date);
    if (existing_day) {
      await run(
        c.env.DB,
        `UPDATE event_days
         SET label = ?, starts_at = ?, ends_at = ?, in_person_capacity = ?, attendance_options_json = ?, sort_order = ?, updated_at = ?
         WHERE id = ?`,
        [label, startsAt, endsAt, inPersonCap, optionsJson, sortOrder, now, existing_day.id],
      );
    } else {
      await run(
        c.env.DB,
        `INSERT INTO event_days
           (id, event_id, day_date, label, starts_at, ends_at, in_person_capacity, attendance_options_json, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), event.id, day.date, label, startsAt, endsAt, inPersonCap, optionsJson, sortOrder, now, now],
      );
    }
  }

  await writeAuditLog(
    c.env.DB,
    "admin",
    admin.id,
    "event_days_updated",
    "event",
    event.id,
    { dayCount: body.days.length, skipped },
  );

  const updatedDays = await getDaysWithCounts(c.env.DB, event.id);
  return json({ success: true, days: updatedDays, skipped });
}

export async function onRequest(
  c: any,
): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PUT") return onRequestPut(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}

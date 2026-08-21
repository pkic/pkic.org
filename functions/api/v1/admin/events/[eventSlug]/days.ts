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
import { all } from "../../../../../_lib/db/queries";
import { listEventDays, resolveAttendanceOptions } from "../../../../../_lib/services/event-days";
import { replaceConfiguredEventDays } from "../../../../../_lib/services/events/day-configuration";
import type { DatabaseLike } from "../../../../../_lib/types";
import { adminEventDaysReplaceSchema } from "../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

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

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const days = await getDaysWithCounts(requestDb(c), event.id);
  return json({ days });
}

export async function onRequestPut(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventDaysReplaceSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  const { skipped } = await replaceConfiguredEventDays(requestDb(c), admin.id, event, body);

  const updatedDays = await getDaysWithCounts(requestDb(c), event.id);
  return json({ success: true, days: updatedDays, skipped });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PUT") return onRequestPut(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}

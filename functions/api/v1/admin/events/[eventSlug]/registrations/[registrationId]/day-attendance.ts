/**
 * PATCH /api/v1/admin/events/:eventSlug/registrations/:registrationId/day-attendance
 *
 * Set or remove per-day attendance for a registration without running the full
 * admission / capacity-exempt flow.  For admitting a registrant with
 * capacity exemption, use the /admit endpoint instead.
 */
import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { first, run } from "../../../../../../../_lib/db/queries";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { listEventDays } from "../../../../../../../_lib/services/event-days";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { nowIso } from "../../../../../../../_lib/utils/time";
import { uuid } from "../../../../../../../_lib/utils/ids";
import { adminManageDayAttendanceSchema } from "../../../../../../../../assets/shared/schemas/api";
import { AppError } from "../../../../../../../_lib/errors";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { queueRegistrationStatusEmail } from "../../../../../../../_lib/services/registrations/status-notifications";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

interface RegistrationRow {
  id: string;
  event_id: string;
}

interface ExistingDayAttendanceRow {
  attendance_type: string;
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminManageDayAttendanceSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const registrationId = c.req.param("registrationId");

  const registration = await first<RegistrationRow>(
    requestDb(c),
    "SELECT id, event_id FROM registrations WHERE id = ? AND event_id = ?",
    [registrationId, event.id],
  );

  if (!registration) {
    throw new AppError(404, "NOT_FOUND", "Registration not found for this event");
  }

  const eventDays = await listEventDays(requestDb(c), event.id);
  const dayByDate = new Map(eventDays.map((day) => [day.day_date, day]));

  for (const dayDate of body.dayDates) {
    const day = dayByDate.get(dayDate);
    if (!day) {
      throw new AppError(400, "DAY_NOT_CONFIGURED", `Day '${dayDate}' is not configured for this event`);
    }

    const existing = await first<ExistingDayAttendanceRow>(
      requestDb(c),
      "SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ? AND event_day_id = ?",
      [registration.id, day.id],
    );
    const fromType = existing?.attendance_type ?? "not_attending";
    const toType = body.action === "remove" ? "not_attending" : body.action;

    if (body.action === "remove") {
      await run(
        requestDb(c),
        `DELETE FROM registration_day_attendance WHERE registration_id = ? AND event_day_id = ?`,
        [registration.id, day.id],
      );
    } else {
      await run(
        requestDb(c),
        `INSERT INTO registration_day_attendance (
           id, registration_id, event_day_id, attendance_type, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(registration_id, event_day_id)
         DO UPDATE SET attendance_type = excluded.attendance_type, updated_at = excluded.updated_at`,
        [uuid(), registration.id, day.id, body.action, nowIso(), nowIso()],
      );
    }

    if (fromType !== toType) {
      await run(
        requestDb(c),
        `INSERT INTO registration_attendance_history (
           id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), registration.id, day.id, fromType, toType, admin.id, nowIso()],
      );
    }
  }

  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "registration_day_attendance_updated",
    "registration",
    registration.id,
    { action: body.action, dayDates: body.dayDates },
  );

  if (body.action !== "remove") {
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const outbox = await queueRegistrationStatusEmail(requestDb(c), {
      event,
      registrationId: registration.id,
      appBaseUrl,
      templateKey: "registration_updated",
      subject: `Registration updated for ${event.name}`,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outbox.outboxId));
  }

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "PATCH") return onRequestPatch(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}

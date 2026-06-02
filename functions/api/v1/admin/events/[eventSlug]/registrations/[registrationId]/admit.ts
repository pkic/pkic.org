import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { first, run } from "../../../../../../../_lib/db/queries";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { getRegistrationDayAttendance, listEventDays } from "../../../../../../../_lib/services/event-days";
import {
  setRegistrationCapacityExempt,
  syncRegistrationDayWaitlist,
} from "../../../../../../../_lib/services/registrations/day-waitlist";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { nowIso } from "../../../../../../../_lib/utils/time";
import { uuid } from "../../../../../../../_lib/utils/ids";
import { adminRegistrationAdmitSchema } from "../../../../../../../../assets/shared/schemas/api";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { queueRegistrationStatusEmail } from "../../../../../../../_lib/services/registrations/status-notifications";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

interface RegistrationRow {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  attendance_type: "in_person" | "virtual" | "on_demand";
}

interface ExistingDayAttendanceRow {
  attendance_type: string;
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminRegistrationAdmitSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const registrationId = c.req.param("registrationId");

  const registration = await first<RegistrationRow>(
    requestDb(c),
    "SELECT id, event_id, user_id, status, attendance_type FROM registrations WHERE id = ? AND event_id = ?",
    [registrationId, event.id],
  );

  if (!registration) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found for this event" } }, 404);
  }

  if (registration.status === "cancelled") {
    return json(
      { error: { code: "REGISTRATION_CANCELLED", message: "Cancelled registrations cannot be admitted" } },
      409,
    );
  }

  const reason = `${body.mode}:${body.reason}`;
  await setRegistrationCapacityExempt(requestDb(c), {
    registrationId: registration.id,
    exempt: true,
    reason,
  });

  if (registration.status === "waitlisted") {
    await run(requestDb(c), "UPDATE registrations SET status = 'registered', updated_at = ? WHERE id = ?", [
      nowIso(),
      registration.id,
    ]);
    await run(
      requestDb(c),
      `UPDATE waitlist_entries
       SET status = 'removed', updated_at = ?
       WHERE event_id = ? AND registration_id = ? AND status IN ('waiting', 'offered')`,
      [nowIso(), event.id, registration.id],
    );
  }

  const eventDays = await listEventDays(requestDb(c), event.id);
  let admittedDayDates: string[] = [];

  if (eventDays.length > 0) {
    const dayByDate = new Map(eventDays.map((day) => [day.day_date, day]));
    admittedDayDates = body.dayDates && body.dayDates.length > 0 ? body.dayDates : eventDays.map((day) => day.day_date);

    for (const dayDate of admittedDayDates) {
      const day = dayByDate.get(dayDate);
      if (!day) {
        return json(
          { error: { code: "DAY_NOT_CONFIGURED", message: `Day '${dayDate}' is not configured for this event` } },
          400,
        );
      }

      const existing = await first<ExistingDayAttendanceRow>(
        requestDb(c),
        "SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ? AND event_day_id = ?",
        [registration.id, day.id],
      );
      const fromType = existing?.attendance_type ?? "not_attending";

      await run(
        requestDb(c),
        `INSERT INTO registration_day_attendance (
          id, registration_id, event_day_id, attendance_type, created_at, updated_at
        ) VALUES (?, ?, ?, 'in_person', ?, ?)
        ON CONFLICT(registration_id, event_day_id)
        DO UPDATE SET attendance_type = 'in_person', updated_at = excluded.updated_at`,
        [uuid(), registration.id, day.id, nowIso(), nowIso()],
      );

      if (fromType !== "in_person") {
        await run(
          requestDb(c),
          `INSERT INTO registration_attendance_history (
             id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuid(), registration.id, day.id, fromType, "in_person", admin.id, nowIso()],
        );
      }
    }
  }

  const selections = (await getRegistrationDayAttendance(requestDb(c), registration.id)).map((entry) => ({
    dayDate: entry.dayDate,
    attendanceType: entry.attendanceType,
  }));

  await syncRegistrationDayWaitlist(requestDb(c), {
    registrationId: registration.id,
    eventId: event.id,
    userId: registration.user_id,
    selections,
    capacityExemptReason: reason,
  });

  await writeAuditLog(requestDb(c), "admin", admin.id, "registration_admitted", "registration", registration.id, {
    mode: body.mode,
    reason: body.reason,
    admittedDayDates,
    capacityExemptReason: reason,
  });

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const outbox = await queueRegistrationStatusEmail(requestDb(c), {
    event,
    registrationId: registration.id,
    appBaseUrl,
    templateKey: "registration_updated",
    subject: `Registration updated for ${event.name}`,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outbox.outboxId));

  const updated = await first<Record<string, unknown>>(requestDb(c), "SELECT * FROM registrations WHERE id = ?", [
    registration.id,
  ]);

  return json({
    success: true,
    registration: updated,
    admittedDayDates,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}

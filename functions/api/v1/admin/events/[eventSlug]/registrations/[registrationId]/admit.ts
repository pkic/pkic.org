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

interface RegistrationRow {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  attendance_type: "in_person" | "virtual" | "on_demand";
}

export async function onRequestPost(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const body = await parseJsonBody(c.req, adminRegistrationAdmitSchema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const registrationId = c.req.param("registrationId");

  const registration = await first<RegistrationRow>(
    c.env.DB,
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
  await setRegistrationCapacityExempt(c.env.DB, {
    registrationId: registration.id,
    exempt: true,
    reason,
  });

  if (registration.status === "waitlisted") {
    await run(c.env.DB, "UPDATE registrations SET status = 'registered', updated_at = ? WHERE id = ?", [
      nowIso(),
      registration.id,
    ]);
    await run(
      c.env.DB,
      `UPDATE waitlist_entries
       SET status = 'removed', updated_at = ?
       WHERE event_id = ? AND registration_id = ? AND status IN ('waiting', 'offered')`,
      [nowIso(), event.id, registration.id],
    );
  }

  const eventDays = await listEventDays(c.env.DB, event.id);
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

      await run(
        c.env.DB,
        `INSERT INTO registration_day_attendance (
          id, registration_id, event_day_id, attendance_type, created_at, updated_at
        ) VALUES (?, ?, ?, 'in_person', ?, ?)
        ON CONFLICT(registration_id, event_day_id)
        DO UPDATE SET attendance_type = 'in_person', updated_at = excluded.updated_at`,
        [uuid(), registration.id, day.id, nowIso(), nowIso()],
      );
    }
  }

  const selections = (await getRegistrationDayAttendance(c.env.DB, registration.id)).map((entry) => ({
    dayDate: entry.dayDate,
    attendanceType: entry.attendanceType,
  }));

  await syncRegistrationDayWaitlist(c.env.DB, {
    registrationId: registration.id,
    eventId: event.id,
    userId: registration.user_id,
    selections,
    capacityExemptReason: reason,
  });

  await writeAuditLog(c.env.DB, "admin", admin.id, "registration_admitted", "registration", registration.id, {
    mode: body.mode,
    reason: body.reason,
    admittedDayDates,
    capacityExemptReason: reason,
  });

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const outbox = await queueRegistrationStatusEmail(c.env.DB, {
    event,
    registrationId: registration.id,
    appBaseUrl,
    templateKey: "registration_updated",
    subject: `Registration updated for ${event.name}`,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outbox.outboxId));

  const updated = await first<Record<string, unknown>>(c.env.DB, "SELECT * FROM registrations WHERE id = ?", [
    registration.id,
  ]);

  return json({
    success: true,
    registration: updated,
    admittedDayDates,
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}

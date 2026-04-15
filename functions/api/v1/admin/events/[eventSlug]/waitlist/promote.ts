import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { listEventDays } from "../../../../../../_lib/services/event-days";
import { promoteWaitlistIfCapacity } from "../../../../../../_lib/services/registrations/waitlist";
import { promoteDayWaitlistIfCapacity } from "../../../../../../_lib/services/registrations/day-waitlist";
import { queueRegistrationStatusEmail } from "../../../../../../_lib/services/registrations/status-notifications";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { resolveAppBaseUrl, getConfig } from "../../../../../../_lib/config";

export async function onRequestPost(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const affectedRegistrations = new Set<string>();
  let wholeRegistrationOffers = 0;
  let dayRegistrationOffers = 0;

  if (typeof event.capacity_in_person === "number" && event.capacity_in_person > 0) {
    while (true) {
      const promoted = await promoteWaitlistIfCapacity(
        c.env.DB,
        event.id,
        event.capacity_in_person,
        config.waitlistClaimWindowHours,
      );
      if (!promoted) {
        break;
      }
      wholeRegistrationOffers += 1;
      affectedRegistrations.add(promoted.registration_id);
    }
  }

  const eventDays = await listEventDays(c.env.DB, event.id);
  for (const day of eventDays) {
    while (true) {
      const promoted = await promoteDayWaitlistIfCapacity(c.env.DB, {
        eventId: event.id,
        eventDayId: day.id,
        claimWindowHours: config.waitlistClaimWindowHours,
      });
      if (!promoted) {
        break;
      }
      dayRegistrationOffers += 1;
      affectedRegistrations.add(promoted.registration_id);
    }
  }

  const outboxIds: string[] = [];
  for (const registrationId of affectedRegistrations) {
    const outbox = await queueRegistrationStatusEmail(c.env.DB, {
      event,
      registrationId,
      appBaseUrl,
      templateKey: "registration_updated",
      subject: `Waitlist availability update for ${event.name}`,
      noticeKind: "waitlist_offer",
    });
    outboxIds.push(outbox.outboxId);
  }

  await writeAuditLog(c.env.DB, "admin", admin.id, "admin_waitlist_promoted", "event", event.id, {
    wholeRegistrationOffers,
    dayRegistrationOffers,
    affectedRegistrations: Array.from(affectedRegistrations),
  });

  c.executionCtx.waitUntil(
    Promise.all(outboxIds.map((outboxId) => processOutboxByIdBackground(c.env.DB, c.env, outboxId))),
  );

  return json({
    success: true,
    wholeRegistrationOffers,
    dayRegistrationOffers,
    affectedRegistrations: Array.from(affectedRegistrations),
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}

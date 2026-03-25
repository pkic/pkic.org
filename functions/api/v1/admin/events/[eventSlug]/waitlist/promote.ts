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
import type { PagesContext } from "../../../../../_lib/types";

export async function onRequestPost(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const config = getConfig(context.env, context.request);
  const appBaseUrl = resolveAppBaseUrl(context.env);

  const affectedRegistrations = new Set<string>();
  let wholeRegistrationOffers = 0;
  let dayRegistrationOffers = 0;

  if (typeof event.capacity_in_person === "number" && event.capacity_in_person > 0) {
    while (true) {
      const promoted = await promoteWaitlistIfCapacity(
        context.env.DB,
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

  const eventDays = await listEventDays(context.env.DB, event.id);
  for (const day of eventDays) {
    while (true) {
      const promoted = await promoteDayWaitlistIfCapacity(context.env.DB, {
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
    const outbox = await queueRegistrationStatusEmail(context.env.DB, {
      event,
      registrationId,
      appBaseUrl,
      templateKey: "registration_updated",
      subject: `Waitlist availability update for ${event.name}`,
      noticeKind: "waitlist_offer",
    });
    outboxIds.push(outbox.outboxId);
  }

  await writeAuditLog(context.env.DB, "admin", admin.id, "admin_waitlist_promoted", "event", event.id, {
    wholeRegistrationOffers,
    dayRegistrationOffers,
    affectedRegistrations: Array.from(affectedRegistrations),
  });

  context.waitUntil(
    Promise.all(outboxIds.map((outboxId) => processOutboxByIdBackground(context.env.DB, context.env, outboxId))),
  );

  return json({
    success: true,
    wholeRegistrationOffers,
    dayRegistrationOffers,
    affectedRegistrations: Array.from(affectedRegistrations),
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}

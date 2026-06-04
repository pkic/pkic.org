import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { promoteEventWaitlistWithNotifications } from "../../../../../../_lib/services/registrations/waitlist-promotions";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { resolveAppBaseUrl, getConfig } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const promoted = await promoteEventWaitlistWithNotifications(requestDb(c), {
    event,
    appBaseUrl,
    claimWindowHours: config.waitlistClaimWindowHours,
    source: {
      actorType: "admin",
      actorId: admin.id,
      auditAction: "admin_waitlist_promoted",
      source: "admin_endpoint",
    },
  });

  c.executionCtx.waitUntil(
    Promise.all(promoted.outboxIds.map((outboxId) => processOutboxByIdBackground(requestDb(c), c.env, outboxId))),
  );

  return json({
    success: true,
    dayRegistrationOffers: promoted.dayRegistrationOffers,
    affectedRegistrations: promoted.affectedRegistrations,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}

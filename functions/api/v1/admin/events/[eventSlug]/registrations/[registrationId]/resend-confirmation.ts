/** POST /api/v1/admin/events/:eventSlug/registrations/:registrationId/resend-confirmation */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { resendRegistrationEmail } from "../../../../../../../_lib/services/registrations/resend-confirmation";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { adminRegistrationResendConfirmationResponseSchema } from "../../../../../../../../assets/shared/schemas/route-contracts-admin-registrations";
import { adminRegistrationResendConfirmationRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts-admin-registrations";
import type { ValidatedData } from "chanfana";

export async function onRequestPost(
  c: AdminContext,
  data?: ValidatedData<typeof adminRegistrationResendConfirmationRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data?.params.eventSlug ?? c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const result = await resendRegistrationEmail(db, {
    registrationId: data?.params.registrationId ?? c.req.param("registrationId"),
    event,
    actorUserId: admin.id,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    confirmationTtlHours: config.confirmationLinkTtlHours,
    internalSigningSecret: c.env.INTERNAL_SIGNING_SECRET,
    rsvpEmail: c.env.RSVP_EMAIL,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
  return json(adminRegistrationResendConfirmationResponseSchema.parse({ success: true, message: "Email queued" }));
}

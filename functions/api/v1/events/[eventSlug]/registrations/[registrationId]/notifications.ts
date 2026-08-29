import type { ValidatedData } from "chanfana";
import {
  eventRegistrationNotificationResponseSchema,
  eventRegistrationNotificationsCreateRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { getConfig, resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { requestDb } from "../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { resendRegistrationEmail } from "../../../../../../_lib/services/registrations/resend-confirmation";
import { requireEventRegistrationManagement } from "../authorization";

export const EventRegistrationNotificationsCreate = openApiRoute(
  eventRegistrationNotificationsCreateRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof eventRegistrationNotificationsCreateRouteSchema>) => {
    const { actor, db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
    const result = await resendRegistrationEmail(db, {
      registrationId: data.params.registrationId,
      event,
      actorUserId: actor.id,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      confirmationTtlHours: getConfig(c.env, c.req.raw).confirmationLinkTtlHours,
      internalSigningSecret: c.env.INTERNAL_SIGNING_SECRET,
      rsvpEmail: c.env.RSVP_EMAIL,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, result.outboxId));
    return json(eventRegistrationNotificationResponseSchema.parse({ success: true, message: "Email queued" }));
  },
);

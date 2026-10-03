import { groupEventRegistrationNotificationsCreateRouteSchema } from "../../../../../../../assets/shared/schemas/group-event-registration-operations";
import { eventRegistrationNotificationResponseSchema } from "../../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { getConfig, resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { resendRegistrationEmail } from "../../../../../../_lib/services/registrations/resend-confirmation";
import { requireManagedGroupEventContext } from "./management-context";

export const GroupEventRegistrationNotificationsCreate = openApiRoute(
  groupEventRegistrationNotificationsCreateRouteSchema,
  async (c: AdminContext, data) => {
    const context = await requireManagedGroupEventContext(c, data.params.groupId, data.params.eventId);
    const result = await resendRegistrationEmail(context.db, {
      registrationId: data.params.registrationId,
      event: context.event,
      actorUserId: context.actor.id,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      confirmationTtlHours: getConfig(c.env, c.req.raw).confirmationLinkTtlHours,
      internalSigningSecret: c.env.INTERNAL_SIGNING_SECRET,
      rsvpEmail: c.env.RSVP_EMAIL,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(context.rawDb, c.env, result.outboxId));
    return json(eventRegistrationNotificationResponseSchema.parse({ success: true, message: "Email queued" }));
  },
);

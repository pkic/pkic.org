import type { ValidatedData } from "chanfana";
import {
  eventRegistrationPromotionsCreateRouteSchema,
  eventRegistrationPromotionsResponseSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requestDb } from "../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { promoteEventWaitlistWithNotifications } from "../../../../../_lib/services/registrations/waitlist-promotions";
import { requireEventRegistrationManagement } from "./authorization";

export const EventRegistrationPromotionsCreate = openApiRoute(
  eventRegistrationPromotionsCreateRouteSchema,
  async (
    c: AdminContext,
    data: ValidatedData<typeof eventRegistrationPromotionsCreateRouteSchema>,
  ): Promise<Response> => {
    const { actor, db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
    const promoted = await promoteEventWaitlistWithNotifications(db, {
      event,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      claimWindowHours: getConfig(c.env, c.req.raw).waitlistClaimWindowHours,
      source: {
        actorType: "admin",
        actorId: actor.id,
        auditAction: "admin_waitlist_promoted",
        source: "event_registration_management",
      },
    });

    const rawDb = requestDb(c);
    c.executionCtx.waitUntil(
      Promise.all(promoted.outboxIds.map((outboxId) => processOutboxByIdBackground(rawDb, c.env, outboxId))),
    );
    return json(
      eventRegistrationPromotionsResponseSchema.parse({
        success: true,
        dayRegistrationOffers: promoted.dayRegistrationOffers,
        affectedRegistrations: promoted.affectedRegistrations,
      }),
    );
  },
);

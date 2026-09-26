import type { ValidatedData } from "chanfana";
import { registrationBadgeResponseSchema } from "../../../../../../../assets/shared/schemas/participant-roles";
import {
  eventRegistrationBadgeCreateRouteSchema,
  eventRegistrationBadgeGetRouteSchema,
  eventRegistrationBadgePatchRouteSchema,
  eventRegistrationBadgeRegenerationResponseSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { requestDb } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  processBadgeRenderJobById,
  requestRegistrationBadgeRegeneration,
} from "../../../../../../_lib/services/registration-badge-regeneration";
import { getRegistrationBadge, setRegistrationBadge } from "../../../../../../_lib/services/registrations/badge-role";
import { requireEventRegistrationManagement } from "../authorization";

export const EventRegistrationBadgeGet = openApiRoute(
  eventRegistrationBadgeGetRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof eventRegistrationBadgeGetRouteSchema>) => {
    const { actor, db } = await requireEventRegistrationManagement(c, data.params.eventSlug);
    return json(
      registrationBadgeResponseSchema.parse(
        await getRegistrationBadge(db, actor, data.params.eventSlug, data.params.registrationId),
      ),
    );
  },
);

export const EventRegistrationBadgePatch = openApiRoute(
  eventRegistrationBadgePatchRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof eventRegistrationBadgePatchRouteSchema>) => {
    const { actor, db } = await requireEventRegistrationManagement(c, data.params.eventSlug);
    const result = await setRegistrationBadge(db, actor, {
      eventSlug: data.params.eventSlug,
      registrationId: data.params.registrationId,
      patch: data.body,
    });
    return json(registrationBadgeResponseSchema.parse(result.response));
  },
);

export const EventRegistrationBadgeCreate = openApiRoute(
  eventRegistrationBadgeCreateRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof eventRegistrationBadgeCreateRouteSchema>) => {
    const { actor, db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
    const result = await requestRegistrationBadgeRegeneration(db, {
      actor,
      event,
      registrationId: data.params.registrationId,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    });
    c.executionCtx.waitUntil(processBadgeRenderJobById(requestDb(c), c.env, result.jobId));
    return json(
      eventRegistrationBadgeRegenerationResponseSchema.parse({ success: true, status: "queued", ...result }),
      202,
    );
  },
);

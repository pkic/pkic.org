import { eventManagementDetailResponseSchema } from "../../../../../assets/shared/schemas/event-management";
import { eventSettingsPatchRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { updateDirectEventSettings } from "../../../../_lib/services/events/settings";
import { eventManagementCapabilities, requireEventPermission } from "./authorization";

export const EventSettingsPatch = openApiRoute(eventSettingsPatchRouteSchema, async (c: AdminContext, data) => {
  const { actor, context, db } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  const event = await updateDirectEventSettings(db, {
    eventSlug: data.params.eventSlug,
    actor,
    settings: data.body,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    allowedHeroImageHosts: c.env.HERO_IMAGE_ALLOWED_HOSTS,
    capabilities: eventManagementCapabilities(actor, context),
  });
  return json(eventManagementDetailResponseSchema.parse({ event }));
});

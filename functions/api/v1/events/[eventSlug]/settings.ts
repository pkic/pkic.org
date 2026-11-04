import { eventManagementDetailResponseSchema } from "../../../../../assets/shared/schemas/event-management";
import { eventSettingsPatchRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { updateDirectEventSettingsFromRequest } from "../../../../_lib/services/events/settings-update";

export const EventSettingsPatch = openApiRoute(eventSettingsPatchRouteSchema, async (c: AdminContext, data) => {
  const event = await updateDirectEventSettingsFromRequest(requestDb(c), {
    eventSlug: data.params.eventSlug,
    request: c.req.raw,
    env: c.env,
    settings: data.body,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    allowedHeroImageHosts: c.env.HERO_IMAGE_ALLOWED_HOSTS,
  });
  return json(eventManagementDetailResponseSchema.parse({ event }));
});

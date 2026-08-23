import { adminEventUpdateResponseSchema } from "../../../../../../assets/shared/schemas/admin-events";
import { adminEventSettingsPatchRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-admin-events";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { updateEventSettings } from "../../../../../_lib/services/events/settings";

export const AdminEventsEventSlugSettingsPatch = openApiRoute(
  adminEventSettingsPatchRouteSchema,
  async (c: AdminContext, data) => {
    const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const event = await updateEventSettings(requestDb(c), {
      eventSlug: data.params.eventSlug,
      actorId: actor.id,
      settings: data.body,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    });
    return json(adminEventUpdateResponseSchema.parse({ success: true, event }));
  },
);

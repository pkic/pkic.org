/**
 * GET /api/v1/admin/events/:eventSlug
 *
 * Returns the full event record including settings_json fields (venue,
 * virtualUrl, etc.) so the admin UI can populate the Details / Settings form.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getAdminEventDetail } from "../../../../../_lib/services/events/admin-detail";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { adminEventDetailResponseSchema } from "../../../../../../assets/shared/schemas/admin-events";
import { adminEventDetailRouteSchema as eventDetailRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-admin-events";

export const AdminEventsEventSlugGet = openApiRoute(eventDetailRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(
    adminEventDetailResponseSchema.parse({ event: await getAdminEventDetail(requestDb(c), data.params.eventSlug) }),
  );
});

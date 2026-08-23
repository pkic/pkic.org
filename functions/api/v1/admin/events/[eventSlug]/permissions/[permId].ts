import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { revokeEventTeamRole } from "../../../../../../_lib/services/events/team";
import { adminEventTeamPermissionDeleteRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-admin-events";
import { successResponseSchema } from "../../../../../../../assets/shared/schemas/api-common";

export const AdminEventsEventSlugPermissionsPermIdDelete = openApiRoute(
  adminEventTeamPermissionDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    await revokeEventTeamRole(requestDb(c), actor, data.params.eventSlug, data.params.permId);
    return json(successResponseSchema.parse({ success: true }));
  },
);

import {
  adminEventTeamListResponseSchema,
  adminEventTeamPermissionCreateResponseSchema,
} from "../../../../../../assets/shared/schemas/admin-events";
import {
  adminEventTeamListRouteSchema,
  adminEventTeamPermissionCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { grantEventTeamRole, listEventTeam } from "../../../../../_lib/services/events/team";
import type { ValidatedData } from "chanfana";

export const AdminEventTeamList = openApiRoute(adminEventTeamListRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(
    adminEventTeamListResponseSchema.parse(await listEventTeam(requestDb(c), actor, data.params.eventSlug, data.query)),
  );
});

export const AdminEventTeamPermissionCreate = openApiRoute(
  adminEventTeamPermissionCreateRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof adminEventTeamPermissionCreateRouteSchema>): Promise<Response> => {
    const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const permission = await grantEventTeamRole(requestDb(c), actor, data.params.eventSlug, data.body);
    return json(adminEventTeamPermissionCreateResponseSchema.parse({ permission }), 201);
  },
);

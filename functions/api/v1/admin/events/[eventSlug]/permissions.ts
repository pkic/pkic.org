import {
  adminEventPermissionSchema,
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
import { parseJsonBody } from "../../../../../_lib/validation";
import type { ValidatedData } from "chanfana";

export const AdminEventTeamList = openApiRoute(adminEventTeamListRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(await listEventTeam(requestDb(c), actor, data.params.eventSlug, data.query));
});

export async function onRequestPost(
  c: AdminContext,
  data?: ValidatedData<typeof adminEventTeamPermissionCreateRouteSchema>,
): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const input = data?.body ?? (await parseJsonBody(c.req, adminEventPermissionSchema));
  const eventSlug = data?.params.eventSlug ?? c.req.param("eventSlug");
  const permission = await grantEventTeamRole(requestDb(c), actor, eventSlug, input);
  return json(adminEventTeamPermissionCreateResponseSchema.parse({ permission }), 201);
}

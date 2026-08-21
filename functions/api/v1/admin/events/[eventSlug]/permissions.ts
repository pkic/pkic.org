import {
  adminEventPermissionSchema,
  adminEventTeamListQuerySchema,
  adminEventTeamListResponseSchema,
} from "../../../../../../assets/shared/schemas/admin-events";
import { eventSlugParamsSchema } from "../../../../../../assets/shared/schemas/api-common";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { grantEventTeamRole, listEventTeam } from "../../../../../_lib/services/events/team";
import { parseJsonBody } from "../../../../../_lib/validation";

const adminEventTeamListRouteSchema = {
  tags: ["Admin events"],
  summary: "List event-level roles (admin)",
  description: "Paginated, searchable, and sortable event-team role grants.",
  request: { params: eventSlugParamsSchema, query: adminEventTeamListQuerySchema },
  responses: {
    "200": {
      description: "Event-team permissions list.",
      content: { "application/json": { schema: adminEventTeamListResponseSchema } },
    },
  },
};

export const AdminEventTeamList = openApiRoute(adminEventTeamListRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(await listEventTeam(requestDb(c), actor, c.req.param("eventSlug"), data.query));
});

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const input = await parseJsonBody(c.req, adminEventPermissionSchema);
  const permission = await grantEventTeamRole(requestDb(c), actor, c.req.param("eventSlug"), input);
  return json({ permission }, 201);
}

/**
 * GET/POST /api/v1/admin/consortium/meetings — list/create consortium
 * meeting series. Staff admin only — see ./router.ts.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import {
  listAdminConsortiumMeetingSeries,
  createConsortiumMeetingSeries,
} from "../../../../../_lib/services/meeting-calendar";
import {
  consortiumMeetingsListRouteSchema,
  consortiumMeetingsCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const ConsortiumMeetingsGet = openApiRoute(consortiumMeetingsListRouteSchema, async (c: AdminContext) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:read");
  const meetingSeries = await listAdminConsortiumMeetingSeries(requestDb(c));
  return json({ meetingSeries });
});

export const ConsortiumMeetingsCreate = openApiRoute(
  consortiumMeetingsCreateRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");
    const body = data.body;
    const meetingSeries = await createConsortiumMeetingSeries(requestDb(c), body, admin.id);
    return json({ meetingSeries }, 201);
  },
);

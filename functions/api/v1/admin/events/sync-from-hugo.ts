import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { syncEventFromHugo } from "../../../../_lib/services/events";
import {
  adminEventSyncResponseSchema,
  adminEventSyncRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-admin-events";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const AdminEventsSyncFromHugoPost = openApiRoute(adminEventSyncRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "events:write");
  const body = data.body;

  const settings = {
    ...(body.event.settings ?? {}),
    ...(body.event.frontend ? { frontend: body.event.frontend } : {}),
  };

  const event = await syncEventFromHugo(requestDb(c), { ...body.event, settings }, body.terms, admin.id);

  return json(adminEventSyncResponseSchema.parse({ success: true, event }));
});

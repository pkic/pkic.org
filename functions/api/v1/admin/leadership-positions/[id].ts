/**
 * PATCH  /api/v1/admin/leadership-positions/:id — edit title/from/till
 * DELETE /api/v1/admin/leadership-positions/:id — remove a position
 *
 * See ./index.ts for the create/list side and
 * functions/_lib/services/leadership.ts for the design rationale.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { updateLeadershipPosition, deleteLeadershipPosition } from "../../../../_lib/services/leadership";
import {
  leadershipPositionResponseSchema,
  leadershipPositionUpdateRouteSchema,
  leadershipPositionDeleteRouteSchema,
} from "../../../../../assets/shared/schemas/leadership";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const LeadershipPositionUpdate = openApiRoute(
  leadershipPositionUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "access:grant");

    const patch = data.body;
    const position = await updateLeadershipPosition(requestDb(c), data.params.id, patch, admin.id);

    return json(leadershipPositionResponseSchema.parse(position));
  },
);

export const LeadershipPositionDelete = openApiRoute(
  leadershipPositionDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "access:revoke");

    const id = data.params.id;
    await deleteLeadershipPosition(requestDb(c), id, admin.id);

    return json({ success: true });
  },
);

/**
 * PATCH  /api/v1/leadership/positions/:id — edit title/from/till
 * DELETE /api/v1/leadership/positions/:id — remove a position
 *
 * See ./index.ts for the create/list side and
 * functions/_lib/services/leadership.ts for the design rationale.
 */
import { json } from "../../../../_lib/http";
import { updateLeadershipPosition, deleteLeadershipPosition } from "../../../../_lib/services/leadership";
import {
  leadershipPositionResponseSchema,
  leadershipPositionUpdateRouteSchema,
  leadershipPositionDeleteRouteSchema,
} from "../../../../../assets/shared/schemas/leadership";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const LeadershipPositionUpdate = openApiRoute(
  leadershipPositionUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "access:grant");

    const patch = data.body;
    const position = await updateLeadershipPosition(db, data.params.id, patch, staff.id);

    return json(leadershipPositionResponseSchema.parse(position));
  },
);

export const LeadershipPositionDelete = openApiRoute(
  leadershipPositionDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "access:revoke");

    const id = data.params.id;
    await deleteLeadershipPosition(db, id, staff.id);

    return json({ success: true });
  },
);

/**
 * GET  /api/v1/system/leadership-positions?body=board|executive_council
 * POST /api/v1/system/leadership-positions
 *
 * System CRUD for the Board of Directors / Executive Council rosters
 * (consolidated migration 0035) — see functions/_lib/services/leadership.ts for the
 * design rationale (why a dedicated table instead of user_roles). Gated by
 * the same access:grant/access:revoke permissions the existing chair
 * assignment endpoints use, since this is the same kind of designation
 * management.
 */
import { json } from "../../../../_lib/http";
import { listLeadershipPositions, createLeadershipPosition } from "../../../../_lib/services/leadership";
import {
  leadershipPositionResponseSchema,
  leadershipPositionsListResponseSchema,
  leadershipPositionsListRouteSchema,
  leadershipPositionsCreateRouteSchema,
} from "../../../../../assets/shared/schemas/leadership";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requireStaffAnyPermission, requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const LeadershipPositionsList = openApiRoute(
  leadershipPositionsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);

    const { positions, total } = await listLeadershipPositions(db, data.query);
    return json(
      leadershipPositionsListResponseSchema.parse({
        positions,
        page: buildPageInfo(data.query.limit, data.query.offset, total, positions.length),
      }),
    );
  },
);

export const LeadershipPositionsCreate = openApiRoute(
  leadershipPositionsCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "access:grant");

    const body = data.body;
    const position = await createLeadershipPosition(db, body, staff.id);

    return json(leadershipPositionResponseSchema.parse(position), 201);
  },
);

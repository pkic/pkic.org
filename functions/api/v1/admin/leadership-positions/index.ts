/**
 * GET  /api/v1/admin/leadership-positions?body=board|executive_council
 * POST /api/v1/admin/leadership-positions
 *
 * Admin CRUD for the Board of Directors / Executive Council rosters
 * (migration 0049) — see functions/_lib/services/leadership.ts for the
 * design rationale (why a dedicated table instead of user_roles). Gated by
 * the same access:grant/access:revoke permissions the existing chair
 * assignment endpoints use, since this is the same kind of designation
 * management.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listLeadershipPositionsAdmin, createLeadershipPosition } from "../../../../_lib/services/leadership";
import {
  leadershipPositionsListRouteSchema,
  leadershipPositionsCreateRouteSchema,
} from "../../../../../assets/shared/schemas/leadership";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const LeadershipPositionsList = openApiRoute(
  leadershipPositionsListRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "access:grant");

    const positions = await listLeadershipPositionsAdmin(requestDb(c), data.query.body);
    return json({ positions });
  },
);

export const LeadershipPositionsCreate = openApiRoute(
  leadershipPositionsCreateRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "access:grant");

    const body = data.body;
    const position = await createLeadershipPosition(requestDb(c), body, admin.id);

    return json(position, 201);
  },
);

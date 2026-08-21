/**
 * GET  /api/v1/admin/working-groups — list all working groups (admin, unfiltered by active)
 * POST /api/v1/admin/working-groups — create a working group
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listAdminWorkingGroups, createWorkingGroup } from "../../../../_lib/services/admin-working-groups";
import {
  workingGroupCreateRouteSchema,
  workingGroupsListRouteSchema,
} from "../../../../../assets/shared/schemas/working-groups";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const WorkingGroupsList = openApiRoute(workingGroupsListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:read");

  const { limit, offset, q, sort, active } = data.query;
  const { workingGroups, total } = await listAdminWorkingGroups(requestDb(c), { limit, offset, q, sort, active });
  return json({ workingGroups, page: buildPageInfo(limit, offset, total, workingGroups.length) });
});

export const WorkingGroupsCreate = openApiRoute(workingGroupCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const body = data.body;
  const workingGroup = await createWorkingGroup(requestDb(c), admin.id, body);

  return json({ workingGroup }, 201);
});

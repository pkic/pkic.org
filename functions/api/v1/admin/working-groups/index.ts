/**
 * GET  /api/v1/admin/working-groups — list all working groups (admin, unfiltered by active)
 * POST /api/v1/admin/working-groups — create a working group
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { listAdminWorkingGroups, createWorkingGroup } from "../../../../_lib/services/admin-working-groups";
import {
  workingGroupCreateRouteSchema,
  workingGroupsListRouteSchema,
} from "../../../../../assets/shared/schemas/working-groups";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const WorkingGroupsList = openApiRoute(workingGroupsListRouteSchema, async (c: AdminContext, _data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:read");

  const workingGroups = await listAdminWorkingGroups(requestDb(c));
  return json({ workingGroups });
});

export const WorkingGroupsCreate = openApiRoute(workingGroupCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const body = data.body;
  const workingGroup = await createWorkingGroup(requestDb(c), body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "working_group_created", "working_group", workingGroup.id, {
    name: workingGroup.name,
  });

  return json({ workingGroup }, 201);
});

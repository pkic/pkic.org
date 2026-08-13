/**
 * PATCH /api/v1/admin/votes/:id — update a vote's settings.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getVoteScopeForPermissionCheck, updateVoteSettings } from "../../../../../_lib/services/votes";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { adminVoteUpdateRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminVotePatch = openApiRoute(adminVoteUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;

  const scope = await getVoteScopeForPermissionCheck(db, id);
  requirePermission(
    admin,
    "votes:manage",
    scope.scopeType === "working_group" && scope.scopeId ? { type: "working_group", id: scope.scopeId } : undefined,
  );

  const body = data.body;
  const vote = await updateVoteSettings(db, id, body);

  await writeAuditLog(db, "admin", admin.id, "vote_updated", "vote", vote.id, { changes: body });

  return json({ vote });
});

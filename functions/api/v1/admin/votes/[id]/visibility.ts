/**
 * PATCH /api/v1/admin/votes/:id/visibility — set a vote's public
 * visibility and detail level. Reversible at any time; every
 * change is written to audit_log.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getVoteScopeForPermissionCheck, updateVoteVisibility } from "../../../../../_lib/services/votes";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { adminVoteVisibilityUpdateRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminVoteVisibilityPatch = openApiRoute(
  adminVoteVisibilityUpdateRouteSchema,
  async (c: AdminContext, data) => {
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
    const vote = await updateVoteVisibility(db, id, body);

    await writeAuditLog(db, "admin", admin.id, "vote_visibility_updated", "vote", vote.id, { changes: body });

    return json({ vote });
  },
);

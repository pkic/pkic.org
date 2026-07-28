/**
 * PATCH /api/v1/admin/votes/:id/visibility — set a vote's public
 * visibility and detail level (PRD §4.8). Reversible at any time; every
 * change is written to audit_log.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { parseJsonBody } from "../../../../../_lib/validation";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getVoteScopeForPermissionCheck, updateVoteVisibility } from "../../../../../_lib/services/votes";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import {
  adminVoteVisibilityUpdateSchema,
  adminVoteVisibilityUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");

  const scope = await getVoteScopeForPermissionCheck(db, id);
  requirePermission(
    admin,
    "votes:manage",
    scope.scopeType === "working_group" && scope.scopeId ? { type: "working_group", id: scope.scopeId } : undefined,
  );

  const body = await parseJsonBody(c.req, adminVoteVisibilityUpdateSchema);
  const vote = await updateVoteVisibility(db, id, body);

  await writeAuditLog(db, "admin", admin.id, "vote_visibility_updated", "vote", vote.id, { changes: body });

  return json({ vote });
}

export class AdminVoteVisibilityPatch extends OpenAPIRoute {
  schema = adminVoteVisibilityUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

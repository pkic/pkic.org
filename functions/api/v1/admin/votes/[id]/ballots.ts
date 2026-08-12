/**
 * GET /api/v1/admin/votes/:id/ballots — full ballot breakdown, staff only.
 * Separate from the "results are hidden until closes_at"
 * rule, which governs the member/public result endpoints — this is a
 * staff audit surface, viewable at any time.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getVoteScopeForPermissionCheck, listBallotsForAdmin } from "../../../../../_lib/services/votes";
import { adminVoteBallotsRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");

  const scope = await getVoteScopeForPermissionCheck(db, id);
  requirePermission(
    admin,
    "votes:manage",
    scope.scopeType === "working_group" && scope.scopeId ? { type: "working_group", id: scope.scopeId } : undefined,
  );

  const ballots = await listBallotsForAdmin(db, id);
  return json({ ballots });
}

export class AdminVoteBallotsGet extends OpenAPIRoute {
  schema = adminVoteBallotsRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

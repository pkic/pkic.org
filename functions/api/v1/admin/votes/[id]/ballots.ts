/**
 * GET /api/v1/admin/votes/:id/ballots — full ballot breakdown, staff only.
 * Separate from the "results are hidden until closes_at"
 * rule, which governs the member/public result endpoints — this is a
 * staff audit surface, viewable at any time.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requireVoteManagementAccess } from "../../../../../_lib/auth/vote-access";
import { listBallotsForAdmin } from "../../../../../_lib/services/votes";
import { adminVoteBallotsRouteSchema } from "../../../../../../assets/shared/schemas/votes-admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminVoteBallotsGet = openApiRoute(adminVoteBallotsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;

  await requireVoteManagementAccess(db, admin, id);

  const ballots = await listBallotsForAdmin(db, id);
  return json({ ballots });
});

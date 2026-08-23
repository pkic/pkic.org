/**
 * POST /api/v1/admin/votes — create a vote directly.
 * Staff admin may create for any scope; a WG chair/vice-chair's
 * WG-scoped votes:create grant only covers their own working group
 * (resolved and checked against the actual WG before creating).
 *
 * GET /api/v1/admin/votes — list all votes, optionally filtered by status.
 * Not in endpoint table — see listVotesForAdmin's header for why it's
 * a necessary addition.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { getWorkingGroupBySlugOrId } from "../../../../_lib/services/working-groups";
import { createVoteDirect, listVotesForAdmin } from "../../../../_lib/services/votes";
import {
  adminVoteCreateRouteSchema,
  adminVoteMutationResponseSchema,
  adminVotesListRouteSchema,
} from "../../../../../assets/shared/schemas/votes-admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const AdminVotesGet = openApiRoute(adminVotesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "votes:manage");

  const { status, q, sort, limit, offset } = data.query;

  const { votes, total } = await listVotesForAdmin(db, { status, q, sort, limit, offset });
  return json({ votes, page: buildPageInfo(limit, offset, total, votes.length) });
});

export const AdminVotesPost = openApiRoute(adminVoteCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const body = data.body;

  if (body.scopeType === "working_group") {
    const wg = body.scopeId ? await getWorkingGroupBySlugOrId(db, body.scopeId) : null;
    requirePermission(admin, "votes:create", wg ? { type: "working_group", id: wg.id } : undefined);
  } else {
    requirePermission(admin, "votes:create");
  }

  const vote = await createVoteDirect(db, admin, body);

  return json(adminVoteMutationResponseSchema.parse({ vote }));
});

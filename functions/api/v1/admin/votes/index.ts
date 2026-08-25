/**
 * POST /api/v1/admin/votes — create a vote directly.
 * Group-scoped votes:create permission only covers that owning group.
 *
 * GET /api/v1/admin/votes — list all votes, optionally filtered by status.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { requireEffectiveGroupPermission } from "../../../../_lib/services/groups/governance";
import { createVoteDirect, listVotesForAdmin } from "../../../../_lib/services/votes";
import {
  adminVoteCreateRouteSchema,
  adminVoteMutationResponseSchema,
  adminVotesListResponseSchema,
  adminVotesListRouteSchema,
} from "../../../../../assets/shared/schemas/votes-admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const AdminVotesGet = openApiRoute(adminVotesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "votes:manage");

  const { votes, total } = await listVotesForAdmin(db, data.query);
  return json(
    adminVotesListResponseSchema.parse({
      votes,
      page: buildPageInfo(data.query.limit, data.query.offset, total, votes.length),
    }),
  );
});

export const AdminVotesPost = openApiRoute(adminVoteCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const body = data.body;

  await requireEffectiveGroupPermission(db, admin, body.ownerGroupId, "votes:create");

  const vote = await createVoteDirect(db, admin, body);

  return json(adminVoteMutationResponseSchema.parse({ vote }));
});

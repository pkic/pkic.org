/**
 * GET /api/v1/admin/vote-proposals — list all proposals, filterable by
 * status.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listAllVoteProposalsForAdmin } from "../../../../_lib/services/votes";
import { adminListProposalsRouteSchema } from "../../../../../assets/shared/schemas/votes";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export const AdminVoteProposalsGet = openApiRoute(adminListProposalsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "votes:manage");

  const { status, limit = 50, offset = 0 } = data.query;
  const { proposals, total } = await listAllVoteProposalsForAdmin(db, { status, limit, offset });
  return json({ proposals, page: buildPageInfo(limit, offset, total, proposals.length) });
});

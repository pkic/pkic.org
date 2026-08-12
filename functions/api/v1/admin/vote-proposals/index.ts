/**
 * GET /api/v1/admin/vote-proposals — list all proposals, filterable by
 * status.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listAllVoteProposalsForAdmin } from "../../../../_lib/services/votes";
import {
  adminListProposalsQuerySchema,
  adminListProposalsRouteSchema,
} from "../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "votes:manage");

  const url = new URL(c.req.raw.url);
  const parsed = adminListProposalsQuerySchema.safeParse({ status: url.searchParams.get("status") ?? undefined });
  const proposals = await listAllVoteProposalsForAdmin(db, parsed.success ? parsed.data : {});
  return json({ proposals });
}

export class AdminVoteProposalsGet extends OpenAPIRoute {
  schema = adminListProposalsRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

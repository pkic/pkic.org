/**
 * POST /api/v1/admin/votes — create a vote directly (PRD §4.8 Path A).
 * Staff admin may create for any scope; a WG chair/vice-chair's
 * WG-scoped votes:create grant only covers their own working group
 * (resolved and checked against the actual WG before creating).
 *
 * GET /api/v1/admin/votes — list all votes, optionally filtered by status.
 * Not in §7's endpoint table — see listVotesForAdmin's header for why it's
 * a necessary addition.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { parseJsonBody } from "../../../../_lib/validation";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { getWorkingGroupBySlugOrId } from "../../../../_lib/services/working-groups";
import { createVoteDirect, listVotesForAdmin } from "../../../../_lib/services/votes";
import { writeAuditLog } from "../../../../_lib/services/audit";
import {
  adminVoteCreateSchema,
  adminVoteCreateRouteSchema,
  adminVotesListQuerySchema,
  adminVotesListRouteSchema,
} from "../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "votes:manage");

  const url = new URL(c.req.raw.url);
  const parsed = adminVotesListQuerySchema.safeParse({ status: url.searchParams.get("status") ?? undefined });
  const votes = await listVotesForAdmin(db, parsed.success ? parsed.data : {});
  return json({ votes });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminVoteCreateSchema);

  if (body.scopeType === "working_group") {
    const wg = body.scopeId ? await getWorkingGroupBySlugOrId(db, body.scopeId) : null;
    requirePermission(admin, "votes:create", wg ? { type: "working_group", id: wg.id } : undefined);
  } else {
    requirePermission(admin, "votes:create");
  }

  const vote = await createVoteDirect(db, admin, body);

  await writeAuditLog(db, "admin", admin.id, "vote_created", "vote", vote.id, {
    title: vote.title,
    voteType: vote.voteType,
    scopeType: vote.scopeType,
  });

  return json({ vote });
}

export class AdminVotesPost extends OpenAPIRoute {
  schema = adminVoteCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

export class AdminVotesGet extends OpenAPIRoute {
  schema = adminVotesListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

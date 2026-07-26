/**
 * GET  /api/v1/admin/members — list members (Interim Admin Tool)
 * POST /api/v1/admin/members — create a member (or finish a §6 Step 2
 *                               migration gap) directly
 *
 * PRD §6 "Interim Admin Tool — Manual Member Management (pre-Phase 4A)".
 * Gated by `membership:write` (existing Phase 2 permission, already held
 * by the `admin` and `membership_processor` roles — no new permission
 * needed).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { createAdminMember, listAdminMembers } from "../../../../_lib/services/admin-members";
import {
  adminMembersListQuerySchema,
  memberCreateSchema,
  membersCreateRouteSchema,
  membersListRouteSchema,
} from "../../../../../assets/shared/schemas/admin-members";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const url = new URL(c.req.raw.url);
  const parsed = adminMembersListQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  const limit = parsed.success ? (parsed.data.limit ?? 50) : 50;
  const offset = parsed.success ? (parsed.data.offset ?? 0) : 0;

  const { members, total } = await listAdminMembers(requestDb(c), { limit, offset });
  return json({ members, page: { limit, offset, total, hasMore: offset + members.length < total } });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const body = await parseJsonBody(c.req, memberCreateSchema);
  const result = await createAdminMember(requestDb(c), body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "member_created", "organization", result.organizationId, {
    membershipCategory: body.membershipCategory,
    organizationName: body.organizationName ?? null,
    representativeEmails: body.representatives.map((r) => r.email),
  });

  return json(result, 201);
}

export class MembersList extends OpenAPIRoute {
  schema = membersListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class MembersCreate extends OpenAPIRoute {
  schema = membersCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

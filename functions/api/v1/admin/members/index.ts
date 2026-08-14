/**
 * GET  /api/v1/admin/members — list members (Interim Admin Tool)
 * POST /api/v1/admin/members — create a member (or finish a
 *                               migration gap) directly
 *
 * Interim Admin Tool — Manual Member Management.
 * Gated by `membership:write` (existing permission, already held
 * by the `admin` and `membership_processor` roles — no new permission
 * needed).
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { createAdminMember, listAdminMembers } from "../../../../_lib/services/admin-members";
import { membersCreateRouteSchema, membersListRouteSchema } from "../../../../../assets/shared/schemas/admin-members";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const MembersList = openApiRoute(membersListRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const { limit = 50, offset = 0 } = data.query;

  const { members, total } = await listAdminMembers(requestDb(c), { limit, offset });
  return json({ members, page: buildPageInfo(limit, offset, total, members.length) });
});

export const MembersCreate = openApiRoute(membersCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const body = data.body;
  const result = await createAdminMember(requestDb(c), body);

  await writeAuditLog(requestDb(c), "admin", admin.id, "member_created", "organization", result.organizationId, {
    membershipCategory: body.membershipCategory,
    organizationName: body.organizationName ?? null,
    representativeEmails: body.representatives.map((r) => r.email),
  });

  return json(result, 201);
});

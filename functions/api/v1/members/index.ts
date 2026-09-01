/**
 * GET /api/v1/members
 *
 * Public, paginated member directory. Strong cache headers
 * per the success metric: "public read only API endpoint with strong
 * http cache instructions (CDN + client) to avoid a spike in expensive db
 * calls for mostly static data."
 */
import { json } from "../../../_lib/http";
import { listPublicMembers } from "../../../_lib/services/membership/directory";
import { membersListResponseSchema, membersListRouteSchema } from "../../../../assets/shared/schemas/members-directory";
import { openApiRoute } from "../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  memberProvisionResponseSchema,
  memberProvisionRouteSchema,
} from "../../../../assets/shared/schemas/membership-management";
import type { AdminContext } from "../../../_lib/db/context";
import { provisionMember } from "../../../_lib/services/membership-management-list";
import { requireMembershipStaffPermission } from "./authorization";
import { requirePermission } from "../../../_lib/auth/permissions";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const MembersGet = openApiRoute(membersListRouteSchema, async (c: any, data) => {
  const { members, total } = await listPublicMembers(c.env.DB, data.query);

  const response = json(
    membersListResponseSchema.parse({
      members,
      page: buildPageInfo(data.query.limit, data.query.offset, total, members.length),
    }),
  );
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});

export const MemberProvision = openApiRoute(memberProvisionRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireMembershipStaffPermission(c, "membership:write");
  requirePermission(staff, "identities:activate");
  return json(memberProvisionResponseSchema.parse(await provisionMember(db, staff, data.body)), 201);
});

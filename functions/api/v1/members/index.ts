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
import {
  memberUpdateResponseSchema,
  memberUpdateRouteSchema,
  membersListRouteSchema,
  publicMembersListResponseSchema,
  staffMembersListResponseSchema,
} from "../../../../assets/shared/schemas/members-directory";
import { listStaffMembers } from "../../../_lib/services/membership/staff-directory";
import { updateMemberAggregate } from "../../../_lib/services/membership/aggregate";
import { optionalMembershipReader } from "./authorization";
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

/**
 * One endpoint, two projections, chosen by what the caller may see — the same
 * capability-shaped union `/api/v1/groups/:groupId/memberships` uses.
 *
 * Either way a row is one membership: an organization or an individual, never
 * one per representative, because an organization's representatives inherit
 * its membership rather than each holding one of their own.
 *
 * The staff branch is never publicly cached: the API middleware forces
 * `no-store` on any request carrying an authorization header or a session
 * cookie, which is exactly the request that reaches it.
 */
export const MembersGet = openApiRoute(membersListRouteSchema, async (c: any, data) => {
  const staff = await optionalMembershipReader(c);
  if (staff) {
    const { members, total } = await listStaffMembers(staff.db, data.query);
    return json(
      staffMembersListResponseSchema.parse({
        members,
        page: buildPageInfo(data.query.limit, data.query.offset, total, members.length),
      }),
    );
  }

  const { members, total } = await listPublicMembers(c.env.DB, data.query);
  const response = json(
    publicMembersListResponseSchema.parse({
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

/**
 * The membership itself, not one identity acting under it: an organization's
 * representatives inherit its category and standing, so changing either
 * through one of them is refused on the capacities route and belongs here.
 */
export const MemberPatch = openApiRoute(memberUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireMembershipStaffPermission(c, "membership:write");
  const member = await updateMemberAggregate(db, staff, data.params.id, data.body);
  return json(memberUpdateResponseSchema.parse({ member }));
});

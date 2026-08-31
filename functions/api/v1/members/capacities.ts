import {
  individualMembershipGrantRouteSchema,
  memberCapacityDeleteRouteSchema,
  memberCapacityListResponseSchema,
  memberCapacityListRouteSchema,
  memberCapacityMutationResponseSchema,
  memberCapacityUpdateRouteSchema,
} from "../../../../assets/shared/schemas/membership-management";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  grantIndividualMembership,
  removeMembershipCapacity,
  updateMembershipCapacity,
} from "../../../_lib/services/membership/capacities";
import { listMemberCapacities } from "../../../_lib/services/membership-management-list";
import { requireMembershipStaffPermission } from "./authorization";
import { requirePermission } from "../../../_lib/auth/permissions";

export const MemberCapacitiesList = openApiRoute(memberCapacityListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireMembershipStaffPermission(c, "membership:read");
  const { members, total } = await listMemberCapacities(db, data.query);
  return json(
    memberCapacityListResponseSchema.parse({
      members,
      page: buildPageInfo(data.query.limit, data.query.offset, total, members.length),
    }),
  );
});

export const MemberCapacityUpdate = openApiRoute(memberCapacityUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireMembershipStaffPermission(c, "membership:write");
  const member = await updateMembershipCapacity(db, staff, data.params.id, data.body);
  return json(memberCapacityMutationResponseSchema.parse({ member }));
});

export const MemberCapacityDelete = openApiRoute(memberCapacityDeleteRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireMembershipStaffPermission(c, "membership:write");
  await removeMembershipCapacity(db, staff, data.params.id);
  return json({ success: true });
});

export const MemberCapacityGrant = openApiRoute(individualMembershipGrantRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireMembershipStaffPermission(c, "membership:write");
  requirePermission(staff, "identities:activate");
  const member = await grantIndividualMembership(db, staff, data.body);
  return json(memberCapacityMutationResponseSchema.parse({ member }), 201);
});

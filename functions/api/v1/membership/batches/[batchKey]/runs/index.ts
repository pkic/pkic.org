import {
  membershipBatchRunCreateRouteSchema,
  membershipBatchRunResponseSchema,
} from "../../../../../../../assets/shared/schemas/membership-batches";
import { requireUserBackedAuthAdmin } from "../../../../../../_lib/auth/admin-identity";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  createMembershipBatchRun,
  membershipBatchPermissions,
} from "../../../../../../_lib/services/membership/batch-runs";

export const MembershipBatchRunCreate = openApiRoute(
  membershipBatchRunCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:read");
    const batchKey = data.params.batchKey;
    for (const permission of membershipBatchPermissions(batchKey)) requirePermission(staff, permission);
    const actor = requireUserBackedAuthAdmin(staff);
    return json(membershipBatchRunResponseSchema.parse(await createMembershipBatchRun(db, c.env, actor, batchKey)));
  },
);

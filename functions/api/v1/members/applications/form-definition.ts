import {
  membershipApplicationFormDefinitionGetRouteSchema,
  membershipApplicationFormDefinitionResponseSchema,
  membershipApplicationFormDefinitionUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/membership-application-form";
import { type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  getMembershipApplicationFormDefinition,
  updateMembershipApplicationFormDefinition,
} from "../../../../_lib/services/membership/application-form";
import { requireMembershipStaffPermission } from "../authorization";

export const MembersApplicationsFormDefinitionGet = openApiRoute(
  membershipApplicationFormDefinitionGetRouteSchema,
  async (c: AdminContext) => {
    c.set?.("sensitive", true);
    const { db } = await requireMembershipStaffPermission(c, "membership:read");
    return json(
      membershipApplicationFormDefinitionResponseSchema.parse(await getMembershipApplicationFormDefinition(db)),
    );
  },
);

export const MembersApplicationsFormDefinitionPatch = openApiRoute(
  membershipApplicationFormDefinitionUpdateRouteSchema,
  async (c: AdminContext, data) => {
    c.set?.("sensitive", true);
    const { db, staff } = await requireMembershipStaffPermission(c, "membership:write");
    return json(
      membershipApplicationFormDefinitionResponseSchema.parse(
        await updateMembershipApplicationFormDefinition(db, staff, data.body),
      ),
    );
  },
);

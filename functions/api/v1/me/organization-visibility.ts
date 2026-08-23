/**
 * PATCH /api/v1/me/organization-visibility.
 */
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { updateOrganizationVisibility } from "../../../_lib/services/member-self-service";
import {
  myOrganizationVisibilityUpdateResponseSchema,
  myOrganizationVisibilityUpdateRouteSchema,
} from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";

export const MeOrganizationVisibilityPatch = openApiRoute(
  myOrganizationVisibilityUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    await updateOrganizationVisibility(db, member, data.body.showOnOrgProfile);
    return json(
      myOrganizationVisibilityUpdateResponseSchema.parse({
        success: true,
        showOnOrgProfile: data.body.showOnOrgProfile,
      }),
    );
  },
);

import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { selfOrganizationsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-organizations";
import { userOrganizationsListResponseSchema } from "../../../../../../assets/shared/schemas/user-organizations";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listUserOrganizations } from "../../../../../_lib/services/user-organizations";

export const CurrentUserOrganizationsGet = openApiRoute(
  selfOrganizationsListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const result = await listUserOrganizations(db, member.userId, data.query);
    return json(
      userOrganizationsListResponseSchema.parse({
        organizations: result.organizations,
        page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.organizations.length),
      }),
    );
  },
);

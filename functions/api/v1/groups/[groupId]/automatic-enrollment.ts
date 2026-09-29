import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { setAutomaticEnrollmentOptOut } from "../../../../_lib/services/groups";
import { groupAutomaticEnrollmentPreferenceRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";

export const GroupAutomaticEnrollmentPreference = openApiRoute(
  groupAutomaticEnrollmentPreferenceRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    await setAutomaticEnrollmentOptOut(db, member.userId, data.params.groupId, data.body.optedOut);
    return json({ success: true as const, optedOut: data.body.optedOut });
  },
);

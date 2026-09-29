import { successResponseSchema } from "../../../../../../assets/shared/schemas/api-common";
import { eventTeamRoleDeleteRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-events";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { revokeEventTeamRole } from "../../../../../_lib/services/events/team";
import { requireEventPermission } from "../authorization";

export const EventTeamRoleDelete = openApiRoute(eventTeamRoleDeleteRouteSchema, async (c: AdminContext, data) => {
  const { actor, db } = await requireEventPermission(c, data.params.eventSlug, "events:manage");
  await revokeEventTeamRole(db, actor, data.params.eventSlug, data.params.roleAssignmentId);
  return json(successResponseSchema.parse({ success: true }));
});

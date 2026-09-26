import { organizationEventsListRouteSchema } from "../../../../../assets/shared/schemas/organization-activity";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listOrganizationEvents } from "../../../../_lib/services/organization-activity/event-participation";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireOrganizationStaffPermission } from "../authorization";

export const OrganizationEventsGet = openApiRoute(organizationEventsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireOrganizationStaffPermission(c, "organizations:read");
  return jsonPrivate(await listOrganizationEvents(db, data.params.organizationId, data.query));
});

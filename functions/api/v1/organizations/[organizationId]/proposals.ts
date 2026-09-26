import { organizationProposalsListRouteSchema } from "../../../../../assets/shared/schemas/organization-activity";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listOrganizationProposals } from "../../../../_lib/services/organization-activity/proposal-submissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireOrganizationStaffPermission } from "../authorization";

export const OrganizationProposalsGet = openApiRoute(
  organizationProposalsListRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireOrganizationStaffPermission(c, "organizations:read");
    return jsonPrivate(await listOrganizationProposals(db, data.params.organizationId, data.query));
  },
);

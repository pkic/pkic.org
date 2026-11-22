import {
  organizationCurrentApplicationGetRouteSchema,
  organizationCurrentApplicationResponseSchema,
} from "../../../../../assets/shared/schemas/organization-self-service";
import type { AdminContext } from "../../../../_lib/db/context";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { readOrganizationCurrentApplication } from "../../../../_lib/services/membership/applications/organization-current";
import { requireOrganizationRepresentative } from "../authorization";

export const OrganizationCurrentApplicationGet = openApiRoute(
  organizationCurrentApplicationGetRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireOrganizationRepresentative(c, data.params.organizationId);
    return jsonPrivate(
      organizationCurrentApplicationResponseSchema.parse({
        application: await readOrganizationCurrentApplication(db, data.params.organizationId),
      }),
    );
  },
);

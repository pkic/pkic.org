import {
  organizationContactDetailsGetRouteSchema,
  organizationContactDetailsPutRouteSchema,
  organizationContactDetailsResponseSchema,
} from "../../../../../../assets/shared/schemas/organization-contact-details";
import { resolveUserSessionFromRequest } from "../../../../../_lib/auth/user-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { organizationContactAccess } from "../../../../../_lib/services/organization-contact-access";
import {
  readOrganizationContactDetails,
  saveOrganizationContactDetails,
} from "../../../../../_lib/services/organization-contact-details";

async function access(
  c: AdminContext,
  organizationId: string,
  permission: "organizations:read" | "organizations:write",
) {
  markResponseSensitive(c);
  const db = requestDb(c);
  const session = await resolveUserSessionFromRequest(db, c.req.raw, c.env);
  return organizationContactAccess(db, session, organizationId, permission);
}

export const OrganizationContactDetailsGet = openApiRoute(
  organizationContactDetailsGetRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await access(c, data.params.organizationId, "organizations:read");
    return json(
      organizationContactDetailsResponseSchema.parse(
        await readOrganizationContactDetails(db, data.params.organizationId),
      ),
    );
  },
);

export const OrganizationContactDetailsPut = openApiRoute(
  organizationContactDetailsPutRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor } = await access(c, data.params.organizationId, "organizations:write");
    return json(
      organizationContactDetailsResponseSchema.parse(
        await saveOrganizationContactDetails(db, actor, data.params.organizationId, data.body),
      ),
    );
  },
);

import {
  organizationSecondaryContactNominationDeleteRouteSchema,
  organizationSecondaryContactNominationPutRouteSchema,
  organizationSecondaryContactNominationResponseSchema,
} from "../../../../../assets/shared/schemas/organization-self-service";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { nominateSecondaryContact } from "../../../../_lib/services/member-organization";
import { requireOrganizationMemberMutation } from "../authorization";

export const OrganizationSecondaryContactNominationPut = openApiRoute(
  organizationSecondaryContactNominationPutRouteSchema,
  async (c: AdminContext, data) => {
    const { db, member } = await requireOrganizationMemberMutation(c, data.params.organizationId);
    return json(
      organizationSecondaryContactNominationResponseSchema.parse(
        await nominateSecondaryContact(db, member, data.body.userId),
      ),
    );
  },
);

export const OrganizationSecondaryContactNominationDelete = openApiRoute(
  organizationSecondaryContactNominationDeleteRouteSchema,
  async (c: AdminContext, data) => {
    const { db, member } = await requireOrganizationMemberMutation(c, data.params.organizationId);
    return json(
      organizationSecondaryContactNominationResponseSchema.parse(await nominateSecondaryContact(db, member, null)),
    );
  },
);

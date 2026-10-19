import {
  affiliationLinkKeptRouteSchema,
  affiliationOfferDismissalRouteSchema,
  affiliationOfferGetRouteSchema,
  affiliationOfferResponseSchema,
} from "../../../../../../assets/shared/schemas/affiliation-offer";
import { successResponseSchema } from "../../../../../../assets/shared/schemas/api-common";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  dismissAffiliationOffer,
  readAffiliationOffer,
} from "../../../../../_lib/services/identities/affiliation-offer";
import { keepLinkedOrganization } from "../../../../../_lib/services/identities/organization-link-notices";
import { nowIso } from "../../../../../_lib/utils/time";

export const CurrentUserAffiliationOfferGet = openApiRoute(affiliationOfferGetRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
  return jsonPrivate(affiliationOfferResponseSchema.parse({ offer: await readAffiliationOffer(db, actor.userId) }));
});

export const CurrentUserAffiliationOfferDismissalPost = openApiRoute(
  affiliationOfferDismissalRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    await dismissAffiliationOffer(db, { userId: actor.userId, organizationId: data.body.organizationId });
    return jsonPrivate(successResponseSchema.parse({ success: true }), 201);
  },
);

export const CurrentUserAffiliationLinkKeptPost = openApiRoute(
  affiliationLinkKeptRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    await keepLinkedOrganization(db, {
      userId: actor.userId,
      organizationId: data.body.organizationId,
      jobTitle: data.body.jobTitle,
      at: nowIso(),
    });
    return jsonPrivate(successResponseSchema.parse({ success: true }), 201);
  },
);

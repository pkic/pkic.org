/**
 * PATCH /api/v1/me/organization/secondary-contact — primary contact
 * nominates (or withdraws a nomination for) a secondary contact.
 * Held as `pending` until a staff admin confirms via
 * POST /api/v1/organizations/:organizationId/confirm-secondary-contact.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { nominateSecondaryContact } from "../../../../_lib/services/member-organization";
import {
  mySecondaryContactNominateResponseSchema,
  mySecondaryContactNominateRouteSchema,
} from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeSecondaryContactPatch = openApiRoute(
  mySecondaryContactNominateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const result = await nominateSecondaryContact(db, member, data.body.userId);
    return json(mySecondaryContactNominateResponseSchema.parse(result));
  },
);

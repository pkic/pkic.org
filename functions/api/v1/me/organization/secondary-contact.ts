/**
 * PATCH /api/v1/me/organization/secondary-contact — primary contact
 * nominates (or withdraws a nomination for) a secondary contact (PRD
 * §4.11). Held as `pending` until a staff admin confirms via
 * POST /api/v1/admin/organizations/:id/confirm-secondary-contact.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { nominateSecondaryContact } from "../../../../_lib/services/member-organization";
import {
  mySecondaryContactNominateRouteSchema,
  mySecondaryContactNominateSchema,
} from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, mySecondaryContactNominateSchema);
  const result = await nominateSecondaryContact(db, member, body.userId);
  return json(result);
}

export class MeSecondaryContactPatch extends OpenAPIRoute {
  schema = mySecondaryContactNominateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

/**
 * POST /api/v1/me/organization/members — self-service coworker enrollment
 * (member portal). Only the caller's organization's primary or secondary
 * contact may call this; see addCoworker() for the full eligibility check.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { addCoworker } from "../../../../_lib/services/member-organization";
import { addCoworkerRouteSchema, addCoworkerSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, addCoworkerSchema);
  const coworker = await addCoworker(db, member, body);
  return json(coworker);
}

export class MeOrganizationMembersPost extends OpenAPIRoute {
  schema = addCoworkerRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

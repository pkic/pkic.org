/**
 * POST /api/v1/me/organization/members — self-service coworker enrollment
 * (member portal). Only the caller's organization's primary or secondary
 * contact may call this; see addCoworker() for the full eligibility check.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { addCoworker } from "../../../../_lib/services/member-organization";
import { addCoworkerRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeOrganizationMembersPost = openApiRoute(addCoworkerRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const coworker = await addCoworker(db, member, data.body);
  return json(coworker);
});

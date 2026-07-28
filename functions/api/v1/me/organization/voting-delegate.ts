/**
 * PATCH /api/v1/me/organization/voting-delegate — primary/secondary
 * contact sets (or clears) the organization's standing forum-vote delegate
 * (PRD §4.8). Takes effect immediately.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { setVotingDelegate } from "../../../../_lib/services/member-organization";
import {
  myVotingDelegateUpdateRouteSchema,
  myVotingDelegateUpdateSchema,
} from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, myVotingDelegateUpdateSchema);
  const result = await setVotingDelegate(db, member, body.userId);
  return json(result);
}

export class MeVotingDelegatePatch extends OpenAPIRoute {
  schema = myVotingDelegateUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

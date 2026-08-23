/**
 * PATCH /api/v1/me/organization/voting-delegate — primary/secondary
 * contact sets (or clears) the organization's standing forum-vote delegate.
 * Takes effect immediately.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { setVotingDelegate } from "../../../../_lib/services/member-organization";
import {
  myVotingDelegateUpdateResponseSchema,
  myVotingDelegateUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeVotingDelegatePatch = openApiRoute(myVotingDelegateUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const result = await setVotingDelegate(db, member, data.body.userId);
  return json(myVotingDelegateUpdateResponseSchema.parse(result));
});

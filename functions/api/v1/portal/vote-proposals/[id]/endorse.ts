/**
 * POST/DELETE /api/v1/portal/vote-proposals/:id/endorse — endorse a
 * proposal, or withdraw my own endorsement (A–G members only).
 * Endorsing auto-converts the proposal to an active vote once the
 * endorsement threshold is reached.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { endorseVoteProposal, withdrawEndorsement } from "../../../../../_lib/services/votes";
import {
  endorseProposalRouteSchema,
  withdrawEndorsementRouteSchema,
} from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const PortalVoteProposalEndorsePost = openApiRoute(endorseProposalRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;
  const result = await endorseVoteProposal(db, member, id);
  return json(result);
});

export const PortalVoteProposalEndorseDelete = openApiRoute(
  withdrawEndorsementRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const id = data.params.id;
    await withdrawEndorsement(db, member, id);
    return json({ success: true });
  },
);

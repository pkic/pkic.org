import type { ValidatedData } from "chanfana";
import { adminProposalFlagRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { moderateProposal } from "../../../../../_lib/services/proposal-moderation";

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalFlagRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const result = await moderateProposal(db, admin, data.params.proposalId, data.body.action);
  return json({ success: true, ...result });
}

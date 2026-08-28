import type { ValidatedData } from "chanfana";
import { adminProposalPatchRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { proposalPatchResponseSchema } from "../../../../../../assets/shared/schemas/proposal-management";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { editProposal } from "../../../../../_lib/services/proposal-edit";

export async function onRequestPatch(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalPatchRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const proposal = await editProposal(db, admin, data.params.proposalId, data.body);
  return json(proposalPatchResponseSchema.parse({ proposal }));
}

import type { ValidatedData } from "chanfana";
import { adminProposalReviewPatchRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { requireUserBackedAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { updateProposalReview } from "../../../../../../_lib/services/proposal-reviews";

export async function onRequestPatch(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalReviewPatchRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const review = await updateProposalReview(db, admin, data.params.proposalId, data.params.reviewId, data.body);
  return json({ success: true, review });
}

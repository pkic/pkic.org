import type { ValidatedData } from "chanfana";
import { cancelAcceptedProposalResponseSchema } from "../../../../../../assets/shared/schemas/proposal-management";
import { adminProposalCancelRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { requireUserBackedAdminFromRequest } from "../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { processSelectedOutboxBackground } from "../../../../../_lib/email/outbox";
import { json } from "../../../../../_lib/http";
import { cancelAcceptedProposal } from "../../../../../_lib/services/proposal-cancellation";

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalCancelRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const canceled = await cancelAcceptedProposal(
    db,
    actor,
    data.params.proposalId,
    data.body.comment,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  const { outboxIds, ...response } = canceled;
  if (outboxIds.length > 0) {
    c.executionCtx.waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, outboxIds));
  }
  return json(cancelAcceptedProposalResponseSchema.parse({ success: true, ...response }));
}

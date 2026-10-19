import type { ValidatedData } from "chanfana";
import { independentCapacityDecisionResponseSchema } from "../../../../../../../assets/shared/schemas/independent-capacity";
import type { proposalSpeakerDisclosureReviewRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { reviewIndependentDisclosure } from "../../../../../../_lib/services/proposal-speaker-independent-review";

export async function onRequestPut(
  c: AdminContext,
  data: ValidatedData<typeof proposalSpeakerDisclosureReviewRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const result = await reviewIndependentDisclosure(db, {
    proposalId: data.params.proposalId,
    userId: data.params.userId,
    decision: data.body.decision,
    actor,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  if (result.outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
  return json(independentCapacityDecisionResponseSchema.parse({ success: true, review: result.review }));
}

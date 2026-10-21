import type { ValidatedData } from "chanfana";
import { proposalSpeakerAcceptanceRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-proposal-management";
import { proposalSpeakerAcceptanceResponseSchema } from "../../../../../../../assets/shared/schemas/proposal-speakers";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { acceptSpeakerParticipationByManager } from "../../../../../../_lib/services/proposal-speaker-confirmation";

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof proposalSpeakerAcceptanceRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const outboxId = await acceptSpeakerParticipationByManager(
    db,
    actor,
    data.params.proposalId,
    data.params.userId,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  if (outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  return json(proposalSpeakerAcceptanceResponseSchema.parse({ success: true }));
}

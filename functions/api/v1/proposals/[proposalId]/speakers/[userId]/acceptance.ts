import type { ValidatedData } from "chanfana";
import { proposalSpeakerAcceptanceRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-proposal-management";
import { proposalSpeakerAcceptanceResponseSchema } from "../../../../../../../assets/shared/schemas/proposal-speakers";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { acceptSpeakerParticipationByManager } from "../../../../../../_lib/services/proposal-speaker-confirmation";

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof proposalSpeakerAcceptanceRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  await acceptSpeakerParticipationByManager(db, actor, data.params.proposalId, data.params.userId);
  return json(proposalSpeakerAcceptanceResponseSchema.parse({ success: true }));
}

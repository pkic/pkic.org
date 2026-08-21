import type { ValidatedData } from "chanfana";
import { adminProposalSpeakerPatchRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { editAdminProposalSpeaker } from "../../../../../../_lib/services/proposal-speaker-admin";

export async function onRequestPatch(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalSpeakerPatchRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(
    await editAdminProposalSpeaker(
      db,
      admin,
      data.params.proposalId,
      data.params.userId,
      data.body,
      resolveAppBaseUrl(c.env, c.req.raw),
    ),
  );
}

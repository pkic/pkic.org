import type { ValidatedData } from "chanfana";
import {
  adminProposalSpeakerDeleteRouteSchema,
  adminProposalSpeakerPatchRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts";
import { proposalSpeakerRemovalResponseSchema } from "../../../../../../../assets/shared/schemas/proposal-management";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { editAdminProposalSpeaker } from "../../../../../../_lib/services/proposal-speaker-admin";
import { removeAdminProposalSpeaker } from "../../../../../../_lib/services/proposal-speaker-removal";

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

export async function onRequestDelete(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalSpeakerDeleteRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const result = await removeAdminProposalSpeaker(db, {
    actor: admin,
    proposalId: data.params.proposalId,
    userId: data.params.userId,
    replacementProposerUserId: data.body.replacementProposerUserId,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json(proposalSpeakerRemovalResponseSchema.parse(result));
}

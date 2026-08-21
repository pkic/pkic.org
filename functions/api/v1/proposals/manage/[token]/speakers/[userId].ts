import type { ValidatedData } from "chanfana";
import { dispatchRequestMethod, json } from "../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../_lib/validation";
import {
  getProposerManagedSpeakerContext,
  updateProposalSpeakerByProposer,
} from "../../../../../../_lib/services/proposer-speaker-profile";
import { proposerSpeakerPatchSchema } from "../../../../../../../assets/shared/schemas/proposal-management";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { proposalSpeakerRemovalResponseSchema } from "../../../../../../../assets/shared/schemas/proposal-management";
import { proposerManagedSpeakerDeleteRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { removeProposalSpeakerByProposer } from "../../../../../../_lib/services/proposal-speaker-removal";

export async function onRequestPatch(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, proposerSpeakerPatchSchema);
  const { proposal, speaker } = await getProposerManagedSpeakerContext(
    c.env.DB,
    c.req.param("token"),
    c.req.param("userId"),
    requireInternalSecret(c.env),
  );

  await updateProposalSpeakerByProposer(c.env.DB, {
    proposal,
    speaker,
    patch: {
      role: body.role,
      firstName: body.firstName === undefined ? undefined : body.firstName || null,
      lastName: body.lastName === undefined ? undefined : body.lastName || null,
      organizationName: body.organizationName === undefined ? undefined : body.organizationName || null,
      jobTitle: body.jobTitle === undefined ? undefined : body.jobTitle || null,
      biography: body.biography === undefined ? undefined : body.biography || null,
      links: body.links,
    },
  });

  return json({ success: true });
}

export async function onRequestDelete(
  c: any,
  data?: ValidatedData<typeof proposerManagedSpeakerDeleteRouteSchema>,
): Promise<Response> {
  c.set?.("sensitive", true);
  const params = data?.params ?? { token: c.req.param("token"), userId: c.req.param("userId") };
  const result = await removeProposalSpeakerByProposer(c.env.DB, {
    manageToken: params.token,
    signingSecret: requireInternalSecret(c.env),
    userId: params.userId,
  });
  return json(proposalSpeakerRemovalResponseSchema.parse(result));
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchRequestMethod(c, { PATCH: onRequestPatch, DELETE: onRequestDelete });
}

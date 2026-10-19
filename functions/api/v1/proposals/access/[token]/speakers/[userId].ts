import type { ParticipantRouteData } from "../../../../../../_lib/routes/participant-authority";
import { json } from "../../../../../../_lib/http";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  getProposerManagedSpeakerContext,
  updateProposalSpeakerRoleByProposer,
} from "../../../../../../_lib/services/proposer-speaker-profile";
import { successResponseSchema } from "../../../../../../../assets/shared/schemas/api-common";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { proposalSpeakerRemovalResponseSchema } from "../../../../../../../assets/shared/schemas/proposal-management";
import {
  proposalAccessSpeakerDeleteRouteSchema,
  proposalAccessSpeakerPatchRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { removeProposalSpeakerByProposer } from "../../../../../../_lib/services/proposal-speaker-removal";

type ProposalAccessSpeakerContext = AdminContext;

export async function handleProposalSpeakerPatch(
  c: ProposalAccessSpeakerContext,
  data: ParticipantRouteData<typeof proposalAccessSpeakerPatchRouteSchema>,
): Promise<Response> {
  const { proposal, speaker } = await getProposerManagedSpeakerContext(
    c.env.DB,
    data.params.token,
    data.params.userId,
    requireInternalSecret(c.env),
  );

  await updateProposalSpeakerRoleByProposer(c.env.DB, { proposal, speaker, role: data.body.role });

  return json(successResponseSchema.parse({ success: true }));
}

export async function onRequestDelete(
  c: any,
  data: ParticipantRouteData<typeof proposalAccessSpeakerDeleteRouteSchema>,
): Promise<Response> {
  c.set?.("sensitive", true);
  const params = data.params;
  const result = await removeProposalSpeakerByProposer(c.env.DB, {
    manageToken: params.token,
    signingSecret: requireInternalSecret(c.env),
    userId: params.userId,
  });
  return json(proposalSpeakerRemovalResponseSchema.parse(result));
}

export const ProposalAccessSpeakerPatch = openApiRoute(
  proposalAccessSpeakerPatchRouteSchema,
  handleProposalSpeakerPatch,
  (c: ProposalAccessSpeakerContext) => c.set?.("sensitive", true),
);

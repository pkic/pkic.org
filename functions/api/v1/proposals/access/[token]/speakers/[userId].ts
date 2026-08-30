import type { ValidatedData } from "chanfana";
import { json } from "../../../../../../_lib/http";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  getProposerManagedSpeakerContext,
  updateProposalSpeakerByProposer,
} from "../../../../../../_lib/services/proposer-speaker-profile";
import { successResponseSchema } from "../../../../../../../assets/shared/schemas/api-common";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { proposalSpeakerRemovalResponseSchema } from "../../../../../../../assets/shared/schemas/proposal-management";
import {
  proposalAccessSpeakerDeleteRouteSchema,
  proposalAccessSpeakerPatchRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { removeProposalSpeakerByProposer } from "../../../../../../_lib/services/proposal-speaker-removal";

type ProposalAccessSpeakerContext = AdminContext<{ token: string; userId: string }>;

async function handleProposalSpeakerPatch(
  c: ProposalAccessSpeakerContext,
  data: ValidatedData<typeof proposalAccessSpeakerPatchRouteSchema>,
): Promise<Response> {
  const { proposal, speaker } = await getProposerManagedSpeakerContext(
    c.env.DB,
    data.params.token,
    data.params.userId,
    requireInternalSecret(c.env),
  );

  await updateProposalSpeakerByProposer(c.env.DB, {
    proposal,
    speaker,
    patch: {
      role: data.body.role,
      firstName: data.body.firstName === undefined ? undefined : data.body.firstName || null,
      lastName: data.body.lastName === undefined ? undefined : data.body.lastName || null,
      organizationName: data.body.organizationName === undefined ? undefined : data.body.organizationName || null,
      jobTitle: data.body.jobTitle === undefined ? undefined : data.body.jobTitle || null,
      biography: data.body.biography === undefined ? undefined : data.body.biography || null,
      links: data.body.links,
    },
  });

  return json(successResponseSchema.parse({ success: true }));
}

export async function onRequestDelete(
  c: any,
  data: ValidatedData<typeof proposalAccessSpeakerDeleteRouteSchema>,
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

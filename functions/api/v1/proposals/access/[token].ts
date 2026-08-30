import type { ValidatedData } from "chanfana";
import {
  proposalAccessPatchResponseSchema,
  proposalAccessReadResponseSchema,
} from "../../../../../assets/shared/schemas/proposal-management";
import {
  proposalAccessPatchRouteSchema,
  proposalAccessReadRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../_lib/request";
import { loadProposalAccessView, saveProposalAccessChanges } from "../../../../_lib/services/proposal-self-service";

type ProposalAccessContext = AdminContext<{ token: string }>;

function markProposalAccessSensitive(c: ProposalAccessContext): void {
  c.set?.("sensitive", true);
}

export async function onRequestGet(
  c: ProposalAccessContext,
  data: ValidatedData<typeof proposalAccessReadRouteSchema>,
): Promise<Response> {
  const result = await loadProposalAccessView(c.env.DB, {
    token: data.params.token,
    signingSecret: requireInternalSecret(c.env),
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json(proposalAccessReadResponseSchema.parse(result));
}

export async function onRequestPatch(
  c: ProposalAccessContext,
  data: ValidatedData<typeof proposalAccessPatchRouteSchema>,
): Promise<Response> {
  const result = await saveProposalAccessChanges(c.env.DB, {
    token: data.params.token,
    signingSecret: requireInternalSecret(c.env),
    body: data.body,
  });
  return json(proposalAccessPatchResponseSchema.parse(result));
}

export const ProposalAccessGet = openApiRoute(proposalAccessReadRouteSchema, onRequestGet, markProposalAccessSensitive);
export const ProposalAccessPatch = openApiRoute(
  proposalAccessPatchRouteSchema,
  onRequestPatch,
  markProposalAccessSensitive,
);

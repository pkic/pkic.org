import type { ValidatedData } from "chanfana";
import {
  proposalManageReadResponseSchema,
  proposalManageUpdateResponseSchema,
} from "../../../../../assets/shared/schemas/proposal-management";
import {
  proposalManageReadRouteSchema,
  proposalManageUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../_lib/request";
import { loadProposalManageView, saveProposalManageChanges } from "../../../../_lib/services/proposal-self-service";

type ProposalManageContext = AdminContext<{ token: string }>;

function markProposalManageSensitive(c: ProposalManageContext): void {
  c.set?.("sensitive", true);
}

export async function onRequestGet(
  c: ProposalManageContext,
  data: ValidatedData<typeof proposalManageReadRouteSchema>,
): Promise<Response> {
  const result = await loadProposalManageView(c.env.DB, {
    token: data.params.token,
    signingSecret: requireInternalSecret(c.env),
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json(proposalManageReadResponseSchema.parse(result));
}

export async function onRequestPatch(
  c: ProposalManageContext,
  data: ValidatedData<typeof proposalManageUpdateRouteSchema>,
): Promise<Response> {
  const result = await saveProposalManageChanges(c.env.DB, {
    token: data.params.token,
    signingSecret: requireInternalSecret(c.env),
    body: data.body,
  });
  return json(proposalManageUpdateResponseSchema.parse(result));
}

export const ProposalsManageTokenGet = openApiRoute(
  proposalManageReadRouteSchema,
  onRequestGet,
  markProposalManageSensitive,
);
export const ProposalsManageTokenPatch = openApiRoute(
  proposalManageUpdateRouteSchema,
  onRequestPatch,
  markProposalManageSensitive,
);

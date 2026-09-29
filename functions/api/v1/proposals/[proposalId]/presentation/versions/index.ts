import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import {
  listProposalPresentationVersions,
  publicPresentationVersion,
} from "../../../../../../_lib/services/presentation-versions";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import type { ValidatedData } from "chanfana";
import { proposalPresentationVersionsListRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";

export async function onRequestGet(
  c: AdminContext,
  data: ValidatedData<typeof proposalPresentationVersionsListRouteSchema>,
): Promise<Response> {
  const actor = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const result = await listProposalPresentationVersions(
    requestDb(c),
    data.params.proposalId,
    {
      q: data.query.q,
      sort: data.query.sort,
      limit: data.query.limit,
      offset: data.query.offset,
    },
    { actor, permission: "proposals:read" },
  );
  return json({ ...result, versions: result.versions.map(publicPresentationVersion) });
}

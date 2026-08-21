import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { listProposalPresentationVersions } from "../../../../../../../_lib/services/presentation-versions";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import type { ValidatedData } from "chanfana";
import { adminPresentationVersionsListRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";

export async function onRequestGet(
  c: AdminContext,
  data: ValidatedData<typeof adminPresentationVersionsListRouteSchema>,
): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(
    await listProposalPresentationVersions(requestDb(c), data.params.proposalId, {
      q: data.query.q,
      sort: data.query.sort,
      limit: data.query.limit,
      offset: data.query.offset,
    }),
  );
}

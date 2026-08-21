import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { adminProposalAuditLogRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import type { ValidatedData } from "chanfana";
import { listProposalAuditLog } from "../../../../../_lib/services/audit-log-read";

export async function onRequestGet(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalAuditLogRouteSchema>,
): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");
  return json(
    await listProposalAuditLog(requestDb(c), proposalId, {
      q: data.query.q,
      sort: data.query.sort,
      limit: data.query.limit ?? 50,
      offset: data.query.offset ?? 0,
    }),
  );
}

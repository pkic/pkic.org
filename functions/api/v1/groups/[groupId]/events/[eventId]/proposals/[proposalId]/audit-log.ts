import { groupEventProposalAuditLogRouteSchema } from "../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { requireUserBackedAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import { listProposalAuditLog } from "../../../../../../../../_lib/services/audit-log-read";
import { requireGroupEventProposalContext } from "../../../../../../../../_lib/services/proposal-group-context";

export const GroupEventProposalAuditLogList = openApiRoute(
  groupEventProposalAuditLogRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const context = await requireGroupEventProposalContext(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      "proposals:score",
      data.params.proposalId,
    );
    return json(await listProposalAuditLog(db, context.proposalId!, data.query));
  },
);

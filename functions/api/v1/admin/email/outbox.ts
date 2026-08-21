/**
 * GET /api/v1/admin/email/outbox
 *
 * Transport-only adapter for the paginated email-outbox read model. D1
 * querying, aggregate counts, and preview-subject enrichment live in the
 * focused admin-email-outbox service modules.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { json } from "../../../../_lib/http";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { listAdminEmailOutbox } from "../../../../_lib/services/admin-email-outbox";
import { adminEmailOutboxGetRouteSchema } from "../../../../../assets/shared/schemas/route-contracts";

export const AdminEmailOutboxGet = openApiRoute(adminEmailOutboxGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  const { status, messageType, dueNow = false, q, sort, limit = 50, offset = 0 } = data.query;
  return json(await listAdminEmailOutbox(db, { status, messageType, dueNow, q, sort, limit, offset }));
});

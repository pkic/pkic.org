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
import { adminEmailOutboxResponseSchema } from "../../../../../assets/shared/schemas/admin-email-outbox";
import { adminEmailOutboxGetRouteSchema } from "../../../../../assets/shared/schemas/route-contracts";

export const AdminEmailOutboxGet = openApiRoute(adminEmailOutboxGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(adminEmailOutboxResponseSchema.parse(await listAdminEmailOutbox(db, data.query)));
});

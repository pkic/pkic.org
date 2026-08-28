/**
 * GET /api/v1/email/outbox
 *
 * Transport-only adapter for the paginated email-outbox read model. D1
 * querying, aggregate counts, and preview-subject enrichment live in the
 * focused email-outbox service modules.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import type { AdminContext } from "../../../../_lib/db/context";
import { listEmailOutbox } from "../../../../_lib/services/email-outbox";
import { emailOutboxResponseSchema, emailOutboxQuerySchema } from "../../../../../assets/shared/schemas/email-outbox";
import { requireSystemPermission } from "../../system/authorization";

const emailOutboxGetRouteSchema = {
  tags: ["Email"],
  "x-pkic-auth": { required: true, scopes: ["email:read"] },
  summary: "List email outbox messages",
  request: { query: emailOutboxQuerySchema },
  responses: {
    "200": {
      description: "Paginated email outbox rows.",
      content: { "application/json": { schema: emailOutboxResponseSchema } },
    },
    "401": { description: "Staff session required." },
    "403": { description: "email:read permission required." },
  },
};

export const EmailOutboxGet = openApiRoute(emailOutboxGetRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireSystemPermission(c, "email:read");
  return json(emailOutboxResponseSchema.parse(await listEmailOutbox(db, data.query)));
});

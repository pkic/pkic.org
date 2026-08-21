/**
 * POST /api/v1/admin/organizations/:id/confirm-secondary-contact.
 * Confirms a nomination the primary contact submitted via
 * PATCH /api/v1/me/organization/secondary-contact.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { confirmSecondaryContact } from "../../../../../_lib/services/admin-organizations";
import { confirmSecondaryContactRouteSchema } from "../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const OrganizationConfirmSecondaryContactPost = openApiRoute(
  confirmSecondaryContactRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "organizations:write");

    const id = data.params.id;
    const result = await confirmSecondaryContact(db, admin.id, id);
    if (result.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    }

    const { outboxId: _outboxId, ...response } = result;
    return json(response);
  },
);

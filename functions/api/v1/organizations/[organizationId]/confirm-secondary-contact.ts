import { organizationSecondaryContactConfirmationRouteSchema } from "../../../../../assets/shared/schemas/organization-management";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { confirmSecondaryContact } from "../../../../_lib/services/organization-management";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireOrganizationStaffPermission } from "../authorization";

export const OrganizationSecondaryContactConfirm = openApiRoute(
  organizationSecondaryContactConfirmationRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireOrganizationStaffPermission(c, "organizations:write");
    const result = await confirmSecondaryContact(db, staff, data.params.organizationId);
    if (result.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    }
    const { outboxId: _outboxId, ...response } = result;
    return json(response);
  },
);

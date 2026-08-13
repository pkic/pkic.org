/**
 * POST /api/v1/admin/organizations/:id/confirm-secondary-contact.
 * Confirms a nomination the primary contact submitted via
 * PATCH /api/v1/me/organization/secondary-contact.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { first } from "../../../../../_lib/db/queries";
import { confirmSecondaryContact } from "../../../../../_lib/services/admin-organizations";
import { writeAuditLog } from "../../../../../_lib/services/audit";
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
    const result = await confirmSecondaryContact(db, id);

    const contact = await first<{ email: string; first_name: string | null; last_name: string | null }>(
      db,
      "SELECT email, first_name, last_name FROM users WHERE id = ?",
      [result.secondaryContactUserId],
    );
    if (contact) {
      const outboxId = await queueEmail(db, {
        templateKey: "org-contact-assigned",
        recipientEmail: contact.email,
        messageType: "transactional",
        subject: "You have been designated an organization contact",
        data: {
          memberName: [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email,
          contactRole: "secondary",
        },
      });
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
    }

    await writeAuditLog(db, "admin", admin.id, "organization_secondary_contact_confirmed", "organization", id, {
      secondaryContactUserId: result.secondaryContactUserId,
    });

    return json(result);
  },
);

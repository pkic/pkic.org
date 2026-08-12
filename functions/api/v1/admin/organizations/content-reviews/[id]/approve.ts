/**
 * POST /api/v1/admin/organizations/content-reviews/:id/approve.
 * Applies the proposed changes to the live organization row, promotes any
 * staged logo, and emails the submitter (org-content-approved).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { queueEmail, processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { approveContentReview } from "../../../../../../_lib/services/organization-content-reviews";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { contentReviewApproveRouteSchema } from "../../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "organizations:content-review");

  const id = c.req.param("id");
  const result = await approveContentReview(db, id, admin);

  if (result.promotedLogoR2Key && result.previousLiveLogoR2Key && c.env.ASSETS_BUCKET) {
    c.executionCtx.waitUntil(
      (c.env.ASSETS_BUCKET as unknown as { delete(key: string): Promise<void> })
        .delete(result.previousLiveLogoR2Key)
        .catch(() => {}),
    );
  }

  const outboxId = await queueEmail(db, {
    templateKey: "org-content-approved",
    recipientEmail: result.submitterEmail,
    messageType: "transactional",
    subject: "Your organization profile update was approved",
    data: { contactName: result.submitterName, organizationName: result.organizationName },
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));

  await writeAuditLog(
    db,
    "admin",
    admin.id,
    "organization_content_review_approved",
    "organization",
    result.organizationId,
    {
      reviewId: id,
    },
  );

  return json({ review: result.review });
}

export class OrganizationContentReviewApprovePost extends OpenAPIRoute {
  schema = contentReviewApproveRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

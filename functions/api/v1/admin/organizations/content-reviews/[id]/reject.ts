/**
 * POST /api/v1/admin/organizations/content-reviews/:id/reject — PRD §4.11.
 * Leaves the live organization row untouched; emails the submitter
 * (org-content-rejected) with the reviewer's reason.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../../_lib/validation";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { queueEmail, processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { rejectContentReview } from "../../../../../../_lib/services/organization-content-reviews";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import {
  contentReviewRejectRouteSchema,
  contentReviewRejectSchema,
} from "../../../../../../../assets/shared/schemas/admin-organizations";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "organizations:content-review");

  const id = c.req.param("id");
  const body = await parseJsonBody(c.req, contentReviewRejectSchema);
  const result = await rejectContentReview(db, id, admin, body.reviewerNote);

  if (result.staleLogoStagingR2Key && c.env.ASSETS_BUCKET) {
    c.executionCtx.waitUntil(
      (c.env.ASSETS_BUCKET as unknown as { delete(key: string): Promise<void> })
        .delete(result.staleLogoStagingR2Key)
        .catch(() => {}),
    );
  }

  const outboxId = await queueEmail(db, {
    templateKey: "org-content-rejected",
    recipientEmail: result.submitterEmail,
    messageType: "transactional",
    subject: "Your organization profile update was not approved",
    data: { contactName: result.submitterName, organizationName: result.organizationName, reviewerNote: body.reviewerNote },
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));

  await writeAuditLog(db, "admin", admin.id, "organization_content_review_rejected", "organization_content_review", id, {
    reviewerNote: body.reviewerNote,
  });

  return json({ review: result.review });
}

export class OrganizationContentReviewRejectPost extends OpenAPIRoute {
  schema = contentReviewRejectRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

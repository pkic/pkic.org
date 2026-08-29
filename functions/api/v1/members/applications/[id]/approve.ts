/**
 * POST /api/v1/members/applications/:id/approve. Runs the full onboarding
 * orchestration (membership/applications/approve.ts's approveApplication),
 * which commits membership provisioning, the application stage transition,
 * Google Groups enqueues, the three applicant-facing email-outbox inserts
 * (member-account-claim, application-approved-welcome, and — only when a
 * new organization contact was just designated — org-contact-assigned),
 * and the audit-log insert all in one atomic `db.batch()` (PR #1 review
 * phase1-2-review-20260817.md blocker 4). This route only resolves the
 * login URL (needs `env`, which the service layer doesn't have) and kicks
 * off background delivery of the emails the service already queued.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { getConfig } from "../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { approveApplication } from "../../../../../_lib/services/membership/applications/approve";
import {
  applicationApproveResponseSchema,
  applicationApproveRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-application-management";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const ApplicationApprovePost = openApiRoute(applicationApproveRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "membership:approve");

  const applicationId = data.params.id;
  const config = getConfig(c.env, c.req.raw);
  const loginUrl = `${config.appBaseUrl}/portal/`;

  const result = await approveApplication(db, {
    applicationId,
    actor: staff,
    approvalMode: "staff_override",
    loginUrl,
    sendOrgContactAssignedEmail: true,
  });

  for (const outboxId of result.outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  return json(
    applicationApproveResponseSchema.parse({
      applicationId: result.applicationId,
      memberId: result.memberId,
      userId: result.userId,
      organizationId: result.organizationId,
      workingGroupSlugs: result.workingGroupSlugs,
    }),
  );
});

/**
 * POST /api/v1/admin/applications/:id/approve — PRD §4.7. Runs the full
 * onboarding orchestration (membership-onboarding.ts) and queues the three
 * applicant-facing emails: member-account-claim, application-approved-
 * welcome, and (only when a new organization contact was just designated)
 * org-contact-assigned.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getConfig } from "../../../../../_lib/config";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { approveApplication } from "../../../../../_lib/services/membership-onboarding";
import { resolveApprovalIcsAttachments } from "../../../../../_lib/services/meeting-calendar";
import { applicationApproveRouteSchema } from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:approve");

  const applicationId = c.req.param("id");
  const result = await approveApplication(db, { applicationId, actorUserId: admin.id });

  const config = getConfig(c.env, c.req.raw);
  const loginUrl = `${config.appBaseUrl}/portal/`;

  const claimOutboxId = await queueEmail(db, {
    templateKey: "member-account-claim",
    recipientEmail: result.email,
    messageType: "transactional",
    subject: "Set up your PKI Consortium member account",
    data: { memberName: result.name, loginUrl },
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, claimOutboxId));

  const icsAttachments = await resolveApprovalIcsAttachments(db, result.workingGroupSlugs);
  const welcomeOutboxId = await queueEmail(db, {
    templateKey: "application-approved-welcome",
    recipientEmail: result.email,
    messageType: "transactional",
    subject: "Welcome to the PKI Consortium!",
    data: { applicantName: result.name, loginUrl, workingGroups: result.workingGroupNames.join(", ") },
    attachments: icsAttachments,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, welcomeOutboxId));

  if (result.assignedContactRole) {
    const contactOutboxId = await queueEmail(db, {
      templateKey: "org-contact-assigned",
      recipientEmail: result.email,
      messageType: "transactional",
      subject: "You have been designated an organization contact",
      data: { memberName: result.name, contactRole: result.assignedContactRole },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, contactOutboxId));
  }

  await writeAuditLog(db, "admin", admin.id, "application_approved", "member_application", applicationId, {
    memberId: result.memberId,
    organizationId: result.organizationId,
  });

  return json({
    applicationId: result.applicationId,
    memberId: result.memberId,
    userId: result.userId,
    organizationId: result.organizationId,
    workingGroupSlugs: result.workingGroupSlugs,
  });
}

export class ApplicationApprovePost extends OpenAPIRoute {
  schema = applicationApproveRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

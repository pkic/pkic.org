/**
 * POST /api/v1/admin/applications/:id/communications.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import {
  addApplicationCommunication,
  getMemberApplicationById,
} from "../../../../../_lib/services/member-applications";
import { AppError } from "../../../../../_lib/errors";
import { applicationCommunicationCreateRouteSchema } from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const ApplicationCommunicationsPost = openApiRoute(
  applicationCommunicationCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "membership:write");

    const applicationId = data.params.id;
    const application = await getMemberApplicationById(db, applicationId);
    if (!application) {
      throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
    }

    const body = data.body;

    const outboxId = await queueEmail(db, {
      templateKey: body.templateKey ?? "application-hold-information",
      recipientEmail: application.applicant_email,
      messageType: "transactional",
      subject: body.subject,
      data: { applicantName: application.applicant_name, requestDetails: body.body },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));

    const communication = await addApplicationCommunication(db, {
      applicationId,
      actorUserId: admin.id,
      subject: body.subject,
      body: body.body,
      templateKey: body.templateKey ?? null,
      emailOutboxId: outboxId,
    });

    await writeAuditLog(db, "admin", admin.id, "application_communication_sent", "member_application", applicationId, {
      subject: body.subject,
    });

    return json({ id: communication.id, createdAt: communication.created_at }, 201);
  },
);

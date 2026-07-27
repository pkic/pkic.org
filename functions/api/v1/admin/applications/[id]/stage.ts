/**
 * PATCH /api/v1/admin/applications/:id/stage — stage transition (PRD §4.2).
 *
 * Queues the matching applicant-facing email per §4.4 when
 * transitionApplicationStage reports one; the service layer only does the
 * DB write (see member-applications.ts's own note on this split).
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getConfig } from "../../../../../_lib/config";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { getMembershipSettings } from "../../../../../_lib/services/membership-settings";
import { transitionApplicationStage } from "../../../../../_lib/services/member-applications";
import {
  applicationStageTransitionRouteSchema,
  applicationStageTransitionSchema,
} from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const body = await parseJsonBody(c.req, applicationStageTransitionSchema);
  const applicationId = c.req.param("id");

  const result = await transitionApplicationStage(db, {
    applicationId,
    toStage: body.toStage,
    actorUserId: admin.id,
    onHoldSubtype: body.onHoldSubtype ?? null,
    note: body.note ?? null,
  });

  if (result.suggestedEmailTemplateKey) {
    const config = getConfig(c.env, c.req.raw);
    const settings = await getMembershipSettings(db);
    // No token here (only its hash is stored) — links to the manual ID/token
    // entry fallback the application-status page already supports (see
    // "Phase 1 — Hugo Frontend Follow-Up" §A decision 1 in prd.md).
    const statusUrl = `${config.appBaseUrl}/application-status/?id=${result.application.id}`;
    const outboxId = await queueEmail(db, {
      templateKey: result.suggestedEmailTemplateKey,
      recipientEmail: result.application.applicant_email,
      messageType: "transactional",
      subject: "Update on your PKI Consortium membership application",
      data: {
        applicantName: result.application.applicant_name,
        statusUrl,
        deadlineDays: settings.on_hold_response_deadline_days,
        consultationWindowDays: settings.consultation_window_days,
        requestDetails: body.note ?? "",
        reason: body.note ?? "",
      },
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  await writeAuditLog(db, "admin", admin.id, "application_stage_transitioned", "member_application", applicationId, {
    fromStage: result.fromStage,
    toStage: result.toStage,
    onHoldSubtype: body.onHoldSubtype ?? null,
  });

  return json({
    id: result.application.id,
    status: result.application.status,
    stage: result.application.stage,
    onHoldSubtype: result.application.on_hold_subtype,
  });
}

export class ApplicationStagePatch extends OpenAPIRoute {
  schema = applicationStageTransitionRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}

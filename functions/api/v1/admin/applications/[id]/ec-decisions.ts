/**
 * POST /api/v1/admin/applications/:id/ec-decisions — staff override fallback
 * for recording an EC member's decision.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { recordEcDecision } from "../../../../../_lib/services/ec-review";
import {
  adminEcDecisionCreateRouteSchema,
  adminEcDecisionCreateSchema,
} from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:approve");

  const applicationId = c.req.param("id");
  const body = await parseJsonBody(c.req, adminEcDecisionCreateSchema);

  const decision = await recordEcDecision(db, {
    applicationId,
    ecMemberUserId: body.ecMemberUserId,
    decision: body.decision,
    reason: body.reason ?? null,
  });

  await writeAuditLog(db, "admin", admin.id, "ec_decision_recorded_by_staff", "member_application", applicationId, {
    ecMemberUserId: body.ecMemberUserId,
    decision: body.decision,
    reason: body.reason ?? null,
  });

  return json(
    {
      id: decision.id,
      applicationId,
      decision: decision.decision,
      reason: decision.reason,
      createdAt: decision.created_at,
    },
    201,
  );
}

export class AdminApplicationEcDecisionsPost extends OpenAPIRoute {
  schema = adminEcDecisionCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

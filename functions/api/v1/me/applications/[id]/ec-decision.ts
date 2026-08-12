/**
 * POST /api/v1/me/applications/:id/ec-decision. The real EC
 * member portal voting path (as opposed to the staff-admin override at
 * POST /api/v1/admin/applications/:id/ec-decisions). Requires a member
 * session and `is_ec_member`.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { recordEcDecision } from "../../../../../_lib/services/ec-review";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { ecDecisionCreateRouteSchema, ecDecisionCreateSchema } from "../../../../../../assets/shared/schemas/ec-review";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  if (!member.isEcMember) {
    throw new AppError(403, "PERMISSION_REQUIRED", "Only Executive Council members may record an EC decision");
  }

  const applicationId = c.req.param("id");
  const body = await parseJsonBody(c.req, ecDecisionCreateSchema);

  const decision = await recordEcDecision(db, {
    applicationId,
    ecMemberUserId: member.userId,
    decision: body.decision,
    reason: body.reason ?? null,
  });

  await writeAuditLog(db, "member", member.userId, "ec_decision_recorded", "member_application", applicationId, {
    decision: body.decision,
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

export class MeApplicationEcDecisionPost extends OpenAPIRoute {
  schema = ecDecisionCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

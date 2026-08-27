/**
 * POST /api/v1/me/applications/:id/ec-decision. The real EC
 * member portal voting path (as opposed to the staff-admin override at
 * POST /api/v1/system/membership-applications/:id/ec-decisions). Requires a member
 * session and `is_ec_member`.
 */
import { json } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { recordEcDecision } from "../../../../../_lib/services/ec-review";
import { ecDecisionCreateRouteSchema } from "../../../../../../assets/shared/schemas/ec-review";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const MeApplicationEcDecisionPost = openApiRoute(ecDecisionCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  if (!member.isEcMember) {
    throw new AppError(403, "PERMISSION_REQUIRED", "Only Executive Council members may record an EC decision");
  }

  const applicationId = data.params.id;
  const body = data.body;

  const decision = await recordEcDecision(db, {
    applicationId,
    ecMemberUserId: member.userId,
    decision: body.decision,
    reason: body.reason ?? null,
    audit: { actorType: "member", actorId: member.userId, action: "ec_decision_recorded" },
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
});

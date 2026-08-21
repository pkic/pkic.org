/**
 * POST /api/v1/admin/applications/:id/ec-decisions — staff override fallback
 * for recording an EC member's decision.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { recordEcDecision } from "../../../../../_lib/services/ec-review";
import { adminEcDecisionCreateRouteSchema } from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminApplicationEcDecisionsPost = openApiRoute(
  adminEcDecisionCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "membership:approve");

    const applicationId = data.params.id;
    const body = data.body;

    const decision = await recordEcDecision(db, {
      applicationId,
      ecMemberUserId: body.ecMemberUserId,
      decision: body.decision,
      reason: body.reason ?? null,
      audit: { actorType: "admin", actorId: admin.id, action: "ec_decision_recorded_by_staff" },
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
  },
);

/**
 * POST /api/v1/members/applications/:id/ec-decisions — staff override fallback
 * for recording an EC member's decision.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { recordEcDecision } from "../../../../../_lib/services/ec-review";
import {
  staffEcDecisionCreateResponseSchema,
  staffEcDecisionCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-application-management";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const MembershipApplicationEcDecisionsPost = openApiRoute(
  staffEcDecisionCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, staff } = await requireStaffPermission(c, "membership:approve");

    const applicationId = data.params.id;
    const body = data.body;

    const decision = await recordEcDecision(db, {
      applicationId,
      ecMemberUserId: body.ecMemberUserId,
      decision: body.decision,
      reason: body.reason ?? null,
      audit: { actorType: "admin", actorId: staff.id, action: "ec_decision_recorded_by_staff" },
    });

    const payload = staffEcDecisionCreateResponseSchema.parse({
      id: decision.id,
      applicationId,
      ecMemberUserId: decision.ec_member_user_id,
      decision: decision.decision,
      reason: decision.reason,
      createdAt: decision.created_at,
    });
    return json(payload, 201);
  },
);

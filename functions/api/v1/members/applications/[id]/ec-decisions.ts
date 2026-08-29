import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { recordEcDecision } from "../../../../../_lib/services/ec-review";
import {
  ecDecisionRecordResponseSchema,
  ecDecisionRecordRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-application-management";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { resolveUserSessionFromRequest } from "../../../../../_lib/auth/user-session";
import { requirePermission, guardPermissionMutationDatabase } from "../../../../../_lib/auth/permissions";
import { guardMemberSessionMutationDatabase } from "../../../../../_lib/auth/member";
import type { DatabaseLike } from "../../../../../_lib/types";

export const MembershipApplicationEcDecisionsPost = openApiRoute(
  ecDecisionRecordRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const session = await resolveUserSessionFromRequest(db, c.req.raw, c.env);
    const overriddenEcMemberUserId = data.body.ecMemberUserId;
    let decisionDb: DatabaseLike;
    let ecMemberUserId: string;
    let audit: { actorType: "admin" | "member"; actorId: string; action: string };

    if (overriddenEcMemberUserId) {
      if (!session.staff) {
        throw new AppError(403, "PERMISSION_REQUIRED", "membership:approve permission required for an override");
      }
      requirePermission(session.staff, "membership:approve");
      decisionDb = guardPermissionMutationDatabase(
        db,
        session.staff,
        [{ permission: "membership:approve" }],
        () => new AppError(409, "EC_AUTHORIZATION_CHANGED", "EC decision authorization changed before commit"),
      );
      ecMemberUserId = overriddenEcMemberUserId;
      audit = { actorType: "admin", actorId: session.staff.id, action: "ec_decision_recorded_by_staff" };
    } else {
      if (!session.member?.isEcMember) {
        throw new AppError(403, "PERMISSION_REQUIRED", "Only Executive Council members may record a decision");
      }
      decisionDb = guardMemberSessionMutationDatabase(db, session.member);
      ecMemberUserId = session.member.userId;
      audit = { actorType: "member", actorId: session.member.userId, action: "ec_decision_recorded" };
    }

    const applicationId = data.params.id;
    const body = data.body;

    const decision = await recordEcDecision(decisionDb, {
      applicationId,
      ecMemberUserId,
      decision: body.decision,
      reason: body.reason ?? null,
      audit,
    });

    const payload = ecDecisionRecordResponseSchema.parse({
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

import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { membershipWorkflowReviewersRouteSchema } from "../../../../../../assets/shared/schemas/membership-review-routes";
import { listMembershipReviewers } from "../../../../../_lib/services/membership/workflows/review-read";
import { membershipWorkflowActionResponseSchema } from "../../../../../../assets/shared/schemas/membership-review-routes";
import {
  membershipWorkflowReviewRouteSchema,
  membershipWorkflowObjectionsRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-review-routes";
import {
  getMembershipReview,
  listMembershipObjections,
} from "../../../../../_lib/services/membership/workflows/review-read";
import {
  membershipStaffReviewRouteSchema,
  membershipObjectionCreateRouteSchema,
  membershipObjectionResolveRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-review-routes";
import { resolveUserSessionFromRequest } from "../../../../../_lib/auth/user-session";
import { getConfig } from "../../../../../_lib/config";
import { requestDb, markResponseSensitive, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { completeMembershipStaffReview } from "../../../../../_lib/services/membership/workflows/review-actions";
import {
  recordMembershipObjection,
  resolveMembershipObjection,
} from "../../../../../_lib/services/membership/workflows/objections";

async function reviewContext(c: AdminContext) {
  markResponseSensitive(c);
  const db = requestDb(c);
  const session = await resolveUserSessionFromRequest(db, c.req.raw, c.env);
  return {
    db,
    actor: { userId: session.identity.id, staff: session.staff },
    appBaseUrl: getConfig(c.env, c.req.raw).appBaseUrl,
  };
}
export const MembershipStaffReviewComplete = openApiRoute(
  membershipStaffReviewRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor, appBaseUrl } = await reviewContext(c);
    const result = await completeMembershipStaffReview(db, data.params.id, actor, data.body, appBaseUrl);
    return reviewActionResponse(c, db, result);
  },
);
export const MembershipObjectionCreate = openApiRoute(
  membershipObjectionCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor, appBaseUrl } = await reviewContext(c);
    return json(await recordMembershipObjection(db, data.params.id, actor, data.body, appBaseUrl));
  },
);
export const MembershipObjectionResolve = openApiRoute(
  membershipObjectionResolveRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor, appBaseUrl } = await reviewContext(c);
    const result = await resolveMembershipObjection(
      db,
      data.params.id,
      data.params.objectionId,
      actor,
      data.body,
      appBaseUrl,
    );
    return reviewActionResponse(c, db, result);
  },
);

export const MembershipWorkflowReviewGet = openApiRoute(
  membershipWorkflowReviewRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor } = await reviewContext(c);
    return json(await getMembershipReview(db, data.params.id, actor));
  },
);
export const MembershipWorkflowObjectionsGet = openApiRoute(
  membershipWorkflowObjectionsRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor } = await reviewContext(c);
    return json(await listMembershipObjections(db, data.params.id, actor, data.query));
  },
);

export const MembershipWorkflowReviewersGet = openApiRoute(
  membershipWorkflowReviewersRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor } = await reviewContext(c);
    return json(await listMembershipReviewers(db, data.params.id, actor, data.query));
  },
);

function reviewActionResponse(
  c: AdminContext,
  db: ReturnType<typeof requestDb>,
  result: Awaited<ReturnType<typeof completeMembershipStaffReview>>,
) {
  for (const outboxId of result.outboxIds) c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  return json(membershipWorkflowActionResponseSchema.parse(result));
}

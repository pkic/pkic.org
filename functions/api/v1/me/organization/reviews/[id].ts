/**
 * DELETE /api/v1/me/organization/reviews/:id — withdraw a pending
 * organization content submission. Withdrawal sets
 * status='withdrawn'; the submission is not deleted.
 */
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { withdrawMyOrganizationReview } from "../../../../../_lib/services/organization-content";
import { myOrganizationReviewWithdrawRouteSchema } from "../../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { processStorageDeletionForKey } from "../../../../../_lib/services/storage-deletion-outbox";

export const MeOrganizationReviewDelete = openApiRoute(
  myOrganizationReviewWithdrawRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const id = data.params.id;
    const result = await withdrawMyOrganizationReview(db, member, id);

    if (result.staleLogoStagingR2Key) {
      c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, result.staleLogoStagingR2Key, "assets"));
    }

    return json({ success: true });
  },
);

import { organizationContentReviewWithdrawRouteSchema } from "../../../../../../assets/shared/schemas/organization-self-service";
import type { AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { withdrawMyOrganizationReview } from "../../../../../_lib/services/organization-content";
import { processStorageDeletionForKey } from "../../../../../_lib/services/storage-deletion-outbox";
import { requireOrganizationMemberMutation } from "../../authorization";

export const OrganizationContentReviewDelete = openApiRoute(
  organizationContentReviewWithdrawRouteSchema,
  async (c: AdminContext, data) => {
    const { db, member } = await requireOrganizationMemberMutation(c, data.params.organizationId);
    const result = await withdrawMyOrganizationReview(db, member, data.params.reviewId);
    if (result.staleLogoStagingR2Key) {
      c.executionCtx.waitUntil(processStorageDeletionForKey(db, c.env, result.staleLogoStagingR2Key, "assets"));
    }
    return json({ success: true });
  },
);

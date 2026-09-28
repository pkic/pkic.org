import { eventEmailCampaignStageResponseSchema } from "../../../../../assets/shared/schemas/event-email-campaigns";
import { eventEmailCampaignStageRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-event-email-campaigns";
import { requirePermission, guardPermissionMutationDatabase } from "../../../../_lib/auth/permissions";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  dispatchEventEmailCampaignPage,
  remainingEventEmailCampaignRecipients,
} from "../../../../_lib/services/event-email-campaign/dispatch";

export const EventEmailCampaignStagePost = openApiRoute(eventEmailCampaignStageRouteSchema, async (c: AdminContext) => {
  const { db, staff } = await requireStaffPermission(c, "email:read");
  requirePermission(staff, "email:manage");
  const authorizedDb = guardPermissionMutationDatabase(
    db,
    staff,
    [{ permission: "email:read" }, { permission: "email:manage" }],
    () => new AppError(409, "EMAIL_CAMPAIGN_ACCESS_CHANGED", "Email management permission changed"),
  );
  const page = await dispatchEventEmailCampaignPage(authorizedDb, undefined, staff.id);
  return json(
    eventEmailCampaignStageResponseSchema.parse({
      success: true,
      processedRecipients: page.processed,
      stagedRecipients: page.queued,
      remainingRecipients: await remainingEventEmailCampaignRecipients(db),
    }),
  );
});

import {
  promotionBatchesCreateRouteSchema,
  promotionBatchGetRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import {
  createPromotionBatch,
  preparePromotionBatchRead,
} from "../../../../../_lib/services/event-agenda/promotion-batches";
import { readEventAdminResource } from "../../../../../_lib/services/events/authorized-context";
import { guardPermissionDatabase } from "../../../../../_lib/auth/permissions";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { AppError } from "../../../../../_lib/errors";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { requireEventPermission } from "../authorization";
export const PromotionBatchesCreate = openApiRoute(promotionBatchesCreateRouteSchema, async (c, data) => {
  const { db, event, actor, context } = await requireEventPermission(c, data.params.eventSlug, "agenda:write");
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "agenda:write", context }],
    () =>
      new AppError(
        409,
        "PROMOTION_BATCH_CHANGED",
        "Your agenda access or the published agenda changed. Refresh before preparing kits.",
      ),
  );
  return json(await createPromotionBatch(guarded, event.id, actor.id, resolveAppBaseUrl(c.env, c.req.raw), data.body));
});
export const PromotionBatchGet = openApiRoute(promotionBatchGetRouteSchema, async (c, data) =>
  json(
    await readEventAdminResource(requestDb(c), c.req.raw, c.env, data.params.eventSlug, "agenda:write", (event) =>
      preparePromotionBatchRead(requestDb(c), event, data.params.batchId),
    ),
  ),
);

import {
  promotionBatchesCreateRouteSchema,
  promotionBatchGetRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import {
  createPromotionBatch,
  preparePromotionBatchRead,
} from "../../../../../_lib/services/event-agenda/promotion-batches";
import { readEventAdminResource } from "../../../../../_lib/services/events/authorized-context";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
export const PromotionBatchesCreate = openApiRoute(promotionBatchesCreateRouteSchema, async (c, data) =>
  json(
    await createPromotionBatch(
      requestDb(c),
      c.req.raw,
      c.env,
      data.params.eventSlug,
      resolveAppBaseUrl(c.env, c.req.raw),
      data.body,
    ),
  ),
);

export const PromotionBatchGet = openApiRoute(promotionBatchGetRouteSchema, async (c, data) =>
  json(
    await readEventAdminResource(requestDb(c), c.req.raw, c.env, data.params.eventSlug, "agenda:write", (event) =>
      preparePromotionBatchRead(requestDb(c), event, data.params.batchId),
    ),
  ),
);

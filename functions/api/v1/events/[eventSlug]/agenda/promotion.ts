import { downloadOwnPromotionArtifact } from "../../../../../_lib/services/event-agenda/promotion-artifact-download";
import { queueOwnPromotionRenders } from "../../../../../_lib/services/event-agenda/promotion-render-command";
import { readOwnPromotionSessions } from "../../../../../_lib/services/event-agenda/promotion-session-list";
import { saveOwnPromotionComposition } from "../../../../../_lib/services/event-agenda/promotion-composition-command";
import {
  promotionKitInitializeRouteSchema,
  eventPromotionInitializeRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import { readOwnPromotionRequest } from "../../../../../_lib/services/event-agenda/promotion-request-context";
import { eventPromotionSessionsGetRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import type { z } from "zod";
import { promotionCompositionSaveSchema } from "../../../../../../assets/shared/schemas/event-promotion-design";
import {
  eventPromotionGetRouteSchema,
  eventPromotionCompositionSaveRouteSchema,
  eventPromotionRendersCreateRouteSchema,
  eventPromotionArtifactGetRouteSchema,
  promotionCompositionSaveRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import {
  promotionKitGetRouteSchema,
  promotionRendersCreateRouteSchema,
  promotionSessionsGetRouteSchema,
  promotionCopySaveRouteSchema,
  promotionArtifactGetRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-event-promotion";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { savePromotionCopyRequest } from "../../../../../_lib/services/event-agenda/promotion-copy-command";
async function ownKit(c: AdminContext, eventSlug: string, occurrenceId: string | null) {
  return readOwnPromotionRequest(
    requestDb(c),
    c.req.raw,
    c.env,
    eventSlug,
    occurrenceId,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
}

export const PromotionKitGet = openApiRoute(promotionKitGetRouteSchema, async (c, data) =>
  json((await ownKit(c, data.params.eventSlug, data.params.occurrenceId)).kit),
);
export const PromotionCopySave = openApiRoute(promotionCopySaveRouteSchema, async (c, data) =>
  json(
    await savePromotionCopyRequest(
      requestDb(c),
      c.req.raw,
      c.env,
      data.params.eventSlug,
      data.params.occurrenceId,
      data.body.expectedRevision,
      data.body.copy,
    ),
  ),
);
export const PromotionArtifactGet = openApiRoute(promotionArtifactGetRouteSchema, async (c, data) =>
  downloadOwnPromotionArtifact(
    requestDb(c),
    c.req.raw,
    c.env,
    data.params.eventSlug,
    data.params.occurrenceId,
    resolveAppBaseUrl(c.env, c.req.raw),
    data.query,
  ),
);
export const PromotionRendersCreate = openApiRoute(promotionRendersCreateRouteSchema, async (c, data) =>
  queueOwnPromotionRenders(
    requestDb(c),
    c.req.raw,
    c.env,
    data.params.eventSlug,
    data.params.occurrenceId,
    resolveAppBaseUrl(c.env, c.req.raw),
    data.body,
  ).then(json),
);
async function saveOwn(
  c: AdminContext,
  slug: string,
  occurrenceId: string | null,
  input: z.infer<typeof promotionCompositionSaveSchema>,
) {
  const source = await saveOwnPromotionComposition(
    requestDb(c),
    c.req.raw,
    c.env,
    slug,
    occurrenceId,
    resolveAppBaseUrl(c.env, c.req.raw),
    input,
  );
  return json(source.kit);
}
export const PromotionCompositionSave = openApiRoute(promotionCompositionSaveRouteSchema, async (c, data) =>
  saveOwn(c, data.params.eventSlug, data.params.occurrenceId, data.body),
);
export const EventPromotionGet = openApiRoute(eventPromotionGetRouteSchema, async (c, data) =>
  json((await ownKit(c, data.params.eventSlug, null)).kit),
);
export const EventPromotionCompositionSave = openApiRoute(eventPromotionCompositionSaveRouteSchema, async (c, data) =>
  saveOwn(c, data.params.eventSlug, null, data.body),
);
export const EventPromotionRendersCreate = openApiRoute(eventPromotionRendersCreateRouteSchema, async (c, data) =>
  queueOwnPromotionRenders(
    requestDb(c),
    c.req.raw,
    c.env,
    data.params.eventSlug,
    null,
    resolveAppBaseUrl(c.env, c.req.raw),
    data.body,
  ).then(json),
);
export const EventPromotionArtifactGet = openApiRoute(eventPromotionArtifactGetRouteSchema, async (c, data) =>
  downloadOwnPromotionArtifact(
    requestDb(c),
    c.req.raw,
    c.env,
    data.params.eventSlug,
    null,
    resolveAppBaseUrl(c.env, c.req.raw),
    data.query,
  ),
);

export const PromotionSessionsGet = openApiRoute(promotionSessionsGetRouteSchema, async (c, data) =>
  json(await readOwnPromotionSessions(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.query)),
);
export const EventPromotionSessionsGet = openApiRoute(eventPromotionSessionsGetRouteSchema, async (c, data) =>
  json(await readOwnPromotionSessions(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.query, true)),
);

export const PromotionKitInitialize = openApiRoute(promotionKitInitializeRouteSchema, async (c, data) =>
  json(
    (
      await readOwnPromotionRequest(
        requestDb(c),
        c.req.raw,
        c.env,
        data.params.eventSlug,
        data.params.occurrenceId,
        resolveAppBaseUrl(c.env, c.req.raw),
        true,
      )
    ).kit,
  ),
);
export const EventPromotionInitialize = openApiRoute(eventPromotionInitializeRouteSchema, async (c, data) =>
  json(
    (
      await readOwnPromotionRequest(
        requestDb(c),
        c.req.raw,
        c.env,
        data.params.eventSlug,
        null,
        resolveAppBaseUrl(c.env, c.req.raw),
        true,
      )
    ).kit,
  ),
);

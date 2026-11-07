import { PromotionKitInitialize, EventPromotionInitialize } from "./agenda/promotion";
import { PromotionBatchesCreate, PromotionBatchGet } from "./agenda/promotion-batches";
import { EventPromotionSessionsGet } from "./agenda/promotion";
import {
  PromotionCompositionSave,
  EventPromotionGet,
  EventPromotionCompositionSave,
  EventPromotionRendersCreate,
  EventPromotionArtifactGet,
  EventPromotionPdfExport,
} from "./agenda/promotion";
import {
  PromotionKitGet,
  PromotionCopySave,
  PromotionArtifactGet,
  PromotionPdfExport,
  PromotionSessionsGet,
  PromotionRendersCreate,
} from "./agenda/promotion";

type PromotionRouter = Pick<typeof import("./router").openapi, "get" | "post">;

/** Register sharing resources under the event router's existing authentication and permission middleware. */
export function registerPromotionRoutes(openapi: PromotionRouter): void {
  openapi.post("/promotion/batches", PromotionBatchesCreate);
  openapi.get("/promotion/batches/:batchId", PromotionBatchGet);
  openapi.get("/promotion", EventPromotionGet);
  openapi.post("/promotion/referrals", EventPromotionInitialize);
  openapi.get("/promotion/sessions", EventPromotionSessionsGet);
  openapi.post("/promotion/composition", EventPromotionCompositionSave);
  openapi.post("/promotion/renders", EventPromotionRendersCreate);
  openapi.get("/promotion/artifact", EventPromotionArtifactGet);
  openapi.post("/promotion/artifact", EventPromotionPdfExport);
  openapi.post("/agenda/occurrences/:occurrenceId/promotion/composition", PromotionCompositionSave);
  openapi.get("/agenda/promotion", PromotionSessionsGet);
  openapi.get("/agenda/occurrences/:occurrenceId/promotion", PromotionKitGet);
  openapi.post("/agenda/occurrences/:occurrenceId/promotion/referrals", PromotionKitInitialize);
  openapi.post("/agenda/occurrences/:occurrenceId/promotion", PromotionCopySave);
  openapi.post("/agenda/occurrences/:occurrenceId/promotion/renders", PromotionRendersCreate);
  openapi.get("/agenda/occurrences/:occurrenceId/promotion/artifact", PromotionArtifactGet);
  openapi.post("/agenda/occurrences/:occurrenceId/promotion/artifact", PromotionPdfExport);
}

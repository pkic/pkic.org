import { promotionBatchCreateSchema, promotionBatchSchema } from "./event-promotion-batches";
import { z } from "zod";
import { eventSlugParamsSchema } from "./api-common";
import {
  promotionArtifactQuerySchema,
  promotionKitSchema,
  promotionKitSaveSchema,
  promotionSessionsQuerySchema,
  promotionRenderRequestSchema,
} from "./event-promotion-kit";
import { agendaSnapshotSchema, promotionSessionListSchema } from "./event-agenda";
import { authErrors, ok, requiresPermissions, requiresSession } from "./route-contract";
import { promotionCompositionSaveSchema } from "./event-promotion-design";
const params = eventSlugParamsSchema.extend({ occurrenceId: z.string().min(1) });
export const promotionKitGetRouteSchema = {
  "x-pkic-mcp": { expose: true, readonly: true },
  tags: ["Event promotion"],
  ...requiresSession(),
  summary: "Read own approved session promotion kit",
  request: { params },
  responses: {
    ...ok("Promotion kit", promotionKitSchema),
    ...authErrors({ conflict: "Copy or agenda not approved", notFound: "Session not found" }),
  },
};
export const promotionCopySaveRouteSchema = {
  "x-pkic-mcp": { expose: true },
  tags: ["Event promotion"],
  summary: "Review and approve promotion narrative",
  ...requiresPermissions("agenda:write"),
  request: { params, body: { content: { "application/json": { schema: promotionKitSaveSchema } } } },
  responses: {
    ...ok("Updated agenda", agendaSnapshotSchema),
    ...authErrors({ conflict: "Agenda revision changed", notFound: "Session not found" }),
  },
};
export const promotionArtifactGetRouteSchema = {
  ...promotionKitGetRouteSchema,
  "x-pkic-mcp": { expose: false },
  summary: "Download own current promotion artifact",
  request: { params, query: promotionArtifactQuerySchema },
  responses: {
    200: {
      description: "PNG card, complete PNG card ZIP set, or selectable-text PDF",
      content: {
        "application/pdf": { schema: z.string() },
        "image/png": { schema: z.string() },
        "application/zip": { schema: z.string() },
      },
    },
    ...authErrors({ conflict: "Artifact revision is stale", notFound: "Session not found" }),
  },
};

export const promotionSessionsGetRouteSchema = {
  ...promotionKitGetRouteSchema,
  summary: "List assigned published sessions with promotion kits",
  request: { params: eventSlugParamsSchema, query: promotionSessionsQuerySchema },
  responses: {
    ...ok("Assigned published sessions", promotionSessionListSchema),
    ...authErrors({ notFound: "Event not found" }),
  },
};

export const promotionRendersCreateRouteSchema = {
  ...promotionKitGetRouteSchema,
  "x-pkic-mcp": { expose: true },
  summary: "Queue durable versioned promotion renders",
  request: { params, body: { content: { "application/json": { schema: promotionRenderRequestSchema } } } },
};
export const promotionCompositionSaveRouteSchema = {
  ...promotionKitGetRouteSchema,
  "x-pkic-mcp": { expose: true },
  summary: "Save own promotion composition without changing the shared session",
  request: { params, body: { content: { "application/json": { schema: promotionCompositionSaveSchema } } } },
};
export const eventPromotionGetRouteSchema = {
  ...promotionKitGetRouteSchema,
  summary: "Read own attendee promotion kit",
  request: { params: eventSlugParamsSchema },
};
export const eventPromotionCompositionSaveRouteSchema = {
  ...promotionCompositionSaveRouteSchema,
  request: { ...promotionCompositionSaveRouteSchema.request, params: eventSlugParamsSchema },
};
export const eventPromotionRendersCreateRouteSchema = {
  ...promotionRendersCreateRouteSchema,
  request: { ...promotionRendersCreateRouteSchema.request, params: eventSlugParamsSchema },
};
export const eventPromotionArtifactGetRouteSchema = {
  ...promotionArtifactGetRouteSchema,
  request: { ...promotionArtifactGetRouteSchema.request, params: eventSlugParamsSchema },
};

export const eventPromotionSessionsGetRouteSchema = {
  ...promotionSessionsGetRouteSchema,
  summary: "List public sessions available for own promotion kit",
};

export const promotionBatchesCreateRouteSchema = {
  tags: ["Event promotion"],
  "x-pkic-mcp": { expose: true },
  ...requiresPermissions("agenda:write"),
  summary: "Prepare personal promotion materials for all published session speakers",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: promotionBatchCreateSchema } } },
  },
  responses: {
    ...ok("Bulk promotion progress", promotionBatchSchema),
    ...authErrors({ conflict: "Published agenda changed" }),
  },
};
export const promotionBatchGetRouteSchema = {
  tags: ["Event promotion"],
  "x-pkic-mcp": { expose: true, readonly: true },
  ...requiresPermissions("agenda:write"),
  summary: "Read bulk speaker promotion progress",
  request: { params: eventSlugParamsSchema.extend({ batchId: z.uuid() }) },
  responses: { ...ok("Bulk promotion progress", promotionBatchSchema), ...authErrors({ notFound: "Batch not found" }) },
};

export const promotionKitInitializeRouteSchema = {
  ...promotionKitGetRouteSchema,
  "x-pkic-mcp": { expose: true },
  summary: "Initialize own personal promotion link",
  request: { params, body: { content: { "application/json": { schema: z.strictObject({}) } } } },
};
export const eventPromotionInitializeRouteSchema = {
  ...promotionKitInitializeRouteSchema,
  request: { ...promotionKitInitializeRouteSchema.request, params: eventSlugParamsSchema },
};

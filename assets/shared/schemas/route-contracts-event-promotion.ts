import { z } from "zod";
import { eventSlugParamsSchema } from "./api-common";
import { promotionArtifactQuerySchema, promotionKitSchema, promotionKitSaveSchema } from "./event-promotion-kit";
import { agendaSnapshotSchema, agendaOccurrenceQuerySchema, promotionSessionListSchema } from "./event-agenda";
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
  request: { params: eventSlugParamsSchema, query: agendaOccurrenceQuerySchema },
  responses: {
    ...ok("Assigned published sessions", promotionSessionListSchema),
    ...authErrors({ notFound: "Event not found" }),
  },
};

export const promotionRendersCreateRouteSchema = {
  ...promotionKitGetRouteSchema,
  "x-pkic-mcp": { expose: false },
  summary: "Queue durable versioned promotion renders",
  request: { params },
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
  request: { params: eventSlugParamsSchema },
};
export const eventPromotionArtifactGetRouteSchema = {
  ...promotionArtifactGetRouteSchema,
  request: { ...promotionArtifactGetRouteSchema.request, params: eventSlugParamsSchema },
};

export const eventPromotionSessionsGetRouteSchema = {
  ...promotionSessionsGetRouteSchema,
  summary: "List public sessions available for own promotion kit",
};

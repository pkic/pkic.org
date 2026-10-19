import { z } from "zod";
import { eventSlugParamsSchema } from "./api-common";
import { promotionArtifactQuerySchema, promotionKitSchema, promotionKitSaveSchema } from "./event-promotion-kit";
import { agendaSnapshotSchema, agendaOccurrenceQuerySchema, agendaOccurrenceListSchema } from "./event-agenda";
import { authErrors, ok, requiresPermissions, requiresSession } from "./route-contract";
const params = eventSlugParamsSchema.extend({ occurrenceId: z.string().min(1) });
export const promotionKitGetRouteSchema = {
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
    ...ok("Assigned published sessions", agendaOccurrenceListSchema),
    ...authErrors({ notFound: "Event not found" }),
  },
};

export const promotionRendersCreateRouteSchema = {
  ...promotionKitGetRouteSchema,
  summary: "Queue durable versioned promotion renders",
  request: { params },
};

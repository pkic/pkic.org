import { z } from "zod";
import { requiresPermissions } from "./route-contract";
import { eventSlugParamsSchema } from "./api-common";
import {
  agendaTransferSchema,
  transferPrepareSchema,
  transferReviewSchema,
  transferApplySchema,
  transferApplyResponseSchema,
} from "./event-agenda-transfer";
import { agendaOccurrenceQuerySchema } from "./event-agenda";
const response = (schema: z.ZodType) => ({
  "200": { description: "Reviewed agenda transfer", content: { "application/json": { schema } } },
});
const base = { ...requiresPermissions("agenda:write"), tags: ["Events"] };
export const agendaTransferExportQuerySchema = agendaOccurrenceQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export const agendaTransferExportRouteSchema = {
  ...requiresPermissions("agenda:read"),
  tags: ["Events"],
  summary: "Export a versioned private agenda document",
  request: {
    params: eventSlugParamsSchema,
    query: agendaTransferExportQuerySchema,
  },
  responses: response(agendaTransferSchema),
};
export const agendaTransferReviewRouteSchema = {
  ...base,
  summary: "Review a mapped agenda import",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: transferPrepareSchema } } },
  },
  responses: response(transferReviewSchema),
};
export const agendaTransferApplyRouteSchema = {
  ...base,
  summary: "Apply a freshly reviewed agenda import to the draft",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: transferApplySchema } } },
  },
  responses: response(transferApplyResponseSchema),
};
import { transferIdentitiesQuerySchema } from "./event-agenda-transfer-identities";
import { sessionAppearanceChoicesSchema } from "./event-session-history";
export const agendaTransferIdentitiesRouteSchema = {
  ...base,
  summary: "Choose a canonical identity valid at an imported session date",
  request: { params: eventSlugParamsSchema, query: transferIdentitiesQuerySchema },
  responses: response(sessionAppearanceChoicesSchema),
};

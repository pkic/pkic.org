import { eventSlugParamsSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { requiresPermissions } from "./route-contract";
import {
  appearanceOverrideRequestSchema,
  appearanceOverrideReviewSchema,
  appearanceOverridesQuerySchema,
  appearanceOverridesResponseSchema,
  appearanceOverrideSchema,
  appearanceOverrideReviewResponseSchema,
} from "./event-appearance-overrides";
const params = eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema });
const response = (
  schema:
    | typeof appearanceOverrideSchema
    | typeof appearanceOverridesResponseSchema
    | typeof appearanceOverrideReviewResponseSchema,
) => ({
  "200": { description: "Audited historical representation override", content: { "application/json": { schema } } },
});
export const appearanceOverridesGetRouteSchema = {
  ...requiresPermissions("agenda:read"),
  tags: ["Events"],
  summary: "List historical representation requests and immutable decisions",
  request: { params, query: appearanceOverridesQuerySchema },
  responses: response(appearanceOverridesResponseSchema),
};
export const appearanceOverrideRequestRouteSchema = {
  ...requiresPermissions("agenda:write"),
  tags: ["Events"],
  summary: "Request a reasoned historical representation override",
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: appearanceOverrideRequestSchema } } },
  },
  responses: response(appearanceOverrideSchema),
};
export const appearanceOverrideReviewRouteSchema = {
  ...requiresPermissions("agenda:appearance_approve"),
  tags: ["Events"],
  summary: "Independently approve or reject a historical display override",
  request: {
    params: params.extend({ requestId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: appearanceOverrideReviewSchema } } },
  },
  responses: response(appearanceOverrideReviewResponseSchema),
};

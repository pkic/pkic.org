/** Shared contract factory for FK-backed, resource-specific group grants. */
import { z } from "zod";
import { jsonErrorResponse, successResponseSchema } from "./api-common";
import { groupLabelSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { groupIdSchema, groupReferenceParamsSchema } from "./groups";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

type CapabilityValues = readonly [string, ...string[]];

export function resourceGrantSchemas<const Values extends CapabilityValues>(capabilities: Values) {
  const capabilitySchema = z.enum(capabilities);
  const grantSchema = z.object({
    granteeGroup: groupLabelSchema,
    capability: capabilitySchema,
    createdByUserId: databaseIdSchema.nullable(),
    createdAt: z.string(),
  });
  const createSchema = z.object({ granteeGroupId: groupIdSchema, capability: capabilitySchema }).strict();
  const paramsSchema = z.object({ granteeGroupId: groupIdSchema, capability: capabilitySchema });
  const listQuery = listQuerySchema(["group", "capability", "created_at"] as const).extend({
    granteeGroupId: groupIdSchema.optional(),
    capability: capabilitySchema.optional(),
  });
  return {
    capabilities,
    capabilitySchema,
    grantSchema,
    createSchema,
    paramsSchema,
    listQuerySchema: listQuery,
    listResponseSchema: paginatedResponseSchema("grants", grantSchema),
  };
}

export const FORM_GROUP_CAPABILITIES = ["view_definition", "submit", "view_responses", "manage"] as const;
export const formGroupGrantSchemas = resourceGrantSchemas(FORM_GROUP_CAPABILITIES);

export const EVENT_GROUP_CAPABILITIES = ["view", "register", "attend", "manage_attendance", "manage"] as const;
export const eventGroupGrantSchemas = resourceGrantSchemas(EVENT_GROUP_CAPABILITIES);

export const VOTE_GROUP_CAPABILITIES = ["view", "participate", "view_results", "manage"] as const;
export const voteGroupGrantSchemas = resourceGrantSchemas(VOTE_GROUP_CAPABILITIES);

export const MAILING_LIST_GROUP_CAPABILITIES = ["view", "subscribe", "post", "moderate", "manage"] as const;
export const mailingListGroupGrantSchemas = resourceGrantSchemas(MAILING_LIST_GROUP_CAPABILITIES);

export type FormGroupCapability = (typeof FORM_GROUP_CAPABILITIES)[number];
export type EventGroupCapability = (typeof EVENT_GROUP_CAPABILITIES)[number];
export type VoteGroupCapability = (typeof VOTE_GROUP_CAPABILITIES)[number];
export type MailingListGroupCapability = (typeof MAILING_LIST_GROUP_CAPABILITIES)[number];

function resourceGrantRouteSchemas<const Values extends CapabilityValues, Params extends z.ZodObject<z.ZodRawShape>>(
  schemas: ReturnType<typeof resourceGrantSchemas<Values>>,
  resourceParamsSchema: Params,
) {
  const mutationResponseSchema = successResponseSchema.extend({
    grant: schemas.grantSchema,
    created: z.boolean(),
  });
  const revokeParamsSchema = resourceParamsSchema.extend(schemas.paramsSchema.shape);
  return {
    list: {
      tags: ["Groups"],
      summary: "List resource sharing grants",
      description: "Search, filtering, sorting, counting, and pagination are executed in D1.",
      request: { params: resourceParamsSchema, query: schemas.listQuerySchema },
      responses: {
        "200": {
          description: "A bounded page of resource-specific group grants.",
          content: { "application/json": { schema: schemas.listResponseSchema } },
        },
        "403": jsonErrorResponse("Effective management of the owning group is required."),
        "404": jsonErrorResponse("Group-owned resource not found."),
      },
    },
    create: {
      tags: ["Groups"],
      summary: "Grant one resource capability to a group",
      request: {
        params: resourceParamsSchema,
        body: { required: true, content: { "application/json": { schema: schemas.createSchema } } },
      },
      responses: {
        "200": {
          description: "Existing idempotent grant.",
          content: { "application/json": { schema: mutationResponseSchema } },
        },
        "201": {
          description: "Resource grant created.",
          content: { "application/json": { schema: mutationResponseSchema } },
        },
        "403": jsonErrorResponse("Effective management of the owning group is required."),
        "404": jsonErrorResponse("Group-owned resource or grantee group not found."),
        "409": jsonErrorResponse("The owning group cannot be granted its own resource."),
      },
    },
    revoke: {
      tags: ["Groups"],
      summary: "Revoke one resource capability from a group",
      request: { params: revokeParamsSchema },
      responses: {
        "200": {
          description: "Resource grant revoked.",
          content: { "application/json": { schema: successResponseSchema } },
        },
        "403": jsonErrorResponse("Effective management of the owning group is required."),
        "404": jsonErrorResponse("Group-owned resource or grant not found."),
      },
    },
    listResponseSchema: schemas.listResponseSchema,
    mutationResponseSchema,
  };
}

const formPlacementGrantParamsSchema = groupReferenceParamsSchema.extend({ placementId: databaseIdSchema });
const eventGrantParamsSchema = groupReferenceParamsSchema.extend({ eventId: databaseIdSchema });
const voteGrantParamsSchema = groupReferenceParamsSchema.extend({ voteId: databaseIdSchema });
const mailingListGrantParamsSchema = groupReferenceParamsSchema.extend({ listId: databaseIdSchema });

export const formPlacementGroupGrantRouteSchemas = resourceGrantRouteSchemas(
  formGroupGrantSchemas,
  formPlacementGrantParamsSchema,
);
export const eventGroupGrantRouteSchemas = resourceGrantRouteSchemas(eventGroupGrantSchemas, eventGrantParamsSchema);
export const voteGroupGrantRouteSchemas = resourceGrantRouteSchemas(voteGroupGrantSchemas, voteGrantParamsSchema);
export const mailingListGroupGrantRouteSchemas = resourceGrantRouteSchemas(
  mailingListGroupGrantSchemas,
  mailingListGrantParamsSchema,
);

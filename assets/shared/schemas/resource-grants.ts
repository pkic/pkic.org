/** Shared contract factory for FK-backed, resource-specific group grants. */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { groupIdSchema } from "./groups";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

type CapabilityValues = readonly [string, ...string[]];

export function resourceGrantSchemas<const Values extends CapabilityValues>(capabilities: Values) {
  const capabilitySchema = z.enum(capabilities);
  const grantSchema = z.object({
    groupId: groupIdSchema,
    capability: capabilitySchema,
    createdByUserId: databaseIdSchema.nullable(),
    createdAt: z.string(),
  });
  const createSchema = grantSchema.pick({ groupId: true, capability: true });
  const paramsSchema = createSchema;
  const listQuery = listQuerySchema(["group", "capability", "created_at"] as const).extend({
    groupId: groupIdSchema.optional(),
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

export const EVENT_GROUP_CAPABILITIES = ["view", "participate", "manage"] as const;
export const eventGroupGrantSchemas = resourceGrantSchemas(EVENT_GROUP_CAPABILITIES);

export const VOTE_GROUP_CAPABILITIES = ["view", "participate", "manage"] as const;
export const voteGroupGrantSchemas = resourceGrantSchemas(VOTE_GROUP_CAPABILITIES);

export type FormGroupCapability = (typeof FORM_GROUP_CAPABILITIES)[number];
export type EventGroupCapability = (typeof EVENT_GROUP_CAPABILITIES)[number];
export type VoteGroupCapability = (typeof VOTE_GROUP_CAPABILITIES)[number];

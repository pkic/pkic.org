import { z } from "zod";
import { normalizedEmailSchema, successResponseSchema } from "./api-common";
import { permissionSchema } from "./permissions";

export const mcpOauthContextSchema = z.object({
  authenticated: z.boolean(),
  authorized: z.boolean(),
  returnTo: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  requestedScopes: z.array(permissionSchema),
  grantedScopes: z.array(permissionSchema),
  userEmail: normalizedEmailSchema.nullable(),
  staffEmail: normalizedEmailSchema.nullable(),
});
export const mcpOauthMagicLinkResponseSchema = successResponseSchema.extend({
  sentTo: normalizedEmailSchema.nullable(),
});
export const mcpOauthRedirectResponseSchema = z.object({ redirectTo: z.string() });

const mcpOauthReturnToSchema = z.string().trim().min(1).max(2048);
export const mcpOauthAuthorizeActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request-link"),
    email: normalizedEmailSchema,
    return_to: mcpOauthReturnToSchema,
  }),
  z.object({ action: z.literal("approve"), return_to: mcpOauthReturnToSchema }),
  z.object({ action: z.literal("deny"), return_to: mcpOauthReturnToSchema }),
]);

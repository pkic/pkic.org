import { z } from "zod";
import { normalizedEmailSchema, successResponseSchema } from "./api-common";
import { oauthSelectedScopesSchema } from "./oauth-authorizations";
import { PERMISSION_DOMAINS } from "../permission-metadata";
import { databaseIdSchema } from "./identifiers";
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
  actingIdentityId: databaseIdSchema.nullable(),
  redirectHost: z.string(),
  areas: z.array(
    z.object({
      key: z.enum(Object.keys(PERMISSION_DOMAINS) as (keyof typeof PERMISSION_DOMAINS)[]),
      label: z.string(),
      permissions: z.array(
        z.object({
          permission: permissionSchema,
          label: z.string(),
          access: z.enum(["read", "write"]),
          allResources: z.boolean(),
          resourceCount: z.number().int().min(0),
        }),
      ),
    }),
  ),
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
  z.object({
    action: z.literal("approve"),
    return_to: mcpOauthReturnToSchema,
    scopes: oauthSelectedScopesSchema,
    actingIdentityId: databaseIdSchema.nullable(),
  }),
  z.object({ action: z.literal("deny"), return_to: mcpOauthReturnToSchema }),
]);

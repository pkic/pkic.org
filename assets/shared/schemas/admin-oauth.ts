import { z } from "zod";
import { normalizedEmailSchema, successResponseSchema } from "./api-common";

export const adminMcpOauthContextSchema = z.object({
  authenticated: z.boolean(),
  returnTo: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  requestedScopes: z.array(z.string()),
  grantedScopes: z.array(z.string()),
  adminEmail: z.string().nullable(),
});
export const adminMcpOauthVerifyResponseSchema = z.object({
  success: z.literal(true),
  expiresAt: z.string(),
  returnTo: z.string(),
  admin: z.object({ email: z.string().nullable().optional() }).optional(),
});
export const adminMcpOauthMagicLinkResponseSchema = successResponseSchema.extend({
  sentTo: normalizedEmailSchema.nullable(),
});
export const adminMcpOauthRedirectResponseSchema = z.object({ redirectTo: z.string() });

import { z } from "zod";
import { emailRecoveryRequestSchema, magicLinkVerifySchema, successResponseSchema } from "./api-common";

export const adminAuthRequestSchema = emailRecoveryRequestSchema;
export const adminAuthVerifySchema = magicLinkVerifySchema;

export const publicAdminGrantSchema = z.object({
  // Stored contextual permissions may include additively introduced values
  // that predate the current UI vocabulary; preserve them in session status.
  permission: z.string().min(1),
  contextType: z.string().nullable(),
  contextId: z.string().nullable(),
});

/** Canonical allowlisted admin identity returned by every public auth transport. */
export const publicAuthAdminSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  grants: z.array(publicAdminGrantSchema),
  expiresAt: z.string().nullable(),
});
export type PublicAuthAdmin = z.infer<typeof publicAuthAdminSchema>;

export const adminSessionEstablishedResponseSchema = successResponseSchema.extend({
  expiresAt: z.string(),
  admin: publicAuthAdminSchema,
});

export const adminAuthSessionResponseSchema = successResponseSchema.extend({
  admin: publicAuthAdminSchema,
});

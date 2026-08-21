/**
 * Member-facing (non-staff) magic-link authentication.
 * Mirrors adminAuthRequestSchema/adminAuthVerifySchema (assets/shared/schemas/api.ts)
 * exactly; kept separate because the response shape carries an AuthMember, not
 * an AuthAdmin.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema, tokenSchema } from "./api-common";

export const memberAuthRequestSchema = z.object({
  email: normalizedEmailSchema,
});

export const memberAuthVerifySchema = z.object({
  token: tokenSchema,
});

export const authMemberSchema = z.object({
  userId: databaseIdSchema,
  email: z.string(),
  memberId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  membershipCategory: z.string(),
  isEcMember: z.boolean(),
});

export const memberAuthRequestRouteSchema = {
  tags: ["Member Auth"],
  summary: "Request a member sign-in magic link",
  description:
    "Sends a magic-link sign-in email to an active member. Always returns success regardless of whether the email matches an active member, to avoid leaking membership status.",
  request: {
    body: { content: { "application/json": { schema: memberAuthRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Magic link sent if the email matches an active member.",
      content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
    },
  },
};

export const memberAuthVerifyRouteSchema = {
  tags: ["Member Auth"],
  summary: "Verify a member magic link and start a session",
  request: {
    body: { content: { "application/json": { schema: memberAuthVerifySchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Session established.",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), expiresAt: z.string(), member: authMemberSchema }),
        },
      },
    },
  },
};

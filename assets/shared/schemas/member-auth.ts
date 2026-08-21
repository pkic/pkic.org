/**
 * Member-facing (non-staff) magic-link authentication.
 * Reuses the canonical magic-link request contracts; the member response shape
 * remains separate because it carries an AuthMember rather than an AuthAdmin.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { emailRecoveryRequestSchema, magicLinkVerifySchema, successResponseSchema } from "./api-common";

export const memberAuthRequestSchema = emailRecoveryRequestSchema;
export const memberAuthVerifySchema = magicLinkVerifySchema;

export const authMemberSchema = z.object({
  userId: databaseIdSchema,
  email: z.string(),
  memberId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  membershipCategory: z.string(),
  isEcMember: z.boolean(),
});

export const memberAuthVerifyResponseSchema = successResponseSchema.extend({
  expiresAt: z.string(),
  member: authMemberSchema,
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
      content: { "application/json": { schema: successResponseSchema } },
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
          schema: memberAuthVerifyResponseSchema,
        },
      },
    },
  },
};

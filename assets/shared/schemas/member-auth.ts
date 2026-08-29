/**
 * The member-facing view of an authenticated identity.
 *
 * The member magic-link routes this file once described are gone — that flow
 * is served by the canonical `/api/v1/auth` endpoints. What remains is the
 * response shape, which stays separate because it carries an AuthMember
 * rather than an AuthAdmin.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { successResponseSchema } from "./api-common";

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

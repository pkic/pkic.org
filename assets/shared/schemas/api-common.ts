import { z } from "zod";
import { EMAIL_AUTH_TOKEN_MAX_LENGTH } from "../constants/email-auth";
import { databaseIdSchema } from "./identifiers";

/** Exact base response contract for successful mutations. Extend this for declared domain payloads. */
export const successResponseSchema = z.object({ success: z.literal(true) }).strict();

/** Canonical API error envelope returned by the Worker HTTP boundary. */
export const apiErrorPayloadSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.unknown().nullable().optional(),
  }),
});
export type ApiErrorPayload = z.infer<typeof apiErrorPayloadSchema>;

/** Canonical OpenAPI response entry for the shared JSON error envelope. */
export function jsonErrorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: apiErrorPayloadSchema } },
  };
}

/** Structured validation details understood by shared browser form helpers. */
export const apiValidationErrorDetailsSchema = z.object({
  formErrors: z.array(z.string()).optional(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});

/**
 * Boolean query parameters arrive as strings. `z.coerce.boolean()` follows
 * JavaScript truthiness and therefore turns the non-empty string `"false"`
 * into `true`; enumerate the wire values instead.
 */
export const booleanQueryFlagSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

/** Body format of a rendered email template/message. */
export const emailContentTypeSchema = z.enum(["markdown", "html", "text"]);
export type EmailContentType = z.infer<typeof emailContentTypeSchema>;

/** Delivery classification used for outbox rows and templates. */
export const emailMessageTypeSchema = z.enum(["transactional", "promotional"]);
export type EmailMessageType = z.infer<typeof emailMessageTypeSchema>;

export const namePattern = /^[\p{L}\p{N} .,'’\-()&/]+$/u;
export const slugPattern = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
export const termKeyPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
export const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const tokenCharactersPattern = /^[A-Za-z0-9_.-]+$/;
export const frontendPathPattern = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/;

export function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

export function boundedJsonObject<T extends z.ZodRawShape>(shape: T, maxLength: number) {
  return z.object(shape).superRefine((value, context) => {
    if (JSON.stringify(value).length > maxLength) {
      context.addIssue({
        code: "custom",
        message: `JSON payload exceeds ${maxLength} characters`,
      });
    }
  });
}

export const normalizedEmailSchema = z
  .email({ error: "Please enter a valid email address (for example: name@example.com)." })
  .transform((value) => value.trim().toLowerCase());
export const emailRecoveryRequestSchema = z.object({ email: normalizedEmailSchema });
export const firstNameSchema = trimmedString(1, 80).regex(namePattern, "Contains unsupported characters");
export const lastNameSchema = trimmedString(1, 120).regex(namePattern, "Contains unsupported characters");
export const organizationNameSchema = trimmedString(2, 160);
export const jobTitleSchema = trimmedString(2, 120);
export const tokenSchema = z.string().trim().min(16).max(512).regex(tokenCharactersPattern, "Invalid token format");
export const emailAuthTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(EMAIL_AUTH_TOKEN_MAX_LENGTH)
  .regex(tokenCharactersPattern, "Invalid token format");
export const magicLinkVerifySchema = z.object({ token: emailAuthTokenSchema });

/** Events use stable natural ids (often their initial slug), not generated UUID ids. */
export const eventIdSchema = trimmedString(1, 200);

export const eventSlugParamsSchema = z.object({
  eventSlug: z.string().trim().regex(slugPattern),
});

export const proposalIdParamsSchema = z.object({
  proposalId: databaseIdSchema,
});

export const proposalSpeakerIdParamsSchema = proposalIdParamsSchema.extend({
  userId: databaseIdSchema,
});

export const proposerManagedSpeakerParamsSchema = z.object({
  token: tokenSchema,
  userId: databaseIdSchema,
});

export const proposalReviewIdParamsSchema = proposalIdParamsSchema.extend({
  reviewId: databaseIdSchema,
});

export const presentationVersionIdParamsSchema = proposalIdParamsSchema.extend({
  versionId: databaseIdSchema,
});

export const formKeyParamsSchema = z.object({
  formKey: z.string().trim().min(1).max(120),
});

export const userIdParamsSchema = z.object({
  userId: databaseIdSchema,
});

export const emailTemplateKeyParamsSchema = z.object({
  key: z.string().trim().min(1).max(200),
});

export const registrationManageTokenParamsSchema = z.object({
  token: z.string().trim().min(1).max(4096).describe("Attendee self-service registration manage token"),
});

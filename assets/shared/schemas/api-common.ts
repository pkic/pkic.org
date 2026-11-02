import { z } from "zod";
import { EMAIL_AUTH_TOKEN_MAX_LENGTH } from "../constants/email-auth.ts";
import { databaseIdSchema } from "./identifiers.ts";
import { asciiEmailDomain, EMAIL_ADDRESS_PATTERN } from "../email-address.ts";

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

/** Details of a `RATE_LIMITED` (429) refusal: whole seconds until another request may succeed. */
export const rateLimitErrorDetailsSchema = z.object({ retryAfter: z.number().int().positive() });
export type RateLimitErrorDetails = z.infer<typeof rateLimitErrorDetailsSchema>;

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

export const namePattern = /^[\p{L}\p{M}\p{N} .,'’\p{Pd}()&/\u200c\u200d]+$/u;
export const slugPattern = /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/;
export const termKeyPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
export const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const tokenCharactersPattern = /^[A-Za-z0-9_.-]+$/;
export const frontendPathPattern = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/;

/**
 * Canonical wire/storage representation for an instant.
 *
 * Offsets and omitted fractional seconds are intentionally rejected: every
 * backend and client receives the same millisecond-precision UTC value and
 * localization remains a presentation-boundary concern.
 */
export const utcInstantSchema = z.iso.datetime({ precision: 3 });

/** A trimmed, bounded string; `tooShort` is what a value under `min` is told. */
export function trimmedString(min: number, max: number, tooShort?: string): z.ZodString {
  return z.string().trim().min(min, tooShort).max(max);
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

const INVALID_EMAIL_MESSAGE = "Please enter a valid email address (for example: name@example.com).";
/**
 * An email address in its stored form. The domain is converted to ASCII before
 * validation, so an internationalized domain is accepted and kept in the
 * punycode spelling every other comparison uses.
 */
export const normalizedEmailSchema = z
  .string({ error: INVALID_EMAIL_MESSAGE })
  .trim()
  .transform(asciiEmailDomain)
  .pipe(z.email({ pattern: EMAIL_ADDRESS_PATTERN, error: INVALID_EMAIL_MESSAGE }))
  .transform((value) => value.toLowerCase());
export const emailRecoveryRequestSchema = z.object({ email: normalizedEmailSchema });
/** Canonically equivalent Unicode spellings share one representation; never guess a different encoding. */
function personName(max: number, field: string) {
  return z
    .string()
    .trim()
    .normalize("NFC")
    .min(1, `Enter your ${field}.`)
    .max(max, `Keep your ${field} to ${max} characters or fewer.`)
    .regex(namePattern, `Check your ${field} and remove unsupported characters.`);
}
export const firstNameSchema = personName(80, "first name");
export const lastNameSchema = personName(120, "last name");
export const personNamePatchSchema = z
  .object({ firstName: firstNameSchema.optional(), lastName: lastNameSchema.optional() })
  .strict()
  .refine((body) => body.firstName !== undefined || body.lastName !== undefined, {
    message: "Enter a first or last name.",
  });
/** Said wherever an organization name is asked for and left empty. */
export const ORGANIZATION_NAME_REQUIRED = "Enter your organization.";
export const organizationNameSchema = z
  .string({ error: ORGANIZATION_NAME_REQUIRED })
  .trim()
  .min(1, ORGANIZATION_NAME_REQUIRED)
  .min(2, "Enter at least 2 characters.")
  .max(160);
/** Said wherever someone takes part on behalf of an organization without a job title. */
export const JOB_TITLE_REQUIRED = "Enter your job title at this organization.";
/** Required wherever it is asked: someone taking part on behalf of an organization says what they do there. */
export const jobTitleSchema = z
  .string({ error: JOB_TITLE_REQUIRED })
  .trim()
  .min(1, JOB_TITLE_REQUIRED)
  .min(2, "Enter at least 2 characters.")
  .max(120);
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

export const proposalAccessSpeakerParamsSchema = z.object({
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

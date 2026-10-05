import { z } from "zod";
export const SESSION_PRESENTATION_SOURCE_KEY_HEADER = "x-presentation-source-key";
export const sessionPresentationDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const SESSION_PRESENTATION_SOURCE_DIGEST_HEADER = "x-presentation-source-digest";
export const sessionPresentationSourceKeySchema = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("://") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !value.split(/[\\/]/u).includes(".."),
    "Use a repository-relative source reference",
  );
import { databaseIdSchema } from "./identifiers.ts";
import {
  presentationVersionSchema,
  presentationVersionsListQuerySchema,
  presentationVersionReviewRequestSchema,
} from "./presentation-versions.ts";
import { paginatedResponseSchema } from "./pagination.ts";
export const sessionPresentationVersionSchema = presentationVersionSchema.omit({ proposalId: true }).extend({
  occurrenceId: databaseIdSchema,
  sourceKey: sessionPresentationSourceKeySchema.nullable().default(null),
  sourceDigest: sessionPresentationDigestSchema.nullable().default(null),
});
export const sessionPresentationVersionsSchema = paginatedResponseSchema("versions", sessionPresentationVersionSchema);
export const sessionPresentationVersionResponseSchema = z.object({ version: sessionPresentationVersionSchema });
export const sessionPresentationVersionsQuerySchema = presentationVersionsListQuerySchema;
export const sessionPresentationReviewRequestSchema = presentationVersionReviewRequestSchema;
export type SessionPresentationVersion = z.infer<typeof sessionPresentationVersionSchema>;

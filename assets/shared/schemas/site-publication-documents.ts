import { z } from "zod";
import { databaseIdSchema } from "./identifiers.ts";
import { utcInstantSchema } from "./api-common.ts";
import { presentationByteCountSchema } from "./event-agenda-legacy-fragments.ts";
import {
  sessionPresentationReleaseParamsSchema,
  parseSessionPresentationPublicUrl,
} from "../session-presentation-public-url.ts";

export const publicationDocumentGrantIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const publicationDocumentSelectionSchema = z
  .object({
    url: z.string().refine((value) => parseSessionPresentationPublicUrl(value) !== null),
    grantId: publicationDocumentGrantIdSchema,
  })
  .strict();
export const publicationDocumentEffectSchema = sessionPresentationReleaseParamsSchema
  .extend({
    eventId: databaseIdSchema,
    materialId: z.string().min(1).max(300),
    grantId: publicationDocumentGrantIdSchema,
  })
  .strict();
export const publicationDocumentEffectsSchema = z
  .array(publicationDocumentEffectSchema)
  .max(1000)
  .refine(
    (effects) => new Set(effects.map(({ grantId }) => grantId)).size === effects.length,
    "Duplicate document effect",
  );
export const publicationDocumentAllowSchema = publicationDocumentEffectSchema
  .extend({
    version: z.literal(1),
    r2Key: z.string().min(1).max(1024),
    fileName: z.string().min(1).max(500),
    versionNumber: z.number().int().positive(),
    fileSize: presentationByteCountSchema,
    objectEtag: z.string().min(1).max(200),
    approvedAt: utcInstantSchema,
    approvalNonce: z.uuid().nullable(),
  })
  .strict();
export const publicationDocumentDenialSchema = publicationDocumentEffectSchema
  .extend({ version: z.literal(1) })
  .strict();
export type PublicationDocumentEffect = z.infer<typeof publicationDocumentEffectSchema>;
export type PublicationDocumentAllow = z.infer<typeof publicationDocumentAllowSchema>;

/** One canonical hash input; historical approval timestamps are only a guarded bootstrap basis. */
export function publicationDocumentGrantHashInput(
  input: Pick<PublicationDocumentEffect, "eventSlug" | "occurrenceId" | "materialId" | "versionId" | "digest"> & {
    approvedAt: string;
    approvalNonce: string | null;
  },
): string {
  return JSON.stringify([
    input.eventSlug,
    input.occurrenceId,
    input.materialId,
    input.versionId,
    input.digest,
    input.approvalNonce ?? input.approvedAt,
  ]);
}
export async function publicationDocumentGrantId(input: Parameters<typeof publicationDocumentGrantHashInput>[0]) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(publicationDocumentGrantHashInput(input)),
  );
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
export function publicationDocumentStorageKey(grantId: string, disposition: "allow" | "deny") {
  return `publication-documents/${publicationDocumentGrantIdSchema.parse(grantId)}/${disposition}.json`;
}

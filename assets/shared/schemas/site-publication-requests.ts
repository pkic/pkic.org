import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, pageInfoSchema } from "./pagination";
import { sitePublicationSnapshotIdSchema } from "./site-publication-release";
import { publicationDocumentEffectsSchema } from "./site-publication-documents";
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const externalIdentity = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const sitePublicationResourceTypeSchema = z.enum(["event_agenda", "presentation_version", "session_material"]);
/** Stable identity for the whole-site publication aggregate; it does not refer to an event or database row. */
export const SITE_PUBLICATION_SITE_RESOURCE_ID = "00000000-0000-4000-8000-000000000000";
export const sitePublicationReasonSchema = z.enum([
  "agenda_approved",
  "rights_withdrawn",
  "version_review_changed",
  "version_deleted",
  "repair",
  "organization_content_approved",
  "organization_content_changed",
  "member_news_refreshed",
  "membership_changed",
  "identity_profile_changed",
  "user_headshot_changed",
  "user_profile_changed",
  "group_content_changed",
  "sponsorship_changed",
]);
export const sitePublicationRequestStatusSchema = z.enum([
  "queued",
  "rendering",
  "awaiting_activation",
  "delivered",
  "failed",
  "obsolete",
]);
export const sitePublicationResourceSchema = z.object({
  resourceType: sitePublicationResourceTypeSchema,
  resourceId: databaseIdSchema,
});
// Event-owned listing routes retain their event-only resource contract above.
export const sitePublicationRequestInputSchema = sitePublicationResourceSchema.extend({
  resourceType: z.enum([
    ...sitePublicationResourceTypeSchema.options,
    "organization_content",
    "member_news",
    "membership",
    "identity_profile",
    "user_profile",
    "group_content",
    "site_content",
    "sponsorship",
  ]),
  revision: sequence,
  reasonCode: sitePublicationReasonSchema,
  documentEffects: publicationDocumentEffectsSchema.default([]),
  deduplicationKey: z
    .string()
    .min(1)
    .max(250)
    .regex(/^[A-Za-z0-9_.:/-]+$/),
});
export const sitePublicationRequestSchema = sitePublicationRequestInputSchema.extend({
  id: z.uuid(),
  sequence: sequence,
  status: sitePublicationRequestStatusSchema,
  attempts: sequence,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema,
  leaseExpiresAt: utcInstantSchema.nullable(),
  nextAttemptAt: utcInstantSchema.nullable(),
  lastErrorCode: externalIdentity.nullable(),
  lastErrorAt: utcInstantSchema.nullable(),
  sourceSequence: sequence.nullable(),
  snapshotId: sitePublicationSnapshotIdSchema.nullable(),
  buildId: externalIdentity.nullable(),
  releaseId: externalIdentity.nullable(),
  documentEffectsCompletedAt: utcInstantSchema.nullable().default(null),
});
export const sitePublicationRequestQuerySchema = listQuerySchema(["sequence"], { maxLimit: 100 }).extend({
  status: sitePublicationRequestStatusSchema.optional(),
});
export const sitePublicationRequestListSchema = z.object({
  requests: z.array(sitePublicationRequestSchema),
  page: pageInfoSchema,
});
export const sitePublicationBuildSchema = z.object({
  sourceSequence: sequence,
  snapshotId: sitePublicationSnapshotIdSchema,
  buildId: externalIdentity,
  releaseId: externalIdentity,
});
export const sitePublicationBuildCompletionSchema = sitePublicationBuildSchema.extend({
  requestId: z.uuid(),
  leaseToken: z.uuid(),
});
/** Only a verified activation receipt is eligible to advance delivery. A build result is insufficient. */
export const sitePublicationActivationSchema = sitePublicationBuildSchema.extend({
  requestId: z.uuid(),
  expectedDeliveredSequence: sequence,
  activationReceiptId: externalIdentity,
  activatedAt: utcInstantSchema,
});
export const sitePublicationDeliverySchema = z.object({
  desiredSequence: sequence,
  deliveredSequence: sequence,
  snapshotId: sitePublicationSnapshotIdSchema.nullable(),
  buildId: externalIdentity.nullable(),
  releaseId: externalIdentity.nullable(),
  activationReceiptId: externalIdentity.nullable(),
  activatedAt: utcInstantSchema.nullable(),
});
export type SitePublicationRequestInput = z.input<typeof sitePublicationRequestInputSchema>;
export type SitePublicationResource = z.infer<typeof sitePublicationResourceSchema>;
export type SitePublicationRequestQuery = z.infer<typeof sitePublicationRequestQuerySchema>;
export type SitePublicationActivation = z.infer<typeof sitePublicationActivationSchema>;
export type SitePublicationBuildCompletion = z.infer<typeof sitePublicationBuildCompletionSchema>;

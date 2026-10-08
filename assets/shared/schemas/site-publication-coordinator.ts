import { sitePublicationReleaseSchema } from "./site-publication-release";
import { z } from "zod";
import { sitePublicationProviderAttestationConfigSchema } from "./site-publication-provider";
import { sitePublicationSourceSequenceSchema, sitePublicationSnapshotIdSchema } from "./site-publication-release";
export const sitePublicationAttemptPhaseSchema = z.enum([
  "dispatching",
  "building",
  "build_attested",
  "awaiting_activation",
  "activating",
  "uncertain",
  "failed",
  "superseded",
  "delivered",
]);
export const sitePublicationPublicOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
});
export const SITE_PUBLICATION_REPAIR_INTERVAL_SECONDS = 86400;
export const SITE_PUBLICATION_FULL_REPAIR_PREFIX = "repair:full:";
export const sitePublicationCoordinatorConfigSchema = z.object({
  environment: z.enum(["preview", "production"]),
  publicOrigin: sitePublicationPublicOriginSchema,
  enabled: z.boolean().default(false),
  exclusiveActivationOwner: z.boolean().default(false),
  provider: sitePublicationProviderAttestationConfigSchema,
  debounceSeconds: z.number().int().min(0).max(300).default(20),
  /** Periodic full generation repairs missed jobs and time-only public projection changes. */
  repairIntervalSeconds: z
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(SITE_PUBLICATION_REPAIR_INTERVAL_SECONDS)
    .optional(),
});
export const sitePublicationAttemptSchema = z.object({
  environment: z.enum(["preview", "production"]),
  publicOrigin: sitePublicationPublicOriginSchema,
  id: z.uuid(),
  requestId: z.uuid(),
  sourceSequence: sitePublicationSourceSequenceSchema,
  leaseToken: z.uuid(),
  phase: sitePublicationAttemptPhaseSchema,
  provider: sitePublicationProviderAttestationConfigSchema,
  buildId: z.uuid().nullable(),
  versionId: z.uuid().nullable(),
  snapshotId: sitePublicationSnapshotIdSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  errorCode: z
    .string()
    .regex(/^[A-Z_]{1,100}$/)
    .nullable(),
});
export type SitePublicationAttempt = z.infer<typeof sitePublicationAttemptSchema>;
export type SitePublicationCoordinatorConfig = z.infer<typeof sitePublicationCoordinatorConfigSchema>;

export const sitePublicationMachineContextSchema = z.object({
  identityType: z.literal("native_build_machine"),
  attemptId: z.uuid(),
  buildId: z.uuid(),
});
export const sitePublicationMachineCompletionSchema = z.object({
  release: sitePublicationReleaseSchema.refine(
    (value) => value.sourceSequence !== null && value.integrity !== undefined,
    "Native release with full integrity required",
  ),
  versionId: z.uuid(),
  workerBundleSha256: sitePublicationSnapshotIdSchema,
});
export type SitePublicationMachineContext = z.infer<typeof sitePublicationMachineContextSchema>;

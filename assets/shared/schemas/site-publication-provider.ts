import { z } from "zod";
const hexId = z.string().regex(/^[a-f0-9]{32}$/i);
export const sitePublicationProviderConfigSchema = z.object({
  accountId: hexId,
  triggerId: z.uuid(),
  scriptName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  branch: z.string().min(1).max(200),
  commitHash: z.string().regex(/^[a-f0-9]{40,64}$/i),
});
export const sitePublicationProviderTokenSchema = z.string().min(1).max(4096).regex(/^\S+$/);
export const sitePublicationProviderBuildSchema = z.object({
  success: z.literal(true),
  result: z.object({ build_uuid: z.uuid() }),
});
export const sitePublicationProviderDeploymentsSchema = z.object({
  success: z.literal(true),
  result: z.object({
    deployments: z
      .array(
        z.object({
          id: z.uuid(),
          created_on: z.iso.datetime({ offset: true }),
          versions: z.array(z.object({ version_id: z.uuid(), percentage: z.number().min(0).max(100) })).max(100),
        }),
      )
      .max(100),
  }),
});
export type SitePublicationProviderConfig = z.infer<typeof sitePublicationProviderConfigSchema>;

export const sitePublicationProviderAttestationConfigSchema = sitePublicationProviderConfigSchema.extend({
  workerTag: hexId,
  repoConnectionId: z.uuid(),
  repositoryId: z.string().min(1).max(200),
  providerAccountId: z.string().min(1).max(200),
});
export const sitePublicationCiIdentitySchema = z.object({
  WORKERS_CI_BUILD_UUID: z.uuid(),
  WORKERS_CI_COMMIT_SHA: z.string().regex(/^[a-f0-9]{40,64}$/i),
  WORKERS_CI_BRANCH: z.string().min(1).max(200),
});
export const sitePublicationProviderBuildRecordSchema = z.object({
  build_uuid: z.uuid(),
  status: z.enum(["queued", "initializing", "running", "stopped"]),
  build_outcome: z.enum(["success", "fail", "skipped", "cancelled", "terminated"]).nullish(),
  build_trigger_metadata: z.object({ branch: z.string().max(200), commit_hash: z.string().max(64) }),
  trigger: z.object({
    trigger_uuid: z.uuid(),
    external_script_id: hexId,
    deleted_on: z.string().nullish(),
    repo_connection: z.object({
      repo_connection_uuid: z.uuid(),
      repo_id: z.string().max(200),
      provider_account_id: z.string().max(200),
      deleted_on: z.string().nullish(),
    }),
  }),
});
export const sitePublicationProviderInspectionSchema = z.object({
  success: z.literal(true),
  result: sitePublicationProviderBuildRecordSchema,
});
export const sitePublicationProviderVersionSchema = z.object({
  success: z.literal(true),
  result: z.object({ id: z.uuid() }),
});
export const sitePublicationProviderVersionBuildsSchema = z.object({
  success: z.literal(true),
  result: z.object({
    builds: z
      .record(z.uuid(), sitePublicationProviderBuildRecordSchema)
      .refine((value) => Object.keys(value).length === 1),
  }),
});
export const sitePublicationAttestationPhaseSchema = z.enum(["building", "completed"]);
export const sitePublicationProviderErrorCodeSchema = z.enum([
  "PROVIDER_REJECTED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_WRITE_UNCERTAIN",
  "PROVIDER_RESPONSE_INVALID",
  "PROVIDER_ATTESTATION_MISMATCH",
  "PROVIDER_BUILD_NOT_READY",
  "PROVIDER_BUILD_FAILED",
]);
export type SitePublicationProviderAttestationConfig = z.infer<typeof sitePublicationProviderAttestationConfigSchema>;
export type SitePublicationCiIdentity = z.infer<typeof sitePublicationCiIdentitySchema>;
export type SitePublicationProviderErrorCode = z.infer<typeof sitePublicationProviderErrorCodeSchema>;

export const sitePublicationProviderDeploymentReceiptSchema = z.object({
  success: z.literal(true),
  result: z.object({
    id: z.uuid(),
    created_on: z.iso.datetime({ offset: true }),
    strategy: z.literal("percentage"),
    versions: z
      .array(z.object({ version_id: z.uuid(), percentage: z.number().min(0).max(100) }))
      .min(1)
      .max(100),
  }),
});

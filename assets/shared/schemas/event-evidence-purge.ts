import { z } from "zod";
import { successResponseSchema, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { scannerReconciliationSchema } from "./event-scanner-reconciliation";
import { authErrors, ok, requiresPermissions } from "./route-contract";
export const EVIDENCE_PURGE_TABLES = [
  "event_attendance_import_provenance",
  "event_attendance_corrections",
  "event_attendance_correction_state",
  "event_attendance_observations",
  "event_attendance_imports",
  "event_attendance_import_reviews",
  "event_sponsor_leads",
  "event_scan_attempts",
  "event_offline_admission_access",
  "event_offline_admission_entitlements",
  "event_offline_admission_spends",
  "event_offline_admission_grants",
  "event_entry_admissions",
  "event_session_admissions",
  "event_badge_credentials",
  "event_scanner_upload_receipts",
  "event_scanner_device_sessions",
] as const;
export const evidencePurgePhaseSchema = z.enum(["aggregates", ...EVIDENCE_PURGE_TABLES, "complete"]);
export const evidencePurgeCountsSchema = z.record(z.enum(EVIDENCE_PURGE_TABLES), z.number().int().nonnegative());
export const evidencePurgePreviewSchema = successResponseSchema.extend({
  eventId: databaseIdSchema,
  activeRunId: databaseIdSchema.nullable(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  policyRevision: z.number().int().nonnegative(),
  sourceGeneration: z.number().int().nonnegative(),
  publicationRevision: z.number().int().nonnegative().nullable(),
  timeZone: z.string(),
  counts: evidencePurgeCountsSchema,
  reconciliation: scannerReconciliationSchema,
  blockers: z.array(
    z.enum([
      "policy_unconfigured",
      "cutoff_not_due",
      "removal_paused",
      "contact_open",
      "device_reconciliation_incomplete",
      "active_run",
      "already_purged",
    ]),
  ),
});
export const evidencePurgeReviewCreateSchema = z
  .object({
    expectedPreviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    operationId: z.string().uuid(),
    expectedPolicyRevision: z.number().int().nonnegative(),
    expectedGeneration: z.number().int().nonnegative(),
  })
  .strict();
export const evidencePurgeReviewResponseSchema = evidencePurgePreviewSchema.extend({
  reviewId: databaseIdSchema,
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewedAt: utcInstantSchema,
  expiresAt: utcInstantSchema,
});
export const evidencePurgeRunCreateSchema = z
  .object({
    operationId: z.string().uuid(),
    reviewId: databaseIdSchema,
    reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    retireCapture: z.literal(true),
  })
  .strict();
export const evidencePurgeRunResponseSchema = successResponseSchema.extend({
  runId: databaseIdSchema,
  eventId: databaseIdSchema,
  status: z.enum(["running", "complete"]),
  reviewRequired: z.boolean().default(false),
  phase: evidencePurgePhaseSchema,
  ordinal: z.number().int().nonnegative(),
  sourceGeneration: z.number().int().nonnegative(),
  startedAt: utcInstantSchema,
  completedAt: utcInstantSchema.nullable(),
  reconciliation: scannerReconciliationSchema,
});
export const evidencePurgeChunkCreateSchema = z
  .object({ operationId: z.string().uuid(), expectedOrdinal: z.number().int().nonnegative() })
  .strict();
export const evidencePurgeChunkResponseSchema = successResponseSchema.extend({
  runId: databaseIdSchema,
  ordinal: z.number().int().positive(),
  phase: evidencePurgePhaseSchema,
  sourceGenerationBefore: z.number().int().nonnegative(),
  sourceGenerationAfter: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  committedAt: utcInstantSchema,
});
export type EvidencePurgePhase = z.infer<typeof evidencePurgePhaseSchema>;
export type EvidencePurgePreview = z.infer<typeof evidencePurgePreviewSchema>;
export type EvidencePurgeReviewCreate = z.infer<typeof evidencePurgeReviewCreateSchema>;
export type EvidencePurgeRunCreate = z.infer<typeof evidencePurgeRunCreateSchema>;
export type EvidencePurgeChunkCreate = z.infer<typeof evidencePurgeChunkCreateSchema>;
const base = {
  tags: ["Retention"],
  ...requiresPermissions("retention:read", "events:manage"),
  request: { params: z.object({ eventId: databaseIdSchema }) },
  responses: {
    ...authErrors({
      forbidden: "Requires retention authority and exact event management.",
      conflict: "Source, policy, device closure or authorization changed.",
    }),
  },
};
export const evidencePurgePreviewRouteSchema = {
  ...base,
  summary: "Review event evidence removal readiness",
  responses: { ...base.responses, ...ok("Count-only readiness.", evidencePurgePreviewSchema) },
};
export const evidencePurgeReviewCreateRouteSchema = {
  ...base,
  ...requiresPermissions("retention:read", "retention:run", "users:anonymize", "events:manage"),
  summary: "Record a review of exact event evidence",
  request: {
    ...base.request,
    body: { required: true, content: { "application/json": { schema: evidencePurgeReviewCreateSchema } } },
  },
  responses: { ...base.responses, ...ok("Pinned evidence review.", evidencePurgeReviewResponseSchema) },
};
export const evidencePurgeRunCreateRouteSchema = {
  ...base,
  ...requiresPermissions("retention:read", "retention:run", "users:anonymize", "events:manage"),
  summary: "Retire event capture and start reviewed evidence removal",
  request: {
    ...base.request,
    body: { required: true, content: { "application/json": { schema: evidencePurgeRunCreateSchema } } },
  },
  responses: { ...base.responses, ...ok("Resumable removal run.", evidencePurgeRunResponseSchema) },
};
export const evidencePurgeRunReadRouteSchema = {
  ...base,
  summary: "Read evidence removal progress",
  request: { params: base.request.params.extend({ runId: databaseIdSchema }) },
  responses: { ...base.responses, ...ok("Removal progress.", evidencePurgeRunResponseSchema) },
};
export const evidencePurgeChunkCreateRouteSchema = {
  ...base,
  ...requiresPermissions("retention:read", "retention:run", "users:anonymize", "events:manage"),
  summary: "Commit one bounded evidence removal step",
  request: {
    params: base.request.params.extend({ runId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: evidencePurgeChunkCreateSchema } } },
  },
  responses: { ...base.responses, ...ok("Immutable step receipt.", evidencePurgeChunkResponseSchema) },
};

export const evidencePurgeResumptionCreateSchema = evidencePurgeRunCreateSchema.omit({ retireCapture: true });
export type EvidencePurgeResumptionCreate = z.infer<typeof evidencePurgeResumptionCreateSchema>;
export const evidencePurgeRenewalReviewRouteSchema = {
  ...evidencePurgeReviewCreateRouteSchema,
  summary: "Review policy changes for a fenced removal run",
  request: {
    ...evidencePurgeReviewCreateRouteSchema.request,
    params: base.request.params.extend({ runId: databaseIdSchema }),
  },
};
export const evidencePurgeResumptionCreateRouteSchema = {
  ...evidencePurgeRunCreateRouteSchema,
  summary: "Resume a fenced removal run under renewed policy review",
  request: {
    params: base.request.params.extend({ runId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: evidencePurgeResumptionCreateSchema } } },
  },
};

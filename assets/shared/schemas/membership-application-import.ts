import { formAnswersSchema } from "./form-answers";
import { z } from "zod";
import { utcInstantSchema, normalizedEmailSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { historicalApplicationOutcomeSchema } from "./membership-application-source";

function normalizeSourceInstants(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSourceInstants);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key.endsWith("_at") &&
        typeof item === "string" &&
        /^\d{4}-\d{2}-\d{2}T/.test(item) &&
        Number.isFinite(Date.parse(item))
          ? new Date(item).toISOString()
          : normalizeSourceInstants(item),
      ]),
    );
  return value;
}

const githubTimeSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const githubActorSchema = z.object({ login: z.string() }).nullable();
export const githubApplicationIssueSchema = z.preprocess(
  normalizeSourceInstants,
  z.looseObject({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    html_url: z.url(),
    title: z.string(),
    body: z.string().nullable(),
    state: z.enum(["open", "closed"]),
    state_reason: z.string().nullable(),
    labels: z.array(z.object({ id: z.number().int(), name: z.string() })),
    created_at: githubTimeSchema,
    updated_at: githubTimeSchema,
    closed_at: githubTimeSchema.nullable(),
    pull_request: z.unknown().optional(),
  }),
);
export const githubApplicationEventSchema = z.preprocess(
  normalizeSourceInstants,
  z.looseObject({
    id: z.number().int(),
    event: z.string().optional(),
    body: z.string().nullable().optional(),
    created_at: githubTimeSchema,
    actor: githubActorSchema.optional(),
    user: githubActorSchema.optional(),
  }),
);
export const githubApplicationEvidenceSchema = z.object({
  repository: z.literal("pkic/members"),
  labelId: z.number().int().positive(),
  issue: githubApplicationIssueSchema,
  comments: z.array(githubApplicationEventSchema),
  timeline: z.array(githubApplicationEventSchema),
});
export type GithubApplicationEvidence = z.infer<typeof githubApplicationEvidenceSchema>;
export const applicationImportMappingSchema = z.object({
  answers: formAnswersSchema.default({}),
  applicantName: z.string().trim().min(1).nullable(),
  applicantEmail: normalizedEmailSchema.nullable(),
  organizationName: z.string().trim().min(1).nullable(),
  categoryCode: z.string().nullable(),
  applicantUserId: databaseIdSchema.nullable(),
  organizationId: databaseIdSchema.nullable(),
  outcome: historicalApplicationOutcomeSchema.nullable(),
  mappingReason: z.string().trim().min(10),
  workflow: z
    .object({
      versionId: databaseIdSchema,
      currentPosition: z.number().int().min(0).max(7),
      steps: z
        .array(
          z.object({
            position: z.number().int().min(0).max(7),
            openedAt: utcInstantSchema.nullable(),
            deadlineAt: utcInstantSchema.nullable(),
            completedAt: utcInstantSchema.nullable(),
            evidenceEventIds: z.array(z.string()).min(1),
          }),
        )
        .max(8),
      objections: z
        .array(
          z.object({
            position: z.number().int().min(0).max(7),
            body: z.string().min(1),
            createdAt: utcInstantSchema,
            evidenceEventId: z.string(),
          }),
        )
        .max(100),
    })
    .nullable(),
});
export type ApplicationImportMapping = z.infer<typeof applicationImportMappingSchema>;

export const membershipApplicationImportRequestSchema = z.object({
  runId: databaseIdSchema,
  sourceIssueNumber: z.number().int().positive(),
  expectedUpdatedAt: utcInstantSchema,
  mapping: applicationImportMappingSchema,
});
export const membershipApplicationImportResponseSchema = z.object({ id: databaseIdSchema, imported: z.boolean() });
export const membershipApplicationActivationRequestSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
  releaseManualHold: z.boolean().default(false),
});
export const membershipApplicationActivationResponseSchema = z.object({ activated: z.literal(true) });

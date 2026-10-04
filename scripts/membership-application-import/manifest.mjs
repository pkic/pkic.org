import { createHash } from "node:crypto";
import { z } from "zod";
import { isAbsolute } from "node:path";
import { githubApplicationEvidenceSchema } from "./source-contracts.mjs";
import { applicationImportEligibility } from "./eligibility.mjs";

export function digest(value) {
  const canonical = JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item,
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export function manifestSchema(contracts) {
  const mapping = z
    .object({
      applicantName: contracts.memberApplicationCreateSchema.shape.applicantName.nullable(),
      applicantEmail: contracts.normalizedEmailSchema.nullable(),
      organizationName: contracts.memberApplicationCreateSchema.shape.organizationName.unwrap().nullable(),
      membershipCategory: contracts.memberApplicationCreateSchema.shape.membershipCategory.nullable(),
      applicantUserId: contracts.databaseIdSchema.nullable(),
      outcome: contracts.applicationStageSchema.extract(contracts.APPLICATION_TERMINAL_STAGES).nullable(),
      decisionAt: contracts.utcInstantSchema.nullable(),
      mappingReason: z.string().trim().min(10).max(2000),
    })
    .strict();
  const reviewed = z
    .object({
      decision: z.literal("import"),
      sourceIssueNumber: z.number().int().positive(),
      source: githubApplicationEvidenceSchema,
      mapping,
      reviewedBy: z.string().trim().min(1).max(200),
      reviewedAt: contracts.utcInstantSchema,
    })
    .strict();
  const deferred = z
    .object({
      decision: z.enum(["exclude", "unresolved"]),
      sourceIssueNumber: z.number().int().positive(),
      reason: z.string().trim().min(1).max(2000),
      owner: z.string().trim().min(1).max(200),
    })
    .strict();
  return z
    .object({
      version: z.literal(2),
      runId: contracts.databaseIdSchema,
      actorUserId: contracts.databaseIdSchema,
      environment: z.enum(["production", "local"]),
      databaseId: z.string().min(1),
      localDirectory: z.string().refine(isAbsolute).nullable(),
      sourceData: z.enum(["private", "synthetic"]),
      entries: z
        .array(z.discriminatedUnion("decision", [reviewed, deferred]))
        .min(1)
        .max(2000),
    })
    .strict()
    .superRefine((manifest, ctx) => {
      const seen = new Set();
      manifest.entries.forEach((entry, index) => {
        if (seen.has(entry.sourceIssueNumber))
          ctx.addIssue({ code: "custom", path: ["entries", index], message: "Duplicate source issue" });
        seen.add(entry.sourceIssueNumber);
        if (
          entry.decision === "import" &&
          (entry.source.issue.number !== entry.sourceIssueNumber ||
            entry.source.issue.html_url !== `https://github.com/pkic/members/issues/${entry.sourceIssueNumber}`)
        )
          ctx.addIssue({ code: "custom", path: ["entries", index, "source"], message: "Source identity mismatch" });
      });
    });
}

export function parseManifest(input, contracts, databaseId) {
  const parsed = manifestSchema(contracts).safeParse(input);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "manifest"))];
    throw new Error(`Invalid reviewed manifest; check: ${paths.slice(0, 10).join(", ")}`);
  }
  const manifest = parsed.data;
  if (manifest.databaseId !== databaseId) throw new Error("Destination must match the configured database");
  if (manifest.environment === "local" && (manifest.sourceData !== "synthetic" || !manifest.localDirectory))
    throw new Error("Local rehearsal requires synthetic data and a dedicated local directory");
  if (manifest.environment === "production" && manifest.localDirectory !== null)
    throw new Error("Production must not specify a local directory");
  return manifest;
}

/** Unsupported evidence remains visible in the reconciliation report, never coerced into live policy. */
export function unresolvedReason(entry) {
  if (entry.decision !== "import") return null;
  const eligibility = applicationImportEligibility(entry.source);
  if (!eligibility.eligible) return `source_${eligibility.reason}`;
  if (entry.source.issue.state !== "closed") return "active_workflow_not_supported";
  const mapping = entry.mapping;
  if (!mapping.outcome) return "outcome_unknown";
  if (!mapping.applicantName || !mapping.applicantEmail || !mapping.membershipCategory || !mapping.decisionAt)
    return "required_history_fields_missing";
  if (mapping.decisionAt < entry.source.issue.created_at || mapping.decisionAt > entry.source.issue.closed_at)
    return "decision_time_needs_review";
  return null;
}

export function requestFor(manifest, entry) {
  return { actorUserId: manifest.actorUserId, ...entry };
}

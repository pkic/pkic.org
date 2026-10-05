import { agendaCreditRoleSchema } from "./agenda-credit-role";
import {
  legacyAgendaFragmentsSchema,
  legacyAgendaDownloadsSchema,
  legacyAgendaDownloadUrlSchema,
} from "./event-agenda-legacy-fragments";
export { legacyAgendaFragmentAnchorSchema } from "./event-agenda-legacy-fragments";
import { parseSessionPresentationPublicUrl } from "../session-presentation-public-url";
import { presentationReviewStatusSchema } from "./presentation-versions";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { proposalActingIdentitySnapshotSchema } from "./proposal-acting-identity";
import { httpOrSameOriginUrlSchema, sameOriginPathSchema } from "./urls";

export const publicSessionMediaUrlSchema = httpOrSameOriginUrlSchema.refine((value) => {
  const url = new URL(value, "https://pkic.org");
  return (
    (!/^\/(?:portal|api)(?:\/|$)/u.test(url.pathname) ||
      (value.startsWith("/") && parseSessionPresentationPublicUrl(value) !== null)) &&
    ![...url.searchParams.keys()].some((key) =>
      /^(?:token|access_token|manage|invite|signature|sig|x-amz-signature|x-amz-credential)$/iu.test(key),
    )
  );
}, "Use a stable public media URL without private access or management credentials.");
/** Frozen public credit: profile changes must never rewrite an approved appearance. */
export const sessionAppearanceSchema = z.object({
  userId: z.string().min(1),
  actingIdentityId: z.string().min(1).nullable(),
  displayName: z.string().trim().min(1).max(200),
  jobTitle: z.string().max(200).nullable(),
  organizationName: z.string().max(200).nullable(),
  biography: z.string().max(10000).default(""),
  photoUrl: publicSessionMediaUrlSchema.nullable(),
  approvedAt: utcInstantSchema,
});
/** Preserved public source attribution, never a canonical identity or approval. */
export const sessionArchivalCreditSchema = z.object({
  sourceRef: z.string().trim().min(1).max(300),
  role: agendaCreditRoleSchema.default("speaker"),
  sourcePath: z.string().min(1).max(1000),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  provenance: z.literal("authored_public"),
  displayName: z.string().trim().min(1).max(200),
  jobTitle: z.string().max(200).nullable(),
  organizationName: z.string().max(200).nullable(),
  biography: z.string().max(10000).default(""),
  photoUrl: publicSessionMediaUrlSchema.nullable(),
});
export type SessionArchivalCredit = z.infer<typeof sessionArchivalCreditSchema>;
/** Source establishes a historical start, but no ending or schedulable interval. */
export const sessionArchivalTimingSchema = z.object({
  sourcePath: z.string().min(1).max(1000),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  provenance: z.literal("authored_public"),
  timeZone: z.string().min(1).max(100),
  authoredDate: z.string().nullable(),
  authoredStart: z.string().nullable(),
  startAt: utcInstantSchema,
  endAt: z.null(),
});
/** Explicit review of authored text; a placeholder never becomes the original source value. */
export const sessionSourceDecisionSchema = z
  .object({
    kind: z.enum(["title", "credit"]),
    sourcePath: z.string().min(1).max(1000),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceLocator: z.string().trim().min(1).max(500),
    authoredValue: z.string().max(10000).nullable(),
    decision: z.enum([
      "reviewed_title",
      "title_not_recorded",
      "credit_not_recorded",
      "retain_source_credit",
      "reviewed_credit",
    ]),
    resolvedValue: z.string().max(10000).nullable(),
    reviewedAt: utcInstantSchema,
  })
  .refine(
    (review) => {
      if (review.kind === "title")
        return (
          Boolean(review.resolvedValue?.trim()) &&
          (review.decision === "reviewed_title" ||
            (review.decision === "title_not_recorded" &&
              !review.authoredValue?.trim() &&
              review.resolvedValue === "Title not recorded"))
        );
      return (
        (review.decision === "credit_not_recorded" &&
          review.resolvedValue === null &&
          (review.authoredValue === null || /^(?:none|tbc|tbd)?$/iu.test(review.authoredValue.trim()))) ||
        (review.decision === "reviewed_credit" &&
          Boolean(review.resolvedValue?.trim()) &&
          review.resolvedValue === review.resolvedValue?.trim() &&
          (review.authoredValue === null || /^(?:none|tbc|tbd)?$/iu.test(review.authoredValue.trim()))) ||
        (review.decision === "retain_source_credit" &&
          Boolean(review.authoredValue?.trim()) &&
          review.resolvedValue === review.authoredValue)
      );
    },
    { path: ["decision"], message: "Use an explicit title or credit decision that retains the authored value." },
  );
export type SessionSourceDecision = z.infer<typeof sessionSourceDecisionSchema>;
/** Proposal selection provenance remains pending until the appearance is approved. */
export const sessionProposalRepresentationSchema = z
  .object({
    userId: z.string().min(1),
    actingIdentityId: z.string().min(1).nullable(),
    selectedAt: utcInstantSchema.nullable(),
    snapshot: proposalActingIdentitySnapshotSchema.nullable(),
  })
  .refine(
    (selection) =>
      selection.selectedAt === null
        ? selection.actingIdentityId === null && selection.snapshot === null
        : selection.snapshot !== null &&
          (selection.actingIdentityId !== null ||
            (selection.snapshot.organizationName === null && selection.snapshot.jobTitle === null)),
    { path: ["snapshot"], message: "Retain the explicit proposal selection or leave it pending review." },
  );
export type SessionProposalRepresentation = z.infer<typeof sessionProposalRepresentationSchema>;
export const sessionMaterialSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["presentation", "recording", "transcript", "captions"]),
    title: z.string().trim().min(1).max(300),
    url: z.union([publicSessionMediaUrlSchema, z.literal("")]),
    presentationVersionId: z.string().min(1).nullable(),
    legacyDownloadUrl: legacyAgendaDownloadUrlSchema.nullable().default(null),
    presentationSource: z.enum(["proposal", "session"]).default("proposal"),
    version: z.number().int().positive(),
    rightsConfirmed: z.boolean(),
    consentConfirmed: z.boolean(),
    validated: z.boolean(),
    status: z.enum(["draft", "approved", "withdrawn", "failed"]),
    approvedAt: utcInstantSchema.nullable(),
    approvalNonce: z.uuid().nullable().optional(),
  })
  .refine(
    (material) =>
      material.url !== "" ||
      (material.kind === "presentation" &&
        material.presentationSource === "session" &&
        material.presentationVersionId !== null),
    { path: ["url"], message: "Choose an uploaded session version or enter a stable public URL." },
  )
  .refine(
    (material) =>
      material.legacyDownloadUrl === null ||
      (material.kind === "presentation" &&
        material.presentationSource === "session" &&
        material.presentationVersionId !== null),
    {
      path: ["legacyDownloadUrl"],
      message: "Choose an uploaded session presentation before binding a historical download.",
    },
  );
export const sessionHistoryMetadataSchema = z.object({
  legacyFragments: legacyAgendaFragmentsSchema,
  legacyDownloads: legacyAgendaDownloadsSchema,
  sessionSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(160)
    .nullable()
    .default(null),
  legacyPaths: z
    .array(
      sameOriginPathSchema.refine(
        (path) =>
          path.startsWith("/events/") &&
          !path.includes("?") &&
          !path.includes("#") &&
          !/\/(?:register|propose|invite)\//u.test(path),
        "Use an event session or agenda page path without workflow credentials",
      ),
    )
    .max(50)
    .default([]),
  prerequisites: z.string().max(5000).default(""),
  appearances: z.array(sessionAppearanceSchema).max(30).default([]),
  archivalCredits: z.array(sessionArchivalCreditSchema).max(30).default([]),
  archivalTiming: sessionArchivalTimingSchema.nullable().default(null),
  sourceDecisions: z.array(sessionSourceDecisionSchema).max(60).default([]),
  proposalRepresentations: z.array(sessionProposalRepresentationSchema).max(30).default([]),
  materials: z.array(sessionMaterialSchema).max(50).default([]),
});
export type SessionAppearance = z.infer<typeof sessionAppearanceSchema>;
export type SessionMaterial = z.infer<typeof sessionMaterialSchema>;
export type SessionHistoryMetadata = z.infer<typeof sessionHistoryMetadataSchema>;
export { verifiedSessionMaterialLegacyDownload } from "../session-material-legacy-download";
export function publicSessionMaterials(materials: readonly SessionMaterial[]): SessionMaterial[] {
  return materials.filter(
    (material) =>
      material.status === "approved" &&
      material.rightsConfirmed &&
      material.consentConfirmed &&
      material.validated &&
      material.approvedAt !== null,
  );
}

export function publicSessionMediaUrls(materials: readonly SessionMaterial[]) {
  const released = publicSessionMaterials(materials);
  return {
    presentationUrl: released.find((material) => material.kind === "presentation")?.url ?? null,
    recordingUrl: released.find((material) => material.kind === "recording")?.url ?? null,
  };
}

/** The selected release authority excludes editorial titles and unrelated history edits. */
export function sessionMaterialReleaseIdentity(material: SessionMaterial): string {
  return JSON.stringify([
    material.id,
    material.kind,
    material.url,
    material.version,
    material.presentationVersionId,
    material.presentationSource,
    material.legacyDownloadUrl,
    material.approvedAt,
    material.approvalNonce ?? null,
  ]);
}

export const sessionHistoryCorrectionSchema = z.object({
  expectedRevision: z.number().int().min(0),
  history: sessionHistoryMetadataSchema,
});

export const sessionAppearanceChoiceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string(),
});

export const sessionAppearanceChoicesQuerySchema = listQuerySchema(["name"] as const).extend({
  userId: z.string().optional(),
});
export const sessionAppearanceChoicesSchema = paginatedResponseSchema("identities", sessionAppearanceChoiceSchema);
export const sessionMaterialVersionsQuerySchema = listQuerySchema(["uploadedAt"] as const);
export const sessionMaterialVersionChoiceSchema = z.object({
  source: z.enum(["proposal", "session"]).default("proposal"),
  id: z.string(),
  title: z.string(),
  fileName: z.string().nullable(),
  version: z.number().int().positive(),
  reviewStatus: presentationReviewStatusSchema.nullable(),
  uploadedAt: utcInstantSchema,
});
export const sessionMaterialVersionsSchema = paginatedResponseSchema("versions", sessionMaterialVersionChoiceSchema);

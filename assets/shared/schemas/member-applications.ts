import {
  membershipWorkflowProgressSchema,
  membershipWorkflowStepSchema,
  MEMBERSHIP_APPLICATION_LIFECYCLES,
} from "./membership-workflows";
import { z } from "zod";
import { formAnswersContract } from "./form-answer-contract";
import { activeFormSummarySchema, type FormFieldDefinition } from "./forms";
import { MEMBERSHIP_APPLICATION_FORM_KEY, membershipApplicationFields } from "./membership-application-form";
import { tokenSchema } from "./api-common";
import { membershipCategorySchema, membershipCategoryCatalogEntrySchema } from "./membership-categories";
import { formAnswersSchema } from "./form-answers";
import { databaseIdSchema } from "./identifiers";
import { memberApplicationCapabilityQuerySchema } from "./membership-application-capability";
import { membershipApplicantDetailsSchema, refineMembershipApplicant } from "./membership-applicant-policy";
import {
  applicationDocumentUploadFormSchema,
  applicationDocumentUploadHeadersSchema,
  applicationDocumentUploadResponseSchema,
} from "./application-documents";

export { membershipCategorySchema };
export {
  applicationDocumentSchema as applicationDocumentResponseSchema,
  applicationDocumentsListResponseSchema as applicationDocumentListResponseSchema,
  applicationDocumentUploadResponseSchema,
} from "./application-documents";

// Canonical closed-state vocabulary for member_applications.stage. See
// isValidStageTransition() in
// functions/_lib/services/membership/applications/transition.ts, which
// calls this file's own allowedTransitions() below as the actual
// state-machine enforcement; this is its shared, API-facing type, not a
// second source of truth) — PR #1 review §1.3.
export const APPLICATION_STAGES = MEMBERSHIP_APPLICATION_LIFECYCLES;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export const applicationStageSchema = z.enum(APPLICATION_STAGES);
export const APPLICATION_TERMINAL_STAGES = [
  "approved",
  "declined",
  "withdrawn",
] as const satisfies readonly ApplicationStage[];

export function isApplicationTerminalStage(stage: string): boolean {
  return (APPLICATION_TERMINAL_STAGES as readonly string[]).includes(stage);
}

export const ON_HOLD_SUBTYPES = [
  "request_authority",
  "request_org_email",
  "request_pki_experience",
  "request_org_application",
  "request_information",
] as const;
export const onHoldSubtypeSchema = z.enum(ON_HOLD_SUBTYPES);

/**
 * Canonical application stage-transition graph — the single source of
 * truth for both the backend enforcement in
 * functions/_lib/services/membership/applications/transition.ts
 * (isValidStageTransition) and the frontend Applications.tsx admin screen,
 * which previously hand-declared an independent copy of this exact object
 * (PR #1 review, phase1-2-review-20260817.md blocker 9). `approved` has no
 * listed destinations here on purpose — reaching it requires the full
 * onboarding orchestration in approveApplication(), not a bare transition.
 */
export const APPLICATION_STAGE_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  submitted: ["on_hold", "declined", "withdrawn"],
  processing: ["on_hold", "declined", "withdrawn"],
  on_hold: ["processing", "declined", "withdrawn"],
  approved: [],
  declined: [],
  withdrawn: [],
};

/** Pure transition-graph lookup — the one place both the backend
 * (isValidStageTransition) and the frontend (Applications.tsx) read the
 * allowed next stages from, instead of indexing APPLICATION_STAGE_TRANSITIONS directly. */
export function allowedTransitions(from: ApplicationStage): ApplicationStage[] {
  return APPLICATION_STAGE_TRANSITIONS[from];
}

export const memberApplicationCreateSchema = membershipApplicantDetailsSchema.safeExtend({
  applicantName: z.string().trim().min(1, "Name is required").max(160),
  membershipCategory: membershipCategorySchema,
  joinToken: z.string().min(32).max(1024),
  answers: formAnswersSchema.optional(),
});

export function memberApplicationCreateSchemaForCategory(
  category: MemberApplicationFormResponse["categories"][number],
  fields: FormFieldDefinition[],
) {
  const answers = formAnswersContract(membershipApplicationFields(fields, category));
  return memberApplicationCreateSchema.superRefine((input, context) => {
    refineMembershipApplicant(input, category, context);
    const checked = answers.safeParse(input.answers ?? {});
    if (!checked.success)
      for (const issue of checked.error.issues) context.addIssue({ ...issue, path: ["answers", ...issue.path] });
  });
}

export type MemberApplicationCreateInput = z.infer<typeof memberApplicationCreateSchema>;

/**
 * A signed-in person applies as one of the identities they hold. Their name,
 * address, organization, title, bio and links come from that identity on the
 * server, so the request carries only the choice and the remaining answers.
 */
export const memberApplicationCreateAsIdentitySchema = z.object({
  identityId: databaseIdSchema,
  membershipCategory: membershipCategorySchema,
  answers: formAnswersSchema.optional(),
});
export type MemberApplicationCreateAsIdentityInput = z.infer<typeof memberApplicationCreateAsIdentitySchema>;

export function memberApplicationCreateAsIdentitySchemaForCategory(
  category: MemberApplicationFormResponse["categories"][number],
  fields: FormFieldDefinition[],
) {
  const answers = formAnswersContract(membershipApplicationFields(fields, category, { fromIdentity: true }));
  return memberApplicationCreateAsIdentitySchema.superRefine((input, context) => {
    const checked = answers.safeParse(input.answers ?? {});
    if (!checked.success)
      for (const issue of checked.error.issues) context.addIssue({ ...issue, path: ["answers", ...issue.path] });
  });
}

/** True when a submission is made as a signed-in identity rather than through a verified-email link. */
export function isMemberApplicationAsIdentity(body: unknown): boolean {
  return typeof body === "object" && body !== null && "identityId" in body;
}

export const memberApplicationCreateResponseSchema = z.object({
  applicationId: z.string(),
  stage: applicationStageSchema,
  manageToken: z.string().describe("Applicant token for status checks and document uploads — shown once"),
});
export type MemberApplicationCreateResponse = z.infer<typeof memberApplicationCreateResponseSchema>;

export const memberApplicationCreateRouteSchema = {
  tags: ["Members"],
  summary: "Submit a membership application",
  description:
    "Creates a member_applications record and queues the application-received confirmation email through the durable outbox. A verified-email link or a signed-in identity authorizes the applicant.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.union([memberApplicationCreateSchema, memberApplicationCreateAsIdentitySchema]),
        },
      },
      required: true,
    },
  },
  responses: {
    "201": {
      description: "Application created.",
      content: { "application/json": { schema: memberApplicationCreateResponseSchema } },
    },
    "401": { description: "Applying as an identity requires a session." },
    "403": { description: "The session does not hold the chosen identity." },
    "409": {
      description:
        "The organization or applicant is already a member, the applicant represents an organization, or an application is already in progress.",
    },
    "422": { description: "Missing or invalid required fields." },
  },
};

export const memberApplicationStatusResponseSchema = z.object({
  workflow: membershipWorkflowProgressSchema.nullable().optional(),
  id: databaseIdSchema,
  stage: applicationStageSchema,
  membershipCategory: membershipCategorySchema,
  /** The category's current catalog label; null once the category has left the catalog. */
  membershipCategoryLabel: z.string().nullable(),
  stageEnteredAt: z.string(),
  createdAt: z.string(),
});
export type MemberApplicationStatusResponse = z.infer<typeof memberApplicationStatusResponseSchema>;

export const memberApplicationIdParamsSchema = z.object({ id: databaseIdSchema });
const memberApplicationCapabilityRequest = {
  params: memberApplicationIdParamsSchema,
  query: memberApplicationCapabilityQuerySchema,
};

export const memberApplicationStatusRouteSchema = {
  tags: ["Members"],
  summary: "Check membership application status",
  description:
    "Token-gated status check using the original confirmation token or a signed status-only link from an update email.",
  request: {
    ...memberApplicationCapabilityRequest,
    query: memberApplicationCapabilityQuerySchema.extend({ token: tokenSchema }),
  },
  responses: {
    "200": {
      description: "Current application status.",
      content: { "application/json": { schema: memberApplicationStatusResponseSchema } },
    },
    "401": { description: "Missing or invalid token." },
    "404": { description: "Application not found." },
  },
};

export const membershipApplicationFeeSchema = membershipWorkflowStepSchema.options[2].pick({
  label: true,
  instructions: true,
  amount: true,
  currency: true,
  deadlineDays: true,
});

export const membershipApplicationCategorySchema = membershipCategoryCatalogEntrySchema.extend({
  fee: membershipApplicationFeeSchema.nullable(),
  eligibleWorkingGroupIds: z.array(databaseIdSchema),
});

export const memberApplicationFormResponseSchema = z.object({
  categories: z.array(membershipApplicationCategorySchema),
  form: activeFormSummarySchema.extend({ key: z.literal(MEMBERSHIP_APPLICATION_FORM_KEY) }).nullable(),
});
export type MemberApplicationFormResponse = z.infer<typeof memberApplicationFormResponseSchema>;

export const memberApplicationFormRouteSchema = {
  tags: ["Members"],
  summary: "Get the current membership application form definition",
  description: "Returns the active public membership application form definition and configured category fee.",
  responses: {
    "200": {
      description: "Active membership application form, or null if none configured.",
      content: { "application/json": { schema: memberApplicationFormResponseSchema } },
    },
  },
};

export const applicationDocumentUploadRouteSchema = {
  tags: ["Members"],
  summary: "Upload a supporting document for a membership application",
  description: "Token-gated. multipart/form-data with a single 'file' field.",
  request: {
    ...memberApplicationCapabilityRequest,
    headers: applicationDocumentUploadHeadersSchema,
    body: {
      content: { "multipart/form-data": { schema: applicationDocumentUploadFormSchema } },
      required: true,
    },
  },
  responses: {
    "201": {
      description: "Document stored.",
      content: { "application/json": { schema: applicationDocumentUploadResponseSchema } },
    },
    "401": { description: "Missing or invalid token." },
    "404": { description: "Application not found." },
    "413": { description: "File too large." },
    "415": { description: "Unsupported file type." },
  },
};

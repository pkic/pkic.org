import { z } from "zod";
import { formFieldDefinitionSchema } from "./forms";
import { normalizedEmailSchema } from "./api-common";
import {
  membershipCategorySchema,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  requiresUniversityEmail,
} from "./membership-categories";
import { formAnswersSchema } from "./form-answers";
import { databaseIdSchema } from "./identifiers";
import { isPersonalEmailAddress } from "../constants/email-domains";
import {
  applicationDocumentsListQuerySchema,
  applicationDocumentsListResponseSchema,
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
export const APPLICATION_STAGES = [
  "pending",
  "in_review",
  "on_hold",
  "in_consultation",
  "ec_review",
  "approved",
  "declined",
  "withdrawn",
] as const;
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
  pending: ["in_review", "withdrawn"],
  in_review: ["on_hold", "in_consultation", "declined", "withdrawn"],
  on_hold: ["in_review", "withdrawn"],
  in_consultation: ["ec_review", "withdrawn"],
  ec_review: ["declined", "withdrawn"],
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

export const memberApplicationCreateSchema = z
  .object({
    applicantEmail: normalizedEmailSchema,
    applicantName: z.string().trim().min(1, "Name is required").max(160),
    membershipCategory: membershipCategorySchema,
    organizationName: z.string().trim().min(1).max(200).optional(),
    /** Validated answers keyed by form_fields.key (see GET .../applications/form). */
    answers: formAnswersSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(value.membershipCategory);
    if (!isIndividual && !value.organizationName) {
      ctx.addIssue({
        code: "custom",
        path: ["organizationName"],
        message: "Organization name is required for this membership category",
      });
    }
    if (requiresUniversityEmail(value.membershipCategory) && isPersonalEmailAddress(value.applicantEmail)) {
      ctx.addIssue({
        code: "custom",
        path: ["applicantEmail"],
        message: "Category H5 requires a university email address; personal email providers are not accepted",
      });
    }
  });

export type MemberApplicationCreateInput = z.infer<typeof memberApplicationCreateSchema>;

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
    "Creates a member_applications record and queues the application-received confirmation email through the durable outbox.",
  request: {
    body: { content: { "application/json": { schema: memberApplicationCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Application created.",
      content: { "application/json": { schema: memberApplicationCreateResponseSchema } },
    },
    "409": { description: "An active application already exists for this organization domain." },
    "422": { description: "Missing or invalid required fields." },
  },
};

export const memberApplicationStatusResponseSchema = z.object({
  id: databaseIdSchema,
  stage: applicationStageSchema,
  stageEnteredAt: z.string(),
  createdAt: z.string(),
});
export type MemberApplicationStatusResponse = z.infer<typeof memberApplicationStatusResponseSchema>;

export const memberApplicationIdParamsSchema = z.object({ id: databaseIdSchema });
export const memberApplicationCapabilityQuerySchema = z.object({ token: z.string().min(16).max(64) });
const memberApplicationCapabilityRequest = {
  params: memberApplicationIdParamsSchema,
  query: memberApplicationCapabilityQuerySchema,
};

export const memberApplicationStatusRouteSchema = {
  tags: ["Members"],
  summary: "Check membership application status",
  description: "Token-gated status check for an applicant. Token is issued once at submission time.",
  request: memberApplicationCapabilityRequest,
  responses: {
    "200": {
      description: "Current application status.",
      content: { "application/json": { schema: memberApplicationStatusResponseSchema } },
    },
    "401": { description: "Missing or invalid token." },
    "404": { description: "Application not found." },
  },
};

export const memberApplicationFormResponseSchema = z.object({
  form: z
    .object({
      id: z.string(),
      key: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      fields: z.array(formFieldDefinitionSchema),
    })
    .nullable(),
});
export type MemberApplicationFormResponse = z.infer<typeof memberApplicationFormResponseSchema>;

export const memberApplicationFormRouteSchema = {
  tags: ["Members"],
  summary: "Get the current membership application form definition",
  description: "Portal-managed form fields — staff-editable via the existing /api/v1/admin/forms endpoints.",
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

export const applicationConcernCreateSchema = z.object({
  concernText: z.string().trim().min(1).max(5000),
});

export const applicationConcernResponseSchema = z.object({
  id: databaseIdSchema,
  createdAt: z.string(),
});

export const applicationConcernCreateRouteSchema = {
  tags: ["Members"],
  summary: "Submit a consultation concern (A-G members only)",
  description:
    "Visible only to staff/processors, never to the applicant. Member-session gated; only A-G category members may submit.",
  request: {
    params: memberApplicationIdParamsSchema,
    body: { content: { "application/json": { schema: applicationConcernCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Concern recorded.",
      content: { "application/json": { schema: applicationConcernResponseSchema } },
    },
    "403": { description: "Only A-G category members may submit a concern." },
    "404": { description: "Application not found." },
    "409": { description: "Application is not currently in consultation." },
  },
};

export const applicationDocumentListRouteSchema = {
  tags: ["Members"],
  summary: "List a membership applicant's own uploaded documents",
  description: "Token-gated.",
  request: {
    params: memberApplicationIdParamsSchema,
    query: memberApplicationCapabilityQuerySchema.merge(applicationDocumentsListQuerySchema),
  },
  responses: {
    "200": {
      description: "Documents uploaded for this application.",
      content: { "application/json": { schema: applicationDocumentsListResponseSchema } },
    },
    "401": { description: "Missing or invalid token." },
    "404": { description: "Application not found." },
  },
};

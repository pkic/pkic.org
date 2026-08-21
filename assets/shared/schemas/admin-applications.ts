/**
 * Admin membership application endpoints — list/detail, stage
 * transitions, communications/notes, EC decision staff override, approval.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema } from "./api-common";
import { membershipCategorySchema, applicationStageSchema, onHoldSubtypeSchema } from "./member-applications";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { ecDecisionCreateSchema, ecDecisionValueSchema } from "./ec-review";

/** Allowlisted sort columns for GET /api/v1/admin/applications — see listAdminApplications. */
export const ADMIN_APPLICATIONS_SORT_COLUMNS = [
  "applicant_name",
  "organization_name",
  "membership_category",
  "stage",
  "created_at",
] as const;

export const adminApplicationsListQuerySchema = listQuerySchema(ADMIN_APPLICATIONS_SORT_COLUMNS).extend({
  stage: applicationStageSchema.optional(),
});

export const adminApplicationSummarySchema = z.object({
  id: z.string(),
  applicantEmail: z.string(),
  applicantName: z.string(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string(),
  stage: applicationStageSchema,
  onHoldSubtype: onHoldSubtypeSchema.nullable(),
  assignedToUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminApplicationSummary = z.infer<typeof adminApplicationSummarySchema>;
export const adminApplicationsListResponseSchema = paginatedResponseSchema(
  "applications",
  adminApplicationSummarySchema,
);

export const adminApplicationEventSchema = z.object({
  fromStage: applicationStageSchema.nullable(),
  toStage: applicationStageSchema,
  actorUserId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const adminApplicationCommunicationSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  kind: z.enum(["communication", "note"]),
  actorUserId: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  templateKey: z.string().nullable(),
  emailOutboxId: z.string().nullable(),
  createdAt: z.string(),
});

export const adminApplicationConcernSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  submittedByUserId: z.string(),
  concernText: z.string(),
  createdAt: z.string(),
});

export const adminApplicationEcDecisionSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  ecMemberUserId: z.string(),
  decision: ecDecisionValueSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const adminApplicationDocumentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.string(),
  uploadedByEmail: z.string(),
});

export const adminApplicationDetailSchema = adminApplicationSummarySchema.extend({
  stageEnteredAt: z.string(),
  answers: z.record(z.string(), z.unknown()),
  events: z.array(adminApplicationEventSchema),
  communications: z.array(adminApplicationCommunicationSchema),
  concerns: z.array(adminApplicationConcernSchema),
  ecDecisions: z.array(adminApplicationEcDecisionSchema),
  documents: z.array(adminApplicationDocumentSchema),
});
export type AdminApplicationDetail = z.infer<typeof adminApplicationDetailSchema>;
export type AdminApplicationEvent = z.infer<typeof adminApplicationEventSchema>;
export type AdminApplicationCommunication = z.infer<typeof adminApplicationCommunicationSchema>;
export type AdminApplicationConcern = z.infer<typeof adminApplicationConcernSchema>;
export type AdminApplicationEcDecision = z.infer<typeof adminApplicationEcDecisionSchema>;
export type AdminApplicationDocument = z.infer<typeof adminApplicationDocumentSchema>;

export const adminApplicationsListRouteSchema = {
  tags: ["Membership"],
  summary: "List membership applications (staff)",
  request: { query: adminApplicationsListQuerySchema },
  responses: {
    "200": {
      description: "Applications list.",
      content: {
        "application/json": { schema: adminApplicationsListResponseSchema },
      },
    },
  },
};

export const adminApplicationDetailRouteSchema = {
  tags: ["Membership"],
  summary: "Get a membership application's full detail (staff)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Application detail.",
      content: { "application/json": { schema: adminApplicationDetailSchema } },
    },
    "404": { description: "Application not found." },
  },
};

export const applicationStageTransitionSchema = z.object({
  // "pending" and "approved" are deliberately excluded: pending is only a
  // starting state, and reaching approved requires the full onboarding
  // orchestration in approveApplication() (approve.ts), not a bare stage
  // flip — see isValidStageTransition() in
  // functions/_lib/services/membership/applications/transition.ts.
  toStage: applicationStageSchema.exclude(["pending", "approved"]),
  onHoldSubtype: onHoldSubtypeSchema.optional(),
  note: z.string().trim().max(2000).optional(),
});

export const applicationStageTransitionRouteSchema = {
  tags: ["Membership"],
  summary: "Transition a membership application's stage",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: applicationStageTransitionSchema } }, required: true },
  },
  responses: {
    "200": { description: "Stage transitioned." },
    "404": { description: "Application not found." },
    "409": { description: "Invalid transition for the application's current stage." },
    "422": { description: "on_hold requires a valid onHoldSubtype." },
  },
};

export const applicationCommunicationCreateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  templateKey: z.string().trim().max(80).optional(),
});

export const applicationCommunicationCreateRouteSchema = {
  tags: ["Membership"],
  summary: "Send a communication to an applicant",
  description: "Queues an email via the existing email_outbox and records it on the application's staff-only timeline.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: applicationCommunicationCreateSchema } }, required: true },
  },
  responses: {
    "201": { description: "Communication sent and recorded." },
    "404": { description: "Application not found." },
  },
};

export const applicationNoteCreateSchema = z.object({
  body: z.string().trim().min(1).max(20000),
});

export const applicationNoteCreateRouteSchema = {
  tags: ["Membership"],
  summary: "Add an internal note to an application",
  description: "Never emailed; visible only to staff/processors.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: applicationNoteCreateSchema } }, required: true },
  },
  responses: {
    "201": { description: "Note recorded." },
    "404": { description: "Application not found." },
  },
};

export const adminEcDecisionCreateSchema = ecDecisionCreateSchema.safeExtend({
  ecMemberUserId: databaseIdSchema,
});

export const adminEcDecisionCreateRouteSchema = {
  tags: ["Membership"],
  summary: "Record an EC decision on behalf of an EC member (staff override)",
  description: "Fallback for exceptional access cases; written to audit_log with actor and reason.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: adminEcDecisionCreateSchema } }, required: true },
  },
  responses: {
    "201": { description: "Decision recorded." },
    "404": { description: "Application not found." },
    "409": { description: "Application is not currently in EC review." },
    "400": { description: "Missing required reason for a decline." },
  },
};

export const applicationApproveRouteSchema = {
  tags: ["Membership"],
  summary: "Approve an application and run post-approval onboarding",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "Application approved and member provisioned." },
    "404": { description: "Application not found." },
    "409": { description: "Application must be in ec_review to approve." },
  },
};

// ── Edit application fields (correction of applicant-submitted data) ───────
//
// Distinct from the stage machine (applicationStageTransitionSchema, above):
// this lets staff correct typos/mistakes in what the applicant originally
// submitted (e.g. a mistyped email domain) without moving the application
// through any stage. Only a fixed subset of top-level columns plus a fixed
// subset of form_submission_answers keys are editable — see
// admin-applications.ts's updateAdminApplication for the upsert behavior.

export const applicationEditableAnswersSchema = z.object({
  job_title: z.string().trim().max(200).nullable().optional(),
  linkedin: z.string().trim().max(500).nullable().optional(),
  organization_website: z.string().trim().max(500).nullable().optional(),
  about_yourself: z.string().trim().max(5000).nullable().optional(),
  about_organization: z.string().trim().max(5000).nullable().optional(),
  reason: z.string().trim().max(5000).nullable().optional(),
});

export const applicationUpdateSchema = z
  .object({
    applicantName: z.string().trim().min(1).max(160).optional(),
    applicantEmail: normalizedEmailSchema.optional(),
    organizationName: z.string().trim().min(1).max(200).nullable().optional(),
    membershipCategory: membershipCategorySchema.optional(),
    answers: applicationEditableAnswersSchema.optional(),
  })
  .refine(
    (value) =>
      value.applicantName !== undefined ||
      value.applicantEmail !== undefined ||
      value.organizationName !== undefined ||
      value.membershipCategory !== undefined ||
      value.answers !== undefined,
    { message: "At least one field must be provided" },
  );

export const applicationUpdateRouteSchema = {
  tags: ["Membership"],
  summary: "Correct an applicant's submitted fields (staff, does not transition stage)",
  description:
    "Edits applicantName/applicantEmail/organizationName/membershipCategory and a fixed subset of form_submission_answers keys. Writes an audit_log entry and a member_application_events row so the correction is visible in the timeline.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: applicationUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Application updated." },
    "404": { description: "Application not found." },
    "422": { description: "Invalid field values." },
  },
};

export const adminApplicationDocumentsListRouteSchema = {
  tags: ["Membership"],
  summary: "List all documents uploaded for an application (staff)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "Documents." },
    "404": { description: "Application not found." },
  },
};

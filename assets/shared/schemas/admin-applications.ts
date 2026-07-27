/**
 * Admin membership application endpoints (PRD §4.2) — list/detail, stage
 * transitions, communications/notes, EC decision staff override, approval.
 */
import { z } from "zod";
import { normalizedEmailSchema } from "./api";
import { membershipCategorySchema } from "./member-applications";

/** Allowlisted sort columns for GET /api/v1/admin/applications — see listAdminApplications. */
export const ADMIN_APPLICATIONS_SORT_COLUMNS = [
  "applicant_name",
  "organization_name",
  "membership_category",
  "stage",
  "created_at",
] as const;

const sortValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(41)
  .refine(
    (value) => {
      const field = value.startsWith("-") ? value.slice(1) : value;
      return (ADMIN_APPLICATIONS_SORT_COLUMNS as readonly string[]).includes(field);
    },
    { message: "Unknown sort column" },
  )
  .optional();

export const adminApplicationsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  stage: z.string().trim().min(1).max(40).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  sort: sortValueSchema,
});

export const adminApplicationSummarySchema = z.object({
  id: z.string(),
  applicantEmail: z.string(),
  applicantName: z.string(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string(),
  status: z.string(),
  stage: z.string(),
  onHoldSubtype: z.string().nullable(),
  assignedToUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const adminApplicationsListRouteSchema = {
  tags: ["Membership"],
  summary: "List membership applications (staff)",
  request: { query: adminApplicationsListQuerySchema },
  responses: {
    "200": {
      description: "Applications list.",
      content: {
        "application/json": {
          schema: z.object({
            applications: z.array(adminApplicationSummarySchema),
            page: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
          }),
        },
      },
    },
  },
};

export const adminApplicationDetailRouteSchema = {
  tags: ["Membership"],
  summary: "Get a membership application's full detail (staff)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "Application detail." },
    "404": { description: "Application not found." },
  },
};

const ON_HOLD_SUBTYPES = [
  "request_authority",
  "request_org_email",
  "request_pki_experience",
  "request_org_application",
  "request_information",
] as const;

export const applicationStageTransitionSchema = z.object({
  toStage: z.enum(["in_review", "on_hold", "in_consultation", "ec_review", "declined", "withdrawn"]),
  onHoldSubtype: z.enum(ON_HOLD_SUBTYPES).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const applicationStageTransitionRouteSchema = {
  tags: ["Membership"],
  summary: "Transition a membership application's stage (PRD §4.2)",
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
  summary: "Send a communication to an applicant (PRD §4.2)",
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
  summary: "Add an internal note to an application (PRD §4.2)",
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

export const adminEcDecisionCreateSchema = z
  .object({
    ecMemberUserId: z.uuid(),
    decision: z.enum(["approve", "decline"]),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "decline" && !value.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required when declining" });
    }
  });

export const adminEcDecisionCreateRouteSchema = {
  tags: ["Membership"],
  summary: "Record an EC decision on behalf of an EC member (staff override, PRD §4.6)",
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
  summary: "Approve an application and run post-approval onboarding (PRD §4.7)",
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
// subset of answers_json keys are editable — see admin-applications.ts's
// updateAdminApplication for the merge behavior on answers_json.

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
    "Edits applicantName/applicantEmail/organizationName/membershipCategory and a fixed subset of answers_json keys. Writes an audit_log entry and a member_application_events row so the correction is visible in the timeline.",
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

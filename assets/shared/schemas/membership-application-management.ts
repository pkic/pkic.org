/**
 * Staff membership application management — list/detail, stage
 * transitions, communications/notes, EC decision staff override, approval.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema } from "./api-common";
import { membershipCategorySchema, applicationStageSchema, onHoldSubtypeSchema } from "./member-applications";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { ecDecisionCreateSchema, ecDecisionValueSchema } from "./ec-review";
import { httpUrlSchema } from "./urls";
import { groupLabelSchema } from "./groups";
import { requiresPermissions } from "./route-contract";
/** Allowlisted sort columns for GET /api/v1/members/applications — see listMembershipApplications. */
export const MEMBERSHIP_APPLICATIONS_SORT_COLUMNS = [
  "applicant_name",
  "organization_name",
  "membership_category",
  "stage",
  "created_at",
] as const;

export const membershipApplicationsListQuerySchema = listQuerySchema(MEMBERSHIP_APPLICATIONS_SORT_COLUMNS).extend({
  stage: applicationStageSchema.optional(),
});
export type MembershipApplicationsListQuery = z.infer<typeof membershipApplicationsListQuerySchema>;

export const membershipApplicationSummarySchema = z.object({
  id: z.string(),
  applicantEmail: z.string(),
  applicantName: z.string(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string(),
  membershipCategoryLabel: z.string(),
  stage: applicationStageSchema,
  onHoldSubtype: onHoldSubtypeSchema.nullable(),
  assignedToUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MembershipApplicationSummary = z.infer<typeof membershipApplicationSummarySchema>;
export const membershipApplicationsListResponseSchema = paginatedResponseSchema(
  "applications",
  membershipApplicationSummarySchema,
);

export const membershipApplicationEventSchema = z.object({
  fromStage: applicationStageSchema.nullable(),
  toStage: applicationStageSchema,
  actorUserId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const membershipApplicationCommunicationSchema = z.object({
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

export const membershipApplicationConcernSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  submittedByUserId: z.string(),
  concernText: z.string(),
  createdAt: z.string(),
});

export const membershipApplicationEcDecisionSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  ecMemberUserId: z.string(),
  decision: ecDecisionValueSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const membershipApplicationDetailSchema = membershipApplicationSummarySchema.extend({
  stageEnteredAt: z.string(),
  answers: z.record(z.string(), z.unknown()),
  requestedWorkingGroups: z.array(groupLabelSchema.pick({ slug: true, name: true })),
  events: z.array(membershipApplicationEventSchema),
  communications: z.array(membershipApplicationCommunicationSchema),
  concerns: z.array(membershipApplicationConcernSchema),
  ecDecisions: z.array(membershipApplicationEcDecisionSchema),
});
export const applicationStageTransitionResponseSchema = z.object({
  id: databaseIdSchema,
  stage: applicationStageSchema,
  onHoldSubtype: onHoldSubtypeSchema.nullable(),
});
export const applicationCommunicationCreateResponseSchema = z.object({ id: databaseIdSchema, createdAt: z.string() });
export const applicationNoteCreateResponseSchema = applicationCommunicationCreateResponseSchema;
export const ecDecisionRecordResponseSchema = membershipApplicationEcDecisionSchema;
export const applicationApproveResponseSchema = z.object({
  applicationId: databaseIdSchema,
  memberId: databaseIdSchema,
  userId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  workingGroupSlugs: z.array(z.string()),
});
export type MembershipApplicationDetail = z.infer<typeof membershipApplicationDetailSchema>;
export type MembershipApplicationEvent = z.infer<typeof membershipApplicationEventSchema>;
export type MembershipApplicationCommunication = z.infer<typeof membershipApplicationCommunicationSchema>;
export type MembershipApplicationConcern = z.infer<typeof membershipApplicationConcernSchema>;
export type MembershipApplicationEcDecision = z.infer<typeof membershipApplicationEcDecisionSchema>;

export const membershipApplicationsListRouteSchema = {
  ...requiresPermissions("membership:read"),
  tags: ["Membership"],
  summary: "List membership applications (staff)",
  request: { query: membershipApplicationsListQuerySchema },
  responses: {
    "200": {
      description: "Applications list.",
      content: {
        "application/json": { schema: membershipApplicationsListResponseSchema },
      },
    },
  },
};

export const membershipApplicationDetailRouteSchema = {
  ...requiresPermissions("membership:read"),
  tags: ["Membership"],
  summary: "Get a membership application's full detail (staff)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Application detail.",
      content: { "application/json": { schema: membershipApplicationDetailSchema } },
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
  ...requiresPermissions("membership:write"),
  tags: ["Membership"],
  summary: "Transition a membership application's stage",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: applicationStageTransitionSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Stage transitioned.",
      content: { "application/json": { schema: applicationStageTransitionResponseSchema } },
    },
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
  ...requiresPermissions("membership:write"),
  tags: ["Membership"],
  summary: "Send a communication to an applicant",
  description: "Queues an email via the existing email_outbox and records it on the application's staff-only timeline.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: applicationCommunicationCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Communication sent and recorded.",
      content: { "application/json": { schema: applicationCommunicationCreateResponseSchema } },
    },
    "404": { description: "Application not found." },
  },
};

export const applicationNoteCreateSchema = z.object({
  body: z.string().trim().min(1).max(20000),
});

export const applicationNoteCreateRouteSchema = {
  ...requiresPermissions("membership:write"),
  tags: ["Membership"],
  summary: "Add an internal note to an application",
  description: "Never emailed; visible only to staff/processors.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: applicationNoteCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Note recorded.",
      content: { "application/json": { schema: applicationNoteCreateResponseSchema } },
    },
    "404": { description: "Application not found." },
  },
};

export const ecDecisionRecordSchema = ecDecisionCreateSchema.safeExtend({
  ecMemberUserId: databaseIdSchema.optional(),
});

export const ecDecisionRecordRouteSchema = {
  tags: ["Membership"],
  "x-pkic-auth": { required: true },
  summary: "Record an Executive Council decision",
  description:
    "An Executive Council member records their own decision by omitting ecMemberUserId. Staff with membership:approve may name an EC member only as an exceptional override. Both paths use the same application decision resource and audit trail.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: ecDecisionRecordSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Decision recorded.",
      content: { "application/json": { schema: ecDecisionRecordResponseSchema } },
    },
    "403": { description: "EC membership or membership:approve permission required." },
    "404": { description: "Application not found." },
    "409": { description: "Application is not currently in EC review." },
    "400": { description: "Missing required reason for a decline." },
  },
};

export const applicationApproveRouteSchema = {
  ...requiresPermissions("membership:approve"),
  tags: ["Membership"],
  summary: "Approve an application and run post-approval onboarding",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Application approved and member provisioned.",
      content: { "application/json": { schema: applicationApproveResponseSchema } },
    },
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
// functions/_lib/services/membership/applications/management.ts for the upsert behavior.

export const applicationEditableAnswersSchema = z.object({
  job_title: z.string().trim().max(200).nullable().optional(),
  linkedin: httpUrlSchema.nullable().optional(),
  organization_website: httpUrlSchema.nullable().optional(),
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
  ...requiresPermissions("membership:write"),
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
    "409": { description: "The application changed concurrently or the corrected organization domain is unavailable." },
    "422": { description: "Invalid field values." },
  },
};

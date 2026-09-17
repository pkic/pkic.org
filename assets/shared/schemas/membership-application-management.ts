/**
 * Staff membership application management — list/detail, stage
 * transitions, communications/notes, and evidence-based approval.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema } from "./api-common";
import { membershipCategorySchema, applicationStageSchema, onHoldSubtypeSchema } from "./member-applications";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
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
  currentRequirement: z.string().nullable().default(null),
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

export const membershipApplicationDetailSchema = membershipApplicationSummarySchema.extend({
  stageEnteredAt: z.string(),
  answers: z.record(z.string(), z.unknown()),
  requestedWorkingGroups: z.array(groupLabelSchema.pick({ slug: true, name: true })),
  events: z.array(membershipApplicationEventSchema),
  communications: z.array(membershipApplicationCommunicationSchema),
});
export const applicationStageTransitionResponseSchema = z.object({
  id: databaseIdSchema,
  stage: applicationStageSchema,
  onHoldSubtype: onHoldSubtypeSchema.nullable(),
});
export const applicationCommunicationCreateResponseSchema = z.object({ id: databaseIdSchema, createdAt: z.string() });
export const applicationNoteCreateResponseSchema = applicationCommunicationCreateResponseSchema;
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

export const applicationStageTransitionSchema = z
  .object({
    // Submission and approval belong to their evidence-owning use cases.
    toStage: applicationStageSchema.extract(["processing", "on_hold", "declined", "withdrawn"]),
    onHoldSubtype: onHoldSubtypeSchema.optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((input, context) => {
    if (input.toStage === "on_hold" && !input.onHoldSubtype)
      context.addIssue({
        code: "custom",
        path: ["onHoldSubtype"],
        message: "Choose the information needed from the applicant.",
      });
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

/**
 * Sending one staff-written communication to an applicant.
 *
 * The absence of `templateKey` is the contract, not a gap in it: a
 * communication with no template chosen *is* the message, and the `subject`
 * and `body` typed here are delivered exactly as written. Naming a
 * `templateKey` opts into a stored template instead, and that template's own
 * subject line and content then apply. There is no implicit default — an
 * omitted key never silently borrows the template of some other workflow,
 * which would deliver a canned subject while the application's timeline
 * showed the one staff typed.
 */
export const applicationCommunicationCreateSchema = z.object({
  subject: z.string().trim().min(1, "Enter a subject for the email.").max(200),
  body: z.string().trim().min(1, "Enter the message to send.").max(20000),
  templateKey: z.string().trim().min(1).max(80).optional(),
});
export type ApplicationCommunicationCreate = z.infer<typeof applicationCommunicationCreateSchema>;

export const applicationCommunicationCreateRouteSchema = {
  ...requiresPermissions("membership:write"),
  tags: ["Membership"],
  summary: "Send a communication to an applicant",
  description:
    "Queues an email via the existing email_outbox and records it on the application's staff-only timeline. " +
    "With no templateKey the typed subject and body are delivered verbatim; a templateKey renders that stored " +
    "template and takes its subject line from it.",
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
  body: z.string().trim().min(1, "Enter the note to record.").max(20000),
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
    "409": { description: "Every required workflow step must be satisfied before approval." },
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

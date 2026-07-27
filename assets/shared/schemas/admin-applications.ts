/**
 * Admin membership application endpoints (PRD §4.2) — list/detail, stage
 * transitions, communications/notes, EC decision staff override, approval.
 */
import { z } from "zod";

export const adminApplicationsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  stage: z.string().trim().min(1).max(40).optional(),
  status: z.string().trim().min(1).max(40).optional(),
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

export const adminApplicationDocumentsListRouteSchema = {
  tags: ["Membership"],
  summary: "List all documents uploaded for an application (staff)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "Documents." },
    "404": { description: "Application not found." },
  },
};

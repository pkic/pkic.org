import { z } from "zod";
import { normalizedEmailSchema } from "./api";

/**
 * Schemas for POST /api/v1/members/applications and its supporting
 * endpoints (PRD §1.2). Membership categories mirror
 * functions/_lib/services/member-applications.ts MEMBERSHIP_CATEGORIES.
 */
export const membershipCategorySchema = z.enum([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "H7",
  "H8",
]);

export const memberApplicationCreateSchema = z
  .object({
    applicantEmail: normalizedEmailSchema,
    applicantName: z.string().trim().min(1, "Name is required").max(160),
    membershipCategory: membershipCategorySchema,
    organizationName: z.string().trim().min(1).max(200).optional(),
    /** Free-form answers keyed by form_fields.key (see GET .../applications/form). */
    answers: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    const isIndividual = value.membershipCategory === "H5" || value.membershipCategory === "H6" || value.membershipCategory === "H7";
    if (!isIndividual && !value.organizationName) {
      ctx.addIssue({
        code: "custom",
        path: ["organizationName"],
        message: "Organization name is required for this membership category",
      });
    }
  });

export type MemberApplicationCreateInput = z.infer<typeof memberApplicationCreateSchema>;

export const memberApplicationCreateResponseSchema = z.object({
  applicationId: z.string(),
  status: z.string(),
  stage: z.string(),
  manageToken: z.string().describe("Applicant token for status checks and document uploads — shown once"),
});

export const memberApplicationCreateRouteSchema = {
  tags: ["Members"],
  summary: "Submit a membership application",
  description:
    "Creates a member_applications record and queues the application-received confirmation email. Replaces POST /api/v1/forms (form_type=membership).",
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
  id: z.string(),
  status: z.string(),
  stage: z.string(),
  stageEnteredAt: z.string(),
  createdAt: z.string(),
});

export const memberApplicationStatusRouteSchema = {
  tags: ["Members"],
  summary: "Check membership application status",
  description: "Token-gated status check for an applicant. Token is issued once at submission time.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ token: z.string().min(16).max(64) }),
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

export const memberApplicationFormResponseSchema = z.object({
  form: z
    .object({
      id: z.string(),
      key: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      fields: z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          label: z.string(),
          fieldType: z.string(),
          required: z.boolean(),
          options: z.unknown().nullable(),
          validation: z.unknown().nullable(),
          sortOrder: z.number(),
        }),
      ),
    })
    .nullable(),
});

export const memberApplicationFormRouteSchema = {
  tags: ["Members"],
  summary: "Get the current membership application form definition",
  description: "Portal-managed form fields (PRD §1.4) — staff-editable via the existing /api/v1/admin/forms endpoints.",
  responses: {
    "200": {
      description: "Active membership application form, or null if none configured.",
      content: { "application/json": { schema: memberApplicationFormResponseSchema } },
    },
  },
};

export const applicationDocumentResponseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number(),
  uploadedAt: z.string(),
});

export const applicationDocumentUploadResponseSchema = z.object({
  document: applicationDocumentResponseSchema,
});

export const applicationDocumentUploadRouteSchema = {
  tags: ["Members"],
  summary: "Upload a supporting document for a membership application",
  description: "Token-gated. multipart/form-data with a single 'file' field.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ token: z.string().min(16).max(64) }),
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

export const applicationDocumentListResponseSchema = z.object({
  documents: z.array(applicationDocumentResponseSchema),
});

export const applicationDocumentListRouteSchema = {
  tags: ["Members"],
  summary: "List a membership applicant's own uploaded documents",
  description: "Token-gated.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ token: z.string().min(16).max(64) }),
  },
  responses: {
    "200": {
      description: "Documents uploaded for this application.",
      content: { "application/json": { schema: applicationDocumentListResponseSchema } },
    },
    "401": { description: "Missing or invalid token." },
    "404": { description: "Application not found." },
  },
};

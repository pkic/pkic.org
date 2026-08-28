import { z } from "zod";
import { normalizedEmailSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { memberApplicationManageTokenSchema } from "./membership-application-capability";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchemaWithDefault } from "./pagination";

/** Canonical upload policy shared by the OpenAPI contract and backend validation. */
export const APPLICATION_DOCUMENT_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const applicationDocumentMimeTypeSchema = z.enum(APPLICATION_DOCUMENT_ALLOWED_MIME_TYPES);

export const APPLICATION_DOCUMENT_SORT_KEYS = ["filename", "mimeType", "fileSizeBytes", "uploadedAt"] as const;

export const applicationDocumentsListQuerySchema = searchableListQuerySchema(
  sortColumnSchemaWithDefault(APPLICATION_DOCUMENT_SORT_KEYS, "-uploadedAt"),
  { limit: 25 },
);
export type ApplicationDocumentsListQuery = z.infer<typeof applicationDocumentsListQuerySchema>;

/** An applicant capability selects the applicant-safe projection; no token selects the staff projection. */
export const applicationDocumentsReadQuerySchema = applicationDocumentsListQuerySchema.extend({
  token: memberApplicationManageTokenSchema.optional(),
});

export const applicationDocumentSchema = z.object({
  id: databaseIdSchema,
  filename: z.string().min(1).max(100),
  mimeType: applicationDocumentMimeTypeSchema,
  fileSizeBytes: z.number().int().positive(),
  uploadedAt: z.string(),
});
export type ApplicationDocument = z.infer<typeof applicationDocumentSchema>;

export const staffApplicationDocumentSchema = applicationDocumentSchema.extend({
  uploadedByEmail: normalizedEmailSchema,
});
export type StaffApplicationDocument = z.infer<typeof staffApplicationDocumentSchema>;

export const applicationDocumentUploadHeadersSchema = z.object({
  "idempotency-key": z
    .string()
    .trim()
    .min(16)
    .max(128)
    .regex(/^[\x21-\x7e]+$/, "Idempotency-Key must contain printable ASCII without spaces"),
});

/** Documentation schema; Chanfana validates params/query/headers and the service validates the multipart file. */
export const applicationDocumentUploadFormSchema = z.object({
  file: z.any().describe(`Supporting document (${APPLICATION_DOCUMENT_ALLOWED_MIME_TYPES.join(", ")})`),
});

export const applicationDocumentUploadResponseSchema = z.object({
  document: applicationDocumentSchema,
});

export const applicationDocumentsListResponseSchema = paginatedResponseSchema("documents", applicationDocumentSchema);
export type ApplicationDocumentsListResponse = z.infer<typeof applicationDocumentsListResponseSchema>;

export const staffApplicationDocumentsListResponseSchema = paginatedResponseSchema(
  "documents",
  staffApplicationDocumentSchema,
);
export type StaffApplicationDocumentsListResponse = z.infer<typeof staffApplicationDocumentsListResponseSchema>;

/** The staff document schema extends the applicant-safe base document schema. */
export const applicationDocumentsReadResponseSchema = z.union([
  staffApplicationDocumentsListResponseSchema,
  applicationDocumentsListResponseSchema,
]);

export const applicationDocumentsReadRouteSchema = {
  tags: ["Members"],
  summary: "List membership application documents",
  description:
    "With a valid applicant token, returns the applicant-safe document projection. Without a token, requires a live user-backed membership:read permission and returns the staff projection, including uploader email.",
  request: {
    params: z.object({ id: databaseIdSchema }),
    query: applicationDocumentsReadQuerySchema,
  },
  responses: {
    "200": {
      description: "Applicant-safe or staff document projection, selected by the request authentication context.",
      content: { "application/json": { schema: applicationDocumentsReadResponseSchema } },
    },
    "401": { description: "Invalid applicant token." },
    "403": { description: "A token was not supplied and the caller lacks membership:read." },
    "404": { description: "Application not found for an authorized staff request." },
  },
};

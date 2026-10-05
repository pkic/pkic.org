import { sessionPresentationReleaseParamsSchema } from "../session-presentation-public-url";
import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { ok, authErrors, requiresPermissions } from "./route-contract";
import {
  sessionPresentationVersionResponseSchema,
  sessionPresentationVersionsSchema,
  sessionPresentationVersionsQuerySchema,
  sessionPresentationReviewRequestSchema,
} from "./session-presentation-versions";
const params = eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema });
const versionParams = params.extend({ versionId: databaseIdSchema });
const read = { tags: ["Session presentations"], ...requiresPermissions("agenda:read") };
const write = { tags: ["Session presentations"], ...requiresPermissions("agenda:write") };
const errors = authErrors({
  notFound: "Session or presentation version not found",
  conflict: "Presentation access or version changed",
  badRequest: "Invalid presentation request",
});
export const sessionPresentationListRouteSchema = {
  ...read,
  summary: "List a session's presentation versions",
  request: { params, query: sessionPresentationVersionsQuerySchema },
  responses: { ...errors, ...ok("Presentation versions", sessionPresentationVersionsSchema) },
};
export const sessionPresentationUploadRouteSchema = {
  ...write,
  summary: "Upload a session presentation version",
  request: { params },
  responses: {
    ...errors,
    ...ok("Uploaded draft version", sessionPresentationVersionResponseSchema),
    "413": { description: "Presentation too large" },
    "415": { description: "Unsupported presentation type" },
    "503": { description: "Presentation storage unavailable" },
  },
};
export const sessionPresentationReviewRouteSchema = {
  ...write,
  summary: "Review a session presentation version",
  request: {
    params: versionParams,
    body: { required: true, content: { "application/json": { schema: sessionPresentationReviewRequestSchema } } },
  },
  responses: { ...errors, ...ok("Reviewed presentation", sessionPresentationVersionResponseSchema) },
};
export const sessionPresentationDeleteRouteSchema = {
  ...write,
  summary: "Delete a draft session presentation version",
  request: { params: versionParams },
  responses: { ...errors, ...ok("Version deleted", successResponseSchema) },
};
export const sessionPresentationDownloadRouteSchema = {
  ...read,
  summary: "Download a private session presentation version",
  request: { params: versionParams },
  responses: {
    ...errors,
    "200": { description: "Presentation file stream" },
    "503": { description: "Presentation storage unavailable" },
  },
};

export const sessionPresentationPublicReleaseRouteSchema = {
  tags: ["Session presentations"],
  summary: "Download an activated, explicitly released session PDF",
  request: { params: sessionPresentationReleaseParamsSchema },
  responses: {
    "200": { description: "Published PDF stream" },
    "404": { description: "Published presentation unavailable" },
    "503": { description: "Presentation storage unavailable" },
  },
};

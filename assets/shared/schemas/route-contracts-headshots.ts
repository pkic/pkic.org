import { z } from "zod";
import { userIdParamsSchema, successResponseSchema } from "./api-common";
import { proposalAccessTokenParamsSchema } from "./proposal-management";
import { headshotImageUploadFormSchema, headshotUploadResponseSchema } from "./registration";
import { publicErrors, publicOperation } from "./route-contract";
import { HEADSHOT_VARIANT_WIDTHS } from "../headshot-variants";
import { speakerMailboxProofHeadersSchema } from "./event-proposal-proof";

const rawHeadshotImageSchema = z.any().describe("Raw JPEG, PNG, or WebP image bytes");
const headshotUploadRequestContent = {
  "multipart/form-data": { schema: headshotImageUploadFormSchema },
  "image/jpeg": { schema: rawHeadshotImageSchema },
  "image/png": { schema: rawHeadshotImageSchema },
  "image/webp": { schema: rawHeadshotImageSchema },
  "application/octet-stream": { schema: rawHeadshotImageSchema },
};
const headshotImageResponseContent = {
  "image/jpeg": { schema: rawHeadshotImageSchema },
  "image/png": { schema: rawHeadshotImageSchema },
  "image/webp": { schema: rawHeadshotImageSchema },
};

export const userHeadshotGetRouteSchema = {
  tags: ["Users", "Headshots"],
  summary: "Download a user headshot",
  description: "Returns the currently stored headshot image for a user, when one exists.",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    "200": { description: "Binary headshot image.", content: headshotImageResponseContent },
    "401": { description: "Staff authorization required." },
    "404": { description: "User or headshot not found." },
    "503": { description: "Uploads bucket is not configured." },
  },
};

export const userHeadshotFileParamsSchema = userIdParamsSchema.extend({
  file: z.string().min(1).max(255),
});
export const userHeadshotFileQuerySchema = z.object({
  width: z
    .enum(HEADSHOT_VARIANT_WIDTHS)
    .optional()
    .describe("A bounded square rendition width in pixels. Omit it for the stored portrait."),
});
export const userHeadshotFileGetRouteSchema = {
  tags: ["Users", "Headshots"],
  summary: "Download a user's current headshot file",
  description:
    "Public address of the portrait the user's record names right now. A replaced or removed file stops resolving at once. With `width`, returns a square WebP rendition of that portrait, or the stored portrait when no rendition can be produced.",
  ...publicOperation(),
  request: {
    params: userHeadshotFileParamsSchema,
    query: userHeadshotFileQuerySchema,
  },
  responses: {
    "200": { description: "Binary headshot image.", content: headshotImageResponseContent },
    ...publicErrors({ badRequest: "Invalid user, file, or width.", notFound: "Headshot not found." }),
    "503": { description: "Uploads bucket is not configured." },
  },
};

export const userGravatarImportResponseSchema = successResponseSchema.extend({
  source: z.literal("gravatar"),
});
export const userGravatarImportRouteSchema = {
  tags: ["Users", "Headshots"],
  summary: "Import a user's Gravatar",
  "x-pkic-auth": { required: true, scopes: ["users:write"] },
  request: { params: userIdParamsSchema },
  responses: {
    "200": {
      description: "Gravatar imported.",
      content: { "application/json": { schema: userGravatarImportResponseSchema } },
    },
    "400": { description: "Invalid user identifier." },
    "401": { description: "Staff authorization required." },
    "403": { description: "User update permission required." },
    "404": { description: "User or Gravatar not found." },
  },
};

export const userHeadshotPutRouteSchema = {
  tags: ["Users", "Headshots"],
  summary: "Upload or replace a user headshot",
  description:
    "Uploads, resizes, stores, and activates a headshot image for a user from the portal. Accepts a multipart file field or raw JPEG, PNG, WebP, or octet-stream image bytes; the handler validates the detected file signature.",
  "x-pkic-auth": { required: true, scopes: ["users:write"] },
  request: {
    params: userIdParamsSchema,
    body: {
      content: headshotUploadRequestContent,
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Headshot uploaded successfully.",
      content: {
        "application/json": {
          schema: successResponseSchema,
        },
      },
    },
    "401": { description: "Staff authorization required." },
    "404": { description: "User not found." },
    "413": { description: "File exceeds the maximum upload size." },
    "415": { description: "Unsupported image MIME type." },
    "503": { description: "Uploads bucket is not configured or upload failed." },
  },
};

const proposalSpeakerHeadshotParamsSchema = proposalAccessTokenParamsSchema;

type HeadshotParamsSchema = typeof proposalSpeakerHeadshotParamsSchema;
type HeadshotRouteOptions = {
  tags?: string[];
  auth?: { required: true; scopes: readonly string[] };
  accessResponses?: Partial<Record<"401" | "403", { description: string }>>;
  notFoundDescription?: string;
};
const speakerAccountAuthorityResponse = {
  description:
    "The account's mailbox is proved: the link alone does not change its photo without a live session or the mailbox proof made on this link.",
};
const headshotUploadSuccessResponse = {
  description: "Headshot uploaded successfully.",
  content: { "application/json": { schema: headshotUploadResponseSchema } },
};

function privateHeadshotGetRouteSchema<TParams extends HeadshotParamsSchema>(
  summary: string,
  params: TParams,
  options: HeadshotRouteOptions = {},
) {
  return {
    tags: options.tags ?? ["Proposals", "Headshots"],
    summary,
    ...(options.auth ? { "x-pkic-auth": options.auth } : publicOperation()),
    request: { params },
    responses: {
      "200": { description: "Binary headshot image.", content: headshotImageResponseContent },
      ...options.accessResponses,
      "404": { description: options.notFoundDescription ?? "Speaker or headshot not found." },
      "503": { description: "Uploads bucket is not configured." },
    },
  };
}

function headshotPutRouteSchema<TParams extends HeadshotParamsSchema>(
  summary: string,
  params: TParams,
  options: HeadshotRouteOptions = {},
) {
  return {
    tags: options.tags ?? ["Proposals", "Headshots"],
    summary,
    ...(options.auth ? { "x-pkic-auth": options.auth } : publicOperation()),
    request: {
      params,
      headers: speakerMailboxProofHeadersSchema,
      body: { content: headshotUploadRequestContent, required: true },
    },
    responses: {
      "200": headshotUploadSuccessResponse,
      "403": speakerAccountAuthorityResponse,
      ...options.accessResponses,
      "400": { description: "Invalid upload." },
      "404": { description: options.notFoundDescription ?? "Speaker not found." },
      "413": { description: "Uploaded file exceeds the maximum size." },
      "415": { description: "Unsupported image type." },
      "503": { description: "Uploads bucket is not configured or upload failed." },
    },
  };
}

function headshotDeleteRouteSchema<TParams extends HeadshotParamsSchema>(
  summary: string,
  params: TParams,
  options: HeadshotRouteOptions = {},
) {
  return {
    tags: options.tags ?? ["Proposals", "Headshots"],
    summary,
    ...(options.auth ? { "x-pkic-auth": options.auth } : publicOperation()),
    request: { params, headers: speakerMailboxProofHeadersSchema },
    responses: {
      "200": {
        description: "Headshot removed successfully.",
        content: { "application/json": { schema: successResponseSchema } },
      },
      "403": speakerAccountAuthorityResponse,
      ...options.accessResponses,
      "404": { description: options.notFoundDescription ?? "Speaker not found." },
    },
  };
}

export const proposalSpeakerHeadshotGetRouteSchema = privateHeadshotGetRouteSchema(
  "Download the current speaker headshot",
  proposalSpeakerHeadshotParamsSchema,
);
export const proposalSpeakerHeadshotPutRouteSchema = headshotPutRouteSchema(
  "Upload or replace the current speaker headshot",
  proposalSpeakerHeadshotParamsSchema,
);
export const proposalSpeakerHeadshotDeleteRouteSchema = headshotDeleteRouteSchema(
  "Delete the current speaker headshot",
  proposalSpeakerHeadshotParamsSchema,
);

export const userHeadshotDeleteRouteSchema = {
  tags: ["Users", "Headshots"],
  summary: "Delete a user headshot",
  description: "Clears the active headshot reference for a user and records a staff audit event.",
  "x-pkic-auth": { required: true, scopes: ["users:write"] },
  request: {
    params: userIdParamsSchema,
  },
  responses: {
    "200": {
      description: "Headshot removed successfully.",
      content: {
        "application/json": {
          schema: successResponseSchema,
        },
      },
    },
    "401": { description: "Staff authorization required." },
    "403": { description: "User update permission required." },
    "404": { description: "User not found." },
  },
};

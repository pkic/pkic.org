import { z } from "zod";
import { userIdParamsSchema, proposalSpeakerIdParamsSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { proposalManageTokenParamsSchema } from "./proposal-management";
import { headshotImageUploadFormSchema, headshotUploadResponseSchema } from "./registration";

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

const proposalSpeakerHeadshotParamsSchema = proposalManageTokenParamsSchema;
const proposerManagedSpeakerHeadshotParamsSchema = proposalManageTokenParamsSchema.extend({
  userId: databaseIdSchema,
});
const adminProposalSpeakerHeadshotParamsSchema = proposalSpeakerIdParamsSchema;

type HeadshotParamsSchema =
  | typeof proposalSpeakerHeadshotParamsSchema
  | typeof proposerManagedSpeakerHeadshotParamsSchema
  | typeof adminProposalSpeakerHeadshotParamsSchema;
type HeadshotRouteOptions = {
  tags?: string[];
  accessResponses?: Partial<Record<"401" | "403", { description: string }>>;
  notFoundDescription?: string;
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
    request: {
      params,
      body: { content: headshotUploadRequestContent, required: true },
    },
    responses: {
      "200": headshotUploadSuccessResponse,
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
    request: { params },
    responses: {
      "200": {
        description: "Headshot removed successfully.",
        content: { "application/json": { schema: successResponseSchema } },
      },
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
export const proposerManagedSpeakerHeadshotGetRouteSchema = privateHeadshotGetRouteSchema(
  "Download a proposal speaker headshot",
  proposerManagedSpeakerHeadshotParamsSchema,
);
export const proposerManagedSpeakerHeadshotPutRouteSchema = headshotPutRouteSchema(
  "Upload or replace a proposal speaker headshot",
  proposerManagedSpeakerHeadshotParamsSchema,
);
export const proposerManagedSpeakerHeadshotDeleteRouteSchema = headshotDeleteRouteSchema(
  "Delete a proposal speaker headshot",
  proposerManagedSpeakerHeadshotParamsSchema,
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

const adminReviewResponses = {
  "401": { description: "Staff authorization required." },
  "403": { description: "Proposal review permission required." },
};
const adminManageResponses = {
  "401": { description: "Staff authorization required." },
  "403": { description: "Proposal management permission required." },
};
const adminProposalHeadshotOptions = {
  tags: ["Admin proposals", "Headshots"],
  accessResponses: adminManageResponses,
  notFoundDescription: "Proposal speaker not found.",
};

export const adminProposalSpeakerHeadshotGetRouteSchema = privateHeadshotGetRouteSchema(
  "Download a proposal-scoped speaker headshot",
  adminProposalSpeakerHeadshotParamsSchema,
  {
    tags: adminProposalHeadshotOptions.tags,
    accessResponses: adminReviewResponses,
    notFoundDescription: "Proposal speaker or headshot not found.",
  },
);

export const adminProposalSpeakerHeadshotPutRouteSchema = headshotPutRouteSchema(
  "Upload or replace a proposal-scoped speaker headshot",
  adminProposalSpeakerHeadshotParamsSchema,
  adminProposalHeadshotOptions,
);

export const adminProposalSpeakerHeadshotDeleteRouteSchema = headshotDeleteRouteSchema(
  "Delete a proposal-scoped speaker headshot",
  adminProposalSpeakerHeadshotParamsSchema,
  adminProposalHeadshotOptions,
);

export const adminProposalSpeakerGravatarPostRouteSchema = {
  tags: ["Admin proposals", "Headshots"],
  summary: "Import a proposal-scoped speaker Gravatar",
  request: { params: adminProposalSpeakerHeadshotParamsSchema },
  responses: {
    "200": { ...headshotUploadSuccessResponse, description: "Gravatar imported successfully." },
    ...adminManageResponses,
    "404": { description: "Proposal speaker or Gravatar not found." },
    "503": { description: "Uploads bucket is not configured." },
  },
};

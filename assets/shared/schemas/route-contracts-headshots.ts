import { adminUserIdParamsSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { proposalManageTokenParamsSchema } from "./proposal-management";
import {
  adminHeadshotUploadResponseSchema,
  headshotImageUploadFormSchema,
  headshotUploadResponseSchema,
} from "./registration";

export const adminUserHeadshotGetRouteSchema = {
  tags: ["Admin headshots"],
  summary: "Download a user headshot",
  description: "Returns the currently stored headshot image for a user, when one exists.",
  request: {
    params: adminUserIdParamsSchema,
  },
  responses: {
    "200": { description: "Binary headshot image." },
    "401": { description: "Admin authorization required." },
    "404": { description: "User or headshot not found." },
    "503": { description: "Uploads bucket is not configured." },
  },
};

export const adminUserHeadshotPutRouteSchema = {
  tags: ["Admin headshots"],
  summary: "Upload or replace a user headshot",
  description: "Uploads, resizes, stores, and activates a headshot image for a user from the admin console.",
  request: {
    params: adminUserIdParamsSchema,
    body: {
      content: {
        "multipart/form-data": {
          schema: headshotImageUploadFormSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Headshot uploaded successfully.",
      content: {
        "application/json": {
          schema: adminHeadshotUploadResponseSchema,
        },
      },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "User not found." },
    "413": { description: "File exceeds the admin upload size limit." },
    "415": { description: "Unsupported image MIME type." },
    "503": { description: "Uploads bucket is not configured or upload failed." },
  },
};

const proposalSpeakerHeadshotParamsSchema = proposalManageTokenParamsSchema;
const proposerManagedSpeakerHeadshotParamsSchema = proposalManageTokenParamsSchema.extend({
  userId: databaseIdSchema,
});

function privateHeadshotGetRouteSchema(
  summary: string,
  params: typeof proposalSpeakerHeadshotParamsSchema | typeof proposerManagedSpeakerHeadshotParamsSchema,
) {
  return {
    tags: ["Proposals", "Headshots"],
    summary,
    request: { params },
    responses: {
      "200": { description: "Binary headshot image." },
      "404": { description: "Speaker or headshot not found." },
      "503": { description: "Uploads bucket is not configured." },
    },
  };
}

function headshotPutRouteSchema(
  summary: string,
  params: typeof proposalSpeakerHeadshotParamsSchema | typeof proposerManagedSpeakerHeadshotParamsSchema,
) {
  return {
    tags: ["Proposals", "Headshots"],
    summary,
    request: {
      params,
      body: { content: { "multipart/form-data": { schema: headshotImageUploadFormSchema } }, required: true },
    },
    responses: {
      "200": {
        description: "Headshot uploaded successfully.",
        content: { "application/json": { schema: headshotUploadResponseSchema } },
      },
      "400": { description: "Invalid upload." },
      "413": { description: "Uploaded file exceeds the maximum size." },
      "415": { description: "Unsupported image type." },
      "503": { description: "Uploads bucket is not configured or upload failed." },
    },
  };
}

function headshotDeleteRouteSchema(
  summary: string,
  params: typeof proposalSpeakerHeadshotParamsSchema | typeof proposerManagedSpeakerHeadshotParamsSchema,
) {
  return {
    tags: ["Proposals", "Headshots"],
    summary,
    request: { params },
    responses: {
      "200": {
        description: "Headshot removed successfully.",
        content: { "application/json": { schema: successResponseSchema } },
      },
      "404": { description: "Speaker not found." },
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

export const adminUserHeadshotDeleteRouteSchema = {
  tags: ["Admin headshots"],
  summary: "Delete a user headshot",
  description: "Clears the active headshot reference for a user and records an admin audit event.",
  request: {
    params: adminUserIdParamsSchema,
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
    "401": { description: "Admin authorization required." },
    "404": { description: "User not found." },
  },
};

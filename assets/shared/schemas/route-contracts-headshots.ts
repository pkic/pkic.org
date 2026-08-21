import { adminUserIdParamsSchema } from "./api-common";
import {
  adminHeadshotUploadResponseSchema,
  registrationHeadshotUploadFormSchema,
  successResponseSchema,
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
          schema: registrationHeadshotUploadFormSchema,
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

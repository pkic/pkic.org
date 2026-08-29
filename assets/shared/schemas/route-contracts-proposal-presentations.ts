import { presentationVersionIdParamsSchema, proposalIdParamsSchema, successResponseSchema } from "./api-common";
import { proposalManageAuth, proposalReadAuth } from "./proposal-contract-auth";
import {
  presentationVersionResponseSchema,
  presentationVersionReviewRequestSchema,
  presentationVersionsListQuerySchema,
  presentationVersionsResponseSchema,
} from "./presentation-versions";

export const proposalPresentationVersionsListRouteSchema = {
  tags: ["Proposal presentations"],
  summary: "List presentation versions",
  "x-pkic-auth": proposalReadAuth,
  request: { params: proposalIdParamsSchema, query: presentationVersionsListQuerySchema },
  responses: {
    "200": {
      description: "Presentation versions for the proposal.",
      content: { "application/json": { schema: presentationVersionsResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal access." },
    "404": { description: "Proposal not found." },
  },
};

export const proposalPresentationUploadRouteSchema = {
  tags: ["Proposal presentations"],
  summary: "Upload a presentation version",
  "x-pkic-auth": proposalManageAuth,
  description: "Streams a validated presentation to R2 and atomically records the version and audit event in D1.",
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Presentation uploaded.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "400": { description: "Invalid upload metadata or size." },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal access." },
    "404": { description: "Proposal not found." },
    "409": { description: "The proposal is not accepted." },
    "413": { description: "The presentation is too large." },
    "415": { description: "Unsupported presentation type." },
    "503": { description: "Presentation storage is unavailable." },
  },
};

export const proposalPresentationVersionReviewRouteSchema = {
  tags: ["Proposal presentations"],
  summary: "Review a presentation version",
  "x-pkic-auth": proposalManageAuth,
  description: "Atomically records the review and audit event.",
  request: {
    params: presentationVersionIdParamsSchema,
    body: {
      content: { "application/json": { schema: presentationVersionReviewRequestSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Reviewed presentation version.",
      content: { "application/json": { schema: presentationVersionResponseSchema } },
    },
    "400": { description: "Invalid review payload." },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal access." },
    "404": { description: "Proposal or presentation version not found." },
  },
};

export const proposalPresentationVersionDeleteRouteSchema = {
  tags: ["Proposal presentations"],
  summary: "Delete a presentation version",
  "x-pkic-auth": proposalManageAuth,
  description: "Atomically soft-deletes the version, selects its replacement, and records the audit event.",
  request: { params: presentationVersionIdParamsSchema },
  responses: {
    "200": {
      description: "Presentation version deleted.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal access." },
    "404": { description: "Proposal or presentation version not found." },
    "409": { description: "The version is approved or changed concurrently." },
  },
};

export const proposalPresentationVersionContentRouteSchema = {
  tags: ["Proposal presentations"],
  summary: "Download a presentation version",
  "x-pkic-auth": proposalReadAuth,
  request: { params: presentationVersionIdParamsSchema },
  responses: {
    "200": { description: "Presentation file stream." },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal access." },
    "404": { description: "Proposal, version, or stored object not found." },
    "503": { description: "Presentation storage is unavailable." },
  },
};

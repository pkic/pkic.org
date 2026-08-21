import { z } from "zod";
import {
  presentationVersionIdParamsSchema,
  proposalIdParamsSchema,
  proposalReviewIdParamsSchema,
  proposalSpeakerIdParamsSchema,
  successResponseSchema,
} from "./api-common";
import {
  adminSpeakerBioPatchSchema,
  adminProposalPatchResponseSchema,
  adminProposalPatchSchema,
  finalizeProposalResponseSchema,
  finalizeProposalSchema,
  proposalSpeakerRemovalRequestSchema,
  proposalSpeakerRemovalResponseSchema,
} from "./proposal-management";
import { listQuerySchema } from "./pagination";
import {
  adminProposalSpeakerPatchResponseSchema,
  adminProposalSpeakersResponseSchema,
  proposalDecisionPreviewResponseSchema,
} from "./admin-event-proposals";
import {
  proposalCommentCreateResponseSchema,
  proposalCommentCreateSchema,
  proposalCommentsListQuerySchema,
  proposalCommentsListResponseSchema,
} from "./proposal-comments";
import { proposalFlagRequestSchema, proposalFlagResponseSchema } from "./proposal-status";
import {
  proposalReviewPatchSchema,
  proposalReviewsListQuerySchema,
  proposalReviewsListResponseSchema,
  proposalReviewUpsertSchema,
  proposalReviewWriteResponseSchema,
} from "./proposal-reviews";
import {
  presentationVersionResponseSchema,
  presentationVersionReviewRequestSchema,
  presentationVersionsListQuerySchema,
  presentationVersionsResponseSchema,
} from "./presentation-versions";
import { httpUrlSchema } from "./urls";

export const adminProposalOpenManageRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Open proposal management view",
  description:
    "Refreshes the proposer management token and returns an admin-audited URL for inspecting the proposer workflow.",
  request: {
    params: proposalIdParamsSchema,
  },
  responses: {
    "200": {
      description: "Fresh proposal management URL.",
      content: {
        "application/json": {
          schema: z.object({ manageUrl: httpUrlSchema }),
        },
      },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal management permission." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalPatchRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Update proposal title or abstract",
  description: "Updates editable proposal text fields. Requires organizer-level access for the proposal's event.",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: adminProposalPatchSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Updated proposal details.",
      content: { "application/json": { schema: adminProposalPatchResponseSchema } },
    },
    "400": { description: "Invalid proposal patch payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks organizer permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalFlagRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Flag or delete a proposal",
  description: "Atomically records a spam, duplicate, or soft-delete transition and its audit event.",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: { "application/json": { schema: proposalFlagRequestSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Proposal moderation action applied.",
      content: { "application/json": { schema: proposalFlagResponseSchema } },
    },
    "400": { description: "Invalid moderation action." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal management permission." },
    "404": { description: "Proposal not found." },
    "409": { description: "Proposal was finalized or changed concurrently." },
  },
};

export const adminProposalReviewsListRouteSchema = {
  tags: ["Admin proposal reviews"],
  summary: "List proposal reviews",
  description: "Searches, filters, sorts, and paginates reviews in D1 and returns proposal-level review aggregates.",
  request: {
    params: proposalIdParamsSchema,
    query: proposalReviewsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Proposal reviews and server-computed review statistics.",
      content: { "application/json": { schema: proposalReviewsListResponseSchema } },
    },
    "401": { description: "Missing or invalid authentication." },
    "403": { description: "The actor lacks review access for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalReviewUpsertRouteSchema = {
  tags: ["Admin proposal reviews"],
  summary: "Create or update my proposal review",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: { "application/json": { schema: proposalReviewUpsertSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "The proposal review and its audit event were saved atomically.",
      content: { "application/json": { schema: proposalReviewWriteResponseSchema } },
    },
    "400": { description: "Invalid review payload." },
    "401": { description: "Missing or invalid authentication." },
    "403": { description: "The actor lacks review access for this proposal." },
    "404": { description: "Proposal not found." },
    "409": { description: "The proposal was finalized or the review changed concurrently." },
  },
  "x-pkic-mcp": { expose: true },
};

export const adminProposalReviewPatchRouteSchema = {
  tags: ["Admin proposal reviews"],
  summary: "Update a proposal review",
  request: {
    params: proposalReviewIdParamsSchema,
    body: {
      content: { "application/json": { schema: proposalReviewPatchSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "The proposal review and its audit event were updated atomically.",
      content: { "application/json": { schema: proposalReviewWriteResponseSchema } },
    },
    "400": { description: "Invalid review payload." },
    "401": { description: "Missing or invalid authentication." },
    "403": { description: "The actor may not edit this review." },
    "404": { description: "Proposal or review not found." },
    "409": { description: "The proposal was finalized or the review changed concurrently." },
  },
  "x-pkic-mcp": { expose: true },
};

export const adminProposalFinalizeRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Finalize proposal decision",
  description:
    "Records a final proposal decision, queues speaker/proposer decision emails, and updates presentation reminder state when accepted.",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: finalizeProposalSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Proposal decision recorded and notifications queued.",
      content: { "application/json": { schema: finalizeProposalResponseSchema } },
    },
    "400": { description: "Invalid finalize payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks finalize permission or is not an attributable user-backed actor." },
    "404": { description: "Proposal not found." },
    "409": { description: "The proposal is not decidable, lacks review quorum, or changed concurrently." },
  },
};

export const adminProposalFinalizePreviewRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Preview proposal decision emails",
  description:
    "Renders the emails that would be sent for a proposal decision without recording the decision or queueing mail.",
  request: adminProposalFinalizeRouteSchema.request,
  responses: {
    "200": {
      description: "Rendered decision email preview messages.",
      content: { "application/json": { schema: proposalDecisionPreviewResponseSchema } },
    },
    "400": { description: "Invalid finalize payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks finalize permission for this proposal." },
    "404": { description: "Proposal not found." },
    "409": { description: "The proposal is not in a state that can receive a decision." },
  },
};

export const adminProposalAuditLogRouteSchema = {
  tags: ["Admin proposals"],
  summary: "List proposal audit log",
  description: "Returns recent audit events attached to a proposal, its reviews, and its speaker records.",
  request: {
    params: proposalIdParamsSchema,
    query: listQuerySchema(["createdAt", "action", "actor"] as const),
  },
  responses: {
    "200": { description: "Proposal audit log entries." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalCommentsListRouteSchema = {
  tags: ["Admin proposals"],
  summary: "List internal proposal comments",
  description: "Returns a bounded, searchable page of private program committee comments for a proposal.",
  request: {
    params: proposalIdParamsSchema,
    query: proposalCommentsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Proposal internal comments.",
      content: { "application/json": { schema: proposalCommentsListResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks review permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalCommentCreateRouteSchema = {
  tags: ["Admin proposals"],
  summary: "Add an internal proposal comment",
  description: "Atomically appends a private program committee comment and its audit record.",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: { "application/json": { schema: proposalCommentCreateSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Proposal internal comment created.",
      content: { "application/json": { schema: proposalCommentCreateResponseSchema } },
    },
    "400": { description: "Invalid comment payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks review permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalSpeakersRouteSchema = {
  tags: ["Admin proposal speakers"],
  summary: "List proposal speakers",
  description:
    "Returns speaker participation status, profile completeness, headshot state, and presentation status for a proposal.",
  request: {
    params: proposalIdParamsSchema,
  },
  responses: {
    "200": {
      description: "Proposal speaker roster with completeness summary.",
      content: { "application/json": { schema: adminProposalSpeakersResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks review permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const adminProposalSpeakerPatchRouteSchema = {
  tags: ["Admin proposal speakers"],
  summary: "Update a proposal speaker",
  description:
    "Atomically updates the shared speaker profile, proposal role, participant projection, and audit record.",
  request: {
    params: proposalSpeakerIdParamsSchema,
    body: {
      content: { "application/json": { schema: adminSpeakerBioPatchSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Updated proposal speaker.",
      content: { "application/json": { schema: adminProposalSpeakerPatchResponseSchema } },
    },
    "400": { description: "Invalid speaker patch." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal management permission." },
    "404": { description: "Proposal or speaker not found." },
    "409": { description: "The proposal or speaker changed concurrently." },
  },
};

export const adminProposalSpeakerDeleteRouteSchema = {
  tags: ["Admin proposal speakers"],
  summary: "Remove a proposal speaker",
  description:
    "Atomically removes a speaker association, invalidates its capability, deactivates participant projections, cancels pending speaker email, and records audit history. Removing the current proposer requires an explicit replacement.",
  request: {
    params: proposalSpeakerIdParamsSchema,
    body: {
      content: { "application/json": { schema: proposalSpeakerRemovalRequestSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Speaker removed from the proposal.",
      content: { "application/json": { schema: proposalSpeakerRemovalResponseSchema } },
    },
    "400": { description: "Invalid replacement proposer payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal management permission." },
    "404": { description: "Proposal, speaker, or replacement speaker not found." },
    "409": {
      description: "The final speaker cannot be removed, a proposer replacement is required, or state changed.",
    },
  },
};

export const adminPresentationVersionsListRouteSchema = {
  tags: ["Admin proposal presentations"],
  summary: "List presentation versions",
  request: { params: proposalIdParamsSchema, query: presentationVersionsListQuerySchema },
  responses: {
    "200": {
      description: "Presentation versions for the proposal.",
      content: { "application/json": { schema: presentationVersionsResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal access." },
    "404": { description: "Proposal not found." },
  },
};

export const adminPresentationUploadRouteSchema = {
  tags: ["Admin proposal presentations"],
  summary: "Upload a presentation version",
  description: "Streams a validated presentation to R2 and atomically records the version and audit event in D1.",
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Presentation uploaded.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "400": { description: "Invalid upload metadata or size." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal access." },
    "404": { description: "Proposal not found." },
    "409": { description: "The proposal is not accepted." },
    "413": { description: "The presentation is too large." },
    "415": { description: "Unsupported presentation type." },
    "503": { description: "Presentation storage is unavailable." },
  },
};

export const adminPresentationVersionReviewRouteSchema = {
  tags: ["Admin proposal presentations"],
  summary: "Review a presentation version",
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
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal access." },
    "404": { description: "Proposal or presentation version not found." },
  },
};

export const adminPresentationVersionDeleteRouteSchema = {
  tags: ["Admin proposal presentations"],
  summary: "Delete a presentation version",
  description: "Atomically soft-deletes the version, selects its replacement, and records the audit event.",
  request: { params: presentationVersionIdParamsSchema },
  responses: {
    "200": {
      description: "Presentation version deleted.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal access." },
    "404": { description: "Proposal or presentation version not found." },
    "409": { description: "The version is approved or changed concurrently." },
  },
};

export const adminPresentationVersionDownloadRouteSchema = {
  tags: ["Admin proposal presentations"],
  summary: "Download a presentation version",
  request: { params: presentationVersionIdParamsSchema },
  responses: {
    "200": { description: "Presentation file stream." },
    "401": { description: "Admin authorization required." },
    "403": { description: "The admin lacks proposal access." },
    "404": { description: "Proposal, version, or stored object not found." },
    "503": { description: "Presentation storage is unavailable." },
  },
};

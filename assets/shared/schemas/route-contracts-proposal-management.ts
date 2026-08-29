import { z } from "zod";
import { scopedAuditLogListQuerySchema, scopedAuditLogResponseSchema } from "./audit-log";
import { proposalIdParamsSchema, proposalReviewIdParamsSchema, proposalSpeakerIdParamsSchema } from "./api-common";
import {
  coSpeakerInviteResponseSchema,
  coSpeakerInviteSchema,
  proposalSpeakerPatchSchema,
  proposalPatchResponseSchema,
  proposalPatchSchema,
  cancelAcceptedProposalResponseSchema,
  cancelAcceptedProposalSchema,
  finalizeProposalResponseSchema,
  finalizeProposalSchema,
  proposalSpeakerRemovalRequestSchema,
  proposalSpeakerRemovalResponseSchema,
} from "./proposal-management";
import {
  proposalSpeakerPatchResponseSchema,
  proposalSpeakersResponseSchema,
  proposalSpeakerReminderRequestSchema,
  proposalSpeakerReminderResponseSchema,
  proposalSpeakerRemindersResponseSchema,
} from "./proposal-speakers";
import { proposalDecisionPreviewResponseSchema } from "./proposal-decisions";
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
import { httpCapabilityUrlSchema } from "./urls";
import { eventProposalDetailResponseSchema } from "./event-proposals";
import { proposalCancelAuth, proposalManageAuth, proposalReadAuth, proposalScoreAuth } from "./proposal-contract-auth";

export const proposalAccessLinkResponseSchema = z.object({ manageUrl: httpCapabilityUrlSchema });

export const proposalDetailRouteSchema = {
  tags: ["Proposal management"],
  summary: "Get proposal details",
  "x-pkic-auth": proposalReadAuth,
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Proposal details visible to the authenticated actor.",
      content: { "application/json": { schema: eventProposalDetailResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal access." },
    "404": { description: "Proposal not found." },
  },
};

export const proposalAccessLinkRouteSchema = {
  tags: ["Proposal management"],
  summary: "Issue a proposal management access link",
  "x-pkic-auth": proposalManageAuth,
  description:
    "Refreshes the proposer management token and returns an audited URL for inspecting the proposer workflow.",
  request: {
    params: proposalIdParamsSchema,
  },
  responses: {
    "200": {
      description: "Fresh proposal management URL.",
      content: {
        "application/json": {
          schema: proposalAccessLinkResponseSchema,
        },
      },
    },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal management permission." },
    "404": { description: "Proposal not found." },
  },
};

export const proposalPatchRouteSchema = {
  tags: ["Proposal management"],
  summary: "Update proposal title or abstract",
  description:
    "Updates editable proposal text fields. Ordinary proposals and title changes require proposals:manage. Accepted-proposal abstract changes require the event-scoped proposals:edit_accepted_abstract capability; changing both fields requires both capabilities.",
  "x-pkic-auth": {
    required: true,
    scopesAnyOf: [["proposals:manage"], ["proposals:edit_accepted_abstract"]],
  },
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: proposalPatchSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Updated proposal details.",
      content: { "application/json": { schema: proposalPatchResponseSchema } },
    },
    "400": { description: "Invalid proposal patch payload." },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks the permission required for this proposal's current status." },
    "409": { description: "The proposal or authorization changed while the update was being saved." },
    "404": { description: "Proposal not found." },
  },
};

export const proposalCancellationRouteSchema = {
  tags: ["Proposal management"],
  summary: "Cancel an accepted proposal",
  "x-pkic-auth": proposalCancelAuth,
  description:
    "Removes an accepted proposal from the program without rewriting its accepted decision, records the required comment, deactivates speaker capacity, and queues a notification to every current speaker.",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: { "application/json": { schema: cancelAcceptedProposalSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Accepted proposal canceled and speaker notifications queued.",
      content: { "application/json": { schema: cancelAcceptedProposalResponseSchema } },
    },
    "400": { description: "A cancellation comment is required." },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposals:cancel_accepted for this event." },
    "404": { description: "Proposal not found." },
    "409": { description: "The proposal is not accepted or changed while cancellation was being saved." },
  },
};

export const proposalModerationRouteSchema = {
  tags: ["Proposal management"],
  summary: "Flag or delete a proposal",
  "x-pkic-auth": proposalManageAuth,
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
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal management permission." },
    "404": { description: "Proposal not found." },
    "409": { description: "Proposal was finalized or changed concurrently." },
  },
};

export const proposalReviewsListRouteSchema = {
  tags: ["Proposal reviews"],
  summary: "List proposal reviews",
  "x-pkic-auth": proposalScoreAuth,
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

export const proposalReviewUpsertRouteSchema = {
  tags: ["Proposal reviews"],
  summary: "Create or update my proposal review",
  "x-pkic-auth": proposalScoreAuth,
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

export const proposalReviewPatchRouteSchema = {
  tags: ["Proposal reviews"],
  summary: "Update my proposal review",
  "x-pkic-auth": proposalScoreAuth,
  description:
    "Updates only the authenticated reviewer's own review. Proposal managers and global administrators cannot edit another reviewer's review through this endpoint.",
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

export const proposalDecisionRouteSchema = {
  tags: ["Proposal management"],
  summary: "Finalize proposal decision",
  "x-pkic-auth": proposalManageAuth,
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
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks decision permission or is not an attributable user-backed actor." },
    "404": { description: "Proposal not found." },
    "409": { description: "The proposal is not decidable, lacks review quorum, or changed concurrently." },
  },
};

export const proposalDecisionPreviewRouteSchema = {
  tags: ["Proposal management"],
  summary: "Preview proposal decision emails",
  "x-pkic-auth": proposalManageAuth,
  description:
    "Renders the emails that would be sent for a proposal decision without recording the decision or queueing mail.",
  request: proposalDecisionRouteSchema.request,
  responses: {
    "200": {
      description: "Rendered decision email preview messages.",
      content: { "application/json": { schema: proposalDecisionPreviewResponseSchema } },
    },
    "400": { description: "Invalid finalize payload." },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks decision permission for this proposal." },
    "404": { description: "Proposal not found." },
    "409": { description: "The proposal is not in a state that can receive a decision." },
  },
};

export const proposalAuditLogRouteSchema = {
  tags: ["Proposal management"],
  summary: "List proposal audit log",
  "x-pkic-auth": proposalScoreAuth,
  description: "Returns recent audit events attached to a proposal, its reviews, and its speaker records.",
  request: {
    params: proposalIdParamsSchema,
    query: scopedAuditLogListQuerySchema,
  },
  responses: {
    "200": {
      description: "Proposal audit log entries.",
      content: { "application/json": { schema: scopedAuditLogResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "Proposal scoring permission required." },
    "404": { description: "Proposal not found." },
  },
};

export const proposalCommentsListRouteSchema = {
  tags: ["Proposal management"],
  summary: "List internal proposal comments",
  "x-pkic-auth": proposalScoreAuth,
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
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks review permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const proposalCommentCreateRouteSchema = {
  tags: ["Proposal management"],
  summary: "Add an internal proposal comment",
  "x-pkic-auth": proposalScoreAuth,
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
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks review permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const proposalSpeakersRouteSchema = {
  tags: ["Proposal speakers"],
  summary: "List proposal speakers",
  "x-pkic-auth": proposalScoreAuth,
  description:
    "Returns speaker participation status, profile completeness, headshot state, and presentation status for a proposal.",
  request: {
    params: proposalIdParamsSchema,
  },
  responses: {
    "200": {
      description: "Proposal speaker roster with completeness summary.",
      content: { "application/json": { schema: proposalSpeakersResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks review permission for this proposal." },
    "404": { description: "Proposal not found." },
  },
};

export const proposalSpeakerInviteRouteSchema = {
  tags: ["Proposal speakers"],
  summary: "Invite a proposal speaker",
  "x-pkic-auth": proposalManageAuth,
  description:
    "Adds or renews a proposal speaker invitation and queues its capability-bearing notification atomically.",
  request: {
    params: proposalIdParamsSchema,
    body: {
      content: { "application/json": { schema: coSpeakerInviteSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Proposal speaker invitation state.",
      content: { "application/json": { schema: coSpeakerInviteResponseSchema } },
    },
    "400": { description: "Invalid speaker invitation." },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal management permission." },
    "404": { description: "Proposal or event not found." },
    "409": { description: "The proposal, invitation window, or authorization changed concurrently." },
  },
};

export const proposalSpeakerPatchRouteSchema = {
  tags: ["Proposal speakers"],
  summary: "Update a proposal speaker",
  "x-pkic-auth": proposalManageAuth,
  description:
    "Atomically updates the speaker profile for this proposal, proposal role, participant projection, and audit record without changing the account-wide profile.",
  request: {
    params: proposalSpeakerIdParamsSchema,
    body: {
      content: { "application/json": { schema: proposalSpeakerPatchSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Updated proposal speaker.",
      content: { "application/json": { schema: proposalSpeakerPatchResponseSchema } },
    },
    "400": { description: "Invalid speaker patch." },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal management permission." },
    "404": { description: "Proposal or speaker not found." },
    "409": { description: "The proposal or speaker changed concurrently." },
  },
};

export const proposalSpeakerDeleteRouteSchema = {
  tags: ["Proposal speakers"],
  summary: "Remove a proposal speaker",
  "x-pkic-auth": proposalManageAuth,
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
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal management permission." },
    "404": { description: "Proposal, speaker, or replacement speaker not found." },
    "409": {
      description: "The final speaker cannot be removed, a proposer replacement is required, or state changed.",
    },
  },
};

export const proposalSpeakerReminderRouteSchema = {
  tags: ["Proposal speakers"],
  summary: "Remind a proposal speaker",
  "x-pkic-auth": proposalManageAuth,
  description: "Queues a profile or presentation reminder for one speaker on this proposal.",
  request: {
    params: proposalSpeakerIdParamsSchema,
    body: {
      content: { "application/json": { schema: proposalSpeakerReminderRequestSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Reminder queued.",
      content: { "application/json": { schema: proposalSpeakerReminderResponseSchema } },
    },
    "401": { description: "Authentication required." },
    "403": { description: "The actor lacks proposal management permission." },
    "404": { description: "Proposal or speaker not found." },
    "409": { description: "The proposal or speaker is not eligible for this reminder." },
  },
};

export const proposalSpeakersReminderRouteSchema = {
  ...proposalSpeakerReminderRouteSchema,
  request: {
    ...proposalSpeakerReminderRouteSchema.request,
    params: proposalIdParamsSchema,
  },
  responses: {
    ...proposalSpeakerReminderRouteSchema.responses,
    "200": {
      description: "Reminders queued.",
      content: { "application/json": { schema: proposalSpeakerRemindersResponseSchema } },
    },
  },
};

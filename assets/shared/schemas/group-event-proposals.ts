import { z } from "zod";
import {
  jsonErrorResponse,
  proposalIdParamsSchema,
  proposalReviewIdParamsSchema,
  successResponseSchema,
} from "./api-common";
import {
  eventProposalDetailResponseSchema,
  eventProposalsListQuerySchema,
  eventProposalsResponseSchema,
} from "./event-proposals";
import { groupReferenceParamsSchema } from "./groups";
import {
  proposalEditableSchema,
  proposalPatchResponseSchema,
  proposalPatchSchema,
  cancelAcceptedProposalResponseSchema,
  cancelAcceptedProposalSchema,
  finalizeProposalResponseSchema,
  finalizeProposalSchema,
  proposalSpeakerPatchSchema,
  proposalSpeakerRemovalRequestSchema,
  proposalSpeakerRemovalResponseSchema,
} from "./proposal-management";
import { proposalDecisionPreviewResponseSchema } from "./proposal-decisions";
import { scopedAuditLogListQuerySchema, scopedAuditLogResponseSchema } from "./audit-log";
import {
  proposalCommentCreateResponseSchema,
  proposalCommentCreateSchema,
  proposalCommentsListQuerySchema,
  proposalCommentsListResponseSchema,
} from "./proposal-comments";
import {
  proposalReviewPatchSchema,
  proposalReviewsListQuerySchema,
  proposalReviewsListResponseSchema,
  proposalReviewUpsertSchema,
  proposalReviewWriteResponseSchema,
} from "./proposal-reviews";
import { eventIdSchema } from "./api-common";
import {
  proposalSpeakerPatchResponseSchema,
  proposalSpeakerReminderResponseSchema,
  proposalSpeakerRemindersResponseSchema,
  proposalSpeakersResponseSchema,
} from "./proposal-speakers";
import { databaseIdSchema } from "./identifiers";
import { headshotUrlResponseSchema } from "./registration";

export const groupEventProposalParamsSchema = groupReferenceParamsSchema.extend({
  eventId: eventIdSchema,
  proposalId: proposalIdParamsSchema.shape.proposalId,
});

export const groupEventProposalReviewParamsSchema = groupEventProposalParamsSchema.extend({
  reviewId: proposalReviewIdParamsSchema.shape.reviewId,
});

export const groupEventProposalSpeakerParamsSchema = groupEventProposalParamsSchema.extend({
  userId: databaseIdSchema,
});

const proposalRouteErrors = {
  "401": jsonErrorResponse("An authenticated portal management identity is required."),
  "403": jsonErrorResponse("The actor lacks the required event-scoped proposal capability."),
  "404": jsonErrorResponse("The proposal program is not available through this group and event."),
};

export const groupEventProposalsListRouteSchema = {
  tags: ["Groups"],
  summary: "List proposals for one group-owned event",
  description:
    "Filtering, full-text search, sort order, aggregates, and pagination are executed in D1. Generic event sharing does not grant proposal access.",
  request: {
    params: groupReferenceParamsSchema.extend({ eventId: eventIdSchema }),
    query: eventProposalsListQuerySchema,
  },
  responses: {
    "200": {
      description: "A bounded proposal page and server-computed review statistics.",
      content: { "application/json": { schema: eventProposalsResponseSchema } },
    },
    ...proposalRouteErrors,
  },
};

export const groupEventProposalDetailRouteSchema = {
  tags: ["Groups"],
  summary: "Get a proposal through its owning group and event",
  request: { params: groupEventProposalParamsSchema },
  responses: {
    "200": {
      description: "Proposal details and the actor's event-scoped proposal capabilities.",
      content: { "application/json": { schema: eventProposalDetailResponseSchema } },
    },
    ...proposalRouteErrors,
  },
};

export const groupEventProposalPatchRouteSchema = {
  tags: ["Groups"],
  summary: "Update proposal title or abstract",
  description:
    "Ordinary proposal edits and accepted-title edits require proposals:manage. An accepted abstract can be corrected with proposals:edit_accepted_abstract.",
  request: {
    params: groupEventProposalParamsSchema,
    body: { required: true, content: { "application/json": { schema: proposalPatchSchema } } },
  },
  responses: {
    "200": {
      description: "Updated title and abstract.",
      content: { "application/json": { schema: proposalPatchResponseSchema } },
    },
    "409": jsonErrorResponse("The proposal or authorization changed while the update was being saved."),
    ...proposalRouteErrors,
  },
};

export const groupEventProposalCancelRouteSchema = {
  tags: ["Groups"],
  summary: "Cancel an accepted proposal",
  description:
    "Records the required cancellation comment, preserves the accepted decision history, deactivates speaker capacity, and queues notices to every speaker.",
  request: {
    params: groupEventProposalParamsSchema,
    body: { required: true, content: { "application/json": { schema: cancelAcceptedProposalSchema } } },
  },
  responses: {
    "200": {
      description: "The accepted proposal was canceled and notifications were queued.",
      content: { "application/json": { schema: cancelAcceptedProposalResponseSchema } },
    },
    "409": jsonErrorResponse("The proposal is not accepted or changed while cancellation was being saved."),
    ...proposalRouteErrors,
  },
};

export const groupEventProposalFinalizePreviewRouteSchema = {
  tags: ["Groups"],
  summary: "Preview a proposal decision and its notifications",
  description: "Renders the decision notification plan without changing proposal state or queueing email.",
  request: {
    params: groupEventProposalParamsSchema,
    body: { required: true, content: { "application/json": { schema: finalizeProposalSchema } } },
  },
  responses: {
    "200": {
      description: "The rendered decision notification preview.",
      content: { "application/json": { schema: proposalDecisionPreviewResponseSchema } },
    },
    "409": jsonErrorResponse("The proposal is not currently decidable."),
    ...proposalRouteErrors,
  },
};

export const groupEventProposalFinalizeRouteSchema = {
  tags: ["Groups"],
  summary: "Record a proposal decision",
  description:
    "Records the decision, preserves decision and review history, reconciles participant capacity, and queues notifications atomically.",
  request: {
    params: groupEventProposalParamsSchema,
    body: { required: true, content: { "application/json": { schema: finalizeProposalSchema } } },
  },
  responses: {
    "200": {
      description: "The recorded proposal decision and review-threshold evidence.",
      content: { "application/json": { schema: finalizeProposalResponseSchema } },
    },
    "409": jsonErrorResponse(
      "The proposal, group context, or authorization changed while the decision was being saved.",
    ),
    ...proposalRouteErrors,
  },
};

export const groupEventProposalAuditLogRouteSchema = {
  tags: ["Groups"],
  summary: "List proposal audit evidence",
  description: "Audit filtering, search, sort order, and pagination are executed in D1 for the exact proposal scope.",
  request: { params: groupEventProposalParamsSchema, query: scopedAuditLogListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of proposal audit evidence.",
      content: { "application/json": { schema: scopedAuditLogResponseSchema } },
    },
    ...proposalRouteErrors,
  },
};

export const groupEventProposalReviewsListRouteSchema = {
  tags: ["Groups"],
  summary: "List proposal reviews",
  description: "Review filtering, search, sorting, aggregation, and pagination are executed in D1.",
  request: { params: groupEventProposalParamsSchema, query: proposalReviewsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of private program reviews and the caller's review.",
      content: { "application/json": { schema: proposalReviewsListResponseSchema } },
    },
    ...proposalRouteErrors,
  },
};

export const groupEventProposalReviewUpsertRouteSchema = {
  tags: ["Groups"],
  summary: "Create or update my proposal review",
  request: {
    params: groupEventProposalParamsSchema,
    body: { required: true, content: { "application/json": { schema: proposalReviewUpsertSchema } } },
  },
  responses: {
    "200": {
      description: "The caller's review and audit evidence were saved atomically.",
      content: { "application/json": { schema: proposalReviewWriteResponseSchema } },
    },
    "409": jsonErrorResponse("The proposal or review changed while the review was being saved."),
    ...proposalRouteErrors,
  },
};

export const groupEventProposalReviewPatchRouteSchema = {
  tags: ["Groups"],
  summary: "Update my proposal review",
  description: "Only the review owner may edit this review, including program managers and administrators.",
  request: {
    params: groupEventProposalReviewParamsSchema,
    body: { required: true, content: { "application/json": { schema: proposalReviewPatchSchema } } },
  },
  responses: {
    "200": {
      description: "The caller's review was updated atomically.",
      content: { "application/json": { schema: proposalReviewWriteResponseSchema } },
    },
    "409": jsonErrorResponse("The proposal or review changed while the review was being saved."),
    ...proposalRouteErrors,
  },
};

export const groupEventProposalCommentsListRouteSchema = {
  tags: ["Groups"],
  summary: "List private proposal comments",
  description: "Comment search, sorting, and pagination are executed in D1.",
  request: { params: groupEventProposalParamsSchema, query: proposalCommentsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of private program comments.",
      content: { "application/json": { schema: proposalCommentsListResponseSchema } },
    },
    ...proposalRouteErrors,
  },
};

const proposalSpeakerWriteErrors = {
  "409": jsonErrorResponse("The proposal, speaker, or group context changed while the action was processed."),
  ...proposalRouteErrors,
};

export const groupEventProposalSpeakersRouteSchema = {
  tags: ["Groups"],
  summary: "List proposal speakers through a group-owned event",
  request: { params: groupEventProposalParamsSchema },
  responses: {
    "200": {
      description: "Proposal speaker roster.",
      content: { "application/json": { schema: proposalSpeakersResponseSchema } },
    },
    ...proposalRouteErrors,
  },
};

export const groupEventProposalSpeakerPatchRouteSchema = {
  tags: ["Groups"],
  summary: "Update a proposal speaker",
  request: {
    params: groupEventProposalSpeakerParamsSchema,
    body: { required: true, content: { "application/json": { schema: proposalSpeakerPatchSchema } } },
  },
  responses: {
    "200": {
      description: "Updated proposal speaker.",
      content: { "application/json": { schema: proposalSpeakerPatchResponseSchema } },
    },
    ...proposalSpeakerWriteErrors,
  },
};

export const groupEventProposalSpeakerDeleteRouteSchema = {
  tags: ["Groups"],
  summary: "Remove a proposal speaker",
  request: {
    params: groupEventProposalSpeakerParamsSchema,
    body: { required: true, content: { "application/json": { schema: proposalSpeakerRemovalRequestSchema } } },
  },
  responses: {
    "200": {
      description: "Proposal speaker removed.",
      content: { "application/json": { schema: proposalSpeakerRemovalResponseSchema } },
    },
    ...proposalSpeakerWriteErrors,
  },
};

export const groupEventProposalSpeakerReminderRouteSchema = {
  tags: ["Groups"],
  summary: "Queue a proposal speaker reminder",
  request: { params: groupEventProposalSpeakerParamsSchema },
  responses: {
    "200": {
      description: "Reminder queued.",
      content: { "application/json": { schema: proposalSpeakerReminderResponseSchema } },
    },
    ...proposalSpeakerWriteErrors,
  },
};

export const groupEventProposalSpeakerRemindersRouteSchema = {
  tags: ["Groups"],
  summary: "Queue proposal speaker reminders",
  request: { params: groupEventProposalParamsSchema },
  responses: {
    "200": {
      description: "Reminders queued.",
      content: { "application/json": { schema: proposalSpeakerRemindersResponseSchema } },
    },
    ...proposalSpeakerWriteErrors,
  },
};

const groupEventProposalSpeakerHeadshotResponses = {
  "200": {
    description: "Headshot action completed.",
    content: { "application/json": { schema: headshotUrlResponseSchema } },
  },
  ...proposalSpeakerWriteErrors,
};

export const groupEventProposalSpeakerHeadshotGetRouteSchema = {
  tags: ["Groups", "Headshots"],
  summary: "Download a proposal speaker headshot",
  request: { params: groupEventProposalSpeakerParamsSchema },
  responses: { "200": { description: "Binary headshot image." }, ...proposalRouteErrors },
};

export const groupEventProposalSpeakerHeadshotPutRouteSchema = {
  tags: ["Groups", "Headshots"],
  summary: "Upload a proposal speaker headshot",
  request: { params: groupEventProposalSpeakerParamsSchema },
  responses: groupEventProposalSpeakerHeadshotResponses,
};

export const groupEventProposalSpeakerHeadshotDeleteRouteSchema = {
  tags: ["Groups", "Headshots"],
  summary: "Remove a proposal speaker headshot",
  request: { params: groupEventProposalSpeakerParamsSchema },
  responses: {
    "200": { description: "Headshot removed.", content: { "application/json": { schema: successResponseSchema } } },
    ...proposalSpeakerWriteErrors,
  },
};

export const groupEventProposalSpeakerGravatarPostRouteSchema = {
  tags: ["Groups", "Headshots"],
  summary: "Import a proposal speaker Gravatar",
  request: { params: groupEventProposalSpeakerParamsSchema },
  responses: groupEventProposalSpeakerHeadshotResponses,
};

export const groupEventProposalCommentCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Add a private proposal comment",
  request: {
    params: groupEventProposalParamsSchema,
    body: { required: true, content: { "application/json": { schema: proposalCommentCreateSchema } } },
  },
  responses: {
    "200": {
      description: "Comment and audit evidence were saved atomically.",
      content: { "application/json": { schema: proposalCommentCreateResponseSchema } },
    },
    ...proposalRouteErrors,
  },
};

export type GroupEventProposalEditable = z.infer<typeof proposalEditableSchema>;

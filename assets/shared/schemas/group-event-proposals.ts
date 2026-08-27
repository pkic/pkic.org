import { z } from "zod";
import { jsonErrorResponse, proposalIdParamsSchema, proposalReviewIdParamsSchema } from "./api-common";
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
} from "./proposal-management";
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

export const groupEventProposalParamsSchema = groupReferenceParamsSchema.extend({
  eventId: eventIdSchema,
  proposalId: proposalIdParamsSchema.shape.proposalId,
});

export const groupEventProposalReviewParamsSchema = groupEventProposalParamsSchema.extend({
  reviewId: proposalReviewIdParamsSchema.shape.reviewId,
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

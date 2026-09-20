import { userCatalogListQuerySchema, userCatalogListResponseSchema } from "./user-catalog";
import { membershipApplicationDetailSchema } from "./membership-application-management";
import {
  membershipWorkflowProgressSchema,
  membershipWorkflowObjectionsQuerySchema,
  membershipWorkflowObjectionsResponseSchema,
} from "./membership-workflows";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { authErrors, ok, requiresSession } from "./route-contract";
import {
  membershipWorkflowActionSchema,
  membershipWorkflowObjectionCreateSchema,
  membershipWorkflowObjectionResolveSchema,
} from "./membership-workflows";
const params = z.object({ id: databaseIdSchema });
const review = { tags: ["Membership"], ...requiresSession() };
export const membershipWorkflowActionResponseSchema = z.object({
  approved: z.boolean(),
  outboxIds: z.array(databaseIdSchema),
});
const errors = authErrors({
  notFound: "Application or objection not found.",
  conflict: "Workflow or eligibility changed.",
  unprocessable: "Invalid review evidence.",
});
export const membershipStaffReviewRouteSchema = {
  ...review,
  summary: "Complete the active membership staff review",
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: membershipWorkflowActionSchema } } },
  },
  responses: { ...ok("Review recorded.", membershipWorkflowActionResponseSchema), ...errors },
};
export const membershipObjectionCreateResponseSchema = z.object({ objectionId: databaseIdSchema });
export const membershipObjectionCreateRouteSchema = {
  ...review,
  summary: "Record an attributed membership review objection",
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: membershipWorkflowObjectionCreateSchema } } },
  },
  responses: { ...ok("Objection recorded.", membershipObjectionCreateResponseSchema), ...errors },
};
export const membershipObjectionResolveRouteSchema = {
  ...review,
  summary: "Resolve or withdraw a membership objection with a reason",
  request: {
    params: params.extend({ objectionId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: membershipWorkflowObjectionResolveSchema } } },
  },
  responses: { ...ok("Resolution recorded.", membershipWorkflowActionResponseSchema), ...errors },
};

export const membershipWorkflowReviewResponseSchema = z.object({
  application: membershipApplicationDetailSchema.pick({
    id: true,
    applicantName: true,
    applicantEmail: true,
    organizationName: true,
    membershipCategory: true,
    answers: true,
    answerFields: true,
    requestedWorkingGroups: true,
  }),
  workflow: membershipWorkflowProgressSchema,
  capabilities: z.object({
    completeReview: z.boolean(),
    object: z.boolean(),
    resolveObjections: z.boolean(),
    recordForReviewer: z.boolean(),
  }),
  userId: databaseIdSchema,
});
export const membershipWorkflowReviewRouteSchema = {
  ...review,
  summary: "Read the membership review available to the current user",
  request: { params },
  responses: { ...ok("Application and review requirements.", membershipWorkflowReviewResponseSchema), ...errors },
};
export const membershipWorkflowObjectionsRouteSchema = {
  ...review,
  summary: "List objections for an authorized membership review",
  request: { params, query: membershipWorkflowObjectionsQuerySchema },
  responses: { ...ok("Attributed objections.", membershipWorkflowObjectionsResponseSchema), ...errors },
};

export const membershipWorkflowReviewersRouteSchema = {
  ...review,
  summary: "Search eligible reviewers for the current consensus step",
  request: { params, query: userCatalogListQuerySchema },
  responses: { ...ok("Eligible users for attributed objections.", userCatalogListResponseSchema), ...errors },
};

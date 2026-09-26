import {
  mailingListsListQuerySchema,
  mailingListsListResponseSchema,
  mailingListResponseSchema,
} from "./mailing-lists";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { authErrors, ok, requiresPermissions } from "./route-contract";
import {
  membershipWorkflowRemovalSchema,
  membershipWorkflowRemovalResponseSchema,
  membershipWorkflowCreateSchema,
  membershipWorkflowPublishSchema,
  membershipWorkflowsQuerySchema,
  membershipWorkflowsResponseSchema,
  membershipWorkflowUpdateSchema,
  membershipWorkflowVersionResponseSchema,
} from "./membership-workflows";

export const membershipWorkflowVersionParamsSchema = z.object({ versionId: databaseIdSchema });
const workflowRead = { tags: ["Membership"], ...requiresPermissions("membership:read") };
const workflowWrite = { tags: ["Membership"], ...requiresPermissions("membership:write") };
const workflowResponses = {
  ...ok("Membership workflow version.", membershipWorkflowVersionResponseSchema),
  ...authErrors({ notFound: "Workflow version not found.", conflict: "The workflow or authorization changed." }),
};
export const membershipWorkflowsListRouteSchema = {
  ...workflowRead,
  summary: "List membership workflow versions",
  request: { query: membershipWorkflowsQuerySchema },
  responses: { ...ok("Workflow versions.", membershipWorkflowsResponseSchema), ...authErrors() },
};
export const membershipWorkflowGetRouteSchema = {
  ...workflowRead,
  summary: "Read a membership workflow version",
  request: { params: membershipWorkflowVersionParamsSchema },
  responses: workflowResponses,
};
export const membershipWorkflowCreateRouteSchema = {
  ...workflowWrite,
  summary: "Create a membership workflow draft",
  request: { body: { required: true, content: { "application/json": { schema: membershipWorkflowCreateSchema } } } },
  responses: workflowResponses,
};
export const membershipWorkflowUpdateRouteSchema = {
  ...workflowWrite,
  summary: "Edit a membership workflow draft",
  request: {
    params: membershipWorkflowVersionParamsSchema,
    body: { required: true, content: { "application/json": { schema: membershipWorkflowUpdateSchema } } },
  },
  responses: workflowResponses,
};
export const membershipWorkflowPublishRouteSchema = {
  ...workflowWrite,
  ...requiresPermissions("membership:write", "membership:approve"),
  summary: "Publish an immutable membership workflow version",
  request: {
    params: membershipWorkflowVersionParamsSchema,
    body: { required: true, content: { "application/json": { schema: membershipWorkflowPublishSchema } } },
  },
  responses: workflowResponses,
};

export const membershipWorkflowDestinationsRouteSchema = {
  ...workflowRead,
  summary: "List active managed destinations for membership notices",
  request: { query: mailingListsListQuerySchema },
  responses: { ...ok("Managed notification lists.", mailingListsListResponseSchema), ...authErrors() },
};
export const membershipWorkflowDestinationRouteSchema = {
  ...workflowRead,
  summary: "Read a selected membership notice destination",
  request: { params: z.object({ destinationId: databaseIdSchema }) },
  responses: {
    ...ok("Managed notification list.", mailingListResponseSchema),
    ...authErrors({ notFound: "List not found." }),
  },
};

export const membershipWorkflowRemoveRouteSchema = {
  ...workflowWrite,
  summary: "Delete an unused draft or archive a published workflow version",
  request: {
    params: membershipWorkflowVersionParamsSchema,
    body: { required: true, content: { "application/json": { schema: membershipWorkflowRemovalSchema } } },
  },
  responses: {
    ...ok("Workflow removed from future selection.", membershipWorkflowRemovalResponseSchema),
    ...authErrors({ notFound: "Workflow not found.", conflict: "Workflow is assigned or changed." }),
  },
};

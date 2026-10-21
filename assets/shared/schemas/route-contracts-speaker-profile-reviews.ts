import { eventSlugParamsSchema } from "./api-common";
import { requiresPermissions } from "./route-contract";
import {
  speakerProfileReviewQuerySchema,
  speakerProfileReviewsResponseSchema,
  speakerProfileApprovalSchema,
  speakerProfileApprovalResponseSchema,
} from "./event-speaker-profile-reviews";

export const speakerProfileReviewsRouteSchema = {
  ...requiresPermissions("agenda:read"),
  tags: ["Events"],
  summary: "Review canonical speaker profiles once per event and identity",
  request: { params: eventSlugParamsSchema, query: speakerProfileReviewQuerySchema },
  responses: {
    "200": {
      description: "Speaker profiles",
      content: { "application/json": { schema: speakerProfileReviewsResponseSchema } },
    },
  },
};
export const speakerProfileApprovalRouteSchema = {
  ...requiresPermissions("agenda:appearance_approve"),
  tags: ["Events"],
  summary: "Approve the exact reviewed canonical speaker profile for this event",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: speakerProfileApprovalSchema } } },
  },
  responses: {
    "200": {
      description: "Updated agenda",
      content: { "application/json": { schema: speakerProfileApprovalResponseSchema } },
    },
  },
};

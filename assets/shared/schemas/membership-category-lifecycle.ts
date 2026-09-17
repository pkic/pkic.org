import {
  membershipCategoryCreateSchema,
  membershipCategoryDeleteSchema,
  membershipCategoryDeleteResponseSchema,
  membershipCategoryParamsSchema,
  membershipCategoryResponseSchema,
} from "./membership-categories";
import { requiresPermissions } from "./route-contract";

export const membershipCategoryCreateRouteSchema = {
  ...requiresPermissions("membership:write"),
  tags: ["Membership"],
  summary: "Create a membership category",
  request: { body: { required: true, content: { "application/json": { schema: membershipCategoryCreateSchema } } } },
  responses: {
    "201": {
      description: "Created category.",
      content: { "application/json": { schema: membershipCategoryResponseSchema } },
    },
    "409": { description: "The category code already exists or the catalog changed." },
  },
};

export const membershipCategoryDeleteRouteSchema = {
  ...requiresPermissions("membership:write"),
  tags: ["Membership"],
  summary: "Delete an unused membership category",
  request: {
    params: membershipCategoryParamsSchema,
    body: { required: true, content: { "application/json": { schema: membershipCategoryDeleteSchema } } },
  },
  responses: {
    "200": {
      description: "Deleted unused category.",
      content: { "application/json": { schema: membershipCategoryDeleteResponseSchema } },
    },
    "409": { description: "The category is referenced or has changed." },
  },
};

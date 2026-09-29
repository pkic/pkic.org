import { z } from "zod";
import { groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema, searchTermSchema } from "./pagination";
import { requiresSession } from "./route-contract";

export const USER_CATALOG_SORT_COLUMNS = ["email", "first_name", "last_name", "organization_name"] as const;

/** Data-minimized identity projection shared by user-selection controls. */
export const userCatalogItemSchema = z.object({
  id: databaseIdSchema,
  email: z.email(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  organization_name: z.string().nullable(),
});
export type UserCatalogItem = z.infer<typeof userCatalogItemSchema>;

export const userCatalogListQuerySchema = listQuerySchema(USER_CATALOG_SORT_COLUMNS, {
  limit: 8,
  maxLimit: 8,
}).extend({ q: searchTermSchema });
export type UserCatalogListQuery = z.infer<typeof userCatalogListQuerySchema>;
export const userCatalogListResponseSchema = paginatedResponseSchema("users", userCatalogItemSchema);

export const groupUsersListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Search active users available to a group-management action",
  description:
    "Returns only identity fields needed by a user selector. Search, sorting, counting, and pagination execute in D1 and require effective management permission for the selected group.",
  request: { params: groupReferenceParamsSchema, query: userCatalogListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of active user identities.",
      content: { "application/json": { schema: userCatalogListResponseSchema } },
    },
    "401": { description: "Portal authentication is required." },
    "403": { description: "Effective group management permission is required." },
    "404": { description: "Group not found." },
  },
};

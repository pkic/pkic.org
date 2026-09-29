/**
 * Secondary email addresses (`user_emails`).
 * Backs `GET/POST /api/v1/users/:userId/emails`,
 * and `DELETE .../:emailId`.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const userIdEmailsParamsSchema = z.object({ userId: databaseIdSchema });
export const userEmailIdParamsSchema = z.object({ userId: databaseIdSchema, emailId: databaseIdSchema });

export const userEmailAddSchema = z.object({ email: normalizedEmailSchema });

export const userEmailResponseSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  email: z.string(),
  createdAt: z.string(),
});
export const userEmailAddResponseSchema = z.object({ email: userEmailResponseSchema });
export type UserEmailRecord = z.infer<typeof userEmailResponseSchema>;

export const USER_EMAILS_SORT_COLUMNS = ["email", "created_at"] as const;
export const userEmailsListQuerySchema = listQuerySchema(USER_EMAILS_SORT_COLUMNS, { limit: 10 });
export type UserEmailsListQuery = z.infer<typeof userEmailsListQuerySchema>;
export const userEmailsListResponseSchema = paginatedResponseSchema("emails", userEmailResponseSchema);

export const userEmailsListRouteSchema = {
  tags: ["Users"],
  summary: "List a user's secondary email addresses",
  description:
    "Staff-managed aliases. A verified alias can authenticate the same canonical user and can be selected by an organization representation.",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { params: userIdEmailsParamsSchema, query: userEmailsListQuerySchema },
  responses: {
    "200": {
      description: "Secondary emails.",
      content: { "application/json": { schema: userEmailsListResponseSchema } },
    },
    "400": { description: "Invalid user identifier or list query." },
    "401": { description: "Staff authorization required." },
    "403": { description: "User read permission required." },
  },
};

export const userEmailAddRouteSchema = {
  tags: ["Users"],
  summary: "Add a secondary email address to a user",
  "x-pkic-auth": { required: true, scopes: ["users:write"] },
  request: {
    params: userIdEmailsParamsSchema,
    body: { content: { "application/json": { schema: userEmailAddSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Secondary email added.",
      content: { "application/json": { schema: userEmailAddResponseSchema } },
    },
    "400": { description: "Invalid user identifier or email address." },
    "401": { description: "Staff authorization required." },
    "403": { description: "User update permission required." },
    "404": { description: "User not found." },
    "409": { description: "Email already belongs to (or is already recorded on) a user account." },
  },
};

export const userEmailRemoveRouteSchema = {
  tags: ["Users"],
  summary: "Remove a secondary email address from a user",
  "x-pkic-auth": { required: true, scopes: ["users:write"] },
  request: { params: userEmailIdParamsSchema },
  responses: {
    "200": { description: "Secondary email removed." },
    "400": { description: "Invalid user or email identifier." },
    "401": { description: "Staff authorization required." },
    "403": { description: "User update permission required." },
    "404": { description: "Secondary email not found for this user." },
  },
};

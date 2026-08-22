/**
 * Secondary email addresses (`user_emails`).
 * Backs `GET/POST /api/v1/admin/users/:userId/emails`,
 * and `DELETE .../:emailId`.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema } from "./api-common";

export const userIdEmailsParamsSchema = z.object({ userId: databaseIdSchema });
export const userEmailIdParamsSchema = z.object({ userId: databaseIdSchema, emailId: databaseIdSchema });

export const userEmailAddSchema = z.object({ email: normalizedEmailSchema });

export const userEmailResponseSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  email: z.string(),
  createdAt: z.string(),
});

export const userEmailsListRouteSchema = {
  tags: ["Users"],
  summary: "List a user's secondary email addresses",
  description: "Admin/display/search only -- does not affect login. See user_emails table.",
  request: { params: userIdEmailsParamsSchema },
  responses: {
    "200": {
      description: "Secondary emails.",
      content: { "application/json": { schema: z.object({ emails: z.array(userEmailResponseSchema) }) } },
    },
  },
};

export const userEmailAddRouteSchema = {
  tags: ["Users"],
  summary: "Add a secondary email address to a user",
  request: {
    params: userIdEmailsParamsSchema,
    body: { content: { "application/json": { schema: userEmailAddSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Secondary email added.",
      content: { "application/json": { schema: z.object({ email: userEmailResponseSchema }) } },
    },
    "409": { description: "Email already belongs to (or is already recorded on) a user account." },
  },
};

export const userEmailRemoveRouteSchema = {
  tags: ["Users"],
  summary: "Remove a secondary email address from a user",
  request: { params: userEmailIdParamsSchema },
  responses: {
    "200": { description: "Secondary email removed." },
    "404": { description: "Secondary email not found for this user." },
  },
};

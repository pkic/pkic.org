/**
 * Secondary email addresses (`user_emails`) and the user-merge tool.
 * Backs `GET/POST /api/v1/admin/users/:userId/emails`,
 * `DELETE .../:emailId`, and `POST /api/v1/admin/users/:userId/merge`.
 */
import { z } from "zod";
import { normalizedEmailSchema } from "./api";

export const userIdEmailsParamsSchema = z.object({ userId: z.uuid() });
export const userEmailIdParamsSchema = z.object({ userId: z.uuid(), emailId: z.uuid() });

export const userEmailAddSchema = z.object({ email: normalizedEmailSchema });

export const userEmailResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  createdAt: z.string(),
});

export const userEmailsListRouteSchema = {
  tags: ["Users"],
  summary: "List a user's secondary email addresses",
  description: "Admin/display/search only -- does not affect login. See PRD user_emails table.",
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

export const userMergeSchema = z.object({ sourceUserId: z.uuid() });

export const userMergeResponseSchema = z.object({
  survivorId: z.uuid(),
  mergedFromUserId: z.uuid(),
  mergedFromEmail: z.string(),
});

export const userMergeRouteSchema = {
  tags: ["Users"],
  summary: "Merge another user account into this one",
  description:
    "Reassigns working_group_members/members/user_roles/permission_grants/passkey_credentials from the source " +
    "account, adds its original email as a secondary email on the survivor, and anonymizes the source account " +
    "(tagged via users.merged_into_user_id). Registrations, donations, proposals, audit log, and email_outbox " +
    "entries are deliberately left pointing at the (now-anonymized) source account id, matching the precedent " +
    "already set by finalizeEmailChange's own registration-only reassignment.",
  request: {
    params: z.object({ userId: z.uuid() }),
    body: { content: { "application/json": { schema: userMergeSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Accounts merged.",
      content: { "application/json": { schema: userMergeResponseSchema } },
    },
    "404": { description: "Survivor or source user not found." },
    "409": {
      description:
        "Same user given twice, either account is already merged into another, or both accounts hold a membership.",
    },
  },
};

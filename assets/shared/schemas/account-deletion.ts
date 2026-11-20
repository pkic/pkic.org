import { z } from "zod";
import { ACCOUNT_DELETION_BLOCKER_KINDS, ACCOUNT_DELETION_REMOVED_KINDS } from "../account-deletion";
import { successResponseSchema, userIdParamsSchema } from "./api-common";
import { authErrors, ok, requiresPermissions } from "./route-contract";

const countSchema = z.number().int().positive();

/** What deleting the account would remove, and what keeps it, as of `revision`. */
export const accountDeletionPreviewSchema = z.object({
  userId: userIdParamsSchema.shape.userId,
  email: z.string(),
  /** Opaque: changes whenever anything listed here changes, so a delete confirms exactly what staff saw. */
  revision: z.string().min(1),
  deletable: z.boolean(),
  removes: z.array(z.object({ kind: z.enum(ACCOUNT_DELETION_REMOVED_KINDS), count: countSchema })),
  blockers: z.array(z.object({ kind: z.enum(ACCOUNT_DELETION_BLOCKER_KINDS), count: countSchema })),
});
export type AccountDeletionPreview = z.infer<typeof accountDeletionPreviewSchema>;

export const accountDeletionPreviewResponseSchema = z.object({ deletion: accountDeletionPreviewSchema });

/** Names the preview staff confirmed, so the delete removes exactly what they saw. */
export const accountDeletionSchema = z.object({ revision: accountDeletionPreviewSchema.shape.revision }).strict();
export type AccountDeletion = z.infer<typeof accountDeletionSchema>;

export const accountDeletionResponseSchema = successResponseSchema.extend({
  userId: userIdParamsSchema.shape.userId,
});

export const accountDeletionPreviewRouteSchema = {
  ...requiresPermissions("users:delete"),
  tags: ["Users"],
  summary: "Preview deleting a user account",
  description: "Lists what deleting the account would remove with it, and anything that keeps the account.",
  request: { params: userIdParamsSchema },
  responses: {
    ...ok("What deleting the account would remove.", accountDeletionPreviewResponseSchema),
    ...authErrors({ badRequest: "Invalid user identifier.", notFound: "User not found." }),
  },
};

export const accountDeletionRouteSchema = {
  ...requiresPermissions("users:delete"),
  tags: ["Users"],
  summary: "Delete a user account",
  description:
    "Permanently deletes the account and the records listed in its preview, in one change. Refused when anything keeps the account or when the account changed since the preview.",
  request: { params: userIdParamsSchema, query: accountDeletionSchema },
  responses: {
    ...ok("Account deleted.", accountDeletionResponseSchema),
    ...authErrors({
      badRequest: "Invalid user identifier or revision.",
      notFound: "User not found.",
      conflict: "The account has records that keep it, or it changed since the preview.",
    }),
  },
};

import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { successResponseSchema } from "./api-common";

export const ADMIN_PROPOSAL_COMMENT_SORT_COLUMNS = ["createdAt", "author"] as const;

export const proposalCommentsListQuerySchema = listQuerySchema(ADMIN_PROPOSAL_COMMENT_SORT_COLUMNS, { limit: 25 });

export const proposalCommentCreateSchema = z.object({
  comment: z.string().trim().min(1).max(10_000),
});

export const proposalInternalCommentSchema = z.object({
  id: databaseIdSchema,
  proposal_id: databaseIdSchema,
  author_user_id: databaseIdSchema,
  comment: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  author_email: z.string().email().nullable(),
  author_first_name: z.string().nullable(),
  author_last_name: z.string().nullable(),
});

export const proposalCommentsListResponseSchema = paginatedResponseSchema("comments", proposalInternalCommentSchema);

export const proposalCommentCreateResponseSchema = successResponseSchema.extend({
  comment: proposalInternalCommentSchema,
});

export type ProposalCommentsListQuery = z.infer<typeof proposalCommentsListQuerySchema>;
export type ProposalInternalComment = z.infer<typeof proposalInternalCommentSchema>;

import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { httpUrlSchema } from "./urls";

export const memberNewsQuerySchema = listQuerySchema(["publishedAt", "title"] as const, { limit: 48 });
export type MemberNewsQuery = z.infer<typeof memberNewsQuerySchema>;
export const memberNewsArticleSchema = z.object({
  url: httpUrlSchema,
  title: z.string(),
  summary: z.string(),
  publishedAt: z.iso.datetime(),
  organizationName: z.string(),
  sponsorTier: z.string().nullable(),
});
export type MemberNewsArticle = z.infer<typeof memberNewsArticleSchema>;
export const memberNewsPageSchema = paginatedResponseSchema("articles", memberNewsArticleSchema);
export type MemberNewsPage = z.infer<typeof memberNewsPageSchema>;

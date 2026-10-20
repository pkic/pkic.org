import { z } from "zod";

export const modelContributionSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  contributionBranch: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceVersion: z.string().optional(),
  sourceRevision: z.string().optional(),
});
export type ModelContribution = z.infer<typeof modelContributionSchema>;

/** Feedback captures the page being read; editing targets the configured working branch. */
export function modelFeedbackUrl(context: ModelContribution, page: string, selectedText = "", itemId = ""): string {
  const url = new URL(`https://github.com/${context.repository}/issues/new`);
  url.searchParams.set("template", "model-feedback.yml");
  url.searchParams.set("source-page", page);
  url.searchParams.set("source-version", context.sourceVersion ?? "Not specified on the page");
  if (context.sourceRevision) url.searchParams.set("source-revision", context.sourceRevision);
  if (itemId) url.searchParams.set("item-id", itemId.slice(0, 200));
  // Bound the query so a large selection remains usable as a GitHub link.
  if (selectedText) url.searchParams.set("selected-text", selectedText.slice(0, 300));
  return url.href;
}

export function modelEditUrl(context: ModelContribution): string {
  const branch = encodeURIComponent(context.contributionBranch);
  const path = context.sourcePath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${context.repository}/edit/${branch}/${path}`;
}

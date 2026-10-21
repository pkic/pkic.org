import { z } from "zod";

export const contentContributionSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  contributionBranch: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  feedbackTemplate: z.string().min(1).optional(),
  sourceVersion: z.string().optional(),
  sourceRevision: z.string().optional(),
});
export type ContentContribution = z.infer<typeof contentContributionSchema>;

/** Feedback captures the page being read; editing targets the configured working branch. */
export function contentFeedbackUrl(context: ContentContribution, page: string, selectedText = "", itemId = ""): string {
  const url = new URL(`https://github.com/${context.repository}/issues/new`);
  if (!context.feedbackTemplate) {
    url.searchParams.set("title", `Suggested update: ${new URL(page).pathname}`);
    url.searchParams.set(
      "body",
      [
        `Page: ${page}`,
        context.sourcePath ? `Source file: ${context.sourcePath}` : "",
        context.sourceVersion ? `Displayed version: ${context.sourceVersion}` : "",
        context.sourceRevision ? `Source revision: ${context.sourceRevision}` : "",
        itemId ? `Section or item: ${itemId.slice(0, 200)}` : "",
        selectedText ? `Selected wording:\n> ${selectedText.slice(0, 300).replaceAll("\n", "\n> ")}` : "",
        "Suggested change:\n",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    return url.href;
  }
  url.searchParams.set("template", context.feedbackTemplate);
  url.searchParams.set("source-page", page);
  url.searchParams.set("source-version", context.sourceVersion ?? "Not specified on the page");
  if (context.sourceRevision) url.searchParams.set("source-revision", context.sourceRevision);
  if (itemId) url.searchParams.set("item-id", itemId.slice(0, 200));
  // Bound the query so a large selection remains usable as a GitHub link.
  if (selectedText) url.searchParams.set("selected-text", selectedText.slice(0, 300));
  return url.href;
}

export function contentEditUrl(context: ContentContribution): string | undefined {
  if (!context.sourcePath) return undefined;
  const branch = encodeURIComponent(context.contributionBranch);
  const path = context.sourcePath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${context.repository}/edit/${branch}/${path}`;
}

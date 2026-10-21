import { z } from "zod";
import { parse } from "yaml";
import source from "../../../data/content-contributions.yaml?raw";
import { contentContributionSchema, type ContentContribution } from "../../../assets/shared/content-contribution";
import { normalizedContentSourcePath } from "./site-markdown";

const destination = contentContributionSchema.pick({ repository: true, contributionBranch: true });
const registry = z
  .object({
    website: destination,
    repositories: z.array(destination.extend({ sourceRoot: z.string().min(1) })),
    pages: z.array(contentContributionSchema.extend({ root: z.string(), sections: z.array(z.string()) })),
  })
  .parse(parse(source));

/** Authored files keep their actual path, including filenames used for custom public routes. */
export function contributionForSource(rawSourcePath: string): ContentContribution {
  const sourcePath = `content/${normalizedContentSourcePath(rawSourcePath.startsWith("content/") ? `./${rawSourcePath}` : rawSourcePath)}`;
  const owner = [...registry.repositories]
    .sort((a, b) => b.sourceRoot.length - a.sourceRoot.length)
    .find((entry) => sourcePath.startsWith(entry.sourceRoot));
  return contentContributionSchema.parse(
    owner ? { ...owner, sourcePath: sourcePath.slice(owner.sourceRoot.length) } : { ...registry.website, sourcePath },
  );
}

/** Generated pages accept feedback but have no invented editable Markdown file. */
export function contentContributionForRoute(
  route: string,
  authored?: ContentContribution,
): ContentContribution | undefined {
  if (route === "/portal/" || route.startsWith("/portal/")) return undefined;
  const page = registry.pages.find(
    (entry) => route === entry.root || entry.sections.some((section) => route.startsWith(`${entry.root}${section}`)),
  );
  return contentContributionSchema.parse(page ?? authored ?? registry.website);
}

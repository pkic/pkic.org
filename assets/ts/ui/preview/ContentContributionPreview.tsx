import { ContentContributionLinks } from "../../site/ContentContributionLinks";
import type { PreviewSection } from "./PreviewShell";

export const contentContributionPreview: PreviewSection = {
  id: "content-contribution",
  title: "Suggest a website change",
  note: "One contribution pattern for website pages and content maintained in other repositories.",
  render: () => (
    <ContentContributionLinks
      context={{ repository: "pkic/pkic.org", contributionBranch: "main", sourcePath: "content/about/_index.md" }}
      page="https://pkic.org/about/"
    />
  ),
};

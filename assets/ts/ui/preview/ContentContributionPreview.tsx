import { ContentContributionLinks } from "../../site/ContentContributionLinks";
import type { PreviewSection } from "./PreviewShell";

export const contentContributionPreview: PreviewSection = {
  id: "content-contribution",
  title: "Page feedback",
  note: "An invitation above the site footer and a floating edit link, only for public pages with an editable source.",
  render: () => (
    <ContentContributionLinks
      context={{ repository: "pkic/pkic.org", contributionBranch: "main", sourcePath: "content/about/_index.md" }}
      page="https://pkic.org/about/"
    />
  ),
};

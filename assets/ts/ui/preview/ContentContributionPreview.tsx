import { ContentContributionLinks } from "../../site/ContentContributionLinks";
import type { PreviewSection } from "./PreviewShell";

export const contentContributionPreview: PreviewSection = {
  id: "content-contribution",
  title: "Page feedback",
  note: "An invitation above the site footer and an edit link that floats at the bottom-right, or follows the invitation on phones. Only for public pages with an editable source.",
  render: () => (
    <ContentContributionLinks
      context={{ repository: "pkic/pkic.org", contributionBranch: "main", sourcePath: "content/about/_index.md" }}
      page="https://pkic.org/about/"
    />
  ),
};

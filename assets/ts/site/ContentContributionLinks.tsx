import { contentEditUrl, contentFeedbackUrl, type ContentContribution } from "../../shared/content-contribution";
import { IconPencil } from "../ui/MediaIcons";
import { ExternalLink } from "../ui/ExternalLink";
import "./ContentContributionLinks.css";

/** Public editable content shares selection feedback and a persistent source-edit shortcut. */
export function ContentContributionLinks({
  context,
  page,
  showInvitation = true,
}: {
  context: ContentContribution;
  page: string;
  showInvitation?: boolean;
}) {
  const editUrl = contentEditUrl(context);
  if (!editUrl) return null;
  const feedbackUrl = contentFeedbackUrl(context, page);
  return (
    <section
      class="pk content-contribution"
      aria-label="Contribute to this page"
      data-content-contribution={JSON.stringify(context)}
      data-content-feedback-url={feedbackUrl}
    >
      {showInvitation && (
        <div class="pk-container content-contribution__invitation">
          <p>
            Have a suggestion? Select text to suggest a change, or{" "}
            <ExternalLink data-content-feedback-link href={feedbackUrl}>
              give feedback
            </ExternalLink>
            .
          </p>
        </div>
      )}
      <ExternalLink
        class="content-contribution__edit"
        href={editUrl}
        aria-label="Edit this page on GitHub"
        title="Edit this page on GitHub"
      >
        <IconPencil />
      </ExternalLink>
    </section>
  );
}

import { contentEditUrl, contentFeedbackUrl, type ContentContribution } from "../../shared/content-contribution";
import { ExternalLink } from "../ui/ExternalLink";

/** Persistent links keep contributing available without a text selection or JavaScript. */
export function ContentContributionLinks({ context, page }: { context: ContentContribution; page: string }) {
  const editUrl = contentEditUrl(context);
  return (
    <section
      class="pk pk-container pk-section"
      aria-label="Contribute to this page"
      data-content-contribution={JSON.stringify(context)}
    >
      <p>Select wording to include it in your feedback.</p>
      <p class="pk-cluster pk-cluster--start">
        <ExternalLink data-content-feedback-link href={contentFeedbackUrl(context, page)}>
          Suggest a change
        </ExternalLink>
        {editUrl && <ExternalLink href={editUrl}>Edit this page on GitHub</ExternalLink>}
      </p>
    </section>
  );
}

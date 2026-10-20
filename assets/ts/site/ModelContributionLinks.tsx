import { modelEditUrl, modelFeedbackUrl, type ModelContribution } from "../../shared/model-contribution";
import { ExternalLink } from "../ui/ExternalLink";

/** Persistent links keep contributing available without a text selection or JavaScript. */
export function ModelContributionLinks({ context, page }: { context: ModelContribution; page: string }) {
  return (
    <section
      class="pk pk-container pk-section"
      aria-label="Contribute to the model"
      data-model-contribution={JSON.stringify(context)}
    >
      <p>Select wording to include it in your feedback. You do not need to choose a release version.</p>
      <p class="pk-cluster pk-cluster--start">
        <ExternalLink data-model-feedback-link href={modelFeedbackUrl(context, page)}>
          Suggest a change
        </ExternalLink>
        <ExternalLink href={modelEditUrl(context)}>Edit the working model on GitHub</ExternalLink>
      </p>
    </section>
  );
}

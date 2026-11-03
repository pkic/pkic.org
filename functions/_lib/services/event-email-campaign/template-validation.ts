import type { z } from "zod";
import type { apiValidationErrorDetailsSchema } from "../../../../assets/shared/schemas/api-common";
import type { EventEmailCampaignPreviewInput } from "../../../../assets/shared/schemas/event-email-campaigns";
import { emailTemplateCollectionFields } from "../../../../assets/shared/schemas/email-template-data";
import type { TemplateReferenceAnalysis, TemplateVariableReference } from "../../email/template-references";
import { unresolvedTemplateTokens } from "../../email/render";
import { AppError } from "../../errors";

type CampaignMessage = Pick<EventEmailCampaignPreviewInput, "bodyContent">;

function refuseTokens(input: CampaignMessage, subject: readonly string[], body: readonly string[]): void {
  const subjectTokens = [...new Set(subject)],
    bodyTokens = [...new Set(body)];
  const unresolved = [...new Set([...subjectTokens, ...bodyTokens])];
  if (!unresolved.length) return;
  throw new AppError(
    422,
    "CAMPAIGN_TEMPLATE_UNRESOLVED",
    `Fix the message before sending: ${unresolved.join(", ")} ${unresolved.length === 1 ? "is" : "are"} not a known variable or a closed block.`,
    {
      fieldErrors: {
        ...(subjectTokens.length ? { subjectOverride: [`Unknown or unclosed: ${subjectTokens.join(", ")}`] } : {}),
        ...(bodyTokens.length
          ? { [input.bodyContent ? "bodyContent" : "templateKey"]: [`Unknown or unclosed: ${bodyTokens.join(", ")}`] }
          : {}),
      },
    } satisfies z.infer<typeof apiValidationErrorDetailsSchema>,
  );
}

/** Validate every authored branch against canonical root and loop-item scopes before compilation. */
export function assertCampaignAuthoredReferences(
  input: CampaignMessage,
  known: ReadonlySet<string>,
  templateReferences: readonly TemplateReferenceAnalysis[],
): void {
  const collections = emailTemplateCollectionFields();
  const permitted = (reference: TemplateVariableReference): boolean => {
    if (reference.kind === "each") return known.has(reference.name) && collections.has(reference.name);
    if (known.has(reference.name)) return true;
    if (!reference.collection) return false;
    return (
      ["this", ".", "@index", "@first", "@last"].includes(reference.name) ||
      (collections.get(reference.collection)?.includes(reference.name) ?? false)
    );
  };
  const invalid = (analysis: TemplateReferenceAnalysis) => [
    ...analysis.invalidTokens,
    ...analysis.references.filter((reference) => !permitted(reference)).map((reference) => `{{${reference.name}}}`),
  ];
  refuseTokens(input, invalid(templateReferences[1]!), invalid(templateReferences[0]!));
}

/** Tokens in attributes can survive HTML rendering while disappearing from the text alternative. */
export function assertCampaignRenderedReferences(
  input: CampaignMessage,
  subject: string,
  rendered: { html: string; text: string },
): void {
  refuseTokens(input, unresolvedTemplateTokens(subject), unresolvedTemplateTokens(rendered.text, rendered.html));
}

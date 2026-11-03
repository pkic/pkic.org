import { applyCampaignCustomText } from "../../email/campaign-custom";
import type { EmailContentType } from "../../../../assets/shared/schemas/email-templates";
import type { CampaignTemplate, EventEmailCampaignInput } from "./types";

/** The authored body and subject, before recipient values choose conditional branches. */
export function campaignAuthoredTemplates(
  input: EventEmailCampaignInput,
  template: CampaignTemplate | null,
): [string, string] {
  if (input.bodyContent) return [input.bodyContent, input.subjectOverride ?? ""];
  return [
    template
      ? applyCampaignCustomText(template.content, template.contentType as EmailContentType, input.customText)
      : "",
    input.subjectOverride ?? template?.subjectTemplate ?? "",
  ];
}

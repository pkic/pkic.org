import type { EmailTemplatePartials } from "../../../../assets/shared/schemas/email-templates";
import { AppError } from "../../errors";
import type { CampaignRecipient, CampaignTemplate, EventEmailCampaignInput } from "./types";

import { analyzeTemplateReferences } from "../../email/template-references";

interface CampaignReferenceOptions {
  recipientVariables?: readonly string[];
  partials?: EmailTemplatePartials;
}

export function findBroadcastOnlyTemplateRefs(
  recipients: CampaignRecipient[],
  parts: Array<string | null | undefined>,
  options: CampaignReferenceOptions = {},
): string[] {
  const disallowed = new Set<string>([
    "firstName",
    "lastName",
    "email",
    "registrationStatus",
    "attendanceType",
    "speakerStatus",
    "proposalTitle",
    "proposalAbstract",
    "proposalType",
    "customAnswerRows",
    "reg_details",
    "manageUrl",
  ]);

  for (const key of [
    ...recipients.flatMap((recipient) => Object.keys(recipient.templateData ?? {})),
    ...(options.recipientVariables ?? []),
  ]) {
    if (key !== "registrationUrl" && key !== "proposalUrl") disallowed.add(key);
  }
  const found = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    const analysis = analyzeTemplateReferences(part, options.partials);
    for (const reference of analysis.references) {
      if (disallowed.has(reference.name)) found.add(reference.name);
    }
    if (analysis.includedPartials.includes("reg_details")) found.add("reg_details");
  }
  return Array.from(found).sort();
}

export function assertCampaignBroadcastSafety(
  input: Pick<EventEmailCampaignInput, "sendMode" | "subjectOverride" | "bodyContent" | "customText">,
  recipients: CampaignRecipient[],
  template: CampaignTemplate | null,
  options: CampaignReferenceOptions = {},
): void {
  if (input.sendMode !== "bcc_batch") return;
  const unsafeRefs = findBroadcastOnlyTemplateRefs(
    recipients,
    [input.subjectOverride, input.bodyContent, input.customText, template?.subjectTemplate, template?.content],
    options,
  );
  if (unsafeRefs.length > 0) {
    throw new AppError(
      400,
      "CAMPAIGN_BROADCAST_UNSAFE_TEMPLATE",
      `Broadcast emails cannot use recipient-specific tags: ${unsafeRefs.join(", ")}. Switch to Personal (1:1) or remove those tags.`,
    );
  }
}

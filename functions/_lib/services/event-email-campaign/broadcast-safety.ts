import { AppError } from "../../errors";
import type { CampaignRecipient, CampaignTemplate, EventEmailCampaignInput } from "./types";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findBroadcastOnlyTemplateRefs(
  recipients: CampaignRecipient[],
  parts: Array<string | null | undefined>,
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

  for (const recipient of recipients) {
    for (const key of Object.keys(recipient.templateData ?? {})) {
      if (key === "registrationUrl" || key === "proposalUrl") continue;
      disallowed.add(key);
    }
  }

  const content = parts.filter((part): part is string => Boolean(part && part.trim()));
  const found = new Set<string>();
  const regexMap = new Map<string, RegExp>();
  for (const key of disallowed) {
    regexMap.set(
      key,
      key === "reg_details"
        ? /\{\{>\s*reg_details\s*\}\}/
        : new RegExp(`\\{\\{[^}]*\\b${escapeRegex(key)}\\b[^}]*\\}\\}`),
    );
  }

  for (const part of content) {
    for (const key of disallowed) {
      if (regexMap.get(key)?.test(part)) found.add(key);
    }
  }

  return Array.from(found).sort();
}

export function assertCampaignBroadcastSafety(
  input: Pick<EventEmailCampaignInput, "sendMode" | "subjectOverride" | "bodyContent" | "customText">,
  recipients: CampaignRecipient[],
  template: CampaignTemplate | null,
): void {
  if (input.sendMode !== "bcc_batch") return;
  const unsafeRefs = findBroadcastOnlyTemplateRefs(recipients, [
    input.subjectOverride,
    input.bodyContent,
    input.customText,
    template?.subjectTemplate,
    template?.content,
  ]);
  if (unsafeRefs.length > 0) {
    throw new AppError(
      400,
      "CAMPAIGN_BROADCAST_UNSAFE_TEMPLATE",
      `Broadcast emails cannot use recipient-specific tags: ${unsafeRefs.join(", ")}. Switch to Personal (1:1) or remove those tags.`,
    );
  }
}

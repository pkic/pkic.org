import { sha256Hex } from "../../utils/crypto";
import type { EmailMessageType } from "../../../../assets/shared/schemas/admin-email-templates";
import type { CampaignAudienceFilter, CampaignRecipient } from "./types";

export async function computeCampaignDigest(payload: {
  templateKey: string | undefined;
  subjectOverride?: string | null;
  customText?: string | null;
  bodyContent?: string | null;
  messageType?: EmailMessageType | null;
  sendMode: "personal" | "bcc_batch";
  batchSize: number;
  filter: CampaignAudienceFilter;
  recipients: CampaignRecipient[];
}): Promise<string> {
  const canonical = {
    templateKey: payload.templateKey,
    subjectOverride: (payload.subjectOverride ?? "").trim(),
    customText: (payload.customText ?? "").trim(),
    bodyContent: (payload.bodyContent ?? "").trim(),
    messageType: payload.messageType ?? null,
    sendMode: payload.sendMode,
    batchSize: payload.batchSize,
    filter: payload.filter,
    recipients: payload.recipients.map((recipient) => recipient.email),
  };
  return sha256Hex(JSON.stringify(canonical));
}

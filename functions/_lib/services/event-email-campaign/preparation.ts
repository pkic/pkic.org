import { resolveTemplate } from "../../email/templates";
import type { DatabaseLike } from "../../types";
import type {
  CampaignAudienceFilter,
  CampaignEvent,
  EventEmailCampaignInput,
  PreparedEventEmailCampaign,
} from "./types";
import { computeCampaignDigest } from "./digest";
import { listCampaignRecipients } from "./audience";

function campaignAudienceFilter(input: EventEmailCampaignInput): CampaignAudienceFilter {
  return {
    audience: input.filter.audience,
    attendeeStatus: input.filter.attendeeStatus,
    attendanceType: input.filter.attendanceType,
    dayDate: input.filter.dayDate,
    dayWaitlistStatus: input.filter.dayWaitlistStatus,
    speakerStatus: input.filter.speakerStatus,
  };
}

export async function prepareEventEmailCampaign(
  db: DatabaseLike,
  event: CampaignEvent,
  appBaseUrl: string,
  input: EventEmailCampaignInput,
  maxRecipients: number,
): Promise<PreparedEventEmailCampaign> {
  const template = !input.bodyContent && input.templateKey ? await resolveTemplate(db, input.templateKey) : null;
  const messageType = input.messageType ?? template?.messageType ?? "promotional";
  const filter = campaignAudienceFilter(input);
  const recipients = await listCampaignRecipients(db, event, appBaseUrl, filter, { maxRecipients });
  const digest = await computeCampaignDigest({
    templateKey: input.templateKey,
    subjectOverride: input.subjectOverride ?? null,
    customText: input.customText ?? null,
    bodyContent: input.bodyContent ?? null,
    messageType,
    sendMode: input.sendMode,
    batchSize: input.batchSize,
    filter,
    recipients,
  });
  return { template, messageType, filter, recipients, digest };
}

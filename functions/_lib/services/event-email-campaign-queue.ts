import { isAttendeeCampaignAudience } from "../../../assets/shared/schemas/event-email-campaigns";
import { prepareBulkQueueEmailChunkStatements } from "../email/outbox";
import { DIRECT_EMAIL_TEMPLATE_KEY, directEmailBodyPayload } from "../email/direct-body";
import type { DatabaseLike, StatementLike } from "../types";
import { buildEventEmailVariables, type EventRecord } from "./events";
import { proposalPageUrl, registrationPageUrl } from "./frontend-links";
import { registrationManageCapability } from "./registrations/capability-urls";
import { campaignAuthoredTemplates } from "./event-email-campaign/template-content";
import { templateVariableNames } from "../email/template-references";
import { buildPersonalCampaignTemplateData } from "./event-email-campaign/template-data";
import { chunkRecipients } from "./event-email-campaign/batching";
import { findBroadcastOnlyTemplateRefs } from "./event-email-campaign/broadcast-safety";
import type { EventEmailCampaignInput, CampaignDeliveryPage, CampaignRecipient } from "./event-email-campaign/types";
import { outboxIdForOperation } from "../email/outbox-queue";

async function campaignOutboxIdentity(campaignId: string, recipient: CampaignRecipient) {
  const idempotencyKey = recipient.idempotencyKey ?? `event-campaign:${campaignId}:${recipient.email}`;
  return { outboxId: await outboxIdForOperation(idempotencyKey), idempotencyKey };
}

/** Builds a bounded outbox page for the campaign use case to commit with its cursor. */
export async function prepareEventEmailCampaignPage(
  db: DatabaseLike,
  event: EventRecord,
  appBaseUrl: string,
  input: EventEmailCampaignInput,
  campaign: CampaignDeliveryPage,
  campaignId: string,
  condition: { sql: string; bindings: unknown[] },
): Promise<{ queuedRecipients: number; queuedBatches: number; statements: StatementLike[] }> {
  const { template, messageType, recipients } = campaign;
  const templateKey = input.bodyContent
    ? input.templateKey || DIRECT_EMAIL_TEMPLATE_KEY
    : (input.templateKey as string);
  const routeVars = isAttendeeCampaignAudience(input.filter.audience)
    ? { registrationUrl: registrationPageUrl(appBaseUrl, event, { source: "event_email" }) }
    : { proposalUrl: proposalPageUrl(appBaseUrl, event, { source: "event_email" }) };
  const sharedEventVars = buildEventEmailVariables(event, appBaseUrl);
  // These authored names were accepted by preview. Re-derive the defaults from its
  // digest-bound content so later recipients with different forms render absent values empty.
  const defaultVariableNames = templateVariableNames(campaignAuthoredTemplates(input, template), {
    includeLoopBodies: true,
    partials: campaign.partials,
  });
  const usesManageUrl =
    input.filter.audience === "attendees" &&
    findBroadcastOnlyTemplateRefs(
      recipients,
      [input.subjectOverride, input.bodyContent, input.customText, template?.subjectTemplate, template?.content],
      { partials: campaign.partials },
    ).includes("manageUrl");

  const rows = [] as Parameters<typeof prepareBulkQueueEmailChunkStatements>[1];
  let queuedRecipients = 0;
  let queuedBatches = 0;
  if (input.sendMode === "personal") {
    for (const recipient of recipients) {
      const manageUrl =
        usesManageUrl && recipient.registrationId && recipient.manageLinkSecret
          ? (
              await registrationManageCapability(appBaseUrl, event, {
                id: recipient.registrationId,
                manage_link_secret: recipient.manageLinkSecret,
              })
            ).manageUrl
          : undefined;
      rows.push({
        ...(await campaignOutboxIdentity(campaignId, recipient)),
        eventId: event.id,
        templateKey,
        recipientEmail: recipient.email,
        recipientUserId: recipient.userId ?? null,
        messageType,
        subject: input.subjectOverride ?? `Update: ${event.name}`,
        attachments: recipient.attachments,
        capabilityLinkValues: manageUrl ? [manageUrl] : [],
        data: {
          ...buildPersonalCampaignTemplateData(recipient, { ...sharedEventVars, ...routeVars }, defaultVariableNames),
          ...(manageUrl ? { manageUrl } : {}),
          __eventCampaignCustomText: input.customText ?? null,
          ...directEmailBodyPayload(input.bodyContent),
          __campaignAudience: input.filter.audience,
        },
      });
    }
    queuedRecipients = rows.length;
    queuedBatches = rows.length;
  } else {
    for (const chunk of chunkRecipients(recipients, input.batchSize)) {
      const to = chunk[0];
      if (!to) continue;
      rows.push({
        ...(await campaignOutboxIdentity(campaignId, to)),
        eventId: event.id,
        templateKey,
        recipientEmail: to.email,
        messageType,
        subject: input.subjectOverride ?? `Update: ${event.name}`,
        data: {
          ...sharedEventVars,
          firstName: "Member",
          lastName: "",
          ...routeVars,
          __eventCampaignCustomText: input.customText ?? null,
          ...directEmailBodyPayload(input.bodyContent),
          __campaignAudience: input.filter.audience,
          __bccRecipients: chunk.slice(1).map((recipient) => recipient.email),
        },
      });
      queuedRecipients += chunk.length;
      queuedBatches += 1;
    }
  }

  const statements = prepareBulkQueueEmailChunkStatements(db, rows, undefined, condition).map(
    (chunk) => chunk.statement,
  );
  return { queuedRecipients, queuedBatches, statements };
}

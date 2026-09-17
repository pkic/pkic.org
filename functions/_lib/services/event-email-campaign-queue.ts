import { prepareBulkQueueEmailChunkStatements } from "../email/outbox";
import { DIRECT_EMAIL_TEMPLATE_KEY, directEmailBodyPayload } from "../email/direct-body";
import type { DatabaseLike, StatementLike } from "../types";
import { buildEventEmailVariables, type EventRecord } from "./events";
import { proposalPageUrl, registrationPageUrl } from "./frontend-links";
import { registrationManageCapability } from "./registrations/capability-urls";
import { buildPersonalCampaignTemplateData } from "./event-email-campaign/template-data";
import { chunkRecipients } from "./event-email-campaign/batching";
import { findBroadcastOnlyTemplateRefs } from "./event-email-campaign/broadcast-safety";
import type { EventEmailCampaignInput, CampaignDeliveryPage } from "./event-email-campaign/types";

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
  const routeVars =
    input.filter.audience === "attendees"
      ? { registrationUrl: registrationPageUrl(appBaseUrl, event, { source: "event_email" }) }
      : { proposalUrl: proposalPageUrl(appBaseUrl, event, { source: "event_email" }) };
  const sharedEventVars = buildEventEmailVariables(event, appBaseUrl);
  const usesManageUrl =
    input.filter.audience === "attendees" &&
    findBroadcastOnlyTemplateRefs(recipients, [
      input.subjectOverride,
      input.bodyContent,
      input.customText,
      template?.subjectTemplate,
      template?.content,
    ]).includes("manageUrl");

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
        outboxId: `${campaignId}:${recipient.email}`,
        idempotencyKey: `event-campaign:${campaignId}:${recipient.email}`,
        eventId: event.id,
        templateKey,
        recipientEmail: recipient.email,
        recipientUserId: recipient.userId ?? null,
        messageType,
        subject: input.subjectOverride ?? `Update: ${event.name}`,
        capabilityLinkValues: manageUrl ? [manageUrl] : [],
        data: {
          ...buildPersonalCampaignTemplateData(recipient, { ...sharedEventVars, ...routeVars }),
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
        outboxId: `${campaignId}:${to.email}`,
        idempotencyKey: `event-campaign:${campaignId}:${to.email}`,
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

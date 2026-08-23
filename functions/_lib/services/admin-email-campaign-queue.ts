import { prepareBulkQueueEmailChunkStatements } from "../email/outbox";
import type { DatabaseLike } from "../types";
import { queuedCapabilityToken } from "./capability-links";
import { buildEventEmailVariables, type EventRecord } from "./events";
import { proposalPageUrl, registrationManagePageUrl, registrationPageUrl } from "./frontend-links";
import {
  chunkRecipients,
  findBroadcastOnlyTemplateRefs,
  type AdminCampaignInput,
  type PreparedAdminCampaign,
} from "./admin-email-campaign";

/** Builds and atomically queues every outbox row for a validated campaign. */
export async function queueAdminCampaign(
  db: DatabaseLike,
  event: EventRecord,
  appBaseUrl: string,
  input: AdminCampaignInput,
  campaign: PreparedAdminCampaign,
): Promise<{ queuedRecipients: number; queuedBatches: number }> {
  const { template, messageType, recipients } = campaign;
  const templateKey = input.bodyContent ? input.templateKey || "__direct__" : (input.templateKey as string);
  const routeVars =
    input.filter.audience === "attendees"
      ? { registrationUrl: registrationPageUrl(appBaseUrl, event, { source: "admin_email" }) }
      : { proposalUrl: proposalPageUrl(appBaseUrl, event, { source: "admin_email" }) };
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
        usesManageUrl && recipient.registrationId
          ? registrationManagePageUrl(
              appBaseUrl,
              event,
              queuedCapabilityToken("registration_manage", recipient.registrationId),
            )
          : undefined;
      rows.push({
        eventId: event.id,
        templateKey,
        recipientEmail: recipient.email,
        recipientUserId: recipient.userId ?? null,
        messageType,
        subject: input.subjectOverride ?? `Update: ${event.name}`,
        capabilityLinkValues: manageUrl ? [manageUrl] : [],
        data: {
          ...sharedEventVars,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          ...routeVars,
          ...recipient.templateData,
          ...(manageUrl ? { manageUrl } : {}),
          __adminCampaignCustomText: input.customText ?? null,
          __adminCampaignBodyContent: input.bodyContent ?? null,
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
          __adminCampaignCustomText: input.customText ?? null,
          __adminCampaignBodyContent: input.bodyContent ?? null,
          __campaignAudience: input.filter.audience,
          __bccRecipients: chunk.slice(1).map((recipient) => recipient.email),
        },
      });
      queuedRecipients += chunk.length;
      queuedBatches += 1;
    }
  }

  const statements = prepareBulkQueueEmailChunkStatements(db, rows).map((chunk) => chunk.statement);
  if (statements.length > 0) await db.batch(statements);
  return { queuedRecipients, queuedBatches };
}

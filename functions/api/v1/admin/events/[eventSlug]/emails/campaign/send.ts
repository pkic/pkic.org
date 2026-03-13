import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { queueEmail, processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { resolveTemplate } from "../../../../../../../_lib/email/templates";
import { proposalPageUrl, registrationPageUrl } from "../../../../../../../_lib/services/frontend-links";
import {
  chunkRecipients,
  computeCampaignDigest,
  findBroadcastOnlyTemplateRefs,
  listCampaignRecipients,
  verifyCampaignPreviewToken,
} from "../../../../../../../_lib/services/admin-email-campaign";
import type { PagesContext } from "../../../../../../../_lib/types";
import { adminEventCampaignSendSchema } from "../../../../../../../../shared/schemas/api";

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminEventCampaignSendSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const secret = requireInternalSecret(context.env);
  const appBaseUrl = resolveAppBaseUrl(context.env);

  const recipients = await listCampaignRecipients(context.env.DB, event.id, {
    audience: body.filter.audience,
    attendeeStatus: body.filter.attendeeStatus,
    attendanceType: body.filter.attendanceType,
    dayDate: body.filter.dayDate,
    speakerStatus: body.filter.speakerStatus,
  });

  const uniqueRecipients = recipients.filter((recipient, index, arr) =>
    arr.findIndex((candidate) => candidate.email === recipient.email) === index,
  );

  const digest = await computeCampaignDigest({
    templateKey: body.templateKey,
    subjectOverride: body.subjectOverride ?? null,
    customText: body.customText ?? null,
    bodyContent: body.bodyContent ?? null,
    sendMode: body.sendMode,
    batchSize: body.batchSize,
    filter: {
      audience: body.filter.audience,
      attendeeStatus: body.filter.attendeeStatus,
      attendanceType: body.filter.attendanceType,
      dayDate: body.filter.dayDate,
      speakerStatus: body.filter.speakerStatus,
    },
    recipients: uniqueRecipients,
  });

  const validation = await verifyCampaignPreviewToken({
    secret,
    token: body.previewToken,
    eventId: event.id,
    adminId: admin.id,
    digest,
  });

  if (!validation.ok) {
    if (validation.reason === "expired") {
      throw new AppError(409, "CAMPAIGN_PREVIEW_EXPIRED", "Campaign preview expired. Render a fresh preview before sending.");
    }
    if (validation.reason === "mismatch") {
      throw new AppError(409, "CAMPAIGN_PREVIEW_STALE", "Campaign settings or recipients changed after preview. Render preview again.");
    }
    throw new AppError(400, "CAMPAIGN_PREVIEW_INVALID", "Invalid campaign preview token.");
  }

  if (uniqueRecipients.length === 0) {
    throw new AppError(400, "CAMPAIGN_NO_RECIPIENTS", "No recipients matched the selected filters.");
  }

  if (!body.bodyContent && !body.templateKey) {
    throw new AppError(400, "CAMPAIGN_NO_CONTENT", "Provide a message body or select a template before sending.");
  }

  // Validate template exists only when not using a direct body override
  const templateKey = body.bodyContent ? (body.templateKey || "__direct__") : body.templateKey;
  const template = !body.bodyContent ? await resolveTemplate(context.env.DB, templateKey) : null;

  if (body.sendMode === "bcc_batch") {
    const unsafeRefs = findBroadcastOnlyTemplateRefs(uniqueRecipients, [
      body.subjectOverride,
      body.bodyContent,
      body.customText,
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

  let queued = 0;
  let batches = 0;
  const routeVars = body.filter.audience === "attendees"
    ? { registrationUrl: registrationPageUrl(appBaseUrl, event, { source: "admin_email" }) }
    : { proposalUrl: proposalPageUrl(appBaseUrl, event, { source: "admin_email" }) };

  if (body.sendMode === "personal") {
    for (const recipient of uniqueRecipients) {
      const outboxId = await queueEmail(context.env.DB, {
        eventId: event.id,
        templateKey,
        recipientEmail: recipient.email,
        messageType: "promotional",
        subject: body.subjectOverride ?? `Update: ${event.name}`,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          ...routeVars,
          ...recipient.templateData,
          __adminCampaignCustomText: body.customText ?? null,
          __adminCampaignBodyContent: body.bodyContent ?? null,
          __campaignAudience: body.filter.audience,
        },
      });
      queued += 1;
      context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
    }
    batches = uniqueRecipients.length;
  } else {
    const chunks = chunkRecipients(uniqueRecipients, body.batchSize);
    for (const chunk of chunks) {
      const to = chunk[0];
      if (!to) continue;
      const bcc = chunk.slice(1).map((recipient) => recipient.email);
      const outboxId = await queueEmail(context.env.DB, {
        eventId: event.id,
        templateKey,
        recipientEmail: to.email,
        messageType: "promotional",
        subject: body.subjectOverride ?? `Update: ${event.name}`,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: "Member",
          lastName: "",
          ...routeVars,
          __adminCampaignCustomText: body.customText ?? null,
          __adminCampaignBodyContent: body.bodyContent ?? null,
          __campaignAudience: body.filter.audience,
          __bccRecipients: bcc,
        },
      });
      queued += chunk.length;
      batches += 1;
      context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
    }
  }

  return json({
    success: true,
    queuedRecipients: queued,
    queuedBatches: batches,
    mode: body.sendMode,
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}

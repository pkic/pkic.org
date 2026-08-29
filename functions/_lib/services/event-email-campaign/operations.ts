import type {
  EventEmailCampaignCreateInput,
  EventEmailCampaignPreviewInput,
  EventEmailCampaignPreviewResponse,
  EventEmailCampaignResponse,
} from "../../../../assets/shared/schemas/event-email-campaigns";
import {
  eventEmailCampaignPreviewResponseSchema,
  eventEmailCampaignResponseSchema,
} from "../../../../assets/shared/schemas/event-email-campaigns";
import type { EmailContentType } from "../../../../assets/shared/schemas/email-templates";
import { applyCampaignCustomText } from "../../email/campaign-custom";
import { loadEmailRenderResources } from "../../email/partials";
import { renderEmail, renderSubject } from "../../email/render";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { buildEventEmailVariables, type EventRecord } from "../events";
import { proposalPageUrl, registrationManagePageUrl, registrationPageUrl } from "../frontend-links";
import { queueEventEmailCampaign } from "../event-email-campaign-queue";
import { assertCampaignBroadcastSafety } from "./broadcast-safety";
import { chunkRecipients } from "./batching";
import { prepareEventEmailCampaign } from "./preparation";
import { signCampaignPreviewToken, verifyCampaignPreviewToken } from "./preview-token";
import { buildPersonalCampaignTemplateData } from "./template-data";

const PREVIEW_TTL_SECONDS = 10 * 60;

export interface EventEmailCampaignOperationOptions {
  actorId: string;
  appBaseUrl: string;
  signingSecret: string;
  maxRecipients: number;
}

export async function previewEventEmailCampaign(
  db: DatabaseLike,
  event: EventRecord,
  input: EventEmailCampaignPreviewInput,
  options: EventEmailCampaignOperationOptions,
): Promise<EventEmailCampaignPreviewResponse> {
  const campaign = await prepareEventEmailCampaign(db, event, options.appBaseUrl, input, options.maxRecipients);
  const { template, recipients, digest } = campaign;
  const token = await signCampaignPreviewToken({
    secret: options.signingSecret,
    eventId: event.id,
    actorId: options.actorId,
    digest,
    ttlSeconds: PREVIEW_TTL_SECONDS,
  });

  if (recipients.length === 0) {
    return eventEmailCampaignPreviewResponseSchema.parse({
      success: true,
      recipientCount: 0,
      batchCount: 0,
      previewToken: token.token,
      previewExpiresAt: token.expiresAt,
      sampleRecipients: [],
      subject: input.subjectOverride ?? `Update: ${event.name}`,
      html: "<p>No recipients matched your filter.</p>",
      text: "No recipients matched your filter.",
    });
  }

  if (!input.bodyContent && !input.templateKey) {
    throw new AppError(400, "CAMPAIGN_NO_CONTENT", "Provide a message body or select a template before previewing.");
  }
  assertCampaignBroadcastSafety(input, recipients, template);

  const { partials, layoutHtml } = await loadEmailRenderResources(db);
  const sample = recipients[0];
  const routeVariables =
    input.filter.audience === "attendees"
      ? { registrationUrl: registrationPageUrl(options.appBaseUrl, event, { source: "event_email" }) }
      : { proposalUrl: proposalPageUrl(options.appBaseUrl, event, { source: "event_email" }) };
  const sampleData = buildPersonalCampaignTemplateData(sample, {
    ...buildEventEmailVariables(event, options.appBaseUrl),
    recipientCount: recipients.length,
    audience: input.filter.audience,
    ...routeVariables,
  });
  if (input.filter.audience === "attendees") {
    sampleData.manageUrl = registrationManagePageUrl(options.appBaseUrl, event, "preview-token");
  }

  let subject: string;
  let rendered: { html: string; text: string };
  if (input.bodyContent) {
    const data = { ...sampleData, _partials: partials };
    subject = renderSubject(input.subjectOverride ?? null, `Update: ${event.name}`, data);
    rendered = await renderEmail(input.bodyContent, data, layoutHtml, "markdown", options.appBaseUrl);
  } else {
    if (!template) {
      throw new AppError(400, "CAMPAIGN_TEMPLATE_REQUIRED", "Select a template or provide a message body.");
    }
    const data = { ...sampleData, customText: input.customText ?? "", _partials: partials };
    subject = renderSubject(template.subjectTemplate, input.subjectOverride ?? `Update: ${event.name}`, data);
    const contentType = template.contentType as EmailContentType;
    const content = applyCampaignCustomText(template.content, contentType, input.customText ?? null);
    rendered = await renderEmail(content, data, layoutHtml, contentType, options.appBaseUrl);
  }

  return eventEmailCampaignPreviewResponseSchema.parse({
    success: true,
    recipientCount: recipients.length,
    batchCount:
      input.sendMode === "bcc_batch" ? chunkRecipients(recipients, input.batchSize).length : recipients.length,
    previewToken: token.token,
    previewExpiresAt: token.expiresAt,
    sampleRecipients: recipients.slice(0, 10).map((recipient) => recipient.email),
    subject,
    html: rendered.html,
    text: rendered.text,
  });
}

export async function createEventEmailCampaign(
  db: DatabaseLike,
  event: EventRecord,
  input: EventEmailCampaignCreateInput,
  options: EventEmailCampaignOperationOptions,
): Promise<EventEmailCampaignResponse> {
  if (!input.bodyContent && !input.templateKey) {
    throw new AppError(400, "CAMPAIGN_NO_CONTENT", "Provide a message body or select a template before sending.");
  }
  const campaign = await prepareEventEmailCampaign(db, event, options.appBaseUrl, input, options.maxRecipients);
  const { template, recipients, digest } = campaign;
  const validation = await verifyCampaignPreviewToken({
    secret: options.signingSecret,
    token: input.previewToken,
    eventId: event.id,
    actorId: options.actorId,
    digest,
  });
  if (!validation.ok) {
    if (validation.reason === "expired") {
      throw new AppError(409, "CAMPAIGN_PREVIEW_EXPIRED", "Campaign preview expired. Render a fresh preview.");
    }
    if (validation.reason === "mismatch") {
      throw new AppError(409, "CAMPAIGN_PREVIEW_STALE", "Campaign settings or recipients changed after preview.");
    }
    throw new AppError(400, "CAMPAIGN_PREVIEW_INVALID", "Invalid campaign preview token.");
  }
  if (recipients.length === 0) {
    throw new AppError(400, "CAMPAIGN_NO_RECIPIENTS", "No recipients matched the selected filters.");
  }
  assertCampaignBroadcastSafety(input, recipients, template);
  const queued = await queueEventEmailCampaign(db, event, options.appBaseUrl, input, campaign);
  return eventEmailCampaignResponseSchema.parse({
    success: true,
    queuedRecipients: queued.queuedRecipients,
    queuedBatches: queued.queuedBatches,
    mode: input.sendMode,
  });
}

import { isAttendeeCampaignAudience } from "../../../../assets/shared/schemas/event-email-campaigns";
import type {
  EventEmailCampaignCreateInput,
  EventEmailCampaignPreviewInput,
  EventEmailCampaignPreviewResponse,
  EventEmailCampaignResponse,
} from "../../../../assets/shared/schemas/event-email-campaigns";
import {
  eventEmailCampaignPreviewResponseSchema,
  eventEmailCampaignResponseSchema,
  speakerKitTestResponseSchema,
} from "../../../../assets/shared/schemas/event-email-campaigns";
import type { EmailContentType } from "../../../../assets/shared/schemas/email-templates";
import { loadEmailRenderResources } from "../../email/partials";
import { renderEmail, renderSubject } from "../../email/render";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { buildEventEmailVariables, type EventRecord } from "../events";
import {
  promotionKitPageUrl,
  proposalPageUrl,
  registrationManagePageUrl,
  registrationPageUrl,
} from "../frontend-links";
import { countSpeakerKitEmails, queueSpeakerKitTest } from "./speaker-kit";
import { assertCampaignBroadcastSafety } from "./broadcast-safety";
import {
  createCampaignSnapshot,
  findCampaignSnapshot,
  campaignSnapshotDigest,
  acceptCampaignSnapshot,
} from "./snapshots";
import { verifyCampaignPreviewToken } from "./preview-token";
import { analyzeTemplateReferences } from "../../email/template-references";
import { prepareEventFormFieldKeys } from "../forms/event-field-catalog";
import { assertCampaignAuthoredReferences, assertCampaignRenderedReferences } from "./template-validation";
import { campaignAuthoredTemplates } from "./template-content";
import { buildPersonalCampaignTemplateData } from "./template-data";
import { dispatchEventEmailCampaignPage } from "./dispatch";

export interface EventEmailCampaignOperationOptions {
  actorId: string;
  appBaseUrl: string;
  signingSecret: string;
}

export async function previewEventEmailCampaign(
  db: DatabaseLike,
  event: EventRecord,
  input: EventEmailCampaignPreviewInput,
  options: EventEmailCampaignOperationOptions,
): Promise<EventEmailCampaignPreviewResponse> {
  const campaign = await createCampaignSnapshot(db, event, input, options);
  const { template, recipients, token } = campaign;
  const recipientCount =
    input.kit && campaign.recipient_count > 0
      ? await countSpeakerKitEmails(db, event, input)
      : campaign.recipient_count;

  if (recipientCount === 0) {
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

  const { partials, layoutHtml } = await loadEmailRenderResources(db);
  const sample = recipients[0];
  const routeVariables = isAttendeeCampaignAudience(input.filter.audience)
    ? { registrationUrl: registrationPageUrl(options.appBaseUrl, event, { source: "event_email" }) }
    : { proposalUrl: proposalPageUrl(options.appBaseUrl, event, { source: "event_email" }) };
  const canonicalData = {
    ...buildEventEmailVariables(event, options.appBaseUrl),
    recipientCount,
    audience: input.filter.audience,
    ...routeVariables,
    // The sample recipient's first session stands in for the session each speaker gets.
    ...(input.kit
      ? {
          sessionTitle: sample?.templateData.proposalTitle ?? "",
          promotionKitUrl: promotionKitPageUrl(options.appBaseUrl, event),
        }
      : {}),
  };
  const known = new Set([
    ...Object.keys(canonicalData),
    "firstName",
    "lastName",
    ...recipients.flatMap((recipient) => Object.keys(recipient.templateData ?? {})),
    "customText",
    "baseUrl",
    "brandBaseUrl",
  ]);
  const authored = campaignAuthoredTemplates(input, template);
  const templateReferences = authored.map((source) => analyzeTemplateReferences(source, partials));
  const referencedNames = templateReferences.flatMap((analysis) =>
    analysis.references.map((reference) => reference.name),
  );
  const fields = await prepareEventFormFieldKeys(
    db,
    event.id,
    isAttendeeCampaignAudience(input.filter.audience) ? "event_registration" : "proposal_submission",
    referencedNames,
  ).all<{ key: string }>();
  for (const field of fields.results) known.add(field.key);
  assertCampaignBroadcastSafety(input, recipients, template, {
    recipientVariables: fields.results.map((field) => field.key),
    partials,
  });
  assertCampaignAuthoredReferences(input, known, templateReferences);
  const sampleData = buildPersonalCampaignTemplateData(sample, canonicalData, known);
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
    const content = authored[0];
    rendered = await renderEmail(content, data, layoutHtml, contentType, options.appBaseUrl);
  }

  assertCampaignRenderedReferences(input, subject, rendered);

  return eventEmailCampaignPreviewResponseSchema.parse({
    success: true,
    recipientCount,
    batchCount: input.sendMode === "bcc_batch" ? Math.ceil(recipientCount / input.batchSize) : recipientCount,
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
  const snapshot = await verifyCampaignPreview(db, event, input, options);
  await acceptCampaignSnapshot(db, event, input, snapshot, options);
  if (input.kit) {
    const emails = await countSpeakerKitEmails(db, event, input);
    return eventEmailCampaignResponseSchema.parse({
      success: true,
      queuedRecipients: emails,
      queuedBatches: emails,
      stagedRecipients: 0,
      mode: input.sendMode,
    });
  }
  // Stage one bounded page before returning so a small campaign is visible in
  // the outbox immediately. The persisted cursor lets larger campaigns resume.
  const staged = await dispatchEventEmailCampaignPage(db, snapshot.id);
  return eventEmailCampaignResponseSchema.parse({
    success: true,
    queuedRecipients: snapshot.recipient_count,
    queuedBatches:
      input.sendMode === "bcc_batch" ? Math.ceil(snapshot.recipient_count / input.batchSize) : snapshot.recipient_count,
    stagedRecipients: staged.queued,
    mode: input.sendMode,
  });
}

export async function sendSpeakerKitTest(
  db: DatabaseLike,
  event: EventRecord,
  input: EventEmailCampaignCreateInput,
  options: EventEmailCampaignOperationOptions,
) {
  if (!input.kit) throw new AppError(400, "CAMPAIGN_KIT_REQUIRED", "Attach the promotion kit before sending a test.");
  const snapshot = await verifyCampaignPreview(db, event, input, options);
  const { sessionTitle } = await queueSpeakerKitTest(db, event, input, { ...options, campaignId: snapshot.id });
  return speakerKitTestResponseSchema.parse({ success: true, sessionTitle });
}

async function verifyCampaignPreview(
  db: DatabaseLike,
  event: EventRecord,
  input: EventEmailCampaignCreateInput,
  options: EventEmailCampaignOperationOptions,
) {
  if (!input.bodyContent && !input.templateKey) {
    throw new AppError(400, "CAMPAIGN_NO_CONTENT", "Provide a message body or select a template before sending.");
  }
  const snapshot = await findCampaignSnapshot(db, event.id, options.actorId, input.previewToken);
  const digest = await campaignSnapshotDigest(input, snapshot.id);
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
  if (snapshot.recipient_count === 0) {
    throw new AppError(400, "CAMPAIGN_NO_RECIPIENTS", "No recipients matched the selected filters.");
  }
  return snapshot;
}

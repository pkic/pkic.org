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
} from "../../../../assets/shared/schemas/event-email-campaigns";
import type { EmailContentType } from "../../../../assets/shared/schemas/email-templates";
import { loadEmailRenderResources } from "../../email/partials";
import { renderEmail, renderSubject, templateVariableNames, unresolvedTemplateTokens } from "../../email/render";
import type { z } from "zod";
import type { apiValidationErrorDetailsSchema } from "../../../../assets/shared/schemas/api-common";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { buildEventEmailVariables, type EventRecord } from "../events";
import { proposalPageUrl, registrationManagePageUrl, registrationPageUrl } from "../frontend-links";
import { assertCampaignBroadcastSafety } from "./broadcast-safety";
import {
  createCampaignSnapshot,
  findCampaignSnapshot,
  campaignSnapshotDigest,
  acceptCampaignSnapshot,
} from "./snapshots";
import { verifyCampaignPreviewToken } from "./preview-token";
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
  const { template, recipients, token, recipient_count: recipientCount } = campaign;

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
  assertCampaignBroadcastSafety(input, recipients, template);

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
  const sampleData = buildPersonalCampaignTemplateData(sample, canonicalData, known);
  if (input.filter.audience === "attendees") {
    sampleData.manageUrl = registrationManagePageUrl(options.appBaseUrl, event, "preview-token");
  }

  let subject: string;
  let rendered: { html: string; text: string };
  /** What the author wrote, every branch of it, before any one recipient's data chooses a path. */
  const authored = campaignAuthoredTemplates(input, template);
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

  // Check authored names even in skipped branches. Optional recipient values render empty;
  // validation only loads the bounded sample, regardless of the snapshot audience size.
  const unresolvedIn = (source: string, output: string) => [
    ...new Set([
      ...templateVariableNames([source])
        .filter((name) => !known.has(name))
        .map((name) => `{{${name}}}`),
      ...unresolvedTemplateTokens(output),
    ]),
  ];
  const subjectTokens = unresolvedIn(authored[1], subject);
  const bodyTokens = unresolvedIn(authored[0], rendered.text);
  const unresolved = [...new Set([...subjectTokens, ...bodyTokens])];
  if (unresolved.length)
    throw new AppError(
      422,
      "CAMPAIGN_TEMPLATE_UNRESOLVED",
      `Fix the message before sending: ${unresolved.join(", ")} ${unresolved.length === 1 ? "is" : "are"} not a known variable or a closed block.`,
      {
        fieldErrors: {
          ...(subjectTokens.length ? { subjectOverride: [`Unknown or unclosed: ${subjectTokens.join(", ")}`] } : {}),
          ...(bodyTokens.length
            ? { [input.bodyContent ? "bodyContent" : "templateKey"]: [`Unknown or unclosed: ${bodyTokens.join(", ")}`] }
            : {}),
        },
      } satisfies z.infer<typeof apiValidationErrorDetailsSchema>,
    );

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
  await acceptCampaignSnapshot(db, event, input, snapshot);
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

import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { resolveTemplate } from "../../../../../../../_lib/email/templates";
import { renderEmail, renderSubject } from "../../../../../../../_lib/email/render";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { applyCampaignCustomText } from "../../../../../../../_lib/email/campaign-custom";
import { loadEmailPartials } from "../../../../../../../_lib/email/partials";
import { proposalPageUrl, registrationPageUrl } from "../../../../../../../_lib/services/frontend-links";
import {
  chunkRecipients,
  computeCampaignDigest,
  findBroadcastOnlyTemplateRefs,
  listCampaignRecipients,
  signCampaignPreviewToken,
} from "../../../../../../../_lib/services/admin-email-campaign";
import type { PagesContext } from "../../../../../../../_lib/types";
import { adminEventCampaignPreviewSchema } from "../../../../../../../../shared/schemas/api";

const PREVIEW_TTL_SECONDS = 10 * 60;

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminEventCampaignPreviewSchema);
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

  const token = await signCampaignPreviewToken({
    secret,
    eventId: event.id,
    adminId: admin.id,
    digest,
    ttlSeconds: PREVIEW_TTL_SECONDS,
  });

  if (uniqueRecipients.length === 0) {
    return json({
      success: true,
      recipientCount: 0,
      batchCount: 0,
      previewToken: token.token,
      previewExpiresAt: token.expiresAt,
      sampleRecipients: [],
      subject: body.subjectOverride ?? `Update: ${event.name}`,
      html: "<p>No recipients matched your filter.</p>",
      text: "No recipients matched your filter.",
    });
  }

  if (!body.bodyContent && !body.templateKey) {
    throw new AppError(400, "CAMPAIGN_NO_CONTENT", "Provide a message body or select a template before previewing.");
  }

  if (body.sendMode === "bcc_batch") {
    const template = !body.bodyContent && body.templateKey
      ? await resolveTemplate(context.env.DB, body.templateKey)
      : null;
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

  let subject: string;
  let rendered: { html: string; text: string };
  const partials = await loadEmailPartials(context.env.DB);
  const sample = uniqueRecipients[0];
  const routeVars = body.filter.audience === "attendees"
    ? { registrationUrl: registrationPageUrl(appBaseUrl, event, { source: "admin_email" }) }
    : { proposalUrl: proposalPageUrl(appBaseUrl, event, { source: "admin_email" }) };
  const sampleData = {
    ...buildEventEmailVariables(event, appBaseUrl),
    firstName: sample?.firstName || "Member",
    lastName: sample?.lastName || "",
    recipientCount: uniqueRecipients.length,
    audience: body.filter.audience,
    ...routeVars,
    ...(sample?.templateData ?? {}),
  };

  if (body.bodyContent) {
    // Full body provided — render directly without template resolution
    const data = sampleData;
    const dataWithPartials = { ...data, _partials: partials };
    subject = renderSubject(body.subjectOverride ?? null, `Update: ${event.name}`, dataWithPartials);
    rendered = await renderEmail(body.bodyContent, dataWithPartials, null, "markdown", appBaseUrl);
  } else {
    const template = await resolveTemplate(context.env.DB, body.templateKey);
    const data = {
      ...sampleData,
      customText: body.customText ?? "",
    };
    const dataWithPartials = { ...data, _partials: partials };
    subject = renderSubject(template.subjectTemplate, body.subjectOverride ?? `Update: ${event.name}`, dataWithPartials);
    const templateContentType = template.contentType as "markdown" | "html" | "text";
    const content = applyCampaignCustomText(template.content, templateContentType, body.customText ?? null);
    rendered = await renderEmail(content, dataWithPartials, null, templateContentType, appBaseUrl);
  }

  const batchCount = body.sendMode === "bcc_batch"
    ? chunkRecipients(uniqueRecipients, body.batchSize).length
    : uniqueRecipients.length;

  return json({
    success: true,
    recipientCount: uniqueRecipients.length,
    batchCount,
    previewToken: token.token,
    previewExpiresAt: token.expiresAt,
    sampleRecipients: uniqueRecipients.slice(0, 10).map((recipient) => recipient.email),
    subject,
    html: rendered.html,
    text: rendered.text,
  });
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(context);
}

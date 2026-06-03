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
import { loadEmailLayout, loadEmailPartials } from "../../../../../../../_lib/email/partials";
import { proposalPageUrl, registrationPageUrl } from "../../../../../../../_lib/services/frontend-links";
import {
  chunkRecipients,
  computeCampaignDigest,
  findBroadcastOnlyTemplateRefs,
  listCampaignRecipients,
  signCampaignPreviewToken,
} from "../../../../../../../_lib/services/admin-email-campaign";
import { adminEventCampaignPreviewSchema } from "../../../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

const PREVIEW_TTL_SECONDS = 10 * 60;

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventCampaignPreviewSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const secret = requireInternalSecret(c.env);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const template = !body.bodyContent && body.templateKey ? await resolveTemplate(requestDb(c), body.templateKey) : null;
  const messageType = body.messageType ?? template?.messageType ?? "promotional";

  const recipients = await listCampaignRecipients(requestDb(c), event, appBaseUrl, {
    audience: body.filter.audience,
    attendeeStatus: body.filter.attendeeStatus,
    attendanceType: body.filter.attendanceType,
    dayDate: body.filter.dayDate,
    speakerStatus: body.filter.speakerStatus,
  });

  const uniqueRecipients = recipients.filter(
    (recipient, index, arr) => arr.findIndex((candidate) => candidate.email === recipient.email) === index,
  );

  const digest = await computeCampaignDigest({
    templateKey: body.templateKey,
    subjectOverride: body.subjectOverride ?? null,
    customText: body.customText ?? null,
    bodyContent: body.bodyContent ?? null,
    messageType,
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
  const partials = await loadEmailPartials(requestDb(c));
  const layoutHtml = await loadEmailLayout(requestDb(c));
  const sample = uniqueRecipients[0];
  const routeVars =
    body.filter.audience === "attendees"
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
    rendered = await renderEmail(body.bodyContent, dataWithPartials, layoutHtml, "markdown", appBaseUrl);
  } else {
    if (!template) {
      throw new AppError(400, "CAMPAIGN_TEMPLATE_REQUIRED", "Select a template or provide a message body.");
    }
    const data = {
      ...sampleData,
      customText: body.customText ?? "",
    };
    const dataWithPartials = { ...data, _partials: partials };
    subject = renderSubject(
      template.subjectTemplate,
      body.subjectOverride ?? `Update: ${event.name}`,
      dataWithPartials,
    );
    const templateContentType = template.contentType as "markdown" | "html" | "text";
    const content = applyCampaignCustomText(template.content, templateContentType, body.customText ?? null);
    rendered = await renderEmail(content, dataWithPartials, layoutHtml, templateContentType, appBaseUrl);
  }

  const batchCount =
    body.sendMode === "bcc_batch" ? chunkRecipients(uniqueRecipients, body.batchSize).length : uniqueRecipients.length;

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

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}

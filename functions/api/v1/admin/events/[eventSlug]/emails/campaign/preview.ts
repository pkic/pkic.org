import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { renderEmail, renderSubject } from "../../../../../../../_lib/email/render";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { applyCampaignCustomText } from "../../../../../../../_lib/email/campaign-custom";
import type { EmailContentType } from "../../../../../../../../assets/shared/schemas/admin-email-templates";
import { loadEmailRenderResources } from "../../../../../../../_lib/email/partials";
import {
  proposalPageUrl,
  registrationManagePageUrl,
  registrationPageUrl,
} from "../../../../../../../_lib/services/frontend-links";
import {
  chunkRecipients,
  assertCampaignBroadcastSafety,
  prepareAdminCampaign,
  signCampaignPreviewToken,
} from "../../../../../../../_lib/services/admin-email-campaign";
import {
  adminEventCampaignPreviewResponseSchema,
  adminEventCampaignPreviewRouteSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-admin-event-communications";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";

const PREVIEW_TTL_SECONDS = 10 * 60;

export const AdminEventsEventSlugEmailsCampaignPreviewPost = openApiRoute(
  adminEventCampaignPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    const body = data.body;
    const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
    const secret = requireInternalSecret(c.env);
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const campaign = await prepareAdminCampaign(
      requestDb(c),
      event,
      appBaseUrl,
      body,
      getConfig(c.env).adminCampaignMaxRecipients,
    );
    const { template, recipients: uniqueRecipients, digest } = campaign;

    const token = await signCampaignPreviewToken({
      secret,
      eventId: event.id,
      adminId: admin.id,
      digest,
      ttlSeconds: PREVIEW_TTL_SECONDS,
    });

    if (uniqueRecipients.length === 0) {
      return json(
        adminEventCampaignPreviewResponseSchema.parse({
          success: true,
          recipientCount: 0,
          batchCount: 0,
          previewToken: token.token,
          previewExpiresAt: token.expiresAt,
          sampleRecipients: [],
          subject: body.subjectOverride ?? `Update: ${event.name}`,
          html: "<p>No recipients matched your filter.</p>",
          text: "No recipients matched your filter.",
        }),
      );
    }

    if (!body.bodyContent && !body.templateKey) {
      throw new AppError(400, "CAMPAIGN_NO_CONTENT", "Provide a message body or select a template before previewing.");
    }

    assertCampaignBroadcastSafety(body, uniqueRecipients, template);

    let subject: string;
    let rendered: { html: string; text: string };
    const { partials, layoutHtml } = await loadEmailRenderResources(requestDb(c));
    const sample = uniqueRecipients[0];
    const routeVars =
      body.filter.audience === "attendees"
        ? { registrationUrl: registrationPageUrl(appBaseUrl, event, { source: "admin_email" }) }
        : { proposalUrl: proposalPageUrl(appBaseUrl, event, { source: "admin_email" }) };
    const sampleData: Record<string, unknown> = {
      ...buildEventEmailVariables(event, appBaseUrl),
      firstName: sample?.firstName || "Member",
      lastName: sample?.lastName || "",
      recipientCount: uniqueRecipients.length,
      audience: body.filter.audience,
      ...routeVars,
      ...(sample?.templateData ?? {}),
    };
    if (body.filter.audience === "attendees") {
      sampleData.manageUrl = registrationManagePageUrl(appBaseUrl, event, "preview-token");
    }

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
      const templateContentType = template.contentType as EmailContentType;
      const content = applyCampaignCustomText(template.content, templateContentType, body.customText ?? null);
      rendered = await renderEmail(content, dataWithPartials, layoutHtml, templateContentType, appBaseUrl);
    }

    const batchCount =
      body.sendMode === "bcc_batch"
        ? chunkRecipients(uniqueRecipients, body.batchSize).length
        : uniqueRecipients.length;

    return json(
      adminEventCampaignPreviewResponseSchema.parse({
        success: true,
        recipientCount: uniqueRecipients.length,
        batchCount,
        previewToken: token.token,
        previewExpiresAt: token.expiresAt,
        sampleRecipients: uniqueRecipients.slice(0, 10).map((recipient) => recipient.email),
        subject,
        html: rendered.html,
        text: rendered.text,
      }),
    );
  },
);

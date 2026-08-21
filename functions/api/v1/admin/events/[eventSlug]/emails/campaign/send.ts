import { parseJsonBody } from "../../../../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { processPendingOutboxBackground } from "../../../../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import {
  assertCampaignBroadcastSafety,
  prepareAdminCampaign,
  verifyCampaignPreviewToken,
} from "../../../../../../../_lib/services/admin-email-campaign";
import { queueAdminCampaign } from "../../../../../../../_lib/services/admin-email-campaign-queue";
import { adminEventCampaignSendSchema } from "../../../../../../../../assets/shared/schemas/admin-events";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

const CAMPAIGN_IMMEDIATE_OUTBOX_LIMIT = 100;

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEventCampaignSendSchema);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const secret = requireInternalSecret(c.env);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  if (!body.bodyContent && !body.templateKey) {
    throw new AppError(400, "CAMPAIGN_NO_CONTENT", "Provide a message body or select a template before sending.");
  }
  const campaign = await prepareAdminCampaign(
    requestDb(c),
    event,
    appBaseUrl,
    body,
    getConfig(c.env).adminCampaignMaxRecipients,
  );
  const { template, recipients: uniqueRecipients, digest } = campaign;

  const validation = await verifyCampaignPreviewToken({
    secret,
    token: body.previewToken,
    eventId: event.id,
    adminId: admin.id,
    digest,
  });

  if (!validation.ok) {
    if (validation.reason === "expired") {
      throw new AppError(
        409,
        "CAMPAIGN_PREVIEW_EXPIRED",
        "Campaign preview expired. Render a fresh preview before sending.",
      );
    }
    if (validation.reason === "mismatch") {
      throw new AppError(
        409,
        "CAMPAIGN_PREVIEW_STALE",
        "Campaign settings or recipients changed after preview. Render preview again.",
      );
    }
    throw new AppError(400, "CAMPAIGN_PREVIEW_INVALID", "Invalid campaign preview token.");
  }

  if (uniqueRecipients.length === 0) {
    throw new AppError(400, "CAMPAIGN_NO_RECIPIENTS", "No recipients matched the selected filters.");
  }

  assertCampaignBroadcastSafety(body, uniqueRecipients, template);

  const db = requestDb(c);
  const queued = await queueAdminCampaign(db, event, appBaseUrl, body, campaign);
  // Queue construction is now a small number of D1 batches. Start only a bounded
  // processing pass here; the scheduled outbox worker drains the remainder.
  c.executionCtx.waitUntil(
    processPendingOutboxBackground(
      db,
      c.env,
      Math.min(getConfig(c.env).scheduledOutboxLimit, CAMPAIGN_IMMEDIATE_OUTBOX_LIMIT),
    ),
  );

  return json({
    success: true,
    queuedRecipients: queued.queuedRecipients,
    queuedBatches: queued.queuedBatches,
    mode: body.sendMode,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}

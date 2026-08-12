import { parseJsonBody } from "../../../../../../../_lib/validation";
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import {
  prepareBulkQueueEmailStatements,
  processPendingOutboxBackground,
} from "../../../../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { resolveTemplate } from "../../../../../../../_lib/email/templates";
import {
  proposalPageUrl,
  registrationManagePageUrl,
  registrationPageUrl,
} from "../../../../../../../_lib/services/frontend-links";
import { queuedCapabilityToken } from "../../../../../../../_lib/services/capability-links";
import {
  chunkRecipients,
  computeCampaignDigest,
  findBroadcastOnlyTemplateRefs,
  listCampaignRecipients,
  verifyCampaignPreviewToken,
} from "../../../../../../../_lib/services/admin-email-campaign";
import { adminEventCampaignSendSchema } from "../../../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import type { StatementLike } from "../../../../../../../_lib/types";

const CAMPAIGN_QUEUE_BATCH_SIZE = 250;
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
  const templateKey = body.bodyContent ? body.templateKey || "__direct__" : (body.templateKey as string);
  const template = !body.bodyContent && templateKey ? await resolveTemplate(requestDb(c), templateKey) : null;
  const messageType = body.messageType ?? template?.messageType ?? "promotional";

  const recipients = await listCampaignRecipients(requestDb(c), event, appBaseUrl, {
    audience: body.filter.audience,
    attendeeStatus: body.filter.attendeeStatus,
    attendanceType: body.filter.attendanceType,
    dayDate: body.filter.dayDate,
    dayWaitlistStatus: body.filter.dayWaitlistStatus,
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
      dayWaitlistStatus: body.filter.dayWaitlistStatus,
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
  const db = requestDb(c);
  const routeVars =
    body.filter.audience === "attendees"
      ? { registrationUrl: registrationPageUrl(appBaseUrl, event, { source: "admin_email" }) }
      : { proposalUrl: proposalPageUrl(appBaseUrl, event, { source: "admin_email" }) };
  const sharedEventVars = buildEventEmailVariables(event, appBaseUrl);

  const queueRows: Array<{
    eventId: string;
    templateKey: string;
    recipientEmail: string;
    recipientUserId?: string | null;
    messageType: "transactional" | "promotional";
    subject: string;
    capabilityLinkValues?: unknown[];
    data: Record<string, unknown>;
  }> = [];
  const usesManageUrl =
    body.filter.audience === "attendees" &&
    findBroadcastOnlyTemplateRefs(uniqueRecipients, [
      body.subjectOverride,
      body.bodyContent,
      body.customText,
      template?.subjectTemplate,
      template?.content,
    ]).includes("manageUrl");

  if (body.sendMode === "personal") {
    const personalRows = uniqueRecipients.map((recipient) => {
      let recipientManageUrl: string | undefined;
      if (usesManageUrl && recipient.registrationId) {
        recipientManageUrl = registrationManagePageUrl(
          appBaseUrl,
          event,
          queuedCapabilityToken("registration_manage", recipient.registrationId),
        );
      }

      return {
        queueRow: {
          eventId: event.id,
          templateKey,
          recipientEmail: recipient.email,
          recipientUserId: recipient.userId ?? null,
          messageType,
          subject: body.subjectOverride ?? `Update: ${event.name}`,
          capabilityLinkValues: recipientManageUrl ? [recipientManageUrl] : [],
          data: {
            ...sharedEventVars,
            firstName: recipient.firstName,
            lastName: recipient.lastName,
            ...routeVars,
            ...recipient.templateData,
            ...(recipientManageUrl ? { manageUrl: recipientManageUrl } : {}),
            __adminCampaignCustomText: body.customText ?? null,
            __adminCampaignBodyContent: body.bodyContent ?? null,
            __campaignAudience: body.filter.audience,
          },
        },
      };
    });
    for (const row of personalRows) {
      queueRows.push(row.queueRow);
    }
    batches = uniqueRecipients.length;
  } else {
    const chunks = chunkRecipients(uniqueRecipients, body.batchSize);
    for (const chunk of chunks) {
      const to = chunk[0];
      if (!to) continue;
      const bcc = chunk.slice(1).map((recipient) => recipient.email);
      queueRows.push({
        eventId: event.id,
        templateKey,
        recipientEmail: to.email,
        messageType,
        subject: body.subjectOverride ?? `Update: ${event.name}`,
        data: {
          ...sharedEventVars,
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
    }
  }

  const preparedRows = prepareBulkQueueEmailStatements(db, queueRows);
  for (let offset = 0; offset < preparedRows.length; offset += CAMPAIGN_QUEUE_BATCH_SIZE) {
    const preparedSlice = preparedRows.slice(offset, offset + CAMPAIGN_QUEUE_BATCH_SIZE);
    const statements: StatementLike[] = [];
    for (let index = 0; index < preparedSlice.length; index += 1) {
      statements.push(preparedSlice[index].statement);
    }
    await db.batch(statements);
  }

  queued += body.sendMode === "personal" ? queueRows.length : 0;
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
    queuedRecipients: queued,
    queuedBatches: batches,
    mode: body.sendMode,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}

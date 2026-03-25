import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { processPendingOutbox, summarizePendingOutbox } from "../../../../_lib/email/outbox";
import { runReminderCycle } from "../../../../_lib/services/reminders";
import { runRetentionJob, summarizeRetentionJob } from "../../../../_lib/services/retention";
import type { PagesContext } from "../../../../_lib/types";
import { adminRunJobsSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminRunJobsSchema);
  const config = getConfig(context.env, context.request);
  const emptyReminderPreview = {
    attendeeInvites: [],
    speakerInvites: [],
    coSpeakerInvites: [],
    presentationUploads: [],
  };

  const reminders = body.runReminders
    ? await runReminderCycle(context.env.DB, {
      appBaseUrl: resolveAppBaseUrl(context.env),
      reminderIntervalDays: config.reminderIntervalDays,
      maxInviteReminders: config.maxInviteReminders,
      maxPresentationReminders: config.maxPresentationReminders,
      limit: body.reminderLimit,
      dryRun: body.dryRun,
    })
    : { inviteRemindersQueued: 0, speakerInviteRemindersQueued: 0, presentationRemindersQueued: 0, processed: 0, preview: emptyReminderPreview };

  const currentHourUtc = new Date().getUTCHours();
  const shouldRunRetention = body.runRetention
    && (body.runRetentionMode === "always" || currentHourUtc === body.retentionHourUtc);

  const retentionPreview = shouldRunRetention
    ? await summarizeRetentionJob(context.env.DB)
    : { dueEvents: [], totalEvents: 0, totalRegistrations: 0, totalUsers: 0 };

  const retention = shouldRunRetention && !body.dryRun
    ? await runRetentionJob(context.env.DB)
    : { redactedRegistrations: 0, redactedUsers: 0, affectedEvents: 0 };

  const outboxPreview = body.runOutbox
    ? await summarizePendingOutbox(context.env.DB)
    : { dueNow: 0, dueByStatus: {}, nextSendAfter: null };

  const outboxResult = body.runOutbox && !body.dryRun
    ? await processPendingOutbox(context.env.DB, context.env, body.outboxLimit)
    : { processed: 0, failed: 0 };

  return json({
    success: true,
    dryRun: body.dryRun,
    reminders,
    shouldRunRetention,
    retention: {
      ...retention,
      preview: retentionPreview,
    },
    outbox: {
      ...outboxResult,
      dueNow: outboxPreview.dueNow,
      dueByStatus: outboxPreview.dueByStatus,
      nextSendAfter: outboxPreview.nextSendAfter,
    },
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}

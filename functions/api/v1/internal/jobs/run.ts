import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { processPendingOutbox, summarizePendingOutbox } from "../../../../_lib/email/outbox";
import { runReminderCycle } from "../../../../_lib/services/reminders";
import { runRetentionJob, summarizeRetentionJob } from "../../../../_lib/services/retention";
import { adminRunJobsSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminRunJobsSchema);
  const config = getConfig(c.env, c.req.raw);
  const emptyReminderPreview = {
    attendeeInvites: [],
    speakerInvites: [],
    coSpeakerInvites: [],
    presentationUploads: [],
    registrationConfirmations: [],
  };

  const reminders = body.runReminders
    ? await runReminderCycle(c.env.DB, {
        appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
        reminderIntervalDays: config.reminderIntervalDays,
        pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
        maxInviteReminders: config.maxInviteReminders,
        maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
        maxPresentationReminders: config.maxPresentationReminders,
        limit: body.reminderLimit,
        dryRun: body.dryRun,
      })
    : {
        inviteRemindersQueued: 0,
        speakerInviteRemindersQueued: 0,
        presentationRemindersQueued: 0,
        confirmationRemindersQueued: 0,
        confirmationCancellationsProcessed: 0,
        processed: 0,
        preview: emptyReminderPreview,
      };

  const currentHourUtc = new Date().getUTCHours();
  const shouldRunRetention =
    body.runRetention && (body.runRetentionMode === "always" || currentHourUtc === body.retentionHourUtc);

  const retentionPreview = shouldRunRetention
    ? await summarizeRetentionJob(c.env.DB)
    : { dueEvents: [], totalEvents: 0, totalRegistrations: 0, totalUsers: 0 };

  const retention =
    shouldRunRetention && !body.dryRun
      ? await runRetentionJob(c.env.DB)
      : { redactedRegistrations: 0, redactedUsers: 0, affectedEvents: 0 };

  const outboxPreview = body.runOutbox
    ? await summarizePendingOutbox(c.env.DB)
    : { dueNow: 0, dueByStatus: {}, nextSendAfter: null };

  const outboxResult =
    body.runOutbox && !body.dryRun
      ? await processPendingOutbox(c.env.DB, c.env, body.outboxLimit)
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

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}

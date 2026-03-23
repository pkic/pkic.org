import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { processPendingOutbox } from "../../../../_lib/email/outbox";
import { runReminderCycle } from "../../../../_lib/services/reminders";
import { runRetentionJob } from "../../../../_lib/services/retention";
import type { PagesContext } from "../../../../_lib/types";
import { adminRunJobsSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminRunJobsSchema);
  const config = getConfig(context.env, context.request);

  const reminders = body.runReminders
    ? await runReminderCycle(context.env.DB, {
      appBaseUrl: resolveAppBaseUrl(context.env),
      reminderIntervalDays: config.reminderIntervalDays,
      maxInviteReminders: config.maxInviteReminders,
      maxPresentationReminders: config.maxPresentationReminders,
      limit: body.reminderLimit,
      dryRun: body.dryRun,
    })
    : { inviteRemindersQueued: 0, speakerInviteRemindersQueued: 0, presentationRemindersQueued: 0, processed: 0 };

  const currentHourUtc = new Date().getUTCHours();
  const shouldRunRetention = body.runRetention
    && (body.runRetentionMode === "always" || currentHourUtc === body.retentionHourUtc);

  const retention = shouldRunRetention && !body.dryRun
    ? await runRetentionJob(context.env.DB)
    : { anonymizedUsers: 0, deletedRegistrations: 0, deletedInvites: 0, deletedClicks: 0, deletedAuditLogs: 0 };

  const outbox = body.runOutbox && !body.dryRun
    ? await processPendingOutbox(context.env.DB, context.env, body.outboxLimit)
    : { processed: 0, failed: 0 };

  return json({
    success: true,
    dryRun: body.dryRun,
    reminders,
    shouldRunRetention,
    retention,
    outbox,
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}

import { parseJsonBody } from "../../../../_lib/validation";
import { dispatchPostOnly, json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { processPendingOutbox } from "../../../../_lib/email/outbox";
import { runReminderCycle } from "../../../../_lib/services/reminders";
import { adminRunRemindersSchema } from "../../../../../assets/shared/schemas/admin-jobs";

export async function onRequestPost(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminRunRemindersSchema);
  const config = getConfig(c.env, c.req.raw);

  const cycle = await runReminderCycle(c.env.DB, {
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    reminderIntervalDays: config.reminderIntervalDays,
    pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
    confirmationLinkTtlHours: config.confirmationLinkTtlHours,
    maxInviteReminders: config.maxInviteReminders,
    maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
    maxPresentationReminders: config.maxPresentationReminders,
    presentationReminderLeadDays: config.presentationReminderLeadDays,
    limit: body.limit,
    dryRun: body.dryRun,
  });

  const outbox = body.dryRun
    ? { processed: 0, failed: 0 }
    : await processPendingOutbox(c.env.DB, c.env, Math.min(body.limit, 200));

  return json({ success: true, ...cycle, outbox, dryRun: body.dryRun });
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}

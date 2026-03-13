import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { processPendingOutbox } from "../../../../_lib/email/outbox";
import { runReminderCycle } from "../../../../_lib/services/reminders";
import type { PagesContext } from "../../../../_lib/types";
import { adminRunRemindersSchema } from "../../../../../shared/schemas/api";

export async function onRequestPost(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminRunRemindersSchema);
  const config = getConfig(context.env, context.request);

  const cycle = await runReminderCycle(context.env.DB, {
    appBaseUrl: resolveAppBaseUrl(context.env),
    reminderIntervalDays: config.reminderIntervalDays,
    maxInviteReminders: config.maxInviteReminders,
    maxPresentationReminders: config.maxPresentationReminders,
    limit: body.limit,
    dryRun: body.dryRun,
  });

  const outbox = body.dryRun
    ? { processed: 0, failed: 0 }
    : await processPendingOutbox(context.env.DB, context.env, Math.min(body.limit, 200));

  return json({ success: true, ...cycle, outbox, dryRun: body.dryRun });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}

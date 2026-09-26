import type {
  EmailReminderRunResponse,
  reminderRunModeSchema,
} from "../../../../assets/shared/schemas/email-reminders";
import type { z } from "zod";
import { guardPermissionMutationDatabase } from "../../auth/permissions";
import { getConfig, resolveAppBaseUrl } from "../../config";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";
import { writeAuditLog } from "../audit";
import { runReminderCycle } from "../reminders";

type ReminderRunMode = z.infer<typeof reminderRunModeSchema>;

function reminderOptions(env: Env, request: Request, limit: number, dryRun: boolean) {
  const config = getConfig(env, request);
  return {
    appBaseUrl: resolveAppBaseUrl(env, request),
    reminderIntervalDays: config.reminderIntervalDays,
    pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
    confirmationLinkTtlHours: config.confirmationLinkTtlHours,
    maxInviteReminders: config.maxInviteReminders,
    maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
    maxPresentationReminders: config.maxPresentationReminders,
    presentationReminderLeadDays: config.presentationReminderLeadDays,
    limit,
    dryRun,
  };
}

/**
 * Resolves due reminders and queues them into the durable outbox. A preview
 * resolves the same batch without queueing, so it needs no write authorization
 * guard; an execute run re-evaluates `email:manage` inside every write batch.
 */
export async function createReminderRun(
  db: DatabaseLike,
  env: Env,
  request: Request,
  actor: UserBackedAuthAdmin,
  mode: ReminderRunMode,
  limit: number,
): Promise<EmailReminderRunResponse> {
  if (mode === "preview") {
    const result = await runReminderCycle(db, reminderOptions({ ...env, DB: db }, request, limit, true));
    return { success: true, mode, ...result };
  }
  const authorizedDb = guardPermissionMutationDatabase(
    db,
    actor,
    [{ permission: "email:manage" }],
    () => new AppError(409, "EMAIL_AUTHORIZATION_CHANGED", "Email permission changed while the run was in progress"),
  );
  await writeAuditLog(authorizedDb, "admin", actor.id, "email_reminder_run_requested", "reminder_cycle", null, {
    limit,
  });
  const result = await runReminderCycle(
    authorizedDb,
    reminderOptions({ ...env, DB: authorizedDb }, request, limit, false),
  );
  const { preview: _preview, ...summary } = result;
  await writeAuditLog(authorizedDb, "admin", actor.id, "email_reminder_run_completed", "reminder_cycle", null, {
    limit,
    ...summary,
  });
  return { success: true, mode, ...result };
}

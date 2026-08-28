import type { Permission } from "../../../../assets/shared/schemas/permissions";
import type {
  OperationsMembershipBatchKind,
  OperationsMembershipBatchResponse,
  OperationsRemindersRunResponse,
  OperationsRetentionRunResponse,
} from "../../../../assets/shared/schemas/operations";
import { getConfig, resolveAppBaseUrl } from "../../config";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";
import { writeAuditLog } from "../audit";
import { runConsultationBatch, runEcReviewBatch } from "../membership/scheduled-jobs";
import { runReminderCycle } from "../reminders";
import { runRetentionJob } from "../retention";
import { runWeeklyWgChairDigest } from "../wg-chair-digest";
import { authorizedOperationsMutationDb } from "./authorization";

function commandEnv(env: Env, db: DatabaseLike): Env {
  return { ...env, DB: db };
}

async function auditOperation(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  action: string,
  entityType: string,
  details: unknown,
): Promise<void> {
  await writeAuditLog(db, "admin", actor.id, action, entityType, null, details);
}

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

/** Queues a bounded reminder pass; outbox delivery remains a separate email operation or cron responsibility. */
export async function runReminderCommand(
  db: DatabaseLike,
  env: Env,
  request: Request,
  actor: UserBackedAuthAdmin,
  limit: number,
): Promise<OperationsRemindersRunResponse> {
  const authorizedDb = authorizedOperationsMutationDb(db, actor, ["operations:read", "operations:run"]);
  await auditOperation(authorizedDb, actor, "operations_reminders_requested", "reminder_cycle", { limit });
  const result = await runReminderCycle(
    authorizedDb,
    reminderOptions(commandEnv(env, authorizedDb), request, limit, false),
  );
  const { preview: _preview, ...summary } = result;
  await auditOperation(authorizedDb, actor, "operations_reminders_completed", "reminder_cycle", {
    limit,
    ...summary,
  });
  return { success: true, dryRun: false, ...result };
}

export async function runRetentionCommand(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
): Promise<OperationsRetentionRunResponse> {
  const authorizedDb = authorizedOperationsMutationDb(db, actor, [
    "operations:read",
    "operations:run",
    "users:anonymize",
  ]);
  await auditOperation(authorizedDb, actor, "operations_retention_requested", "retention_job", {});
  const result = await runRetentionJob(authorizedDb);
  await auditOperation(authorizedDb, actor, "operations_retention_completed", "retention_job", result);
  return { success: true, ...result };
}

function membershipBatchPermissions(kind: OperationsMembershipBatchKind): Permission[] {
  const permissions: Permission[] = ["operations:read", "operations:run"];
  if (kind === "consultation") permissions.push("membership:write");
  if (kind === "ec-review") permissions.push("membership:approve");
  return permissions;
}

export async function runMembershipBatchCommand(
  db: DatabaseLike,
  env: Env,
  actor: UserBackedAuthAdmin,
  kind: OperationsMembershipBatchKind,
): Promise<OperationsMembershipBatchResponse> {
  const authorizedDb = authorizedOperationsMutationDb(db, actor, membershipBatchPermissions(kind));
  const authorizedEnv = commandEnv(env, authorizedDb);
  await auditOperation(authorizedDb, actor, "operations_membership_batch_requested", "membership_batch", { kind });

  const result =
    kind === "consultation"
      ? await runConsultationBatch(authorizedDb, authorizedEnv, undefined, actor)
      : kind === "ec-review"
        ? await runEcReviewBatch(authorizedDb, authorizedEnv, undefined, actor)
        : await runWeeklyWgChairDigest(authorizedDb, authorizedEnv);

  await auditOperation(authorizedDb, actor, "operations_membership_batch_completed", "membership_batch", {
    kind,
    ...result,
  });
  return { success: true, ...result };
}

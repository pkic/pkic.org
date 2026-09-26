import type { ScheduledJobScheduleUpdate } from "../../../../assets/shared/schemas/scheduler";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { getScheduledJobForActor } from "./management";

export async function updateScheduledJobSchedule(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  jobKey: string,
  input: ScheduledJobScheduleUpdate,
) {
  await getScheduledJobForActor(db, actor, jobKey);
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "scheduler:read" },
        { permission: "scheduler:manage" },
      ]),
      db
        .prepare(
          `UPDATE scheduled_jobs SET interval_seconds = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE job_key = ? AND interval_seconds = ? AND running_since IS NULL`,
        )
        .bind(input.intervalSeconds, jobKey, input.expectedIntervalSeconds),
      prepareAuditLogAfterOneChange(db, "admin", actor.id, "scheduled_job_schedule_updated", "scheduled_job", jobKey, {
        from: input.expectedIntervalSeconds,
        to: input.intervalSeconds,
      }),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error))
      throw new AppError(
        409,
        "SCHEDULED_JOB_CHANGED",
        "The interval, running state, or your permission changed. Reload and retry.",
      );
    throw error;
  }
  return getScheduledJobForActor(db, actor, jobKey);
}

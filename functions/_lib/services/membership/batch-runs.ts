import type { Permission } from "../../../../assets/shared/schemas/permissions";
import type {
  MembershipBatchKey,
  MembershipBatchRunResponse,
} from "../../../../assets/shared/schemas/membership-batches";
import { guardPermissionMutationDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";
import { writeAuditLog } from "../audit";
import { runConsultationBatch, runEcReviewBatch } from "./scheduled-jobs";
import { runWeeklyWgChairDigest } from "../wg-chair-digest";

/** The exact grants each batch requires, re-evaluated inside its own write batch. */
export function membershipBatchPermissions(batchKey: MembershipBatchKey): Permission[] {
  if (batchKey === "consultation") return ["membership:write"];
  if (batchKey === "ec-review") return ["membership:approve"];
  return ["membership:write"];
}

export async function createMembershipBatchRun(
  db: DatabaseLike,
  env: Env,
  actor: UserBackedAuthAdmin,
  batchKey: MembershipBatchKey,
): Promise<MembershipBatchRunResponse> {
  const authorizedDb = guardPermissionMutationDatabase(
    db,
    actor,
    membershipBatchPermissions(batchKey).map((permission) => ({ permission })),
    () =>
      new AppError(
        409,
        "MEMBERSHIP_BATCH_AUTHORIZATION_CHANGED",
        "Membership permission changed while the run was in progress",
      ),
  );
  const authorizedEnv: Env = { ...env, DB: authorizedDb };
  await writeAuditLog(authorizedDb, "admin", actor.id, "membership_batch_requested", "membership_batch", null, {
    batchKey,
  });

  const result =
    batchKey === "consultation"
      ? await runConsultationBatch(authorizedDb, authorizedEnv, undefined, actor)
      : batchKey === "ec-review"
        ? await runEcReviewBatch(authorizedDb, authorizedEnv, undefined, actor)
        : await runWeeklyWgChairDigest(authorizedDb, authorizedEnv);

  await writeAuditLog(authorizedDb, "admin", actor.id, "membership_batch_completed", "membership_batch", null, {
    batchKey,
    ...result,
  });
  return { success: true, batchKey, ...result };
}

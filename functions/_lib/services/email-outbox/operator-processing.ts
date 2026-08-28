import type {
  EmailOutboxProcessResponse,
  EmailOutboxResetFailedResponse,
} from "../../../../assets/shared/schemas/email-outbox";
import { processPendingOutbox, processSelectedOutbox, resetFailedOutbox } from "../../email/outbox";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";
import { writeAuditLog } from "../audit";
import { authorizedEmailOutboxMutationDb } from "./authorization";

function commandEnv(env: Env, db: DatabaseLike): Env {
  return { ...env, DB: db };
}

async function auditEmailCommand(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  action: string,
  details: unknown,
): Promise<void> {
  await writeAuditLog(db, "admin", actor.id, action, "email_outbox", null, details);
}

/** Executes one bounded, attributable outbox-processing command. */
export async function processEmailOutboxCommand(
  db: DatabaseLike,
  env: Env,
  actor: UserBackedAuthAdmin,
  input: { limit: number; ids?: string[] },
): Promise<EmailOutboxProcessResponse> {
  const authorizedDb = authorizedEmailOutboxMutationDb(db, actor);
  const requested = input.ids?.length ? { ids: input.ids } : { limit: input.limit };
  await auditEmailCommand(authorizedDb, actor, "email_outbox_process_requested", requested);

  const result = input.ids?.length
    ? await processSelectedOutbox(authorizedDb, commandEnv(env, authorizedDb), input.ids)
    : await processPendingOutbox(authorizedDb, commandEnv(env, authorizedDb), input.limit);

  await auditEmailCommand(authorizedDb, actor, "email_outbox_process_completed", { ...requested, ...result });
  return { success: true, ...result };
}

/** Resets and processes only rows in the caller's explicit bounded selection. */
export async function resetFailedEmailOutboxCommand(
  db: DatabaseLike,
  env: Env,
  actor: UserBackedAuthAdmin,
  ids: string[],
): Promise<EmailOutboxResetFailedResponse> {
  const authorizedDb = authorizedEmailOutboxMutationDb(db, actor);
  await auditEmailCommand(authorizedDb, actor, "email_outbox_reset_requested", { ids });

  const reset = await resetFailedOutbox(authorizedDb, ids);
  const processed = await processSelectedOutbox(authorizedDb, commandEnv(env, authorizedDb), reset.ids);
  const result = { success: true as const, reset: reset.reset, ...processed };

  await auditEmailCommand(authorizedDb, actor, "email_outbox_reset_completed", { ids, resetIds: reset.ids, ...result });
  return result;
}

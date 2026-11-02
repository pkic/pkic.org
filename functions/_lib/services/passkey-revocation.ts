import { AppError } from "../errors";
import { first } from "../db/queries";
import { nowIso } from "../utils/time";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import {
  lastSignInMethodError,
  refuseRemovingLastSignInMethod,
  signInMethodRemainsEvidence,
} from "../auth/sign-in-methods";
import { prepareAuditLog, prepareAuditLogWhen } from "./audit";
import { LAST_PASSKEY_MESSAGE } from "../../../assets/shared/auth-errors";
import type { DatabaseLike, StatementLike } from "../types";

/**
 * Revokes one of the owner's passkeys. A passkey that is the account's last
 * way to sign in is refused unless the owner confirms: a compromised passkey
 * must be revocable even then. That confirmed removal signs out every other
 * session, which a stolen passkey may have opened, and keeps the caller's so
 * its owner can add a new passkey. Whether it was the last way is decided
 * inside the batch, so a concurrent change cannot misrecord it.
 */
export async function revokePasskey(
  db: DatabaseLike,
  actor: { id: string; kind: "user"; sessionId: string },
  passkeyId: string,
  options: { confirmLastMethod?: boolean } = {},
): Promise<void> {
  const row = await first<{ id: string; user_id: string }>(
    db,
    "SELECT id, user_id FROM passkey_credentials WHERE id = ? AND revoked_at IS NULL",
    [passkeyId],
  );

  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Passkey not found");
  }

  if (row.user_id !== actor.id) {
    throw new AppError(403, "PERMISSION_REQUIRED", "Cannot remove another user's passkey");
  }

  const at = nowIso();
  const revoke = db
    .prepare("UPDATE passkey_credentials SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(at, passkeyId, actor.id);

  if (options.confirmLastMethod) {
    await db.batch([revoke, ...prepareConfirmedRevokeEffects(db, actor, passkeyId, at)]);
    return;
  }

  const remains = await refuseRemovingLastSignInMethod(
    db,
    actor.id,
    { revokedPasskeyId: passkeyId },
    LAST_PASSKEY_MESSAGE,
  );
  try {
    await db.batch([
      prepareAuthorizationGuard(db, remains),
      revoke,
      prepareAuditLog(db, actor.kind, actor.id, "passkey_removed", "passkey_credential", passkeyId, {}, at),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) throw lastSignInMethodError(LAST_PASSKEY_MESSAGE);
    throw error;
  }
}

/**
 * Runs after the revoke in the same batch. Each effect holds only when this
 * revoke won (the row carries its instant); the last-way effects hold only
 * when no other way to sign in remains.
 */
function prepareConfirmedRevokeEffects(
  db: DatabaseLike,
  actor: { id: string; kind: "user"; sessionId: string },
  passkeyId: string,
  at: string,
): StatementLike[] {
  const remains = signInMethodRemainsEvidence(actor.id, { revokedPasskeyId: passkeyId });
  const won = "EXISTS (SELECT 1 FROM passkey_credentials won WHERE won.id = ? AND won.revoked_at = ?)";
  const audit = (lastSignInMethod: boolean) =>
    prepareAuditLogWhen(db, {
      actorType: actor.kind,
      actorId: actor.id,
      action: "passkey_removed",
      entityType: "passkey_credential",
      entityId: passkeyId,
      details: lastSignInMethod ? { lastSignInMethod: true, otherSessionsSignedOut: true } : {},
      conditionSql: `SELECT 1 WHERE ${won} AND ${lastSignInMethod ? "NOT " : ""}EXISTS (${remains.sql})`,
      conditionBindings: [passkeyId, at, ...remains.bindings],
      createdAt: at,
    });
  return [
    db
      .prepare(
        `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL
          AND ${won} AND NOT EXISTS (${remains.sql})`,
      )
      .bind(at, actor.id, actor.sessionId, passkeyId, at, ...remains.bindings),
    audit(false),
    audit(true),
  ];
}

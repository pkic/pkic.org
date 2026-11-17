/**
 * An account keeps at least one way to sign in. The owner may remove a
 * passkey, remove an address, or end their own representation, but not when
 * nothing would remain: ending a representation retires the addresses its
 * domain supported, the primary one included. The one exception is a passkey
 * its owner confirms revoking anyway, since a compromised passkey must not
 * stay live. An end made by someone else is not refused here.
 */
import { LAST_SIGN_IN_METHOD, LAST_SIGN_IN_METHOD_MESSAGE } from "../../../assets/shared/auth-errors";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { addedEmailSignInAllowedSql, primaryEmailSignInAllowedSql } from "./email-sign-in-policy";

/** The one change the owner is about to make. */
export interface SignInMethodChange {
  revokedPasskeyId?: string;
  /** An address leaving the account: it no longer signs in, nor counts as a verified mailbox. */
  removedEmailId?: string;
  /** An organization identity the owner is ending: the addresses it supported stop signing in. */
  endedIdentityId?: string;
}

/**
 * Holds while the account would still have a way to sign in after `change`:
 * another live passkey, or an address that would still sign in. Evaluated
 * before the change, so it reads the same in a guard at the head of the
 * change's batch as in a plain read.
 */
export function signInMethodRemainsEvidence(userId: string, change: SignInMethodChange): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM (SELECT ? AS passkey_id, ? AS email_id, ? AS identity_id) pending
      JOIN users person ON person.id = ? WHERE (
      EXISTS (SELECT 1 FROM passkey_credentials passkey
        WHERE passkey.user_id = person.id AND passkey.revoked_at IS NULL AND passkey.id IS NOT pending.passkey_id)
      OR ${primaryEmailSignInAllowedSql("person", { ignoredEmailId: "pending.email_id", ending: "pending.identity_id" })}
      OR EXISTS (SELECT 1 FROM user_emails sign_in_address
        WHERE sign_in_address.user_id = person.id AND sign_in_address.id IS NOT pending.email_id
          AND ${addedEmailSignInAllowedSql("sign_in_address", "pending.identity_id")}))`,
    bindings: [change.revokedPasskeyId ?? null, change.removedEmailId ?? null, change.endedIdentityId ?? null, userId],
  };
}

/** `message` names what the owner can do instead, which differs for a passkey they may still revoke. */
export function lastSignInMethodError(message = LAST_SIGN_IN_METHOD_MESSAGE): AppError {
  return new AppError(409, LAST_SIGN_IN_METHOD, message);
}

/**
 * Refuses the change up front with the reason. The caller also guards its
 * batch with the same evidence, which settles a concurrent change.
 */
export async function refuseRemovingLastSignInMethod(
  db: DatabaseLike,
  userId: string,
  change: SignInMethodChange,
  message?: string,
): Promise<AuthorizationEvidence> {
  const evidence = signInMethodRemainsEvidence(userId, change);
  if (!(await first(db, evidence.sql, [...evidence.bindings]))) throw lastSignInMethodError(message);
  return evidence;
}

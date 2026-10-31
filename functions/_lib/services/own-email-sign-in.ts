import { secondaryEmailSignInAllowedSql, ownedEmailRepresentationActiveSql } from "../auth/email-sign-in-policy";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { prepareAuditLogAfterOneChange } from "./audit";
import { readOwnEmailAddress } from "./own-email-address-read";
import { refuseRemovingLastSignInMethod } from "../auth/sign-in-methods";

/** Only the account owner can separately authorize a proved mailbox to unlock the whole account. */
export async function setOwnEmailSignInPermission(
  db: DatabaseLike,
  input: { userId: string; emailId: string; enabled: boolean },
) {
  const address = await first<{
    normalized_email: string;
    verified_at: string | null;
    identity_id: string | null;
    permission_revision: string | null;
    allowed: number;
    representation_active: number;
  }>(
    db,
    `SELECT address.normalized_email, address.verified_at, address.identity_id,
    permission.revision AS permission_revision, (${secondaryEmailSignInAllowedSql("address")}) AS allowed,
    ${ownedEmailRepresentationActiveSql("address")} AS representation_active
    FROM user_emails address JOIN users person ON person.id = address.user_id
    LEFT JOIN user_email_sign_in_permissions permission ON permission.email_id = address.id
    WHERE address.id = ? AND person.id = ? AND person.active = 1
      AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
    [input.emailId, input.userId],
  );
  if (!address) throw new AppError(404, "EMAIL_NOT_FOUND", "Email address not found");
  if (input.enabled && !address.verified_at) {
    throw new AppError(409, "EMAIL_SIGN_IN_INELIGIBLE", "Verify this address before enabling sign-in");
  }
  if (input.enabled && !address.representation_active) {
    throw new AppError(
      409,
      "EMAIL_SIGN_IN_INELIGIBLE",
      "Sign-in requires an active organization identity for this address",
    );
  }
  if (Boolean(address.allowed) === input.enabled) return readOwnEmailAddress(db, input.userId, input.emailId);
  const at = nowIso();
  const revision = uuid();
  const remains = input.enabled
    ? null
    : await refuseRemovingLastSignInMethod(db, input.userId, { withdrawnEmailId: input.emailId });
  try {
    await db.batch([
      ...(remains ? [prepareAuthorizationGuard(db, remains)] : []),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM user_emails address JOIN users person ON person.id = address.user_id
          LEFT JOIN user_email_sign_in_permissions permission ON permission.email_id = address.id
          WHERE address.id = ? AND person.id = ? AND person.active = 1
            AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
            AND address.normalized_email = ? AND address.verified_at IS ? AND address.identity_id IS ?
            AND permission.revision IS ?
            ${input.enabled ? `AND ${ownedEmailRepresentationActiveSql("address")}` : ""}`,
        bindings: [
          input.emailId,
          input.userId,
          address.normalized_email,
          address.verified_at,
          address.identity_id,
          address.permission_revision,
        ],
      }),
      db
        .prepare(`INSERT INTO user_email_sign_in_permissions (email_id, revision, enabled_at, revoked_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(email_id) DO UPDATE SET revision = excluded.revision,
          enabled_at = CASE WHEN excluded.revoked_at IS NULL THEN excluded.enabled_at
            ELSE user_email_sign_in_permissions.enabled_at END, revoked_at = excluded.revoked_at`)
        .bind(input.emailId, revision, at, input.enabled ? null : at),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        input.userId,
        "user_email_sign_in_changed",
        "user",
        input.userId,
        { emailId: input.emailId, enabled: input.enabled },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "EMAIL_SIGN_IN_CHANGED", "This address changed; reload before changing sign-in again");
    }
    throw error;
  }
  return readOwnEmailAddress(db, input.userId, input.emailId);
}

import type { AuthorizationEvidence } from "../db/authorization-guard";

/**
 * An unproved primary claim cannot unlock an account established through another verified mailbox.
 * `ignoredEmailId` is a SQL expression for an address to leave out, one about to be removed.
 */
export function primaryEmailProofMayAuthenticateSql(person: string, ignoredEmailId?: string): string {
  return `(${person}.email_verified_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM user_emails verified
    WHERE verified.user_id=${person}.id AND verified.verified_at IS NOT NULL${
      ignoredEmailId ? ` AND verified.id IS NOT ${ignoredEmailId}` : ""
    }))`;
}

/** Ownership of an address can outlive the representation that previously used it. */
export function ownedEmailRepresentationActiveSql(address: string): string {
  return `(${address}.identity_id IS NULL OR EXISTS (
    SELECT 1 FROM identities owner_identity
     WHERE owner_identity.id = ${address}.identity_id AND owner_identity.user_id = ${address}.user_id
       AND owner_identity.started_at IS NOT NULL AND owner_identity.ended_at IS NULL
       AND owner_identity.blocked_at IS NULL))`;
}

/** Mailbox proof and representation authority do not imply consent to account sign-in. */
export function secondaryEmailSignInAllowedSql(address: string): string {
  return `${address}.verified_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM user_email_sign_in_permissions permission
      WHERE permission.email_id = ${address}.id AND permission.revoked_at IS NULL)
    AND ${ownedEmailRepresentationActiveSql(address)}`;
}

/** Pin the selected mailbox and its permission generation inside the session's atomic command. */
export function signInEmailAuthorizationEvidence(input: {
  userId: string;
  normalizedEmail: string;
  emailId: string | null;
  permissionRevision: string | null;
}): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM users person WHERE person.id = ? AND person.active = 1
      AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
      AND ${
        input.emailId === null
          ? `person.normalized_email = ? AND ${primaryEmailProofMayAuthenticateSql("person")}`
          : `EXISTS (
        SELECT 1 FROM user_emails address JOIN user_email_sign_in_permissions permission ON permission.email_id = address.id
         WHERE address.user_id = person.id AND address.id = ? AND address.normalized_email = ?
           AND permission.revision = ? AND ${secondaryEmailSignInAllowedSql("address")})`
      }`,
    bindings:
      input.emailId === null
        ? [input.userId, input.normalizedEmail]
        : [input.userId, input.emailId, input.normalizedEmail, input.permissionRevision],
  };
}

/** A missing address after removal must invalidate its bound session, never turn it into primary access. */
export function sessionEmailSignInAllowedSql(sessionId: string, userId: string): string {
  return `NOT EXISTS (SELECT 1 FROM session_email_authentication authentication
    WHERE authentication.session_id = ${sessionId} AND NOT EXISTS (
      SELECT 1 FROM user_emails address JOIN user_email_sign_in_permissions permission ON permission.email_id = address.id
       WHERE address.id = authentication.email_id AND address.user_id = ${userId}
         AND address.normalized_email = authentication.normalized_email
         AND permission.revision = authentication.permission_revision
         AND ${secondaryEmailSignInAllowedSql("address")}))`;
}

/** A pending claim is not ownership. Resolve only after the caller has proved this mailbox. */
import { primaryEmailProofMayAuthenticateSql } from "../auth/email-sign-in-policy";
import { nowIso } from "../utils/time";
import { normalizeEmail } from "../validation";
import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../types";
import { prepareRotateUserProposalSpeakerManageSecrets } from "./registrations/manage-capability-revocation";

export interface EmailOwnership {
  userId: string;
  provedUserId: string | null;
  kind: "primary" | "secondary";
  emailId: string | null;
  verifiedAt: string | null;
  alternateId: string | null;
  alternateEmail: string | null;
  alternateVerifiedAt: string | null;
}

export function emailOwnershipSelection(email: string) {
  return {
    sql: `WITH owner AS (
    SELECT person.id AS userId,'primary' AS kind,NULL AS emailId,person.email_verified_at AS verifiedAt,
      CASE WHEN ${primaryEmailProofMayAuthenticateSql("person")} THEN person.id ELSE NULL END AS provedUserId
      FROM users person WHERE person.normalized_email=?
    UNION ALL SELECT user_id,'secondary',id,verified_at,CASE WHEN verified_at IS NOT NULL THEN user_id ELSE NULL END
      FROM user_emails WHERE normalized_email=?
  ) SELECT owner.userId,owner.kind,owner.emailId,owner.verifiedAt,alternate.id AS alternateId,
    alternate.email AS alternateEmail,alternate.verified_at AS alternateVerifiedAt,
    owner.provedUserId
    FROM owner LEFT JOIN user_emails alternate ON alternate.id=(SELECT id FROM user_emails
      WHERE user_id=owner.userId AND verified_at IS NOT NULL ORDER BY created_at,id LIMIT 1) LIMIT 1`,
    bindings: [email, email],
  };
}
export function readEmailOwnership(db: DatabaseLike, email: string): Promise<EmailOwnership | null> {
  const read = emailOwnershipSelection(email);
  return first<EmailOwnership>(db, read.sql, read.bindings);
}
/** A proved mailbox may resolve a verified owner or an unverified primary without other verified addresses. */
export function provedMailboxUserIdSelection(email: string) {
  const read = emailOwnershipSelection(email);
  return { sql: `SELECT ownership.provedUserId FROM (${read.sql}) ownership`, bindings: read.bindings };
}
export function provedMailboxUserId(owner: EmailOwnership | null): string | null {
  return owner?.provedUserId ?? null;
}

/** Release only the exact unverified claim observed before the atomic proof command. Never remove an account or identity. */
export function prepareEmailOwnershipClaim(
  db: DatabaseLike,
  email: string,
  targetUserId: string,
  owner: EmailOwnership | null,
): StatementLike[] {
  const pendingRelease: StatementLike[] = [
    db
      .prepare(`UPDATE registrations SET confirmation_link_secret=NULL,pending_confirmation_deadline_at=NULL,
      confirmation_reminder_sent_at=NULL,updated_at=? WHERE id IN(SELECT pending_email_change_registration_id FROM users
      WHERE pending_email=? AND id<>?)`)
      .bind(nowIso(), email, targetUserId),
    db
      .prepare(`UPDATE users SET pending_email=NULL,pending_email_expires_at=NULL,pending_email_change_registration_id=NULL
      WHERE pending_email=? AND id<>?`)
      .bind(email, targetUserId),
  ];
  if (!owner)
    return [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM users WHERE normalized_email=?) AND NOT EXISTS(SELECT 1 FROM user_emails WHERE normalized_email=?)`,
        bindings: [email, email],
      }),
      ...pendingRelease,
    ];
  const evidence =
    owner.kind === "secondary"
      ? {
          sql: "SELECT 1 FROM user_emails WHERE id=? AND user_id=? AND normalized_email=? AND verified_at IS ?",
          bindings: [owner.emailId, owner.userId, email, owner.verifiedAt],
        }
      : {
          sql: `SELECT 1 FROM users WHERE id=? AND normalized_email=? AND email_verified_at IS ? AND (SELECT id FROM user_emails WHERE user_id=users.id AND verified_at IS NOT NULL ORDER BY created_at,id LIMIT 1) IS ?`,
          bindings: [owner.userId, email, owner.verifiedAt, owner.alternateId],
        };
  const statements: StatementLike[] = [prepareAuthorizationGuard(db, evidence), ...pendingRelease];
  if (owner.userId === targetUserId) return statements;
  if (owner.verifiedAt) return [prepareAuthorizationGuard(db, { sql: "SELECT 1 WHERE 0", bindings: [] })];
  if (owner.kind === "secondary") {
    statements.push(
      db
        .prepare("DELETE FROM user_emails WHERE id=? AND user_id=? AND verified_at IS NULL")
        .bind(owner.emailId, owner.userId),
      // A speaker link mailed to the released address now sits in another person's mailbox.
      prepareRotateUserProposalSpeakerManageSecrets(db, owner.userId),
    );
  } else if (owner.alternateId && owner.alternateEmail && owner.alternateVerifiedAt) {
    // Preserve an already verified account under the address it actually owns.
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM user_emails WHERE id=? AND user_id=? AND email=? AND verified_at=?",
        bindings: [owner.alternateId, owner.userId, owner.alternateEmail, owner.alternateVerifiedAt],
      }),
      db.prepare("DELETE FROM user_emails WHERE id=? AND user_id=?").bind(owner.alternateId, owner.userId),
      db
        .prepare(`UPDATE users SET email=?,normalized_email=?,email_verified_at=?,email_verification_method='magic_link'
      WHERE id=? AND normalized_email=? AND email_verified_at IS NULL`)
        .bind(
          owner.alternateEmail,
          normalizeEmail(owner.alternateEmail),
          owner.alternateVerifiedAt,
          owner.userId,
          email,
        ),
      prepareRotateUserProposalSpeakerManageSecrets(db, owner.userId),
    );
  }
  return statements;
}

/** Consolidate a proved mailbox into its requesting account without importing unproved authority. */
import type { DatabaseLike, StatementLike } from "../types";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { prepareAuditLog } from "./audit";
import { prepareUserLifecyclePublication } from "./user-lifecycle-publication";
import { buildUserAccessOffboardingStatements } from "./membership/offboarding";
import {
  prepareRotateUserProposalSpeakerManageSecrets,
  prepareRotateUserProposalManageSecrets,
  prepareRotateUserRegistrationCapabilities,
} from "./registrations/manage-capability-revocation";

/** These statements run only inside the intended account's single-use mailbox-proof command. */
export async function prepareUnverifiedAccountConsolidation(
  db: DatabaseLike,
  input: { sourceUserId: string; targetUserId: string; normalizedEmail: string; at: string },
): Promise<StatementLike[]> {
  const { sourceUserId, targetUserId, normalizedEmail, at } = input;
  const retiredEmail = `consolidated-${crypto.randomUUID()}@invalid`;
  return [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM users source JOIN users target ON target.id=?
        WHERE source.id=? AND source.id<>target.id AND source.normalized_email=?
          AND source.active=1 AND source.email_verified_at IS NULL
          AND source.pii_redacted_at IS NULL AND source.merged_into_user_id IS NULL
          AND NOT EXISTS(SELECT 1 FROM user_emails address WHERE address.user_id=source.id AND address.verified_at IS NOT NULL)
          AND target.active=1 AND target.email_verified_at IS NOT NULL
          AND target.pii_redacted_at IS NULL AND target.merged_into_user_id IS NULL`,
      bindings: [targetUserId, sourceUserId, normalizedEmail],
    }),
    prepareUserLifecyclePublication(db, sourceUserId, at, "deactivate"),
    ...["sessions", "passkey_credentials", "agenda_calendar_subscriptions", "event_badge_credentials"].map((table) =>
      db.prepare(`UPDATE ${table} SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`).bind(at, sourceUserId),
    ),
    ...["user_roles", "permission_grants"].map((table) =>
      db.prepare(`UPDATE ${table} SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`).bind(at, sourceUserId),
    ),
    db.prepare("UPDATE oauth_authorizations SET status='revoked',updated_at=? WHERE user_id=?").bind(at, sourceUserId),
    db
      .prepare(`UPDATE oauth_authorization_completions SET status='failed',request_ciphertext=NULL,redirect_ciphertext=NULL,
      processing_token=NULL,lease_expires_at=NULL,last_error_code='REVOKED',updated_at=?
      WHERE authorization_id IN(SELECT id FROM oauth_authorizations WHERE user_id=?)`)
      .bind(at, sourceUserId),
    prepareRotateUserRegistrationCapabilities(db, sourceUserId, at),
    prepareRotateUserProposalSpeakerManageSecrets(db, sourceUserId),
    prepareRotateUserProposalManageSecrets(db, sourceUserId),
    ...(await buildUserAccessOffboardingStatements(db, {
      userId: sourceUserId,
      causeKey: `mailbox-consolidation:${sourceUserId}`,
      at,
    })),
    db
      .prepare(`UPDATE users SET email=?,normalized_email=?,active=0,pending_email=NULL,
      pending_email_expires_at=NULL,pending_email_change_registration_id=NULL,updated_at=? WHERE id=?`)
      .bind(retiredEmail, retiredEmail, at, sourceUserId),
    prepareAuditLog(
      db,
      "user",
      targetUserId,
      "unverified_account_consolidated",
      "user",
      sourceUserId,
      { targetUserId, provedEmail: normalizedEmail, previousAccessRevoked: true },
      at,
    ),
  ];
}

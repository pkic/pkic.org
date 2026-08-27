import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { prepareStorageDeletion } from "./storage-deletion-outbox";
import { buildUserAccessOffboardingStatements } from "./membership/offboarding";
import { prepareBadgeRenderJobsForUser } from "./badge-render-job-statements";
import { prepareRotateUserProposalSpeakerManageSecrets } from "./registrations/manage-capability-revocation";

interface AnonymizeUserRow {
  id: string;
  pii_redacted_at: string | null;
  headshot_r2_key: string | null;
  updated_at: string;
}

/** Removes account PII and every authentication/access path in one D1 batch. */
export async function anonymizeAdminUser(db: DatabaseLike, actor: AuthAdmin, userId: string) {
  if (userId === actor.id) throw new AppError(403, "FORBIDDEN", "You cannot anonymize your own account");
  const user = await first<AnonymizeUserRow>(
    db,
    "SELECT id, pii_redacted_at, headshot_r2_key, updated_at FROM users WHERE id = ?",
    [userId],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  if (user.pii_redacted_at) throw new AppError(409, "ALREADY_ANONYMIZED", "User has already been anonymized");

  const at = nowIso();
  const redactedEmail = `redacted-${user.id}@anonymized.invalid`;
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE users
         SET email = ?, normalized_email = ?, pending_email = NULL, pending_email_expires_at = NULL,
             pending_email_change_registration_id = NULL,
             first_name = NULL, last_name = NULL, preferred_name = NULL, organization_name = NULL,
             job_title = NULL, biography = NULL, links_json = NULL, data_json = NULL,
             headshot_r2_key = NULL, headshot_updated_at = NULL,
             role = 'user', active = 0, is_ec_member = 0, pii_redacted_at = ?, updated_at = ?
         WHERE id = ? AND pii_redacted_at IS NULL AND updated_at = ?`,
      )
      .bind(redactedEmail, redactedEmail, at, at, user.id, user.updated_at),
    prepareAuditLogAfterOneChange(db, "admin", actor.id, "user_anonymized", "user", user.id, {
      authenticationRevoked: true,
      profileRedacted: true,
    }),
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
    db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
    db
      .prepare(
        `UPDATE registrations
            SET confirmation_link_secret = NULL,
                pending_confirmation_deadline_at = NULL,
                confirmation_reminder_sent_at = NULL,
                manage_link_secret = lower(hex(randomblob(32))),
                updated_at = ?
          WHERE user_id = ?`,
      )
      .bind(at, user.id),
    prepareRotateUserProposalSpeakerManageSecrets(db, user.id),
    db.prepare("UPDATE user_roles SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
    db
      .prepare("UPDATE permission_grants SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(at, user.id),
    db.prepare("DELETE FROM passkey_credentials WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM user_emails WHERE user_id = ?").bind(user.id),
    ...(await buildUserAccessOffboardingStatements(db, {
      userId: user.id,
      causeKey: `user:${user.id}:anonymize:${user.updated_at}`,
      at,
    })),
    prepareBadgeRenderJobsForUser(db, user.id, at),
  ];
  const deletion = prepareStorageDeletion(db, user.headshot_r2_key, at, "speaker_uploads");
  if (deletion) statements.push(deletion);
  try {
    await db.batch(statements);
  } catch (error) {
    if (!isAuditOneChangeGuardFailure(error)) throw error;
    const current = await first<{ pii_redacted_at: string | null }>(
      db,
      "SELECT pii_redacted_at FROM users WHERE id = ?",
      [user.id],
    );
    if (current?.pii_redacted_at) {
      throw new AppError(409, "ALREADY_ANONYMIZED", "User has already been anonymized");
    }
    throw new AppError(409, "ANONYMIZATION_CONFLICT", "The user changed while anonymization was being prepared");
  }
  return { userId: user.id, previousHeadshotKey: user.headshot_r2_key };
}

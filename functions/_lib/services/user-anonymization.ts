import { prepareUserLifecyclePublication } from "./user-lifecycle-publication";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { prepareStorageDeletion } from "./storage-deletion-outbox";
import { profileImageBucketName } from "./profile-image-storage";
import { buildUserAccessOffboardingStatements } from "./membership/offboarding";
import { prepareBadgeRenderJobsForUser } from "./badge-render-job-statements";
import { prepareRotateUserProposalSpeakerManageSecrets } from "./registrations/manage-capability-revocation";
import { authorizedUserMutationDb } from "./user-management-authorization";
import { prepareAffiliationRedaction } from "./identities/affiliation-redaction";
import { prepareLiveSessionAnonymization } from "./live-session/room-erasure";

interface AnonymizeUserRow {
  id: string;
  normalized_email: string;
  pii_redacted_at: string | null;
  headshot_r2_key: string | null;
  updated_at: string;
}

/** Removes account PII and every authentication/access path in one D1 batch. */
export async function anonymizeUser(db: DatabaseLike, actor: UserBackedAuthAdmin, userId: string) {
  if (userId === actor.id) throw new AppError(403, "FORBIDDEN", "You cannot anonymize your own account");
  const user = await first<AnonymizeUserRow>(
    db,
    "SELECT id, normalized_email, pii_redacted_at, headshot_r2_key, updated_at FROM users WHERE id = ?",
    [userId],
  );
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");
  if (user.pii_redacted_at) throw new AppError(409, "ALREADY_ANONYMIZED", "User has already been anonymized");

  const at = nowIso();
  const redactedEmail = `redacted-${user.id}@anonymized.invalid`;
  const authorizedDb = authorizedUserMutationDb(db, actor, ["users:anonymize"]);
  const statements: StatementLike[] = [
    prepareUserLifecyclePublication(authorizedDb, user.id, at, "anonymize"),
    authorizedDb
      .prepare(
        `UPDATE users
         SET email = ?, normalized_email = ?, pending_email = NULL, pending_email_expires_at = NULL,
             pending_email_change_registration_id = NULL,
             first_name = NULL, last_name = NULL, preferred_name = NULL,
             data_json = NULL,
             headshot_r2_key = NULL, headshot_updated_at = NULL,
             active = 0, is_ec_member = 0, pii_redacted_at = ?, updated_at = ?
         WHERE id = ? AND pii_redacted_at IS NULL AND updated_at = ?`,
      )
      .bind(redactedEmail, redactedEmail, at, at, user.id, user.updated_at),
    prepareAuditLogAfterOneChange(authorizedDb, "admin", actor.id, "user_anonymized", "user", user.id, {
      authenticationRevoked: true,
      profileRedacted: true,
    }),
    authorizedDb
      .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(at, user.id),
    authorizedDb
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
    prepareRotateUserProposalSpeakerManageSecrets(authorizedDb, user.id),
    // An application the person made keeps its stage and history, but not who they were: the status link dies with the name.
    authorizedDb
      .prepare(
        `UPDATE member_applications
            SET applicant_email = ?, applicant_name = 'Redacted',
                manage_token_hash = lower(hex(randomblob(32))), updated_at = ?
          WHERE applicant_user_id = ?
             OR (applicant_user_id IS NULL AND lower(applicant_email) = ?)`,
      )
      .bind(redactedEmail, at, user.id, user.normalized_email),
    ...prepareAffiliationRedaction(authorizedDb, user.id, at),
    ...prepareLiveSessionAnonymization(authorizedDb, user.id, at),
    authorizedDb
      .prepare("UPDATE user_roles SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(at, user.id),
    authorizedDb
      .prepare("UPDATE permission_grants SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(at, user.id),
    authorizedDb.prepare("DELETE FROM passkey_credentials WHERE user_id = ?").bind(user.id),
    authorizedDb.prepare("DELETE FROM user_emails WHERE user_id = ?").bind(user.id),
    // Independence disclosures keep their version and review trail; the free-text answers go.
    authorizedDb
      .prepare("UPDATE proposal_speaker_independent_disclosures SET answers_json = '{}' WHERE user_id = ?")
      .bind(user.id),
    ...(await buildUserAccessOffboardingStatements(authorizedDb, {
      userId: user.id,
      causeKey: `user:${user.id}:anonymize:${user.updated_at}`,
      at,
    })),
    prepareBadgeRenderJobsForUser(authorizedDb, user.id, at),
  ];
  const deletion = prepareStorageDeletion(
    authorizedDb,
    user.headshot_r2_key,
    at,
    profileImageBucketName(user.headshot_r2_key),
  );
  if (deletion) statements.push(deletion);
  try {
    await authorizedDb.batch(statements);
  } catch (error) {
    if (!isAuditChangeGuardFailure(error)) throw error;
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

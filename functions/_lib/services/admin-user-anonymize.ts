import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import { prepareStorageDeletion } from "./storage-deletion-outbox";
import { buildUserAccessOffboardingStatements } from "./membership/offboarding";
import { prepareBadgeRenderJobsForUser } from "./badge-render-job-statements";

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
  const offboardingStatements = await buildUserAccessOffboardingStatements(db, {
    userId: user.id,
    causeKey: `user:${user.id}:anonymize:${user.updated_at}`,
    at,
  });
  const statements: StatementLike[] = [
    // Queue external removals while the user's real address is still present;
    // each durable effect snapshots that exact external identity.
    ...offboardingStatements,
    db
      .prepare(
        `UPDATE users
         SET email = ?, normalized_email = ?, pending_email = NULL, pending_email_expires_at = NULL,
             first_name = NULL, last_name = NULL, preferred_name = NULL, organization_name = NULL,
             job_title = NULL, biography = NULL, links_json = NULL, data_json = NULL,
             headshot_r2_key = NULL, headshot_updated_at = NULL,
             role = 'user', active = 0, is_ec_member = 0, pii_redacted_at = ?, updated_at = ?
         WHERE id = ? AND pii_redacted_at IS NULL`,
      )
      .bind(redactedEmail, redactedEmail, at, at, user.id),
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
    db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
    db.prepare("UPDATE user_roles SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, user.id),
    db
      .prepare("UPDATE permission_grants SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(at, user.id),
    db.prepare("DELETE FROM auth_magic_links WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM passkey_credentials WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM user_emails WHERE user_id = ?").bind(user.id),
    prepareBadgeRenderJobsForUser(db, user.id, at),
    prepareAuditLog(db, "admin", actor.id, "user_anonymized", "user", user.id, {
      authenticationRevoked: true,
      profileRedacted: true,
    }),
  ];
  const deletion = prepareStorageDeletion(db, user.headshot_r2_key, at, "speaker_uploads");
  if (deletion) statements.push(deletion);
  const results = await db.batch(statements);
  const updateResult = results[offboardingStatements.length];
  if ((updateResult.meta?.changes ?? 0) !== 1) {
    throw new AppError(409, "ALREADY_ANONYMIZED", "User has already been anonymized");
  }
  return { userId: user.id, previousHeadshotKey: user.headshot_r2_key };
}

/**
 * POST /api/v1/admin/users/:userId/anonymize
 *
 * Irreversibly removes all PII from a user record and deactivates the account.
 * Active sessions are revoked so the user is signed out immediately.
 *
 * Effects:
 *   - Nulls first_name, last_name, preferred_name, organization_name,
 *     job_title, biography, links_json, data_json, headshot_r2_key
 *   - Replaces email with a non-identifiable placeholder
 *   - Sets active = 0, pii_redacted_at = now
 *   - Revokes all active sessions for the user
 *   - Writes an audit-log entry
 *
 * Only a global admin may call this endpoint.
 * An admin cannot anonymize their own account.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { AppError } from "../../../../../_lib/errors";
import type { PagesContext } from "../../../../../_lib/types";

interface UserRow {
  id: string;
  email: string;
  role: string;
  active: number;
  pii_redacted_at: string | null;
}

export async function onRequestPost(
  context: PagesContext<{ userId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);

  if (context.params.userId === admin.id) {
    throw new AppError(403, "FORBIDDEN", "You cannot anonymize your own account");
  }

  const user = await first<UserRow>(
    context.env.DB,
    "SELECT id, email, role, active, pii_redacted_at FROM users WHERE id = ?",
    [context.params.userId],
  );

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  if (user.pii_redacted_at) {
    throw new AppError(409, "ALREADY_ANONYMIZED", "User has already been anonymized");
  }

  const now = nowIso();
  // Replace the email with a deterministic placeholder so UNIQUE constraints
  // are preserved while all identifying information is gone.
  const redactedEmail = `redacted-${user.id}@anonymized.invalid`;
  const redactedNormalized = redactedEmail;

  await run(
    context.env.DB,
    `UPDATE users
     SET email             = ?,
         normalized_email  = ?,
         first_name        = NULL,
         last_name         = NULL,
         preferred_name    = NULL,
         organization_name = NULL,
         job_title         = NULL,
         biography         = NULL,
         links_json        = NULL,
         data_json         = NULL,
         headshot_r2_key   = NULL,
         headshot_updated_at = NULL,
         active            = 0,
         pii_redacted_at   = ?,
         updated_at        = ?
     WHERE id = ?`,
    [redactedEmail, redactedNormalized, now, now, user.id],
  );

  // Revoke all non-expired sessions so the user is signed out immediately.
  await run(
    context.env.DB,
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?",
    [now, user.id, now],
  );

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "user_anonymized",
    "user",
    user.id,
    { previousEmail: user.email, previousRole: user.role },
  );

  return json({ success: true, userId: user.id });
}

export async function onRequest(
  context: PagesContext<{ userId: string }>,
): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}

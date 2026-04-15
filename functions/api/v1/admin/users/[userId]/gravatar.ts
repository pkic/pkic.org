/**
 * POST /api/v1/admin/users/:userId/gravatar
 *
 * Looks up the user's email on Gravatar (which also covers Libravatar for
 * domains that publish SRV records, though we use the Gravatar API directly
 * for reliability).
 *
 * If a Gravatar image is found, it is downloaded and stored in R2 as the
 * user's headshot — replacing any existing one.
 *
 * Privacy note: Gravatar images are published publicly by the user who set
 * them. Downloading and storing the image locally is acceptable because:
 *   1. The image was explicitly made public by the email owner via gravatar.com
 *   2. We use the standard Gravatar URL hash (SHA-256 of lowercase trimmed email)
 *   3. We only store it for the user whose email matches
 *   4. The user can remove it at any time via the admin headshot delete endpoint
 *
 * The endpoint first checks with `d=404` to see if a custom avatar exists
 * (avoiding the generic placeholder). If none exists it returns a 404.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first } from "../../../../../_lib/db/queries";
import { gravatarHash, fetchGravatar } from "../../../../../_lib/utils/gravatar";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { invalidateAndRerender } from "../../../../../_lib/services/og-badge-prerender";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { AppError } from "../../../../../_lib/errors";

interface UserEmailRow {
  id: string;
  email: string;
  headshot_r2_key: string | null;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function onRequestPost(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const userId = c.req.param("userId");

  const user = await first<UserEmailRow>(c.env.DB, "SELECT id, email, headshot_r2_key FROM users WHERE id = ?", [
    userId,
  ]);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const emailHash = await gravatarHash(user.email); // for audit log
  const r2Key = await fetchGravatar(user.id, user.email, c.env, { force: true });

  if (!r2Key) {
    return json({ error: { code: "NO_GRAVATAR", message: "No Gravatar found for this email address" } }, 404);
  }

  await writeAuditLog(c.env.DB, "admin", admin.id, "headshot_imported_gravatar", "user", user.id, {
    r2Key,
    gravatarHash: emailHash,
  });

  const origin = resolveAppBaseUrl(c.env, c.req.raw);
  c.executionCtx.waitUntil(invalidateAndRerender(user.id, c.env, origin));

  return json({ success: true, r2Key, source: "gravatar" });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}

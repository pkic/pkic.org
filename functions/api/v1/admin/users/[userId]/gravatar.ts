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
import { dispatchPostOnly, json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { downloadGravatar, gravatarHash } from "../../../../../_lib/utils/gravatar";
import { AppError } from "../../../../../_lib/errors";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { commitUserHeadshotUpload, getUserHeadshotRecord } from "../../../../../_lib/services/user-headshot";
import {
  adminUserGravatarImportResponseSchema,
  adminUserGravatarImportRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import type { ValidatedData } from "chanfana";

// ── Handler ─────────────────────────────────────────────────────────────────

export async function onRequestPost(
  c: AdminContext,
  data?: ValidatedData<typeof adminUserGravatarImportRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const userId = data?.params.userId ?? c.req.param("userId");

  const user = await getUserHeadshotRecord(requestDb(c), userId);

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const emailHash = await gravatarHash(user.email); // for audit log
  const image = await downloadGravatar(user.email);
  if (!image) {
    return json({ error: { code: "NO_GRAVATAR", message: "No Gravatar found for this email address" } }, 404);
  }
  const r2Key = await commitUserHeadshotUpload(
    {
      db: requestDb(c),
      env: c.env,
      origin: c.req.raw.url,
      userId: user.id,
      previousKey: user.headshot_r2_key,
      image,
      source: "gravatar",
      audit: {
        actorType: "admin",
        actorId: admin.id,
        action: "headshot_imported_gravatar",
        details: { gravatarHash: emailHash },
      },
    },
    (promise) => c.executionCtx.waitUntil(promise),
  );

  return json(adminUserGravatarImportResponseSchema.parse({ success: true, r2Key, source: "gravatar" }));
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}

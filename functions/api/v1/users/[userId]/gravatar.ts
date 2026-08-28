/**
 * POST /api/v1/users/:userId/gravatar
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
 *   4. The user can remove it at any time via the user headshot delete endpoint
 *
 * The endpoint first checks with `d=404` to see if a custom avatar exists
 * (avoiding the generic placeholder). If none exists it returns a 404.
 */
import { json } from "../../../../_lib/http";
import { downloadGravatar, gravatarHash } from "../../../../_lib/utils/gravatar";
import { AppError } from "../../../../_lib/errors";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  commitUserHeadshotUpload,
  getUserHeadshotRecord,
  userHeadshotTargetGuard,
} from "../../../../_lib/services/user-headshot";
import {
  userGravatarImportResponseSchema,
  userGravatarImportRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-headshots";
import type { ValidatedData } from "chanfana";
import { requireUserStaffPermission } from "../authorization";
import { authorizedUserMutationDb } from "../../../../_lib/services/user-management-authorization";

// ── Handler ─────────────────────────────────────────────────────────────────

async function handleGravatarImport(
  c: AdminContext,
  data: ValidatedData<typeof userGravatarImportRouteSchema>,
): Promise<Response> {
  const { db, staff } = await requireUserStaffPermission(c, "users:write");
  const authorizedDb = authorizedUserMutationDb(db, staff, ["users:write"]);
  const userId = data.params.userId;

  const user = await getUserHeadshotRecord(db, userId);

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const emailHash = await gravatarHash(user.email); // for audit log
  const image = await downloadGravatar(user.email);
  if (!image) {
    return json({ error: { code: "NO_GRAVATAR", message: "No Gravatar found for this email address" } }, 404);
  }
  await commitUserHeadshotUpload(
    {
      db: authorizedDb,
      env: c.env,
      origin: c.req.raw.url,
      userId: user.id,
      previousKey: user.headshot_r2_key,
      commitGuard: userHeadshotTargetGuard(user),
      image,
      source: "gravatar",
      audit: {
        actorType: "admin",
        actorId: staff.id,
        action: "headshot_imported_gravatar",
        details: { gravatarHash: emailHash },
      },
    },
    (promise) => c.executionCtx.waitUntil(promise),
  );

  return json(userGravatarImportResponseSchema.parse({ success: true, source: "gravatar" }));
}

export const UserGravatarPost = openApiRoute(userGravatarImportRouteSchema, handleGravatarImport);
